import cookie, { type CookieSerializeOptions } from '@fastify/cookie';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { API_PREFIX, CSRF_HEADER } from '@safeway/shared';
import Fastify, {
  type FastifyError,
  type FastifyInstance,
  type FastifyRequest,
  type FastifyServerOptions,
} from 'fastify';
import { randomUUID } from 'node:crypto';
import type { Config } from './config.js';
import type { Sql } from './db.js';
import { RedisBus } from './lib/bus.js';
import { rateKey } from './lib/crypto.js';
import { HttpError } from './lib/http.js';
import { LoadMonitor } from './lib/load.js';
import { createApiMetrics, type ApiMetrics } from './lib/metrics.js';
import { RateLimiter } from './lib/rateLimit.js';
import { EventSigner } from './lib/signing.js';
import { SurgeDetector } from './lib/surge.js';
import { SESSION_TTL_SECONDS, SessionStore } from './lib/sessions.js';
import type { Redis } from './redis.js';
import { authRoutes } from './routes/auth.js';
import { eventRoutes } from './routes/events.js';
import { healthRoutes } from './routes/health.js';
import { mapRoutes } from './routes/map.js';
import { meRoutes } from './routes/me.js';
import { EventService } from './services/events.js';
import { RedisReputationLinks, ReputationService } from './services/reputation.js';
import { adminRoutes } from './routes/admin.js';

export interface AppContext {
  config: Config;
  sql: Sql;
  redis: Redis;
  sessions: SessionStore;
  limiter: RateLimiter;
  events: EventService;
  reputation: ReputationService;
  surge: SurgeDetector;
  signer: EventSigner;
  /** Niveau de dégradation contrôlée (§56). */
  load: LoadMonitor;
  metrics: ApiMetrics;
  sessionCookie: string;
  sessionTtl: number;
  cookieOptions: CookieSerializeOptions;
  /** Renvoie l'identifiant de l'utilisateur connecté ou lève une 401. */
  requireUser(request: FastifyRequest): Promise<string>;
}

/** Codes d'erreur de connexion (Node, postgres.js) : dépendance injoignable, pas un bogue. */
const CONNECTION_ERRORS = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'EPIPE',
  'CONNECT_TIMEOUT',
  'CONNECTION_CLOSED',
  'CONNECTION_ENDED',
  'CONNECTION_DESTROYED',
]);

const contexts = new WeakMap<FastifyInstance, AppContext>();

/** Contexte d'une application construite par `buildApp` (métriques, niveau de charge…). */
export const contextOf = (app: FastifyInstance): AppContext => contexts.get(app)!;

