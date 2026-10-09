import { regionAt, sizeLabel } from '../lib/regions';
import { useRegionDownloads, type RegionState } from '../lib/useRegionDownloads';
import type { LocalPosition } from '../lib/useManifMode';

interface Props {
  /** Téléchargements suspendus (forte affluence, §56). */
  disabled?: boolean;
  /** Position en mémoire (Mode Manif) : sert uniquement à mettre la région de l'utilisateur en tête. */
  position?: LocalPosition | null;
}

/** Préparer la manif : télécharger la carte de sa région pour l'avoir sans réseau. */
export function OfflineMapPanel({ disabled = false, position = null }: Props) {
  const { regions, download, remove } = useRegionDownloads();

  if (regions === null) return <p className="text-sm text-muted">Chargement…</p>;
  if (regions.length === 0) return <p className="text-sm text-muted">Aucune carte téléchargeable sur ce serveur.</p>;

  const home = position ? regionAt(regions.map((s) => s.region), position) : null;
  const homeState = regions.find((s) => s.region === home) ?? null;
  // Toujours visibles : la région de l'utilisateur et les cartes déjà téléchargées.
  const pinned = regions.filter((s) => s !== homeState && (s.downloaded || s.progress !== null));
  const shown = homeState ? [homeState, ...pinned] : pinned;
  const others = regions
    .filter((s) => !shown.includes(s))
    .sort((a, b) => a.region.name.localeCompare(b.region.name, 'fr'));
  const busyServer = disabled && regions.some((s) => !s.downloaded);

  const item = (state: RegionState) => (
    <RegionItem
      key={state.region.id}
      state={state}
      home={state === homeState}
      disabled={disabled}
      onDownload={() => void download(state.region)}
      onRemove={() => void remove(state.region)}
    />
  );

  return (
    <div className="flex flex-col gap-2">
      {busyServer && (
        <p role="status" className="text-sm font-semibold text-warn">
          Forte affluence : téléchargement suspendu pour garder la carte en direct fluide. Réessayez plus tard.
        </p>
      )}
      {!homeState && regions.length > 1 && (
        <p className="text-sm text-muted">
          Activez le Mode Manif pour voir votre région en premier (calculé sur votre téléphone, rien n'est envoyé).
        </p>
      )}
      {shown.length > 0 && (
        <ul className="flex flex-col gap-2">{shown.map(item)}</ul>
      )}
      {others.length > 0 &&
        (shown.length > 0 ? (
          <details className="rounded-xl border-2 border-line p-3">
            <summary className="min-h-8 cursor-pointer font-semibold">Autres régions ({others.length})</summary>
            <ul className="mt-2 flex flex-col gap-2">{others.map(item)}</ul>
          </details>
        ) : (
          <ul className="flex flex-col gap-2">{others.map(item)}</ul>
        ))}
    </div>
  );
}

interface ItemProps {
  state: RegionState;
  home: boolean;
  disabled: boolean;
  onDownload(): void;
  onRemove(): void;
}

function RegionItem({ state, home, disabled, onDownload, onRemove }: ItemProps) {
  return (
    <li className={`rounded-xl border-2 p-3 ${home ? 'border-accent' : 'border-line'}`}>
      <div className="flex items-center justify-between gap-2">
        <div>
          {home && <p className="text-xs font-bold uppercase tracking-wide text-accent">📍 Votre région</p>}
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
          <button type="button" onClick={onRemove} className="min-h-11 rounded-xl border-2 border-line px-3 font-semibold">
            Supprimer
          </button>
        ) : (
          <button
            type="button"
            disabled={disabled}
            onClick={onDownload}
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
  );
}
