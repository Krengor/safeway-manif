/**
 * Test C — votes massifs (§62) : une zone reçoit des milliers de confirmations.
 * Chaque compte de test confirme les signalements de la cellule chaude (un vote par compte
 * et par signalement : prévoir assez de comptes avec `seed <n>`).
 */
import { check } from 'k6';
import http from 'k6/http';
import { BASE, SLO, fixtures, headers, report, vote } from './lib.js';

const HOT_CELL = fixtures.cells[0];

export const options = {
  scenarios: {
    votes: {
      executor: 'constant-arrival-rate',
      rate: Number(__ENV.RATE || 200), // votes par seconde
      timeUnit: '1s',
      duration: __ENV.DURATION || '2m',
      preAllocatedVUs: 200,
      maxVUs: 2000,
    },
  },
  thresholds: {
    'http_req_duration{name:vote}': SLO['http_req_duration{name:vote}'],
    http_req_failed: ['rate<0.005'],
  },
};

export function setup() {
  // Trois signalements actifs sur la cellule chaude, publiés par trois comptes différents.
  ['FOULE_DENSE', 'GAZ_FUMEE', 'PASSAGE_BLOQUE'].forEach((type, i) =>
    report({ vu: i, cookie: fixtures.cookies[i], cell: HOT_CELL }, type),
  );
  // Les zones des fixtures suivent l'ordre des cellules : zones[0] contient cells[0].
  const res = http.get(`${BASE}/api/map/zones/${fixtures.zones[0]}`, { headers: headers(0) });
  const events = res.json('events').filter((e) => e.cell === HOT_CELL);
  check(events, { 'signalements chauds créés': (e) => e.length > 0 });
  return { events };
}

let next = 0;

export default function ({ events }) {
  // Un compte différent à chaque vote (compteur propre à chaque utilisateur virtuel).
  const span = fixtures.cookies.length - 3;
  const i = 3 + ((__VU * 7919 + next++) % span);
  vote({ vu: i, cookie: fixtures.cookies[i], cell: HOT_CELL }, events[next % events.length], 'confirm');
}
