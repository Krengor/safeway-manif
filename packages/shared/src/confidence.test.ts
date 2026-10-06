import { describe, expect, it } from 'vitest';
import {
  computeConfidence,
  computeZoneStatus,
  extendedExpiry,
  isContested,
  shouldWithdraw,
  type EventCounters,
} from './confidence.js';

const NOW = 1_800_000_000;

function ev(partial: Partial<EventCounters>): EventCounters {
  return { type: 'PASSAGE_BLOQUE', conf: 1, inv: 0, lastConfAt: NOW, expiresAt: NOW + 900, ...partial };
}

describe('computeConfidence', () => {
  it('reste faible pour un signalement isolé', () => {
    expect(computeConfidence(ev({}), NOW)).toBe(0.4);
  });

  it('augmente avec les confirmations indépendantes', () => {
    expect(computeConfidence(ev({ conf: 5 }), NOW)).toBeGreaterThan(computeConfidence(ev({ conf: 2 }), NOW));
  });

  it('baisse avec les contradictions', () => {
    expect(computeConfidence(ev({ conf: 3, inv: 2 }), NOW)).toBeLessThan(computeConfidence(ev({ conf: 3 }), NOW));
  });

  it("décroît avec l'âge de la dernière confirmation", () => {
    const fresh = computeConfidence(ev({ conf: 3 }), NOW);
    const old = computeConfidence(ev({ conf: 3, lastConfAt: NOW - 800 }), NOW);
    expect(old).toBeLessThan(fresh);
  });

  it('vaut 0 une fois expiré', () => {
    expect(computeConfidence(ev({ conf: 10, expiresAt: NOW - 1 }), NOW)).toBe(0);
  });
});

describe('computeZoneStatus', () => {
  it('gris sans information', () => {
    expect(computeZoneStatus([], NOW)).toBe('grey');
  });

  it('rouge pour un danger non contesté', () => {
    expect(computeZoneStatus([ev({})], NOW)).toBe('red');
  });

  it('orange pour un danger contesté', () => {
    expect(computeZoneStatus([ev({ conf: 2, inv: 1 })], NOW)).toBe('orange');
  });

  it("vert seulement si le passage libre est confirmé par plusieurs personnes", () => {
    expect(computeZoneStatus([ev({ type: 'PASSAGE_LIBRE', expiresAt: NOW + 600 })], NOW)).toBe('orange');
    expect(computeZoneStatus([ev({ type: 'PASSAGE_LIBRE', conf: 3, expiresAt: NOW + 600 })], NOW)).toBe('green');
  });

  it('le danger prime sur le passage libre', () => {
    const libre = ev({ type: 'PASSAGE_LIBRE', conf: 5, expiresAt: NOW + 600 });
    expect(computeZoneStatus([libre, ev({ conf: 2 })], NOW)).toBe('red');
  });

  it('ignore les informations purement indicatives', () => {
    expect(computeZoneStatus([ev({ type: 'SECOURS_PRESENT' })], NOW)).toBe('grey');
  });

  it('ignore les événements expirés', () => {
    expect(computeZoneStatus([ev({ expiresAt: NOW - 1 })], NOW)).toBe('grey');
  });
});

describe('règles de retrait et prolongation', () => {
  it('détecte une contestation', () => {
    expect(isContested({ conf: 4, inv: 1 })).toBe(false);
    expect(isContested({ conf: 4, inv: 2 })).toBe(true);
  });

  it('retire un signalement massivement invalidé', () => {
    expect(shouldWithdraw({ conf: 1, inv: 2 })).toBe(false);
    expect(shouldWithdraw({ conf: 1, inv: 3 })).toBe(true);
    expect(shouldWithdraw({ conf: 2, inv: 3 })).toBe(false);
  });

  it('prolonge légèrement, plafonné à deux durées de vie', () => {
    const created = NOW - 600;
    // PASSAGE_BLOQUE : TTL 15 min.
    expect(extendedExpiry('PASSAGE_BLOQUE', created, created + 900, NOW)).toBe(NOW + 450);
    expect(extendedExpiry('PASSAGE_BLOQUE', created, created + 900, created + 1700)).toBe(created + 1800);
    // Ne raccourcit jamais.
    expect(extendedExpiry('PASSAGE_BLOQUE', created, NOW + 2000, NOW)).toBe(NOW + 2000);
  });
});
