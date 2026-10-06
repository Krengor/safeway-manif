import cookie, { type CookieSerializeOptions } from '@fastify/cookie';
import helmet from '@fastify/helmet';
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
import { HttpError } from './lib/http.js';
import { RateLimiter } from './lib/rateLimit.js';
import { SESSION_TTL_SECONDS, SessionStore } from './lib/sessions.js';
import type { Redis } from './redis.js';
import { authRoutes } from './routes/auth.js';
import { eventRoutes } from './routes/events.js';
import { healthRoutes } from './routes/health.js';
import { mapRoutes } from './routes/map.js';
import { meRoutes } from './routes/me.js';
import { EventService } from './services/events.js';

export interface AppContext {
  config: Config;
  sql: Sql;
  redis: Redis;
  sessions: SessionStore;
  limiter: RateLimiter;
  events: EventService;
  sessionCookie: string;
  sessionTtl: number;
  cookieOptions: CookieSerializeOptions;
  /** Renvoie l'identifiant de l'utilisateur connecté ou lève une 401. */
  requireUser(request: FastifyRequest): Promise<string>;
}

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
  const ctx: AppContext = {
    config,
    sql,
    redis,
    sessions,
    limiter: new RateLimiter(redis, config.RATE_LIMIT_SECRET),
    events: new EventService(sql, config.VOTE_TOKEN_SECRET),
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
    },
    { prefix: API_PREFIX },
  );

  return app;
}
