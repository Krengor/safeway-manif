/**
 * Source de tuiles « régionale » : chaque tuile est lue dans le fichier PMTiles de la région qui
 * la couvre (copie téléchargée sur l'appareil si elle existe, sinon requêtes Range sur notre
 * serveur). Un seul fond de carte pour MapLibre, quel que soit le découpage côté serveur.
 */
import { PMTiles } from 'pmtiles';
import { loadRegions, tileSourceFor } from '../lib/offlineMap';
import { regionsForTile, type MapRegion } from '../lib/regions';
import { REGIONAL_PROTOCOL, TILES_URL } from './style';

const archives = new Map<string, PMTiles>();
function archiveFor(url: string): PMTiles {
  let archive = archives.get(url);
  if (!archive) {
    archive = new PMTiles(tileSourceFor(url));
    archives.set(url, archive);
  }
  return archive;
}

/** Sans régions publiées (installation d'origine) : le fichier unique couvre toute la carte. */
const SINGLE: MapRegion[] = [{ id: 'default', name: 'Carte', url: TILES_URL, bytes: 0 }];

type TileReader = (region: MapRegion, z: number, x: number, y: number, signal?: AbortSignal) => Promise<ArrayBuffer | null>;

const readFromArchive: TileReader = async (region, z, x, y, signal) =>
  (await archiveFor(region.url).getZxy(z, x, y, signal))?.data ?? null;

/**
 * Cherche la tuile dans les régions candidates, la plus pertinente d'abord. Une région injoignable
 * (hors ligne et non téléchargée) est sautée : la suivante peut avoir la tuile. Aucune région ne
 * l'a : tuile vide, la carte affiche le fond gris « pas d'information ».
 */
export async function findTile(
  regions: readonly MapRegion[],
  z: number,
  x: number,
  y: number,
  signal?: AbortSignal,
  read: TileReader = readFromArchive,
): Promise<ArrayBuffer> {
  for (const region of regionsForTile(regions.length ? regions : SINGLE, z, x, y)) {
    if (signal?.aborted) break;
    try {
      const data = await read(region, z, x, y, signal);
      if (data) return data;
    } catch (err) {
      if (signal?.aborted) throw err;
    }
  }
  return new ArrayBuffer(0);
}

const TILE_URL = new RegExp(`^${REGIONAL_PROTOCOL}://(\\d+)/(\\d+)/(\\d+)`);

/** Gestionnaire du protocole `swmap://z/x/y` pour `maplibre-gl.addProtocol`. */
export async function regionalTile(params: { url: string }, abort: AbortController): Promise<{ data: ArrayBuffer }> {
  const match = TILE_URL.exec(params.url);
  if (!match) throw new Error(`URL de tuile invalide : ${params.url}`);
  const [z, x, y] = match.slice(1).map(Number) as [number, number, number];
  return { data: await findTile(await loadRegions(), z, x, y, abort.signal) };
}
