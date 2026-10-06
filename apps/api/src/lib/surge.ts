/**
 * Détection de pics (§20 « détection statistique d'anomalies ») : nombre de NOUVEAUX
 * signalements par zone (H3 rés. 7) sur des fenêtres de 5 minutes. Seules des zones sont
 * comptées — aucun compte, aucune IP. Un pic n'est pas forcément un abus (une vraie
 * dispersion peut en provoquer un) : il est seulement signalé à la modération.
 */
import type { Redis } from 'ioredis';

export const SURGE_WINDOW_SECONDS = 300;
/** Au-delà, la zone est signalée comme inhabituelle. */
export const SURGE_THRESHOLD = 15;

const windowOf = (offset = 0) => Math.floor(Date.now() / 1000 / SURGE_WINDOW_SECONDS) - offset;
const keyOf = (window: number) => `surge:${window}`;

export class SurgeDetector {
  constructor(private readonly redis: Redis) {}

  record(zone: string): void {
    const key = keyOf(windowOf());
    this.redis
      .multi()
      .zincrby(key, 1, zone)
      .expire(key, SURGE_WINDOW_SECONDS * 3)
      .exec()
      .catch(() => {});
  }

  /** Zones au-dessus du seuil sur la fenêtre courante ou la précédente. */
  async current(threshold = SURGE_THRESHOLD): Promise<{ zone: string; newEvents: number }[]> {
    const best = new Map<string, number>();
    for (const offset of [0, 1]) {
      const rows = await this.redis.zrangebyscore(keyOf(windowOf(offset)), threshold, '+inf', 'WITHSCORES');
      for (let i = 0; i < rows.length; i += 2) {
        const zone = rows[i]!;
        best.set(zone, Math.max(best.get(zone) ?? 0, Number(rows[i + 1])));
      }
    }
    return [...best].map(([zone, newEvents]) => ({ zone, newEvents })).sort((a, b) => b.newEvents - a.newEvents);
  }
}
