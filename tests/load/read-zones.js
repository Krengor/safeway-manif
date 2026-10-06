/**
 * Scénario de charge A (montée progressive) sur la lecture de la carte — k6.
 *
 *   k6 run -e BASE_URL=https://preprod.example tests/load/read-zones.js
 *
 * À exécuter UNIQUEMENT contre une instance de test vous appartenant.
 * Les paliers 250k/500k nécessitent une exécution distribuée (k6 cloud ou k6-operator).
 */
import http from 'k6/http';
import { check, sleep } from 'k6';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:4173';

// Zones H3 rés. 7 de Besançon : centre-ville + premier anneau (gridDisk(centre, 1)).
const ZONES = [
  '871f82880ffffff',
  '871f82886ffffff',
  '871f82882ffffff',
  '871f82883ffffff',
  '871f82881ffffff',
  '871f82885ffffff',
  '871f82884ffffff',
];

export const options = {
  scenarios: {
    ramp: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '2m', target: Number(__ENV.STAGE1 || 1000) },
        { duration: '3m', target: Number(__ENV.STAGE2 || 10000) },
        { duration: '5m', target: Number(__ENV.STAGE2 || 10000) },
        { duration: '1m', target: 0 },
      ],
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<250'], // SLO lecture (§61)
    http_req_failed: ['rate<0.005'],
  },
};

export default function () {
  // Un client affiche 1 à 3 zones et rafraîchit toutes les 10 s.
  const count = 1 + Math.floor(Math.random() * 3);
  const start = Math.floor(Math.random() * ZONES.length);
  for (let i = 0; i < count; i++) {
    const zone = ZONES[(start + i) % ZONES.length];
    const res = http.get(`${BASE_URL}/api/map/zones/${zone}`, { tags: { name: 'zone' } });
    check(res, { 'statut 200': (r) => r.status === 200 });
  }
  sleep(10);
}
