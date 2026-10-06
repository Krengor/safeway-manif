/**
 * Construction des calques de statut :
 * - `cells`   : hexagones H3 des zones signalées (remplissage léger + contour) ;
 * - `streets` : tronçons de rue des tuiles vectorielles, découpés sur ces hexagones
 *               et colorés selon le statut (vert / orange / rouge).
 * Tout est calculé localement à partir des données publiques déjà chargées.
 */
import { EVENT_META, computeZoneStatus, type PublicEvent, type ZoneStatus } from '@safeway/shared';
import { cellToBoundary } from 'h3-js';
import type { Map as MlMap } from 'maplibre-gl';
import { bboxIntersects, bboxOf, clipLineToConvex, type BBox, type Point } from './clip';
import { BASEMAP_SOURCE } from './style';

export interface CellSummary {
  cell: string;
  status: ZoneStatus;
  events: PublicEvent[];
  /** Événement le plus important (danger d'abord) pour le marqueur. */
  top: PublicEvent;
}

const CATEGORY_PRIORITY = { danger: 0, caution: 1, clear: 2, info: 3 } as const;

export function summarizeCells(events: readonly PublicEvent[], now: number): CellSummary[] {
  const byCell = new Map<string, PublicEvent[]>();
  for (const ev of events) {
    if (ev.expiresAt <= now) continue;
    const list = byCell.get(ev.cell);
    if (list) list.push(ev);
    else byCell.set(ev.cell, [ev]);
  }
  return [...byCell.entries()].map(([cell, list]) => {
    const sorted = [...list].sort(
      (a, b) =>
        CATEGORY_PRIORITY[EVENT_META[a.type].category] - CATEGORY_PRIORITY[EVENT_META[b.type].category] ||
        b.conf - a.conf,
    );
    return { cell, status: computeZoneStatus(list, now), events: sorted, top: sorted[0]! };
  });
}

type Feature = GeoJSON.Feature<GeoJSON.Geometry, { status: ZoneStatus; cell: string }>;

export function cellPolygons(cells: readonly CellSummary[]): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: cells.map<Feature>((c) => {
      const ring = cellToBoundary(c.cell, true) as Point[];
      return {
        type: 'Feature',
        properties: { status: c.status, cell: c.cell },
        geometry: { type: 'Polygon', coordinates: [[...ring, ring[0]!]] },
      };
    }),
  };
}

const EXCLUDED_KINDS = new Set(['rail', 'ferry', 'aerialway']);

/** Découpe les rues visibles sur chaque hexagone coloré. */
export function streetSegments(map: MlMap, cells: readonly CellSummary[]): GeoJSON.FeatureCollection {
  const colored = cells.filter((c) => c.status !== 'grey');
  if (colored.length === 0 || !map.getSource(BASEMAP_SOURCE)) return { type: 'FeatureCollection', features: [] };

  const hexes = colored.map((c) => {
    const ring = cellToBoundary(c.cell, true) as Point[];
    return { summary: c, ring, bbox: bboxOf(ring) };
  });
  const all: BBox = bboxOf(hexes.flatMap((h) => [[h.bbox.minX, h.bbox.minY] as Point, [h.bbox.maxX, h.bbox.maxY] as Point]));

  const features: Feature[] = [];
  for (const road of map.querySourceFeatures(BASEMAP_SOURCE, { sourceLayer: 'roads' })) {
    if (EXCLUDED_KINDS.has(String(road.properties?.kind))) continue;
    const geom = road.geometry;
    const lines: Point[][] =
      geom.type === 'LineString'
        ? [geom.coordinates as Point[]]
        : geom.type === 'MultiLineString'
          ? (geom.coordinates as Point[][])
          : [];
    for (const line of lines) {
      const lb = bboxOf(line);
      if (!bboxIntersects(lb, all)) continue;
      for (const hex of hexes) {
        if (!bboxIntersects(lb, hex.bbox)) continue;
        for (const part of clipLineToConvex(line, hex.ring)) {
          features.push({
            type: 'Feature',
            properties: { status: hex.summary.status, cell: hex.summary.cell },
            geometry: { type: 'LineString', coordinates: part },
          });
        }
      }
    }
  }
  return { type: 'FeatureCollection', features };
}