export async function buildApp(deps: { config: Config; sql: Sql; redis: Redis }): Promise<FastifyInstance> {
  const { config, sql, redis } = deps;
  const isProd = config.NODE_ENV === 'production';

  const logger: FastifyServerOptions['logger'] =
    config.NODE_ENV === 'test'
      ? false
      : {
          level: config.LOG_LEVEL,
          // Journalisation minimale (§17) : ni IP, ni URL complète (query), ni en-têtes, ni corps.
          serializers: {
            req: (req) => ({ method: req.method, route: (req as unknown as FastifyRequest).routeOptions?.url ?? 'unknown' }),
            res: (res) => ({ statusCode: res.statusCode }),
          },
        };

  const app = Fastify({
    // Nombre de proxies de confiance (Caddy, LB) : nécessaire pour le rate limiting par IP.
    trustProxy: (_address: string, hop: number) => hop < config.TRUST_PROXY_HOPS,
    bodyLimit: 16 * 1024, // les payloads légitimes (WebAuthn compris) font quelques Ko
    genReqId: () => randomUUID(),
    logger,
  });

  const sessionCookie = isProd ? '__Host-sw_session' : 'sw_session';
  const cookieOptions: CookieSerializeOptions = {
    httpOnly: true,
    secure: isProd,
    sameSite: 'strict',
    path: '/',
  };

  const sessions = new SessionStore(redis);
  const load = new LoadMonitor(redis);
  const metrics = createApiMetrics(load);
  const reputationLinks = new RedisReputationLinks(redis);
  const signer = new EventSigner(config.EVENT_SIGNING_KEY);
  const ctx: AppContext = {
    config,
    sql,
    redis,
    sessions,
    limiter: new RateLimiter(redis, config.RATE_LIMIT_SECRET),
    events: new EventService(sql, config.VOTE_TOKEN_SECRET, {
      bus: new RedisBus(redis),
      links: reputationLinks,
      signer,
    }),
    signer,
    reputation: new ReputationService(sql, reputationLinks, redis),
    surge: new SurgeDetector(redis),
    load,
    metrics,
    sessionCookie,
    sessionTtl: SESSION_TTL_SECONDS,
    cookieOptions,
    async requireUser(request) {
      const token = request.cookies[sessionCookie];
      if (!token) throw new HttpError(401, 'unauthenticated');
      const userId = await sessions.resolve(token);
      if (!userId) throw new HttpError(401, 'unauthenticated');
      return userId;
    },
  };

  await app.register(cookie);
  await app.register(helmet, {
    // API JSON uniquement : la CSP du front est servie par le reverse proxy.
    contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
    crossOriginResourcePolicy: { policy: 'same-origin' },
    referrerPolicy: { policy: 'no-referrer' },
    hsts: isProd ? { maxAge: 63072000, includeSubDomains: true, preload: true } : false,
  });

  // Plafonds par IP déclarés route par route (`config.rateLimit`), rien de global : derrière
  // un NAT opérateur, des milliers de manifestants peuvent partager quelques adresses.
  // Compteurs dans Redis, sous une clé HMAC : aucune IP en clair (§18).
  await app.register(rateLimit, {
    global: false,
    redis,
    nameSpace: 'rl:route:',
    keyGenerator: (request) => rateKey(config.RATE_LIMIT_SECRET, `ip:${request.ip}`),
    errorResponseBuilder: () => new HttpError(429, 'rate_limited', 'Trop de requêtes, réessayez dans quelques minutes.'),
  });

  // Mesures système (§56, §64) : durée et statut par motif de route, jamais l'URL réelle.
  app.addHook('onRequest', async () => load.requestStarted());
  app.addHook('onResponse', async (request, reply) => {
    load.requestFinished(reply.elapsedTime, reply.statusCode);
    const route = request.routeOptions.url ?? 'unmatched';
    metrics.requests.inc({ route, method: request.method, status: `${Math.floor(reply.statusCode / 100)}xx` });
    metrics.duration.observe(reply.elapsedTime / 1000, { route });
    if (reply.statusCode === 429) metrics.rateLimited.inc();
  });
  app.addHook('onClose', () => load.stop());
  if (config.NODE_ENV !== 'test') load.start();

  // Défense CSRF (§35) : SameSite=Strict + en-tête personnalisé + vérification d'origine.
  app.addHook('onRequest', async (request) => {
    if (request.method === 'GET' || request.method === 'HEAD' || request.method === 'OPTIONS') return;
    if (request.headers[CSRF_HEADER] !== '1') throw new HttpError(403, 'csrf');
    const origin = request.headers.origin;
    if (origin && origin !== config.PUBLIC_ORIGIN) throw new HttpError(403, 'csrf');
  });

  // Par défaut, rien n'est mis en cache ; les routes publiques surchargent.
  app.addHook('onSend', async (_request, reply) => {
    if (!reply.hasHeader('cache-control')) reply.header('cache-control', 'no-store');
  });

  app.setErrorHandler((error: FastifyError, request, reply) => {
    if (error instanceof HttpError) {
      return reply.code(error.statusCode).send({ error: error.code, message: error.message });
    }
    const status = (error as { statusCode?: number }).statusCode;
    if (status && status >= 400 && status < 500) {
      return reply.code(status).send({ error: 'bad_request' });
    }
    // Redis ou PostgreSQL injoignable : 503 « réessayez », que l'app traite comme une coupure
    // réseau (l'envoi reste en attente et repart seul), plutôt qu'un 500 définitif.
    if (redis.status !== 'ready' || CONNECTION_ERRORS.has(String((error as { code?: unknown }).code))) {
      request.log.warn({ err: { type: error.name } }, 'dépendance indisponible');
      return reply.code(503).send({ error: 'unavailable', message: 'Service momentanément indisponible, réessayez.' });
    }
    // On journalise le type d'erreur, jamais le payload de la requête.
    request.log.error({ err: { type: error.name, message: error.message } }, 'erreur interne');
    return reply.code(500).send({ error: 'internal' });
  });

  app.setNotFoundHandler((_request, reply) => reply.code(404).send({ error: 'not_found' }));

  await app.register(
    async (api) => {
      await healthRoutes(api, ctx);
      await authRoutes(api, ctx);
      await meRoutes(api, ctx);
      await mapRoutes(api, ctx);
      await eventRoutes(api, ctx);
      await adminRoutes(api, ctx);
    },
    { prefix: API_PREFIX },
  );

  contexts.set(app, ctx);
  return app;
}
