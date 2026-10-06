import type { RangeResponse, Source } from 'pmtiles';
import { describe, expect, it } from 'vitest';
import { OfflineFirstSource } from './offlineMap';

function fakeNetwork() {
  const calls: [number, number][] = [];
  const source: Source = {
    getKey: () => 'net',
    getBytes: async (offset, length): Promise<RangeResponse> => {
      calls.push([offset, length]);
      return { data: new Uint8Array(length).fill(7).buffer };
    },
  };
  return { source, calls };
}

const bytes = (buffer: ArrayBuffer) => [...new Uint8Array(buffer)];

describe('OfflineFirstSource', () => {
  it('lit les octets demandés dans la région téléchargée, sans réseau', async () => {
    const net = fakeNetwork();
    const blob = new Blob([new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7])]);
    const source = new OfflineFirstSource('https://x/tiles.pmtiles', net.source, async () => blob);
    expect(bytes((await source.getBytes(2, 3)).data)).toEqual([2, 3, 4]);
    expect(net.calls).toEqual([]);
  });

  it('passe par le réseau tant que la région n’est pas téléchargée', async () => {
    const net = fakeNetwork();
    const source = new OfflineFirstSource('https://x/tiles.pmtiles', net.source, async () => null);
    expect(bytes((await source.getBytes(10, 2)).data)).toEqual([7, 7]);
    expect(net.calls).toEqual([[10, 2]]);
  });

  it('bascule sur la copie locale après invalidation (téléchargement terminé)', async () => {
    const net = fakeNetwork();
    let stored: Blob | null = null;
    const source = new OfflineFirstSource('https://x/tiles.pmtiles', net.source, async () => stored);
    await source.getBytes(0, 1);
    stored = new Blob([new Uint8Array([9, 9, 9])]);
    source.invalidate();
    expect(bytes((await source.getBytes(0, 2)).data)).toEqual([9, 9]);
    expect(net.calls).toHaveLength(1);
  });

  it('garde la même clé que l’URL des tuiles (lien avec le style MapLibre)', () => {
    expect(new OfflineFirstSource('https://x/a.pmtiles', fakeNetwork().source).getKey()).toBe('https://x/a.pmtiles');
  });
});
