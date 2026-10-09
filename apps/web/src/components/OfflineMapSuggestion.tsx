import { useState } from 'react';
import { regionAt, sizeLabel } from '../lib/regions';
import type { LocalPosition } from '../lib/useManifMode';
import { useRegionDownloads } from '../lib/useRegionDownloads';

interface Props {
  /** Position en mémoire (Mode Manif). La région est trouvée sur l'appareil ; rien n'est envoyé. */
  position: LocalPosition | null;
  /** Téléchargements suspendus (forte affluence, §56). */
  disabled: boolean;
}

/**
 * Propose la carte hors ligne de la région où l'on se trouve, tant qu'elle n'est pas sur l'appareil.
 * « Plus tard » ne vaut que pour cette session : rien n'est mémorisé sur le téléphone.
 */
export function OfflineMapSuggestion({ position, disabled }: Props) {
  const { regions, download } = useRegionDownloads();
  const [dismissed, setDismissed] = useState<string | null>(null);
  if (!regions || regions.length < 2) return null;

  const busy = regions.find((s) => s.progress !== null);
  const home = position ? regionAt(regions.map((s) => s.region), position) : null;
  const state = busy ?? regions.find((s) => s.region === home);
  if (!state || (state.downloaded && !busy) || (dismissed === state.region.id && !busy) || (disabled && !busy)) return null;

  if (state.progress !== null) {
    return (
      <div role="status" className="pointer-events-auto rounded-xl bg-panel/95 px-3 py-2 text-sm font-semibold shadow">
        <p>
          ⬇ Carte de {state.region.name} : {Math.round(state.progress * 100)} %
        </p>
        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-line" aria-hidden="true">
          <div className="h-full bg-accent transition-all" style={{ width: `${Math.round(state.progress * 100)}%` }} />
        </div>
      </div>
    );
  }

  return (
    <div className="pointer-events-auto flex items-center gap-2 rounded-xl bg-panel/95 px-3 py-2 text-sm font-semibold shadow">
      <span className="flex-1">
        🗺️ Gardez la carte de {state.region.name} même sans réseau ({sizeLabel(state.region.bytes)}).
        {state.error && <span className="block text-danger">{state.error}</span>}
      </span>
      <button
        type="button"
        onClick={() => void download(state.region)}
        className="min-h-11 shrink-0 rounded-lg bg-accent px-3 font-bold text-accent-fg"
      >
        Télécharger
      </button>
      <button
        type="button"
        aria-label="Plus tard"
        onClick={() => setDismissed(state.region.id)}
        className="min-h-11 min-w-11 shrink-0 px-1"
      >
        ✕
      </button>
    </div>
  );
}
