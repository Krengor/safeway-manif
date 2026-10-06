/**
 * routing-service (§55) — HTTP, stateless, sans identité.
 *
 * Confidentialité :
 *   - le reverse proxy retire le cookie : ce service ne sait pas QUI demande un trajet ;
 *   - aucune coordonnée n'est journalisée (journal : route, statut, durée) ni conservée ;
 *   - le rate limiting se fait en mémoire, sur une fenêtre d'une minute (§18).
 */
import {
  CSRF_HEADER,
  MAX_ROUTE_DISTANCE_M,
  ROUTE_PATH,
  distanceM,
  routeRequestSchema,
  type RouteResponse,
} from '@safeway/shared';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import { randomUUID } from 'node:crypto';
import type { HazardSource } from './hazards.js';
import { NoRouteError, planRoute } from './planner.js';
import { EngineUnavailableError, type RouteEngine } from './valhalla.js';

const RATE_LIMIT = 20;
const RATE_WINDOW_MS = 60_000;

export interface RoutingDeps {
  engine: RouteEngine;
  hazards: HazardSource;
  publicOrigin: string;
  trustProxyHops?: number;
  logLevel?: string;
}

export function buildRoutingServer(deps: RoutingDeps): FastifyInstance {
  const logger: FastifyServerOptions['logger'] =
    deps.logLevel === 'silent'
      ? false
      : {
          level: deps.logLevel ?? 'info',
          serializers: {
            req: (req) => ({ method: req.method, route: '/api/route' }),
            res: (res) => ({ statusCode: res.statusCode }),
          },
        };

  const app = Fastify({
    logger,
    bodyLimit: 1024,
    genReqId: () => randomUUID(),
    trustProxy: (_address: string, hop: number) => hop < (deps.trustProxyHops ?? 0),
  });

  // Compteurs en mémoire uniquement, vidés à chaque fenêtre : aucune IP ne persiste.
  let windowStart = Date.now();
  let counters = new Map<string, number>();
  const limited = (ip: string) => {
    if (Date.now() - windowStart > RATE_WINDOW_MS) {
      windowStart = Date.now();
      counters = new Map();
    }
    const n = (counters.get(ip) ?? 0) + 1;
    counters.set(ip, n);
    return n > RATE_LIMIT;
  };

  app.addHook('onSend', async (_request, reply) => {
    reply.header('cache-control', 'no-store');
    reply.header('referrer-policy', 'no-referrer');
    reply.header('x-content-type-options', 'nosniff');
  });

  app.get('/health', async () => ({ ok: true }));

  app.post(ROUTE_PATH, async (request, reply): Promise<RouteResponse | { error: string; message?: string }> => {
    if (request.headers[CSRF_HEADER] !== '1') return reply.code(403).send({ error: 'csrf' });
    const origin = request.headers.origin;
    if (origin && origin !== deps.publicOrigin) return reply.code(403).send({ error: 'csrf' });
    if (limited(request.ip)) {
      return reply.code(429).send({ error: 'rate_limited', message: 'Trop de calculs, patientez une minute.' });
    }

    const parsed = routeRequestSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_payload' });
    const { from, to } = parsed.data;
    if (distanceM(from, to) > MAX_ROUTE_DISTANCE_M) {
      return reply.code(400).send({ error: 'too_far', message: 'Destination trop éloignée pour un trajet à pied.' });
    }

    try {
      const hazards = await deps.hazards.hazardsAround(from, to);
      return await planRoute(deps.engine, hazards, from, to);
    } catch (err) {
      if (err instanceof NoRouteError) {
        return reply.code(404).send({ error: 'no_route', message: 'Aucun chemin piéton trouvé.' });
      }
      if (err instanceof EngineUnavailableError) {
        // Circuit breaker (§57) : le reste de l'app continue de fonctionner.
        return reply.code(503).send({ error: 'routing_unavailable', message: 'Routage temporairement indisponible.' });
      }
      request.log.error({ err: { type: (err as Error).name } }, 'erreur de routage');
      return reply.code(500).send({ error: 'internal' });
    }
  });

  return app;
}
