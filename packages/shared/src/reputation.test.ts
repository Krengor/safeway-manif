import { describe, expect, it } from 'vitest';
import { computeConfidence, shouldWithdraw, type EventCounters } from './confidence.js';
import { REPUTATION_MAX, REPUTATION_MIN, clampReputation, eventOutcome, reputationDelta } from './reputation.js';

const NOW = 1_800_000_000;
const ev = (partial: Partial<EventCounters>): EventCounters => ({
  type: 'PASSAGE_BLOQUE',
  conf: 1,
  inv: 0,
  lastConfAt: NOW,
  expiresAt: NOW + 900,
  ...partial,
});

describe('confiance pondérée', () => {
  it("un auteur fiable pèse plus qu'un auteur peu fiable", () => {
    const trusted = computeConfidence(ev({ supportW: 2 }), NOW);
    const doubtful = computeConfidence(ev({ supportW: 0.25 }), NOW);
    expect(trusted).toBeGreaterThan(computeConfidence(ev({}), NOW));
    expect(doubtful).toBeLessThan(computeConfidence(ev({}), NOW));
  });

  it('sans poids, retombe sur le nombre de personnes (compatibilité)', () => {
    expect(computeConfidence(ev({ conf: 3 }), NOW)).toBe(computeConfidence(ev({ conf: 3, supportW: 3 }), NOW));
  });

  it('le retrait exige toujours au moins 3 personnes, quel que soit leur poids', () => {
    expect(shouldWithdraw({ conf: 1, inv: 2, supportW: 0.25, againstW: 4 })).toBe(false);
    expect(shouldWithdraw({ conf: 1, inv: 3, supportW: 0.25, againstW: 3 })).toBe(true);
  });

  it('des invalidateurs peu fiables ne suffisent pas à retirer un signalement fiable', () => {
    expect(shouldWithdraw({ conf: 2, inv: 3, supportW: 4, againstW: 0.75 })).toBe(false);
  });
});

describe('bilan et réputation', () => {
  it('classe le bilan des signalements', () => {
    expect(eventOutcome({ conf: 3, inv: 0 })).toBe('confirmed');
    expect(eventOutcome({ conf: 1, inv: 3 })).toBe('withdrawn');
    expect(eventOutcome({ conf: 2, inv: 0 })).toBe('neutral');
    expect(eventOutcome({ conf: 4, inv: 2 })).toBe('neutral'); // contesté
  });

  it('récompense les bons signalements et pénalise les faux, plus fortement', () => {
    expect(reputationDelta('author', 'confirmed')).toBeGreaterThan(0);
    expect(reputationDelta('author', 'withdrawn')).toBeLessThan(-reputationDelta('author', 'confirmed'));
    expect(reputationDelta('invalidator', 'withdrawn')).toBeGreaterThan(0);
    expect(reputationDelta('author', 'neutral')).toBe(0);
  });

  it('borne la réputation', () => {
    expect(clampReputation(5)).toBe(REPUTATION_MAX);
    expect(clampReputation(-1)).toBe(REPUTATION_MIN);
  });
});
