import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../server.js';

export async function healthRoutes(app: FastifyInstance, { sql, redis }: AppContext): Promise<void> {
  /** Liveness : le processus répond. */
  app.get('/health', async () => ({ ok: true }));

  /** Readiness : dépendances joignables. Redis est optionnel pour la lecture de la carte. */
  app.get('/ready', async (_request, reply) => {
    const [db, cache] = await Promise.allSettled([sql`SELECT 1`, redis.ping()]);
    const ready = db.status === 'fulfilled';
    return reply.code(ready ? 200 : 503).send({
      db: db.status === 'fulfilled',
      redis: cache.status === 'fulfilled',
    });
  });
}
