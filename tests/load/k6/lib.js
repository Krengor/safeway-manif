/**
 * Outils communs aux scénarios k6 (cahier §62).
 *
 * Variables d'environnement :
 *   BASE_URL   API visée (défaut http://localhost:4380). Pour simuler de nombreux appareils,
 *              viser l'API directement avec TRUST_PROXY_HOPS=1 : k6 joue alors le rôle du
 *              proxy et chaque utilisateur virtuel annonce sa propre adresse (X-Forwarded-For).
 *   ORIGIN     origine du front (défaut http://localhost:5173), pour les WebSockets.
 *   WS_URL     gateway temps réel (défaut ws://localhost:4381/ws).
 *   IPS        nombre d'adresses simulées (défaut 2000) ; moins = NAT opérateur plus chargé.
 */
import http from 'k6/http';
import { check } from 'k6';

export const BASE = __ENV.BASE_URL || 'http://localhost:4380';
export const ORIGIN = __ENV.ORIGIN || 'http://localhost:5173';
export const WS_URL = __ENV.WS_URL || 'ws://localhost:4381/ws';
const IPS = Number(__ENV.IPS || 2000);

/** Fixtures écrites par `npm run loadtest -w @safeway/api -- seed <n>`. */
export const fixtures = JSON.parse(open('../fixtures.json'));

// 429 (limite atteinte) et 409 sont des réponses normales, pas des échecs du service.
http.setResponseCallback(http.expectedStatuses({ min: 200, max: 299 }, 404, 409, 429));

export const pick = (list) => list[Math.floor(Math.random() * list.length)];

/** Adresse simulée d'un utilisateur virtuel (plage de test, jamais routée). */
export function ipFor(vu) {
  const n = vu % IPS;
  return `198.18.${Math.floor(n / 250)}.${(n % 250) + 1}`;
}

export function headers(vu, extra = {}) {
  return { 'x-forwarded-for': ipFor(vu), ...extra };
}

/** Un « appareil » : son compte, sa zone d'intérêt. */
export function device(vu) {
  const cookie = fixtures.cookies[vu % fixtures.cookies.length];
  const cell = fixtures.cells[(vu * 7919) % fixtures.cells.length];
  return { vu, cookie, cell };
}

/** Lecture de la carte : 1 à 4 zones, comme un téléphone qui affiche une vue. */
export function readMap(vu, zones) {
  const requests = zones.map((zone) => ['GET', `${BASE}/api/map/zones/${zone}`, null, { headers: headers(vu), tags: { name: 'zones' } }]);
  const responses = http.batch(requests);
  for (const res of responses) check(res, { 'carte lue': (r) => r.status === 200 });
  return responses.flatMap((r) => (r.status === 200 ? r.json('events') : []));
}

export function status(vu) {
  return http.get(`${BASE}/api/map/status`, { headers: headers(vu), tags: { name: 'status' } });
}

const write = (vu, cookie) => headers(vu, { cookie, 'x-safeway': '1', 'content-type': 'application/json' });

export function report(dev, type = pick(['FOULE_DENSE', 'GAZ_FUMEE', 'PASSAGE_BLOQUE', 'INTERVENTION_EN_COURS', 'PASSAGE_LIBRE'])) {
  const res = http.post(`${BASE}/api/events`, JSON.stringify({ type, cell: dev.cell, presenceCell: dev.cell }), {
    headers: write(dev.vu, dev.cookie),
    tags: { name: 'report' },
  });
  check(res, { 'signalement accepté ou limité': (r) => [200, 201, 429].includes(r.status) });
  return res;
}

export function vote(dev, event, kind = 'confirm') {
  const res = http.post(`${BASE}/api/events/${event.id}/${kind}`, JSON.stringify({ presenceCell: event.cell }), {
    headers: write(dev.vu, dev.cookie),
    tags: { name: 'vote' },
  });
  check(res, { 'vote accepté ou limité': (r) => [200, 404, 429].includes(r.status) });
  return res;
}

/** Zones affichées par un appareil : sa zone et quelques voisines. */
export function viewOf(dev) {
  const zones = fixtures.zones;
  const count = Math.min(1 + (dev.vu % 4), zones.length);
  return Array.from({ length: count }, (_, i) => zones[(dev.vu + i) % zones.length]);
}

/** Seuils communs (SLO initiaux, §61). */
export const SLO = {
  'http_req_duration{name:zones}': ['p(95)<250', 'p(99)<1000'],
  'http_req_duration{name:report}': ['p(95)<500'],
  'http_req_duration{name:vote}': ['p(95)<500'],
  http_req_failed: ['rate<0.005'],
  checks: ['rate>0.99'],
};
