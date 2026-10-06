/**
 * Métriques internes de l'API (§64), exposées sur un port interne séparé (jamais via Caddy).
 * Étiquettes : motif de route, méthode, classe de statut — rien qui identifie une personne
 * ou un lieu.
 */
import { LATENCY_BUCKETS, MetricsRegistry } from '@safeway/shared';
import { createServer, type Server } from 'node:http';
import type { LoadMonitor } from './load.js';

export type ApiMetrics = ReturnType<typeof createApiMetrics>;

export function createApiMetrics(load: LoadMonitor) {
  const registry = new MetricsRegistry();
  return {
    registry,
    requests: registry.counter('safeway_http_requests_total', 'Requêtes HTTP traitées'),
    duration: registry.histogram('safeway_http_request_duration_seconds', 'Latence des requêtes HTTP', LATENCY_BUCKETS),
    reports: registry.counter('safeway_reports_total', 'Signalements créés ou fusionnés'),
    votes: registry.counter('safeway_votes_total', 'Votes (confirmations / invalidations)'),
    rateLimited: registry.counter('safeway_rate_limited_total', 'Requêtes refusées par une limite de débit'),
    activeEvents: registry.gauge('safeway_active_events', 'Signalements actifs (mesuré par la maintenance)'),
    inFlight: registry.gauge('safeway_http_in_flight', 'Requêtes en cours', () => load.pending),
    level: registry.gauge('safeway_load_level', 'Niveau de dégradation appliqué (0-3)', () => load.level),
    localLevel: registry.gauge('safeway_load_level_local', 'Niveau mesuré sur cette instance (0-3)', () => load.localLevel),
    eventLoop: registry.gauge('safeway_event_loop_p99_ms', 'Retard de la boucle d’événements, p99 (ms)', () => load.lastSample.eventLoopP99Ms),
  };
}

/** Serveur HTTP interne : `GET /metrics` uniquement. */
export function serveMetrics(registry: MetricsRegistry, port: number, host: string): Server {
  const server = createServer((req, res) => {
    if (req.method !== 'GET' || req.url !== '/metrics') return void res.writeHead(404).end();
    res.writeHead(200, { 'content-type': 'text/plain; version=0.0.4', 'cache-control': 'no-store' });
    res.end(registry.render());
  });
  server.listen(port, host);
  return server;
}
