import { loadConfig } from './config.js';
import { createDb } from './db.js';
import { createRedis } from './redis.js';
import { buildApp } from './server.js';
import { EventService } from './services/events.js';

const PURGE_INTERVAL_MS = 60_000;

const config = loadConfig();
const sql = createDb(config.DATABASE_URL);
const redis = createRedis(config.REDIS_URL);
// Une erreur de connexion Redis ne doit pas tuer le processus : la carte reste lisible.
redis.on('error', () => {});

const app = await buildApp({ config, sql, redis });

// Purge physique des signalements expirés (§11, §30). Idempotent : plusieurs instances
// peuvent l'exécuter en parallèle sans conséquence, on ajoute du jitter pour les étaler.
const purgeService = new EventService(sql, config.VOTE_TOKEN_SECRET);
const purge = async () => {
  try {
    const deleted = await purgeService.purgeExpired();
    if (deleted > 0) app.log.info({ deleted }, 'purge des signalements expirés');
  } catch (err) {
    app.log.warn({ err: { type: (err as Error).name } }, 'purge échouée');
  }
};
const purgeTimer = setInterval(() => void purge(), PURGE_INTERVAL_MS + Math.floor(Math.random() * 10_000));

async function shutdown(signal: string) {
  app.log.info({ signal }, 'arrêt');
  clearInterval(purgeTimer);
  await app.close();
  await Promise.allSettled([sql.end({ timeout: 5 }), redis.quit()]);
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

await app.listen({ port: config.API_PORT, host: config.API_HOST });
void purge();
