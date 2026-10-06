import { describe, expect, it } from 'vitest';
import { gridDisk } from 'h3-js';
import { PROXIMITY_K, isEventCell, isNear, isZoneCell, toEventCell, zoneOf } from './geo.js';

const PLACE_REPUBLIQUE = { lat: 48.8673, lng: 2.3633 };

describe('geo', () => {
  const cell = toEventCell(PLACE_REPUBLIQUE.lat, PLACE_REPUBLIQUE.lng);

  it('produit une cellule de résolution EVENT_RES', () => {
    expect(isEventCell(cell)).toBe(true);
    expect(isZoneCell(cell)).toBe(false);
    expect(isZoneCell(zoneOf(cell))).toBe(true);
  });

  it('rejette les entrées invalides', () => {
    expect(isEventCell('48.86,2.36')).toBe(false);
    expect(isEventCell(42)).toBe(false);
    expect(isEventCell(toEventCell(48.8, 2.3).replace(/.$/, 'z'))).toBe(false);
  });

  it('accepte la proximité jusqu’à PROXIMITY_K anneaux', () => {
    for (const neighbour of gridDisk(cell, PROXIMITY_K)) expect(isNear(cell, neighbour)).toBe(true);
    const far = gridDisk(cell, PROXIMITY_K + 1).filter((c) => !gridDisk(cell, PROXIMITY_K).includes(c));
    expect(far.length).toBeGreaterThan(0);
    for (const c of far) expect(isNear(cell, c)).toBe(false);
  });

  it('rejette des cellules très éloignées', () => {
    const marseille = toEventCell(43.2965, 5.3698);
    expect(isNear(cell, marseille)).toBe(false);
  });
});
