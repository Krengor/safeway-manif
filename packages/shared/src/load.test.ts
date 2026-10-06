import { describe, expect, it } from 'vitest';
import { DEGRADATION_LEVELS, LevelGovernor, clusterLevel, degradationPolicy, levelForSample } from './load.js';

const calm = { eventLoopP99Ms: 15, latencyP95Ms: 40, errorRate: 0, inFlight: 3 };

describe('niveau de charge', () => {
  it('reste normal au calme et prend le pire indicateur', () => {
    expect(levelForSample(calm)).toBe(0);
    expect(levelForSample({ ...calm, latencyP95Ms: 900 })).toBe(2);
    expect(levelForSample({ ...calm, latencyP95Ms: 900, eventLoopP99Ms: 700 })).toBe(3);
    expect(levelForSample({ ...calm, errorRate: 0.03 })).toBe(1);
  });

  it('monte aussitôt mais redescend un cran à la fois après une période calme', () => {
    const governor = new LevelGovernor(30_000);
    expect(governor.update(3, 0)).toBe(3);
    expect(governor.update(0, 1_000)).toBe(3);
    expect(governor.update(0, 20_000)).toBe(3);
    expect(governor.update(0, 31_000)).toBe(2);
    expect(governor.update(0, 40_000)).toBe(2);
    expect(governor.update(0, 61_000)).toBe(1);
    expect(governor.update(2, 62_000)).toBe(2); // remontée immédiate
  });

  it("agrège le pire niveau des instances vivantes, sauf forçage par l'administrateur", () => {
    const now = 1_000_000;
    const instances = { a: `1|${now - 1000}`, b: `3|${now - 60_000}`, c: `2|${now - 5000}`, d: 'n/a' };
    expect(clusterLevel(instances, null, now)).toEqual({ level: 2, auto: 2, forced: false });
    expect(clusterLevel(instances, '0', now)).toEqual({ level: 0, auto: 2, forced: true });
    expect(clusterLevel({}, '9', now)).toEqual({ level: 0, auto: 0, forced: false });
  });

  it('chaque niveau allège davantage sans jamais couper lecture ni signalement', () => {
    const policies = DEGRADATION_LEVELS.map(degradationPolicy);
    for (let i = 1; i < policies.length; i++) {
      expect(policies[i]!.realtimeBatchMs).toBeGreaterThanOrEqual(policies[i - 1]!.realtimeBatchMs);
      expect(policies[i]!.zoneCacheSeconds).toBeGreaterThanOrEqual(policies[i - 1]!.zoneCacheSeconds);
      expect(policies[i]!.pollFallbackSeconds).toBeLessThanOrEqual(30);
    }
    expect(degradationPolicy(3).routing).toBe(false);
    expect(degradationPolicy(2).secondary).toBe(false);
  });
});
