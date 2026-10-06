/**
 * Test A — montée progressive (§62) : 1k → 10k → 50k → 100k → 250k → 500k sessions,
 * mis à l'échelle de PEAK (paliers à 0,2 %, 2 %, 10 %, 20 %, 50 % et 100 %).
 *
 *   k6 run -e PEAK=10000 tests/load/k6/a-ramp.js
 *
 * Au-delà de quelques dizaines de milliers d'utilisateurs virtuels, une seule machine k6 ne
 * suffit plus : exécution distribuée (k6-operator, plusieurs injecteurs) pour 250k/500k.
 */
import { SLO } from './lib.js';
import { manifestant } from './user.js';

const peak = Number(__ENV.PEAK || 1000);
const steps = [0.002, 0.02, 0.1, 0.2, 0.5, 1].map((f) => Math.max(1, Math.round(peak * f)));

export const options = {
  scenarios: {
    ramp: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: steps
        .flatMap((target) => [
          { duration: __ENV.STEP_UP || '1m', target },
          { duration: __ENV.STEP_HOLD || '2m', target },
        ])
        .concat([{ duration: '1m', target: 0 }]),
      gracefulRampDown: '30s',
    },
  },
  thresholds: SLO,
};

export default function () {
  manifestant();
}
