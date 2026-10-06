/**
 * Test I — DDoS applicatif simulé (§62, §66).
 *
 * Deux populations en parallèle :
 *   - `attaquants` : quelques adresses qui martèlent la lecture et l'écriture ;
 *   - `manifestants` : le trafic normal, qui doit rester servi.
 * Attendu : les attaquants reçoivent des 429, les manifestants restent dans les SLO.
 * (Le volumétrique pur relève de l'anti-DDoS en amont, pas de l'application.)
 */
import http from 'k6/http';
import { BASE, fixtures, pick } from './lib.js';
import { manifestant } from './user.js';

const duration = __ENV.DURATION || '3m';
const ATTACKERS = Number(__ENV.ATTACKERS || 3);

export const options = {
  scenarios: {
    attaquants: {
      executor: 'constant-arrival-rate',
      exec: 'attack',
      rate: Number(__ENV.ATTACK_RATE || 300),
      timeUnit: '1s',
      startTime: '20s', // l'attaque démarre une fois les manifestants connectés
      duration,
      preAllocatedVUs: 100,
      maxVUs: 1000,
    },
    manifestants: {
      executor: 'ramping-vus',
      exec: 'normal',
      stages: [
        { duration: '20s', target: Number(__ENV.USERS || 300) },
        { duration, target: Number(__ENV.USERS || 300) },
      ],
    },
  },
  thresholds: {
    'http_req_duration{scenario:manifestants,name:zones}': ['p(95)<250'],
    'checks{scenario:manifestants}': ['rate>0.99'],
  },
};

export function attack() {
  const ip = `203.0.113.${(__VU % ATTACKERS) + 1}`;
  if (Math.random() < 0.7) {
    http.get(`${BASE}/api/map/zones/${pick(fixtures.zones)}`, {
      headers: { 'x-forwarded-for': ip },
      tags: { name: 'flood-read' },
    });
  } else {
    const cell = pick(fixtures.cells);
    http.post(`${BASE}/api/events`, JSON.stringify({ type: 'DANGER_AUTRE', cell, presenceCell: cell }), {
      headers: {
        'x-forwarded-for': ip,
        cookie: fixtures.cookies[__VU % ATTACKERS],
        'x-safeway': '1',
        'content-type': 'application/json',
      },
      tags: { name: 'flood-write' },
    });
  }
}

export function normal() {
  manifestant([5, 15]);
}
