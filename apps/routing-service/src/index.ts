import { loadConfig } from './config.js';
import { PublicApiHazards } from './hazards.js';
import { buildRoutingServer } from './server.js';
import { ValhallaEngine } from './valhalla.js';

const config = loadConfig();

const app = buildRoutingServer({
  engine: new ValhallaEngine(config.VALHALLA_URL),
  hazards: new PublicApiHazards(config.MAP_API_URL),
  publicOrigin: config.PUBLIC_ORIGIN,
  trustProxyHops: config.TRUST_PROXY_HOPS,
  logLevel: config.LOG_LEVEL,
});

const shutdown = async () => {
  await app.close();
  process.exit(0);
};
process.on('SIGTERM', () => void shutdown());
process.on('SIGINT', () => void shutdown());

await app.listen({ port: config.ROUTING_PORT, host: config.ROUTING_HOST });
