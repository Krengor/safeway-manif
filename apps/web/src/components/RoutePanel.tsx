import type { RouteResponse } from '@safeway/shared';

interface Props {
  route: RouteResponse | null;
  loading: boolean;
  error: string | null;
  /** Nouveaux dangers apparus sur le trajet depuis le calcul. */
  alertCount: number;
  canRecompute: boolean;
  onRecompute(): void;
  onStop(): void;
}

function formatDistance(m: number): string {
  return m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1).replace('.', ',')} km`;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n > 1 ? 's' : ''}`;
}

/** Panneau compact, non modal : la carte reste utilisable pendant le trajet. */
export function RoutePanel({ route, loading, error, alertCount, canRecompute, onRecompute, onStop }: Props) {
  return (
    <section
      aria-label="Itinéraire"
      className="pointer-events-auto mx-auto w-full max-w-lg rounded-2xl border-2 border-line bg-panel p-3 shadow-xl"
    >
      {alertCount > 0 && (
        <p role="alert" className="mb-2 rounded-xl bg-danger px-3 py-2 font-bold text-white">
          ⛔ {alertCount > 1 ? `${alertCount} nouveaux dangers signalés` : 'Nouveau danger signalé'} sur votre trajet.
        </p>
      )}

      {loading && <p className="font-semibold">Calcul de l'itinéraire…</p>}
      {error && !loading && (
        <p role="alert" className="font-semibold text-danger">
          {error}
        </p>
      )}

      {route && !loading && (
        <div className="flex flex-col gap-1">
          <p className="text-lg font-bold">
            {formatDistance(route.distanceM)} · {Math.max(1, Math.round(route.durationS / 60))} min à pied
          </p>
          {route.risk === 'danger' && (
            <p className="font-semibold text-danger">⛔ Traverse une zone signalée dangereuse : aucun détour raisonnable trouvé.</p>
          )}
          {route.risk === 'uncertain' && (
            <p className="font-semibold text-warn">⚠️ Traverse des zones à l'information incertaine.</p>
          )}
          {route.risk === 'clear' && alertCount === 0 && <p className="font-semibold">Aucune zone signalée sur ce trajet.</p>}
          {alertCount > 0 && <p className="font-semibold">Recalculez pour chercher un détour.</p>}
          {route.avoided.danger > 0 && (
            <p className="text-sm">Évite {plural(route.avoided.danger, 'zone')} signalée{route.avoided.danger > 1 ? 's' : ''} dangereuse{route.avoided.danger > 1 ? 's' : ''}.</p>
          )}
          {route.avoided.uncertain > 0 && (
            <p className="text-sm">Évite {plural(route.avoided.uncertain, 'zone')} incertaine{route.avoided.uncertain > 1 ? 's' : ''}.</p>
          )}
          {!route.hazardsKnown && (
            <p className="text-sm font-semibold text-warn">Signalements partiellement indisponibles : trajet calculé sans eux.</p>
          )}
        </div>
      )}

      <p className="mt-2 text-xs text-muted">
        Itinéraire basé sur les informations communautaires disponibles. Il ne garantit pas la sécurité.
      </p>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={onRecompute}
          disabled={!canRecompute}
          className={`min-h-12 rounded-xl font-bold disabled:opacity-40 ${
            alertCount > 0 ? 'bg-danger text-white' : 'bg-accent text-accent-fg'
          }`}
        >
          ↻ Recalculer
        </button>
        <button type="button" onClick={onStop} className="min-h-12 rounded-xl border-2 border-line font-bold">
          ✕ Arrêter
        </button>
      </div>
    </section>
  );
}
