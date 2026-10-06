import { Redis } from 'ioredis';
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

// Métriques agrégées uniquement (§64) : nombre de connexions et de zones, rien d'autre.
const statsTimer = setInterval(() => {
  const { clients, zones } = gateway.hub.stats;
  log(`connexions=${clients} zones=${zones}`);
}, 60_000);

async function shutdown() {
  clearInterval(statsTimer);
  await gateway.close();
  subscriber.disconnect();
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown());
process.on('SIGINT', () => void shutdown());
