/**
 * Réputation (cahier §21) : un seul nombre par compte, jamais affiché ni exposé par l'API.
 *
 * Garde-fous vie privée :
 *   - le lien auteur/votant ↔ signalement ne vit qu'en mémoire (Redis, TTL), le temps de
 *     « régler » le signalement à son expiration, puis il est détruit ;
 *   - aucune date ni historique : seul le nombre courant est stocké ;
 *   - retour automatique vers la valeur neutre (demi-vie ≈ 3 jours), pour qu'une copie de
 *     la base ne révèle pas qui a été actif récemment au-delà de quelques jours.
 */
import { isContested, shouldWithdraw, type EventCounters } from './confidence.js';

export const REPUTATION_NEUTRAL = 1;
export const REPUTATION_MIN = 0.25;
export const REPUTATION_MAX = 2;
/** Facteur appliqué chaque heure à l'écart à la neutralité : 0,99^69 ≈ 0,5 → demi-vie ≈ 69 h. */
export const REPUTATION_HOURLY_DECAY = 0.99;

export type EventOutcome = 'confirmed' | 'withdrawn' | 'neutral';

/** Bilan d'un signalement arrivé à son terme (expiré ou retiré). */
export function eventOutcome(ev: Pick<EventCounters, 'conf' | 'inv' | 'supportW' | 'againstW'>): EventOutcome {
  if (shouldWithdraw(ev)) return 'withdrawn';
  // « Confirmé » : au moins 3 personnes distinctes et pas de contestation significative.
  if (ev.conf >= 3 && !isContested(ev)) return 'confirmed';
  return 'neutral';
}

export type ReputationRole = 'author' | 'confirmer' | 'invalidator';

const DELTAS: Record<ReputationRole, Record<Exclude<EventOutcome, 'neutral'>, number>> = {
  author: { confirmed: 0.1, withdrawn: -0.2 },
  confirmer: { confirmed: 0.03, withdrawn: -0.05 },
  invalidator: { confirmed: -0.05, withdrawn: 0.05 },
};

export function reputationDelta(role: ReputationRole, outcome: EventOutcome): number {
  return outcome === 'neutral' ? 0 : DELTAS[role][outcome];
}

export function clampReputation(value: number): number {
  return Math.min(REPUTATION_MAX, Math.max(REPUTATION_MIN, value));
}
