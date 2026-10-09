import { useCallback, useEffect, useState } from 'react';
import { deleteRegion, downloadRegion, isRegionDownloaded, loadRegions } from './offlineMap';
import type { MapRegion } from './regions';

export interface RegionState {
  region: MapRegion;
  downloaded: boolean;
  /** Fraction téléchargée (0 à 1) pendant un téléchargement, sinon null. */
  progress: number | null;
  error: string | null;
}

/** Régions de carte et leur état hors ligne sur cet appareil. */
export function useRegionDownloads() {
  const [regions, setRegions] = useState<RegionState[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const list = await loadRegions();
      const states = await Promise.all(
        list.map(async (region) => ({ region, downloaded: await isRegionDownloaded(region), progress: null, error: null })),
      );
      if (!cancelled) setRegions(states);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const update = useCallback(
    (id: string, patch: Partial<RegionState>) =>
      setRegions((current) => current?.map((s) => (s.region.id === id ? { ...s, ...patch } : s)) ?? null),
    [],
  );

  const download = useCallback(
    async (region: MapRegion) => {
      update(region.id, { progress: 0, error: null });
      try {
        // Progression affichée par pas de 1 % : pas un rendu par paquet réseau.
        let shown = 0;
        await downloadRegion(region, (fraction) => {
          const percent = Math.floor(fraction * 100);
          if (percent !== shown) {
            shown = percent;
            update(region.id, { progress: fraction });
          }
        });
        update(region.id, { downloaded: true, progress: null });
        navigator.vibrate?.(30);
      } catch (err) {
        update(region.id, { progress: null, error: err instanceof Error ? err.message : 'Téléchargement impossible.' });
      }
    },
    [update],
  );

  const remove = useCallback(
    async (region: MapRegion) => {
      await deleteRegion(region);
      update(region.id, { downloaded: false });
    },
    [update],
  );

  return { regions, download, remove };
}
