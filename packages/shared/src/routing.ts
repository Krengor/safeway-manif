/**
 * Routage sécurisé (cahier §12, §55).
 *
 * Confidentialité : un calcul d'itinéraire exige un point de départ et d'arrivée précis.
 * La requête part donc vers un service dédié (routing-service) qui :
 *   - ne reçoit jamais de cookie (retiré par le reverse proxy) → aucune identité ;
 *   - ne stocke ni ne journalise les coordonnées ; aucun cache de trajets.
 * Le suivi d'alertes sur le trajet se fait ensuite entièrement sur l'appareil.
 */
import { latLngToCell } from 'h3-js';
import { z } from 'zod';
import { EVENT_RES } from './geo.js';

export const ROUTE_PATH = '/api/route';

/** Distance maximale à vol d'oiseau pour un trajet piéton (m). */
export const MAX_ROUTE_DISTANCE_M = 15_000;

const lngLat = z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]);

export const routeRequestSchema = z.object({
  from: lngLat,
  to: lngLat,
});
export type RouteRequest = z.infer<typeof routeRequestSchema>;

/**
 * - clear     : aucune zone signalée sur le trajet (ce n'est PAS une garantie de sécurité) ;
 * - uncertain : traverse des zones à information incertaine ;
 * - danger    : traverse au moins une zone signalée dangereuse (pas d'alternative raisonnable).
 */
export type RouteRisk = 'clear' | 'uncertain' | 'danger';

/** Stratégie retenue, du plus prudent au plus direct. */
export type RouteStrategy = 'avoid-all' | 'avoid-danger' | 'direct';

export interface RouteResponse {
  /** Géométrie [lng, lat][]. */
  shape: [number, number][];
  distanceM: number;
  durationS: number;
  strategy: RouteStrategy;
  risk: RouteRisk;
  /** Nombre de zones évitées par rapport au trajet direct. */
  avoided: { danger: number; uncertain: number };
  /** Cellules signalées traversées malgré tout. */
  crossing: { danger: string[]; uncertain: string[] };
  /** false si les signalements n'ont pas pu être chargés : trajet calculé sans eux. */
  hazardsKnown: boolean;
}

const EARTH_RADIUS_M = 6_371_008.8;

export function distanceM([lng1, lat1]: readonly [number, number], [lng2, lat2]: readonly [number, number]): number {
  const toRad = Math.PI / 180;
  const dLat = (lat2 - lat1) * toRad;
  const dLng = (lng2 - lng1) * toRad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(a));
}

/** Décode une polyline encodée (précision 6 pour Valhalla) en [lng, lat][]. */
export function decodePolyline(encoded: string, precision = 6): [number, number][] {
  const factor = 10 ** precision;
  const points: [number, number][] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;
  const next = () => {
    let result = 0;
    let shift = 0;
    let byte: number;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20 && index <= encoded.length);
    return result & 1 ? ~(result >> 1) : result >> 1;
  };
  while (index < encoded.length) {
    lat += next();
    lng += next();
    points.push([lng / factor, lat / factor]);
  }
  return points;
}

export function polylineLengthM(shape: readonly [number, number][]): number {
  let total = 0;
  for (let i = 1; i < shape.length; i++) total += distanceM(shape[i - 1]!, shape[i]!);
  return total;
}

/** Distance sous laquelle un retour près du départ/de l'arrivée est jugé être un aller-retour. */
const BACKTRACK_TOLERANCE_M = 25;

/**
 * Supprime les allers-retours parasites en début et fin de trajet : le moteur s'accroche
 * parfois au tronçon de départ dans le mauvais sens, va jusqu'au carrefour puis revient.
 */
export function trimBacktracks(shape: readonly [number, number][]): [number, number][] {
  if (shape.length < 3) return [...shape];
  const first = shape[0]!;
  let start = 0;
  for (let i = shape.length - 1; i > 0; i--) {
    if (distanceM(first, shape[i]!) <= BACKTRACK_TOLERANCE_M) {
      start = i;
      break;
    }
  }
  const last = shape[shape.length - 1]!;
  let end = shape.length - 1;
  for (let i = start; i < shape.length - 1; i++) {
    if (distanceM(last, shape[i]!) <= BACKTRACK_TOLERANCE_M) {
      end = i;
      break;
    }
  }
  const trimmed = shape.slice(start, end + 1);
  // On garde les points exacts de départ et d'arrivée.
  if (start > 0) trimmed[0] = first;
  if (end < shape.length - 1) trimmed[trimmed.length - 1] = last;
  return trimmed.length >= 2 ? trimmed : [first, last];
}

/** Pas d'échantillonnage (m) : inférieur à l'arête d'une cellule rés. 10 (~66 m). */
const SAMPLE_STEP_M = 25;

/** Cellules H3 (rés. EVENT_RES) traversées par un trajet, dans l'ordre de parcours. */
export function routeCells(shape: readonly [number, number][]): string[] {
  const cells: string[] = [];
  const seen = new Set<string>();
  const add = (lng: number, lat: number) => {
    const cell = latLngToCell(lat, lng, EVENT_RES);
    if (!seen.has(cell)) {
      seen.add(cell);
      cells.push(cell);
    }
  };
  for (let i = 0; i < shape.length; i++) {
    const p = shape[i]!;
    add(p[0], p[1]);
    const q = shape[i + 1];
    if (!q) break;
    const steps = Math.floor(distanceM(p, q) / SAMPLE_STEP_M);
    for (let s = 1; s <= steps; s++) {
      const t = s / (steps + 1);
      add(p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t);
    }
  }
  return cells;
}
