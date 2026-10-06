/**
 * Test B — pic brutal (§62) : de BASE à PEAK utilisateurs en quelques minutes
 * (ex. 50k → 300k : `-e BASE=50000 -e PEAK=300000`, en exécution distribuée).
 * Attendu : pas d'effondrement ; le niveau de dégradation (§56) monte puis redescend.
 */
import { manifestant } from './user.js';

const base = Number(__ENV.BASE || 200);
const peak = Number(__ENV.PEAK || 1200);

export const options = {
  scenarios: {
    spike: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '1m', target: base },
        { duration: '2m', target: base },
        { duration: __ENV.RISE || '2m', target: peak },
        { duration: '3m', target: peak },
        { duration: '1m', target: base },
        { duration: '2m', target: base },
        { duration: '30s', target: 0 },
      ],
      gracefulRampDown: '30s',
    },
  },
  // Pendant un pic, la continuité prime sur la latence (§61) : seuils de survie.
  thresholds: {
    'http_req_duration{name:zones}': ['p(95)<1000'],
    http_req_failed: ['rate<0.01'],
  },
};

export default function () {
  manifestant();
}
