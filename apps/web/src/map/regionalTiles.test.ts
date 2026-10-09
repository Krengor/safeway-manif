import { describe, expect, it } from 'vitest';
import type { MapRegion } from '../lib/regions';
import { findTile } from './regionalTiles';

const region = (id: string, bbox: [number, number, number, number]): MapRegion => ({
  id,
  name: id,
  url: `/tiles/regions/${id}.pmtiles`,
  bytes: 1,
  bbox,
});
const west = region('ouest', [0, 0, 2.1, 2]);
const east = region('est', [1.9, 0, 4, 2]);
const tile = (marker: number) => new Uint8Array([marker]).buffer;

describe('findTile', () => {
  it('lit la tuile dans la région qui la couvre', async () => {
    const read = async (r: MapRegion) => (r.id === 'ouest' ? tile(1) : tile(2));
    const data = await findTile([west, east], 0, 0, 0, undefined, read);
    // Centre de la tuile z0 : (0, 0), dans l'emprise de l'ouest seulement.
    expect(new Uint8Array(data)).toEqual(new Uint8Array([1]));
  });

  it('passe à la région suivante si la première est injoignable ou n’a pas la tuile', async () => {
    const calls: string[] = [];
    const read = async (r: MapRegion) => {
      calls.push(r.id);
      if (calls.length === 1) throw new Error('hors ligne');
      return tile(9);
    };
    const data = await findTile([west, east], 0, 0, 0, undefined, read);
    expect(new Uint8Array(data)).toEqual(new Uint8Array([9]));
    expect(calls).toHaveLength(2);
  });

  it('renvoie une tuile vide quand aucune région ne l’a', async () => {
    const data = await findTile([west, east], 0, 0, 0, undefined, async () => null);
    expect(data.byteLength).toBe(0);
  });

  it('sans régions publiées, lit le fichier unique', async () => {
    const urls: string[] = [];
    await findTile([], 3, 4, 2, undefined, async (r) => {
      urls.push(r.url);
      return tile(1);
    });
    expect(urls).toEqual(['/tiles/basemap.pmtiles']);
  });

  it('s’arrête si la tuile n’est plus demandée (carte déplacée)', async () => {
    const abort = new AbortController();
    abort.abort();
    const read = async () => tile(1);
    expect((await findTile([west, east], 0, 0, 0, abort.signal, read)).byteLength).toBe(0);
  });
});
