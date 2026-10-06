/**
 * Style MapLibre basé sur des tuiles PMTiles auto-hébergées (choix privacy : aucun
 * fournisseur tiers ne reçoit les requêtes de tuiles, qui révèlent la zone regardée).
 *
 * Fond en niveaux de gris : le gris signifie « pas d'information » et les couleurs
 * de statut ressortent nettement.
 */
import { layers, namedFlavor } from '@protomaps/basemaps';
import type { StyleSpecification } from '@maplibre/maplibre-gl-style-spec';

export const BASEMAP_SOURCE = 'protomaps';
export const TILES_URL: string = import.meta.env.VITE_PMTILES_URL ?? '/tiles/basemap.pmtiles';

/**
 * Position initiale tant que le GPS est inactif (point fixe, jamais la position de l'utilisateur).
 * VITE_DEFAULT_CENTER="lng,lat" — défaut : centre de Besançon.
 */
export const DEFAULT_CENTER: [number, number] = parseCenter(import.meta.env.VITE_DEFAULT_CENTER) ?? [6.0241, 47.2378];

function parseCenter(value: string | undefined): [number, number] | null {
  const parts = value?.split(',').map(Number);
  return parts?.length === 2 && parts.every(Number.isFinite) ? [parts[0]!, parts[1]!] : null;
}
export const DEFAULT_ZOOM = 15;

/** Concaténation volontaire : `new URL()` encoderait les jetons {fontstack}/{range}. */
function absolute(path: string): string {
  return path.startsWith('http') ? path : window.location.origin + path;
}

export function buildStyle(dark: boolean): StyleSpecification {
  const flavorName = dark ? 'black' : 'grayscale';
  return {
    version: 8,
    glyphs: absolute('/fonts/{fontstack}/{range}.pbf'),
    sprite: absolute(`/sprites/v4/${flavorName}`),
    sources: {
      [BASEMAP_SOURCE]: {
        type: 'vector',
        url: `pmtiles://${absolute(TILES_URL)}`,
        attribution: '© <a href="https://openstreetmap.org/copyright">OpenStreetMap</a> · <a href="https://protomaps.com">Protomaps</a>',
      },
    },
    layers: layers(BASEMAP_SOURCE, namedFlavor(flavorName), { lang: 'fr' }),
  };
}
