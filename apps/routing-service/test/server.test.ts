import { CSRF_HEADER, ROUTE_PATH, routeCells } from '@safeway/shared';
import { describe, expect, it } from 'vitest';
import type { HazardSource } from '../src/hazards.js';
import { buildRoutingServer } from '../src/server.js';
import { EngineUnavailableError, ValhallaEngine, type RouteEngine } from '../src/valhalla.js';

const ORIGIN = 'http://localhost:5173';
const FROM: [number, number] = [6.0205, 47.2385];
const TO: [number, number] = [6.0296, 47.2376];

const noHazards: HazardSource = {
  hazardsAround: async () => ({ danger: new Set(), uncertain: new Set(), complete: true }),
};
const okEngine: RouteEngine = { route: async () => ({ shape: [FROM, TO], distanceM: 700, durationS: 500 }) };

function app(engine: RouteEngine = okEngine, hazards: HazardSource = noHazards) {
  return buildRoutingServer({ engine, hazards, publicOrigin: ORIGIN, logLevel: 'silent' });
}

const post = (server: ReturnType<typeof app>, payload: unknown, headers: Record<string, string> = { [CSRF_HEADER]: '1' }) =>
  server.inject({ method: 'POST', url: ROUTE_PATH, payload: payload as object, headers });

describe('routing-service HTTP', () => {
  it('calcule un trajet et ne met rien en cache', async () => {
    const res = await post(app(), { from: FROM, to: TO });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ strategy: 'direct', risk: 'clear', distanceM: 700 });
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it("exige l'en-tête anti-CSRF et la bonne origine", async () => {
    expect((await post(app(), { from: FROM, to: TO }, {})).statusCode).toBe(403);
    expect((await post(app(), { from: FROM, to: TO }, { [CSRF_HEADER]: '1', origin: 'https://evil.example' })).statusCode).toBe(403);
  });

  it('refuse un payload invalide ou un trajet trop long', async () => {
    expect((await post(app(), { from: FROM })).statusCode).toBe(400);
    const far = await post(app(), { from: FROM, to: [2.35, 48.85] }); // Besançon → Paris
    expect(far.statusCode).toBe(400);
    expect(far.json().error).toBe('too_far');
  });

  it('répond 503 proprement quand le moteur est indisponible', async () => {
    const down: RouteEngine = { route: () => Promise.reject(new EngineUnavailableError('down')) };
    const res = await post(app(down), { from: FROM, to: TO });
    expect(res.statusCode).toBe(503);
    expect(res.json().error).toBe('routing_unavailable');
  });

  it('limite le nombre de calculs par minute', async () => {
    const server = app();
    const codes = [];
    for (let i = 0; i < 22; i++) codes.push((await post(server, { from: FROM, to: TO })).statusCode);
    expect(codes.slice(0, 20).every((c) => c === 200)).toBe(true);
    expect(codes.at(-1)).toBe(429);
  });
});

/** Intégration avec le vrai moteur (docker compose dev). Ignoré si Valhalla n'est pas lancé. */
const valhallaUp = await fetch('http://127.0.0.1:8002/status', { signal: AbortSignal.timeout(1500) })
  .then((r) => r.ok)
  .catch(() => false);

describe.skipIf(!valhallaUp)('avec Valhalla (Besançon)', () => {
  it('contourne une zone dangereuse posée au milieu du trajet direct', async () => {
    const engine = new ValhallaEngine('http://127.0.0.1:8002');
    const direct = await engine.route(FROM, TO, []);
    expect(direct).not.toBeNull();
    const cells = routeCells(direct!.shape);
    const middle = cells[Math.floor(cells.length / 2)]!;

    const hazards: HazardSource = {
      hazardsAround: async () => ({ danger: new Set([middle]), uncertain: new Set(), complete: true }),
    };
    const res = await post(app(engine, hazards), { from: FROM, to: TO });
    expect(res.statusCode).toBe(200);
    const route = res.json();
    expect(route.strategy).toBe('avoid-danger');
    expect(route.risk).toBe('clear');
    expect(routeCells(route.shape)).not.toContain(middle);
    expect(route.distanceM).toBeGreaterThanOrEqual(direct!.distanceM);
  });
});
