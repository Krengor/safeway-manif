import { loadConfig } from './config.js';
import { createDb } from './db.js';
import { createRedis } from './redis.js';
import { serveMetrics } from './lib/metrics.js';
import { buildApp, contextOf } from './server.js';
import { EventService } from './services/events.js';
import { RedisReputationLinks, ReputationService } from './services/reputation.js';

const MAINTENANCE_INTERVAL_MS = 60_000;

const config = loadConfig();
const sql = createDb(config.DATABASE_URL);
const redis = createRedis(config.REDIS_URL);
// Une erreur de connexion Redis ne doit pas tuer le processus : la carte reste lisible.
redis.on('error', () => {});

const app = await buildApp({ config, sql, redis });
const { metrics } = contextOf(app);
// Métriques internes (§64) : port séparé, joignable seulement depuis le réseau interne.
const metricsServer = config.METRICS_PORT ? serveMetrics(metrics.registry, config.METRICS_PORT, config.METRICS_HOST) : null;

// Maintenance périodique (§11, §21, §30), idempotente et sûre à plusieurs instances :
//   - purge physique des signalements expirés + règlement de la réputation de leurs auteurs ;
//   - retour horaire des réputations vers la neutralité (une seule instance, verrou Redis).
const reputation = new ReputationService(sql, new RedisReputationLinks(redis), redis);
const purgeService = new EventService(sql, config.VOTE_TOKEN_SECRET, {
  onSettled: (rows) => reputation.settle(rows),
  links: new RedisReputationLinks(redis),
});
const maintenance = async () => {
  try {
    const deleted = await purgeService.purgeExpired();
    if (deleted > 0) app.log.info({ deleted }, 'purge des signalements expirés');
    await reputation.decayIfDue();
    const [active] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM events WHERE expires_at > now()`;
    metrics.activeEvents.set(active?.n ?? 0);
  } catch (err) {
    app.log.warn({ err: { type: (err as Error).name } }, 'maintenance échouée');
  }
};
const maintenanceTimer = setInterval(() => void maintenance(), MAINTENANCE_INTERVAL_MS + Math.floor(Math.random() * 10_000));

async function shutdown(signal: string) {
  app.log.info({ signal }, 'arrêt');
  clearInterval(maintenanceTimer);
  metricsServer?.close();
  await app.close();
  await Promise.allSettled([sql.end({ timeout: 5 }), redis.quit()]);
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

await app.listen({ port: config.API_PORT, host: config.API_HOST });
void maintenance();
