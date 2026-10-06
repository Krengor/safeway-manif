import { useEffect, useState } from 'react';
import { deleteRegion, downloadRegion, isRegionDownloaded, loadRegions, type OfflineRegion } from '../lib/offlineMap';

type RegionState = { region: OfflineRegion; downloaded: boolean; progress: number | null; error: string | null };

const sizeLabel = (bytes: number) => `${(bytes / 1e6).toFixed(1).replace('.', ',')} Mo`;

/** Préparer la manif : télécharger la carte de sa région pour l'avoir sans réseau. */
export function OfflineMapPanel({ disabled = false }: { disabled?: boolean }) {
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

  const update = (id: string, patch: Partial<RegionState>) =>
    setRegions((current) => current?.map((s) => (s.region.id === id ? { ...s, ...patch } : s)) ?? null);

  const download = async (state: RegionState) => {
    update(state.region.id, { progress: 0, error: null });
    try {
      await downloadRegion(state.region, (progress) => update(state.region.id, { progress }));
      update(state.region.id, { downloaded: true, progress: null });
      navigator.vibrate?.(30);
    } catch (err) {
      update(state.region.id, { progress: null, error: err instanceof Error ? err.message : 'Téléchargement impossible.' });
    }
  };

  const remove = async (state: RegionState) => {
    await deleteRegion(state.region);
    update(state.region.id, { downloaded: false });
  };

  if (regions === null) return <p className="text-sm text-muted">Chargement…</p>;
  if (regions.length === 0) return <p className="text-sm text-muted">Aucune carte téléchargeable sur ce serveur.</p>;
  const busyServer = disabled && regions.some((s) => !s.downloaded);

  return (
    <ul className="flex flex-col gap-2">
      {busyServer && (
        <li role="status" className="text-sm font-semibold text-warn">
          Forte affluence : téléchargement suspendu pour garder la carte en direct fluide. Réessayez plus tard.
        </li>
      )}
      {regions.map((state) => (
        <li key={state.region.id} className="rounded-xl border-2 border-line p-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <p className="font-bold">{state.region.name}</p>
              <p className="text-sm text-muted">
                {state.downloaded ? '✓ Disponible sans réseau' : sizeLabel(state.region.bytes)}
              </p>
            </div>
            {state.progress !== null ? (
              <span className="font-semibold" role="status">
                {Math.round(state.progress * 100)} %
              </span>
            ) : state.downloaded ? (
              <button type="button" onClick={() => void remove(state)} className="min-h-11 rounded-xl border-2 border-line px-3 font-semibold">
                Supprimer
              </button>
            ) : (
              <button
                type="button"
                disabled={disabled}
                onClick={() => void download(state)}
                className="min-h-11 rounded-xl bg-accent px-3 font-bold text-accent-fg disabled:opacity-50"
              >
                ⬇ Télécharger
              </button>
            )}
          </div>
          {state.progress !== null && (
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-line" aria-hidden="true">
              <div className="h-full bg-accent transition-all" style={{ width: `${Math.round(state.progress * 100)}%` }} />
            </div>
          )}
          {state.error && (
            <p role="alert" className="mt-2 text-sm font-semibold text-danger">
              {state.error}
            </p>
          )}
        </li>
      ))}
    </ul>
  );
}
