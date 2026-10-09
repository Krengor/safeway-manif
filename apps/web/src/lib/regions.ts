/**
 * Régions de carte (fond PMTiles découpé par région administrative).
 *
 * Confidentialité : la région de l'utilisateur est déduite SUR L'APPAREIL, à partir de sa
 * position en mémoire. Rien n'est envoyé pour la trouver ; seul le téléchargement volontaire
 * d'une région entière révèle au serveur une zone aussi large qu'une région.
 */

/** [ouest, sud, est, nord] en degrés. */
export type BBox = [number, number, number, number];

export interface MapRegion {
  id: string;
  name: string;
  /** Chemin du fichier PMTiles de la région. */
  url: string;
  /** Taille du fichier (octets), affichée avant téléchargement. */
  bytes: number;
  /** Emprise des tuiles du fichier. Absente : fichier unique couvrant toute la carte. */
  bbox?: BBox;
  /** Contour simplifié (multipolygone : polygones → anneaux → [lng, lat]), pour trouver la région d'un point. */
  outline?: number[][][][];
}

export interface Point {
  lng: number;
  lat: number;
}

const WORLD: BBox = [-180, -85.0511, 180, 85.0511];
export const bboxOf = (region: MapRegion): BBox => region.bbox ?? WORLD;

function inBBox([w, s, e, n]: BBox, { lng, lat }: Point): boolean {
  return lng >= w && lng <= e && lat >= s && lat <= n;
}

/** Point dans un anneau (lancer de rayon). */
function inRing(ring: number[][], { lng, lat }: Point): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i] as [number, number];
    const [xj, yj] = ring[j] as [number, number];
    if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Le premier anneau d'un polygone est son contour, les suivants ses trous. */
function inOutline(outline: number[][][][], point: Point): boolean {
  return outline.some(([outer, ...holes]) => !!outer && inRing(outer, point) && !holes.some((h) => inRing(h, point)));
}

/**
 * Région qui contient le point. Sans contour (ou près d'une frontière que le contour simplifié
 * rate), la région dont l'emprise contient le point et dont le centre est le plus proche.
 */
export function regionAt(regions: readonly MapRegion[], point: Point): MapRegion | null {
  const exact = regions.find((r) => r.outline && inOutline(r.outline, point));
  if (exact) return exact;
  const around = regions.filter((r) => inBBox(bboxOf(r), point));
  const distance = (r: MapRegion) => {
    const [w, s, e, n] = bboxOf(r);
    return Math.hypot((w + e) / 2 - point.lng, (s + n) / 2 - point.lat);
  };
  return around.sort((a, b) => distance(a) - distance(b))[0] ?? null;
}

/** Emprise géographique d'une tuile web Mercator z/x/y. */
export function tileBBox(z: number, x: number, y: number): BBox {
  const n = 2 ** z;
  const lng = (i: number) => (i / n) * 360 - 180;
  const lat = (j: number) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * j) / n))) * 180) / Math.PI;
  return [lng(x), lat(y + 1), lng(x + 1), lat(y)];
}

const intersects = (a: BBox, b: BBox) => a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3];

/**
 * Régions susceptibles de contenir la tuile, la plus pertinente d'abord (celle qui contient le
 * centre de la tuile), pour lire chaque tuile dans un seul fichier dans le cas courant.
 */
export function regionsForTile(regions: readonly MapRegion[], z: number, x: number, y: number): MapRegion[] {
  const box = tileBBox(z, x, y);
  const candidates = regions.filter((r) => intersects(bboxOf(r), box));
  const center = { lng: (box[0] + box[2]) / 2, lat: (box[1] + box[3]) / 2 };
  const home = regionAt(candidates, center);
  return home ? [home, ...candidates.filter((r) => r !== home)] : candidates;
}

/** Taille lisible : « 420 Mo », « 1,2 Go ». */
export function sizeLabel(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1).replace('.', ',')} Go`;
  return `${Math.max(1, Math.round(bytes / 1e6))} Mo`;
}
