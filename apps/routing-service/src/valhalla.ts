/**
 * Client Valhalla protégé (§57, §58) : délai maximum, pas de retry implicite,
 * disjoncteur qui s'ouvre après des pannes répétées pour ne pas empiler les requêtes.
 */
import { decodePolyline, polylineLengthM, trimBacktracks } from '@safeway/shared';

export interface EngineRoute {
  shape: [number, number][];
  distanceM: number;
  durationS: number;
}

export interface RouteEngine {
  /** Null si aucun chemin n'existe avec ces contraintes ; lève une erreur si le moteur est en panne. */
  route(from: [number, number], to: [number, number], excludeRings: [number, number][][]): Promise<EngineRoute | null>;
}

export class EngineUnavailableError extends Error {}

export class CircuitBreaker {
  private failures = 0;
  private openUntil = 0;

  constructor(
    private readonly threshold = 5,
    private readonly cooldownMs = 30_000,
  ) {}

  async run<T>(task: () => Promise<T>): Promise<T> {
    if (Date.now() < this.openUntil) throw new EngineUnavailableError('disjoncteur ouvert');
    try {
      const result = await task();
      this.failures = 0;
      return result;
    } catch (err) {
      if (++this.failures >= this.threshold) this.openUntil = Date.now() + this.cooldownMs;
      throw err instanceof EngineUnavailableError ? err : new EngineUnavailableError((err as Error).message);
    }
  }
}

interface ValhallaResponse {
  trip?: { summary: { length: number; time: number }; legs: { shape: string }[] };
}

export class ValhallaEngine implements RouteEngine {
  private readonly breaker = new CircuitBreaker();

  constructor(
    private readonly baseUrl: string,
    private readonly timeoutMs = 4000,
  ) {}

  route(from: [number, number], to: [number, number], excludeRings: [number, number][][]): Promise<EngineRoute | null> {
    return this.breaker.run(async () => {
      const res = await fetch(`${this.baseUrl}/route`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        signal: AbortSignal.timeout(this.timeoutMs),
        body: JSON.stringify({
          locations: [
            { lon: from[0], lat: from[1] },
            { lon: to[0], lat: to[1] },
          ],
          costing: 'pedestrian',
          directions_type: 'none',
          units: 'kilometers',
          ...(excludeRings.length ? { exclude_polygons: excludeRings } : {}),
        }),
      });
      // 4xx : contraintes impossibles (pas de chemin) — ce n'est pas une panne du moteur.
      if (res.status >= 400 && res.status < 500) return null;
      if (!res.ok) throw new Error(`valhalla ${res.status}`);
      const data = (await res.json()) as ValhallaResponse;
      const trip = data.trip;
      if (!trip?.legs[0]) return null;
      const raw = trip.legs.flatMap((leg) => decodePolyline(leg.shape, 6));
      const shape = trimBacktracks(raw);
      // Distance et durée réduites au prorata de la longueur retirée.
      const ratio = polylineLengthM(shape) / Math.max(1, polylineLengthM(raw));
      return {
        shape,
        distanceM: Math.round(trip.summary.length * 1000 * ratio),
        durationS: Math.round(trip.summary.time * ratio),
      };
    });
  }
}
