import { MetricsRegistry } from '@safeway/shared';
import { Redis } from 'ioredis';
import { createServer } from 'node:http';
import { loadConfig } from './config.js';
import { createGateway } from './server.js';

const config = loadConfig();

// Connexion dédiée aux abonnements ; ioredis se réabonne seul après une reconnexion.
const subscriber = new Redis(config.REDIS_URL, {
  maxRetriesPerRequest: null,
  retryStrategy: (times) => Math.min(times * 200, 2000),
});
subscriber.on('error', () => {});

const gateway = createGateway(config, subscriber);

const log = (msg: string) => {
  if (config.LOG_LEVEL !== 'silent') process.stdout.write(`${new Date().toISOString()} ${msg}\n`);
};

gateway.server.listen(config.GATEWAY_PORT, config.GATEWAY_HOST, () => {
  log(`realtime-gateway à l'écoute sur ${config.GATEWAY_HOST}:${config.GATEWAY_PORT}`);
});

// Métriques agrégées uniquement (§64) : volumes, jamais de zone ni d'adresse.
const registry = new MetricsRegistry();
const { hub } = gateway;
registry.gauge('safeway_ws_connections', 'Connexions WebSocket ouvertes', () => hub.stats.clients);
registry.gauge('safeway_ws_zones', 'Zones suivies sur cette instance', () => hub.stats.zones);
registry.gauge('safeway_ws_messages_sent', 'Messages envoyés aux clients (cumul)', () => hub.counters.messages);
registry.gauge('safeway_ws_too_slow_closed', 'Clients déconnectés car trop lents (cumul)', () => hub.counters.tooSlow);
registry.gauge('safeway_ws_rejected', 'Connexions refusées (cumul)', () => gateway.rejected);
registry.gauge('safeway_ws_batch_ms', 'Fenêtre de regroupement appliquée (ms)', () => hub.batchMs);
registry.gauge('safeway_load_level', 'Niveau de dégradation appliqué (0-3)', () => gateway.level);
const metricsServer = config.METRICS_PORT
  ? createServer((req, res) => {
      if (req.method !== 'GET' || req.url !== '/metrics') return void res.writeHead(404).end();
      res.writeHead(200, { 'content-type': 'text/plain; version=0.0.4', 'cache-control': 'no-store' });
      res.end(registry.render());
    }).listen(config.METRICS_PORT, config.METRICS_HOST)
  : null;

const statsTimer = setInterval(() => {
  const { clients, zones } = hub.stats;
  log(`connexions=${clients} zones=${zones} niveau=${gateway.level}`);
}, 60_000);

async function shutdown() {
  clearInterval(statsTimer);
  metricsServer?.close();
  await gateway.close();
  subscriber.disconnect();
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown());
process.on('SIGINT', () => void shutdown());
