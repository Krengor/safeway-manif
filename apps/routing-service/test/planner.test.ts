import { EVENT_RES } from '@safeway/shared';
import { gridDisk, latLngToCell } from 'h3-js';
import { describe, expect, it } from 'vitest';
import { NoRouteError, exclusionRings, planRoute } from '../src/planner.js';
import { CircuitBreaker, EngineUnavailableError, type EngineRoute, type RouteEngine } from '../src/valhalla.js';
import type { HazardMap } from '../src/hazards.js';

const FROM: [number, number] = [6.02, 47.238];
const TO: [number, number] = [6.03, 47.238];
const MIDDLE = latLngToCell(47.238, 6.025, EVENT_RES);

const straight: EngineRoute = { shape: [FROM, TO], distanceM: 760, durationS: 550 };
// Détour par le nord : ne traverse pas la cellule du milieu.
const detour = (distanceM: number): EngineRoute => ({
  shape: [FROM, [6.02, 47.243], [6.03, 47.243], TO],
  distanceM,
  durationS: distanceM * 0.72,
});

/** Moteur factice : renvoie le détour dès qu'on lui demande d'exclure quelque chose. */
function fakeEngine(onExclusion: EngineRoute | null, direct: EngineRoute | null = straight) {
  const calls: number[] = [];
  const engine: RouteEngine = {
    async route(_from, _to, rings) {
      calls.push(rings.length);
      return rings.length ? onExclusion : direct;
    },
  };
  return { engine, calls };
}

const hazards = (partial: Partial<HazardMap>): HazardMap => ({
  danger: new Set(),
  uncertain: new Set(),
  complete: true,
  ...partial,
});

describe('planRoute', () => {
  it("sans signalement : un seul calcul, trajet direct, risque « clear »", async () => {
    const { engine, calls } = fakeEngine(null);
    const route = await planRoute(engine, hazards({}), FROM, TO);
    expect(calls).toEqual([0]);
    expect(route).toMatchObject({ strategy: 'direct', risk: 'clear', avoided: { danger: 0, uncertain: 0 } });
  });

  it('contourne une zone dangereuse quand le détour est raisonnable', async () => {
    const { engine } = fakeEngine(detour(1500));
    const route = await planRoute(engine, hazards({ danger: new Set([MIDDLE]) }), FROM, TO);
    expect(route.strategy).toBe('avoid-danger');
    expect(route.risk).toBe('clear');
    expect(route.crossing.danger).toEqual([]);
    expect(route.avoided.danger).toBe(1);
  });

  it('garde le direct et signale le danger si le détour est démesuré', async () => {
    const { engine } = fakeEngine(detour(5000)); // > 3 × 760 m
    const route = await planRoute(engine, hazards({ danger: new Set([MIDDLE]) }), FROM, TO);
    expect(route.strategy).toBe('direct');
    expect(route.risk).toBe('danger');
    expect(route.crossing.danger).toEqual([MIDDLE]);
  });

  it('évite les zones incertaines seulement si le détour reste court (≤ 1,5 ×)', async () => {
    const short = await planRoute(fakeEngine(detour(1000)).engine, hazards({ uncertain: new Set([MIDDLE]) }), FROM, TO);
    expect(short.strategy).toBe('avoid-all');
    const long = await planRoute(fakeEngine(detour(1500)).engine, hazards({ uncertain: new Set([MIDDLE]) }), FROM, TO);
    expect(long.strategy).toBe('direct');
    expect(long.risk).toBe('uncertain');
  });

  it("n'exclut jamais les cellules de départ et d'arrivée", async () => {
    const start = latLngToCell(FROM[1], FROM[0], EVENT_RES);
    const { engine, calls } = fakeEngine(detour(900));
    const route = await planRoute(engine, hazards({ danger: new Set([start]) }), FROM, TO);
    expect(calls).toEqual([0]); // rien d'excluable → un seul calcul
    expect(route.risk).toBe('danger'); // mais le danger au départ est signalé
  });

  it('remonte « aucun chemin » si même le direct est impossible', async () => {
    await expect(planRoute(fakeEngine(null, null).engine, hazards({}), FROM, TO)).rejects.toBeInstanceOf(NoRouteError);
  });

  it('transmet la complétude des données de danger', async () => {
    const route = await planRoute(fakeEngine(null).engine, hazards({ complete: false }), FROM, TO);
    expect(route.hazardsKnown).toBe(false);
  });
});

describe('exclusionRings', () => {
  it('fusionne des cellules voisines en un seul anneau fermé', () => {
    const rings = exclusionRings(gridDisk(MIDDLE, 1));
    expect(rings).toHaveLength(1);
    expect(rings[0]![0]).toEqual(rings[0]!.at(-1));
  });
});

describe('CircuitBreaker', () => {
  it("s'ouvre après des échecs répétés puis refuse sans appeler le moteur", async () => {
    const breaker = new CircuitBreaker(3, 60_000);
    let calls = 0;
    const failing = () => {
      calls++;
      return Promise.reject(new Error('boom'));
    };
    for (let i = 0; i < 3; i++) await expect(breaker.run(failing)).rejects.toBeInstanceOf(EngineUnavailableError);
    await expect(breaker.run(failing)).rejects.toThrow('disjoncteur ouvert');
    expect(calls).toBe(3);
  });

  it('se réarme après un succès', async () => {
    const breaker = new CircuitBreaker(2, 60_000);
    await expect(breaker.run(() => Promise.reject(new Error('x')))).rejects.toThrow();
    await breaker.run(() => Promise.resolve('ok'));
    await expect(breaker.run(() => Promise.reject(new Error('x')))).rejects.toThrow();
    expect(await breaker.run(() => Promise.resolve('ok'))).toBe('ok');
  });
});
