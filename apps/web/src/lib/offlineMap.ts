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
import type { MapRegion } from './regions';

const CACHE_NAME = 'sw-offline-map-v1';
const REGIONS_URL = '/tiles/regions.json';

export type OfflineRegion = MapRegion;

const absolute = (path: string) => (path.startsWith('http') ? path : window.location.origin + path);
const hasCacheApi = () => typeof caches !== 'undefined';

let regionsRequest: Promise<OfflineRegion[]> | null = null;

/** Liste des régions (une seule requête partagée par la carte et l'écran hors ligne). */
export function loadRegions(): Promise<OfflineRegion[]> {
  regionsRequest ??= (async () => {
    try {
      const res = await fetch(REGIONS_URL, { cache: 'no-cache' });
      if (!res.ok) return [];
      return (await res.json()) as OfflineRegion[];
    } catch {
      return [];
    }
  })().then((list) => {
    // Échec (hors ligne au démarrage) : on réessaiera au prochain appel.
    if (list.length === 0) regionsRequest = null;
    return list;
  });
  return regionsRequest;
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
  if (!hasCacheApi()) return false;
  try {
    return (await (await caches.open(CACHE_NAME)).match(absolute(region.url))) !== undefined;
  } catch {
    return false;
  }
}

/**
 * Télécharge la région en entier ; `onProgress` reçoit une fraction entre 0 et 1.
 *
 * Le fichier (jusqu'à plusieurs centaines de Mo) est écrit au fil de l'eau dans le Cache
 * Storage, sans être gardé en mémoire : un téléphone ne tiendrait pas un tel fichier en RAM.
 */
export async function downloadRegion(region: OfflineRegion, onProgress: (fraction: number) => void): Promise<void> {
  if (!hasCacheApi()) throw new Error('Stockage hors ligne indisponible sur ce navigateur.');
  // Demande au navigateur de ne pas effacer la carte quand l'espace manque (sans effet si refusé).
  await navigator.storage?.persist?.().catch(() => false);
  const estimate = await navigator.storage?.estimate?.().catch(() => undefined);
  if (estimate?.quota !== undefined && estimate.usage !== undefined && estimate.quota - estimate.usage < region.bytes) {
    throw new Error('Espace insuffisant sur cet appareil pour cette carte.');
  }
  const res = await fetch(absolute(region.url));
  if (!res.ok || !res.body) throw new Error('Téléchargement impossible.');
  const total = Number(res.headers.get('content-length')) || region.bytes;
  let received = 0;
  const counted = res.body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        received += chunk.byteLength;
        onProgress(total ? Math.min(1, received / total) : 0);
        controller.enqueue(chunk);
      },
    }),
  );
  const cache = await caches.open(CACHE_NAME);
  try {
    await cache.put(
      absolute(region.url),
      new Response(counted, { headers: { 'content-length': String(total), 'content-type': 'application/octet-stream' } }),
    );
  } catch (err) {
    await cache.delete(absolute(region.url)).catch(() => false);
    throw err instanceof DOMException && err.name === 'QuotaExceededError'
      ? new Error('Espace insuffisant sur cet appareil pour cette carte.')
      : new Error('Téléchargement interrompu. Réessayez.');
  }
  if (received < total) {
    await cache.delete(absolute(region.url));
    throw new Error('Téléchargement interrompu. Réessayez.');
  }
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
