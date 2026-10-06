import { gridDisk, latLngToCell } from 'h3-js';
import { describe, expect, it } from 'vitest';
import { EVENT_RES } from './geo.js';
import { decodePolyline, distanceM, polylineLengthM, routeCells, routeRequestSchema, trimBacktracks } from './routing.js';

describe('decodePolyline', () => {
  it('décode le format polyline (exemple de référence Google, précision 5)', () => {
    expect(decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@', 5)).toEqual([
      [-120.2, 38.5],
      [-120.95, 40.7],
      [-126.453, 43.252],
    ]);
  });

  it('décode une chaîne vide', () => {
    expect(decodePolyline('')).toEqual([]);
  });
});

describe('distanceM', () => {
  it('mesure ~111 km par degré de latitude', () => {
    expect(distanceM([6, 47], [6, 48])).toBeGreaterThan(111_000);
    expect(distanceM([6, 47], [6, 48])).toBeLessThan(111_400);
  });
});

describe('routeCells', () => {
  it("couvre toutes les cellules d'un segment, sans trou ni doublon", () => {
    // ~500 m vers l'est à Besançon, en un seul segment.
    const cells = routeCells([
      [6.02, 47.238],
      [6.0266, 47.238],
    ]);
    expect(new Set(cells).size).toBe(cells.length);
    // Chaque cellule touche la suivante : aucune cellule « sautée ».
    for (let i = 0; i < cells.length - 1; i++) expect(gridDisk(cells[i]!, 1)).toContain(cells[i + 1]);
    expect(cells[0]).toBe(latLngToCell(47.238, 6.02, EVENT_RES));
    expect(cells.at(-1)).toBe(latLngToCell(47.238, 6.0266, EVENT_RES));
  });
});

describe('trimBacktracks', () => {
  it('supprime un aller-retour au départ (cas réel Valhalla, Besançon)', () => {
    const shape: [number, number][] = [
      [6.024346, 47.238006],
      [6.024367, 47.238256],
      [6.025062, 47.238672], // part vers le nord-est…
      [6.024327, 47.238255],
      [6.024291, 47.237992], // …et revient à ~4 m du départ
      [6.024269, 47.237702],
      [6.025036, 47.23713],
    ];
    const trimmed = trimBacktracks(shape);
    expect(trimmed[0]).toEqual(shape[0]);
    expect(trimmed).toHaveLength(3);
    expect(polylineLengthM(trimmed)).toBeLessThan(polylineLengthM(shape) - 150);
  });

  it('supprime un aller-retour à l’arrivée', () => {
    const shape: [number, number][] = [
      [6.02, 47.238],
      [6.022, 47.238],
      [6.023, 47.239], // dépasse l'arrivée…
      [6.02201, 47.23801], // …et revient
    ];
    expect(trimBacktracks(shape)).toEqual([
      [6.02, 47.238],
      [6.02201, 47.23801],
    ]);
  });

  it('laisse intact un trajet sans aller-retour', () => {
    const shape: [number, number][] = [
      [6.02, 47.238],
      [6.025, 47.238],
      [6.03, 47.238],
    ];
    expect(trimBacktracks(shape)).toEqual(shape);
  });
});

describe('routeRequestSchema', () => {
  it('refuse des coordonnées hors bornes ou mal formées', () => {
    expect(routeRequestSchema.safeParse({ from: [6, 47], to: [6.01, 47.01] }).success).toBe(true);
    expect(routeRequestSchema.safeParse({ from: [200, 47], to: [6, 47] }).success).toBe(false);
    expect(routeRequestSchema.safeParse({ from: [6], to: [6, 47] }).success).toBe(false);
  });
});
