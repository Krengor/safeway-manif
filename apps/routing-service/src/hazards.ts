/**
 * Couche de danger temporaire (§55) : statut des cellules à partir des signalements publics.
 *
 * Le service interroge l'API publique par zone — exactement les données qu'un client voit —
 * avec un cache mémoire de quelques secondes. Il n'a aucun accès à la base de données.
 */
import {
  ZONE_RES,
  computeZoneStatus,
  type PublicEvent,
  type ZoneEventsResponse,
} from '@safeway/shared';
import { POLYGON_TO_CELLS_FLAGS, polygonToCellsExperimental } from 'h3-js';

export interface HazardMap {
  danger: Set<string>;
  uncertain: Set<string>;
  /** false si au moins une zone n'a pas pu être chargée. */
  complete: boolean;
}

export interface HazardSource {
  hazardsAround(from: [number, number], to: [number, number]): Promise<HazardMap>;
}

const CACHE_MS = 5000;
/** Marge autour du rectangle départ/arrivée : un détour peut sortir de ce rectangle. */
const MARGIN_DEG = 0.008; // ≈ 600-900 m
const MAX_ZONES = 60;

/** Zones H3 rés. 7 couvrant le rectangle départ/arrivée élargi. */
export function zonesAround(from: [number, number], to: [number, number]): string[] {
  const minX = Math.min(from[0], to[0]) - MARGIN_DEG;
  const maxX = Math.max(from[0], to[0]) + MARGIN_DEG;
  const minY = Math.min(from[1], to[1]) - MARGIN_DEG;
  const maxY = Math.max(from[1], to[1]) + MARGIN_DEG;
  const ring = [
    [minX, minY],
    [maxX, minY],
    [maxX, maxY],
    [minX, maxY],
    [minX, minY],
  ];
  return polygonToCellsExperimental([ring], ZONE_RES, POLYGON_TO_CELLS_FLAGS.containmentOverlapping, true).slice(
    0,
    MAX_ZONES,
  );
}

export function classify(events: readonly PublicEvent[], now: number): Omit<HazardMap, 'complete'> {
  const byCell = new Map<string, PublicEvent[]>();
  for (const ev of events) byCell.set(ev.cell, [...(byCell.get(ev.cell) ?? []), ev]);
  const danger = new Set<string>();
  const uncertain = new Set<string>();
  for (const [cell, list] of byCell) {
    const status = computeZoneStatus(list, now);
    if (status === 'red') danger.add(cell);
    else if (status === 'orange') uncertain.add(cell);
  }
  return { danger, uncertain };
}

export class PublicApiHazards implements HazardSource {
  private readonly cache = new Map<string, { at: number; events: PublicEvent[] }>();

  constructor(private readonly apiUrl: string) {}

  async hazardsAround(from: [number, number], to: [number, number]): Promise<HazardMap> {
    const zones = zonesAround(from, to);
    const results = await Promise.allSettled(zones.map((zone) => this.zone(zone)));
    const events = results.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));
    return {
      ...classify(events, Math.floor(Date.now() / 1000)),
      complete: results.every((r) => r.status === 'fulfilled'),
    };
  }

  private async zone(zone: string): Promise<PublicEvent[]> {
    const cached = this.cache.get(zone);
    if (cached && Date.now() - cached.at < CACHE_MS) return cached.events;
    const res = await fetch(`${this.apiUrl}/api/map/zones/${zone}`, { signal: AbortSignal.timeout(2000) });
    if (!res.ok) throw new Error(`api ${res.status}`);
    const body = (await res.json()) as ZoneEventsResponse;
    if (this.cache.size > 5000) this.cache.clear();
    this.cache.set(zone, { at: Date.now(), events: body.events });
    return body.events;
  }
}
