/**
 * Discrétisation géographique (cahier §8, §14, §15, §50).
 *
 * Les coordonnées GPS ne quittent jamais l'appareil : le client les convertit
 * immédiatement en cellule H3 puis les oublie. Le serveur ne voit que des cellules.
 */
import { cellToParent, getResolution, gridDistance, isValidCell, latLngToCell } from 'h3-js';

/** Résolution des signalements : arête ≈ 66 m, surface ≈ 0,015 km² (quelques tronçons de rue). */
export const EVENT_RES = 10;

/**
 * Résolution des zones de lecture / canaux temps réel : arête ≈ 1,4 km.
 * Une requête de carte ne révèle donc au serveur qu'un quartier, pas une rue.
 */
export const ZONE_RES = 7;

/**
 * Distance maximale (en anneaux H3 de résolution EVENT_RES) entre la cellule de
 * l'utilisateur et celle d'un signalement pour pouvoir le créer ou le voter.
 * k = 2 ≈ 200-250 m.
 */
export const PROXIMITY_K = 2;

/** Nombre maximum de zones demandées en une requête de carte. */
export const MAX_ZONES_PER_REQUEST = 12;

export function isEventCell(cell: unknown): cell is string {
  return typeof cell === 'string' && isValidCell(cell) && getResolution(cell) === EVENT_RES;
}

export function isZoneCell(cell: unknown): cell is string {
  return typeof cell === 'string' && isValidCell(cell) && getResolution(cell) === ZONE_RES;
}

export function toEventCell(lat: number, lng: number): string {
  return latLngToCell(lat, lng, EVENT_RES);
}

export function zoneOf(eventCell: string): string {
  return cellToParent(eventCell, ZONE_RES);
}

/** Vrai si les deux cellules (résolution EVENT_RES) sont à au plus PROXIMITY_K anneaux. */
export function isNear(cellA: string, cellB: string): boolean {
  if (cellA === cellB) return true;
  try {
    return gridDistance(cellA, cellB) <= PROXIMITY_K;
  } catch {
    // gridDistance échoue pour des cellules trop éloignées (ou de part et d'autre d'un pentagone).
    return false;
  }
}
