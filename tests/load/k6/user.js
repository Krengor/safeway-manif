/**
 * Comportement d'un manifestant type, partagé par les scénarios A, B, D et I.
 *
 * Toutes les 10 à 30 s : lecture de 1 à 4 zones (comme le polling de l'app quand le temps
 * réel est coupé — le pire cas pour l'API). De temps en temps : un vote sur un signalement
 * vu, plus rarement un nouveau signalement.
 */
import { sleep } from 'k6';
import { device, pick, readMap, report, status, viewOf, vote } from './lib.js';

export const REPORT_PROBABILITY = Number(__ENV.REPORT_P || 0.02);
export const VOTE_PROBABILITY = Number(__ENV.VOTE_P || 0.1);

export function manifestant(think = [10, 30]) {
  const dev = device(__VU);
  const events = readMap(__VU, viewOf(dev));
  if (__ITER % 6 === 0) status(__VU);

  const roll = Math.random();
  if (roll < REPORT_PROBABILITY) report(dev);
  else if (roll < REPORT_PROBABILITY + VOTE_PROBABILITY) {
    const near = events.filter((e) => e.cell === dev.cell);
    if (near.length) vote(dev, pick(near), Math.random() < 0.85 ? 'confirm' : 'invalidate');
  }
  sleep(think[0] + Math.random() * (think[1] - think[0]));
}
