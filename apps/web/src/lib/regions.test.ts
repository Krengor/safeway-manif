import { describe, expect, it } from 'vitest';
import { regionAt, regionsForTile, sizeLabel, tileBBox, type MapRegion } from './regions';

// Deux régions voisines dont les emprises se chevauchent (comme les vraies, avec leur marge).
const west: MapRegion = {
  id: 'ouest',
  name: 'Ouest',
  url: '/tiles/regions/ouest.pmtiles',
  bytes: 1,
  bbox: [0, 0, 2.1, 2],
  outline: [[[[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]]]],
};
const east: MapRegion = {
  id: 'est',
  name: 'Est',
  url: '/tiles/regions/est.pmtiles',
  bytes: 1,
  bbox: [1.9, 0, 4, 2],
  // Un trou au milieu : un point dedans n'appartient pas à la région.
  outline: [
    [
      [[2, 0], [4, 0], [4, 2], [2, 2], [2, 0]],
      [[3, 0.5], [3.5, 0.5], [3.5, 1], [3, 1], [3, 0.5]],
    ],
  ],
};

describe('regionAt', () => {
  it('trouve la région par son contour, même dans la marge commune des emprises', () => {
    expect(regionAt([west, east], { lng: 1.95, lat: 1 })?.id).toBe('ouest');
    expect(regionAt([west, east], { lng: 2.05, lat: 1 })?.id).toBe('est');
  });

  it('respecte les trous des contours, puis se rabat sur l’emprise la plus proche', () => {
    expect(regionAt([east], { lng: 3.2, lat: 0.7 })?.id).toBe('est'); // emprise, faute de contour
    expect(regionAt([west, east], { lng: 3.2, lat: 0.7 })?.id).toBe('est');
  });

  it('ne trouve rien hors de toutes les régions', () => {
    expect(regionAt([west, east], { lng: 10, lat: 10 })).toBeNull();
  });

  it('accepte un fichier unique sans emprise (installation d’origine)', () => {
    const single: MapRegion = { id: 'default', name: 'Besançon', url: '/tiles/basemap.pmtiles', bytes: 1 };
    expect(regionAt([single], { lng: 6, lat: 47 })?.id).toBe('default');
  });
});

describe('tuiles', () => {
  it('calcule l’emprise d’une tuile web Mercator', () => {
    const [w, s, e, n] = tileBBox(1, 1, 0);
    expect([w, e]).toEqual([0, 180]);
    expect(s).toBeCloseTo(0);
    expect(n).toBeCloseTo(85.0511, 3);
  });

  it('met en tête la région qui contient le centre de la tuile', () => {
    // Tuile z8 autour de (1, 1) : uniquement l'ouest ; tuile z0 : les deux, dont celle du centre.
    const x = Math.floor(((1 + 180) / 360) * 256);
    expect(regionsForTile([west, east], 8, x, 127).map((r) => r.id)).toEqual(['ouest']);
    expect(regionsForTile([east, west], 0, 0, 0).map((r) => r.id).sort()).toEqual(['est', 'ouest']);
  });

  it('ignore les régions qui ne touchent pas la tuile', () => {
    expect(regionsForTile([west, east], 10, 0, 0)).toEqual([]);
  });
});

describe('sizeLabel', () => {
  it('affiche des Mo puis des Go', () => {
    expect(sizeLabel(24_000_000)).toBe('24 Mo');
    expect(sizeLabel(420_400_000)).toBe('420 Mo');
    expect(sizeLabel(1_250_000_000)).toBe('1,3 Go');
  });
});
