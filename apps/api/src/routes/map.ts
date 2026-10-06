import {
  SIGNING_KEY_PATH,
  degradationPolicy,
  isZoneCell,
  type MapStatusResponse,
  type SigningKeyResponse,
  type ZoneEventsResponse,
} from '@safeway/shared';
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

    const events = await ctx.events.listZone(zone);
    // Sous forte charge, le cache s'allonge : moins de requêtes atteignent l'origine (§56).
    const maxAge = degradationPolicy(ctx.load.level).zoneCacheSeconds;
    reply.header('cache-control', `public, max-age=${maxAge}, stale-while-revalidate=${maxAge * 2}`);
    return { now: Math.floor(Date.now() / 1000), zones: [zone], events };
  });

  /** Clé publique de signature : mise en cache par le client pour vérifier hors ligne. */
  app.get(SIGNING_KEY_PATH, async (_request, reply): Promise<SigningKeyResponse> => {
    reply.header('cache-control', 'public, max-age=86400');
    return ctx.signer.publicKey;
  });

  app.get('/map/status', async (_request, reply): Promise<MapStatusResponse> => {
    // Niveau de dégradation contrôlée (§56), recalculé toutes les 5 s à partir de la charge.
    reply.header('cache-control', 'public, max-age=5');
    return { now: Math.floor(Date.now() / 1000), level: ctx.load.level };
  });
}
