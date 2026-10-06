import { isZoneCell, type MapStatusResponse, type ZoneEventsResponse } from '@safeway/shared';
import type { FastifyInstance } from 'fastify';
import { HttpError } from '../lib/http.js';
import { RATE_RULES } from '../lib/rateLimit.js';
import type { AppContext } from '../server.js';

export async function mapRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  /**
   * Événements actifs d'une zone (H3 rés. 7, ≈ 5 km²).
   * Réponse publique, identique pour tous : cache CDN de quelques secondes (§49).
   * Une URL par zone maximise le taux de cache partagé entre utilisateurs.
   */
  app.get<{ Params: { zone: string } }>('/map/zones/:zone', async (request, reply): Promise<ZoneEventsResponse> => {
    await ctx.limiter.consume(RATE_RULES.read, `ip:${request.ip}`);
    const { zone } = request.params;
    if (!isZoneCell(zone)) throw new HttpError(400, 'invalid_zone');

    const events = await ctx.events.listByZones([zone]);
    reply.header('cache-control', 'public, max-age=5, stale-while-revalidate=10');
    return { now: Math.floor(Date.now() / 1000), zones: [zone], events };
  });

  app.get('/map/status', async (_request, reply): Promise<MapStatusResponse> => {
    reply.header('cache-control', 'public, max-age=30');
    // V0.1 : niveau fixe. Le niveau de dégradation (§56) sera piloté par la charge en V0.3.
    return { now: Math.floor(Date.now() / 1000), level: 0, refreshSeconds: 10 };
  });
}
