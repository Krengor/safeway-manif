/**
 * Carte hors ligne (cahier §26).
 *
 * L'utilisateur télécharge à l'avance le fichier PMTiles de sa région : il est rangé dans
 * le Cache Storage du navigateur, puis la carte le lit directement, sans aucune requête
 * réseau. Tant qu'il n'est pas téléchargé, les tuiles viennent du réseau comme d'habitude.
 *
 * Confidentialité : le téléchargement est volontaire et porte sur une région entière
 * (pas sur les rues consultées). Il peut être supprimé à tout moment.
 */
import { FetchSource, type RangeResponse, type Source } from 'pmtiles';

const CACHE_NAME = 'sw-offline-map-v1';
const REGIONS_URL = '/tiles/regions.json';

export interface OfflineRegion {
  id: string;
  name: string;
  /** Chemin du fichier PMTiles de la région. */
  url: string;
  /** Taille du fichier (octets), pour l'afficher avant téléchargement. */
  bytes: number;
}

const absolute = (path: string) => (path.startsWith('http') ? path : window.location.origin + path);
const hasCacheApi = () => typeof caches !== 'undefined';

export async function loadRegions(): Promise<OfflineRegion[]> {
  try {
    const res = await fetch(REGIONS_URL, { cache: 'no-cache' });
    if (!res.ok) return [];
    return (await res.json()) as OfflineRegion[];
  } catch {
    return [];
  }
}

async function cachedBlob(url: string): Promise<Blob | null> {
  if (!hasCacheApi()) return null;
  try {
    const cache = await caches.open(CACHE_NAME);
    const res = await cache.match(absolute(url));
    return res ? await res.blob() : null;
  } catch {
    return null;
  }
}

export async function isRegionDownloaded(region: OfflineRegion): Promise<boolean> {
  return (await cachedBlob(region.url)) !== null;
}

/** Télécharge la région en entier ; `onProgress` reçoit une fraction entre 0 et 1. */
export async function downloadRegion(region: OfflineRegion, onProgress: (fraction: number) => void): Promise<void> {
  if (!hasCacheApi()) throw new Error('Stockage hors ligne indisponible sur ce navigateur.');
  const res = await fetch(absolute(region.url));
  if (!res.ok || !res.body) throw new Error('Téléchargement impossible.');
  const total = Number(res.headers.get('content-length')) || region.bytes;
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.byteLength;
    onProgress(total ? Math.min(1, received / total) : 0);
  }
  const blob = new Blob(chunks as BlobPart[], { type: 'application/octet-stream' });
  const cache = await caches.open(CACHE_NAME);
  await cache.put(absolute(region.url), new Response(blob, { headers: { 'content-length': String(blob.size) } }));
  tileSources.get(absolute(region.url))?.invalidate();
}

export async function deleteRegion(region: OfflineRegion): Promise<void> {
  if (!hasCacheApi()) return;
  const cache = await caches.open(CACHE_NAME);
  await cache.delete(absolute(region.url));
  tileSources.get(absolute(region.url))?.invalidate();
}

/**
 * Source PMTiles « hors ligne d'abord » : lit dans la région téléchargée si elle existe,
 * sinon fait des requêtes HTTP Range classiques.
 */
export class OfflineFirstSource implements Source {
  private blob: Promise<Blob | null> | null = null;
  private readonly network: Source;

  constructor(
    private readonly url: string,
    network?: Source,
    private readonly lookup: (url: string) => Promise<Blob | null> = cachedBlob,
  ) {
    this.network = network ?? new FetchSource(url);
  }

  getKey(): string {
    return this.url;
  }

  async getBytes(offset: number, length: number, signal?: AbortSignal, etag?: string): Promise<RangeResponse> {
    this.blob ??= this.lookup(this.url);
    const blob = await this.blob;
    if (blob) return { data: await blob.slice(offset, offset + length).arrayBuffer() };
    return this.network.getBytes(offset, length, signal, etag);
  }

  /** À appeler après un téléchargement ou une suppression. */
  invalidate(): void {
    this.blob = null;
  }
}

const tileSources = new Map<string, OfflineFirstSource>();

/** Source unique par fichier de tuiles (partagée par la carte et le gestionnaire hors ligne). */
export function tileSourceFor(url: string): OfflineFirstSource {
  const key = absolute(url);
  let source = tileSources.get(key);
  if (!source) {
    source = new OfflineFirstSource(key);
    tileSources.set(key, source);
  }
  return source;
}
