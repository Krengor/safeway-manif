/**
 * Test D — événement viral (§62) : la majorité des utilisateurs se concentre sur une ville,
 * voire sur deux ou trois zones H3. Tout le monde lit les mêmes zones : c'est le micro-cache
 * par zone de l'API et le cache HTTP public qui doivent encaisser.
 */
import { sleep } from 'k6';
import { SLO, device, fixtures, readMap, report } from './lib.js';

const HOT = fixtures.zones.slice(0, 3);
const peak = Number(__ENV.PEAK || 1000);

export const options = {
  scenarios: {
    viral: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '1m', target: peak },
        { duration: __ENV.HOLD || '5m', target: peak },
        { duration: '30s', target: 0 },
      ],
    },
  },
  thresholds: SLO,
};

export default function () {
  readMap(__VU, HOT);
  if (Math.random() < 0.01) report(device(__VU));
  sleep(5 + Math.random() * 10);
}
