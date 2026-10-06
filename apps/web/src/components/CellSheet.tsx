import { EVENT_META, computeConfidence, isContested, type PublicEvent } from '@safeway/shared';
import { Sheet } from './Sheet';

interface Props {
  events: PublicEvent[];
  now: number;
  canVote: boolean;
  voteHint: string | null;
  busyId: string | null;
  onVote(event: PublicEvent, vote: 1 | -1): void;
  onClose(): void;
}

function ago(seconds: number): string {
  if (seconds < 60) return "à l'instant";
  const min = Math.round(seconds / 60);
  return `il y a ${min} min`;
}

function reliability(event: PublicEvent, now: number): { label: string; tone: string } {
  if (isContested(event)) return { label: 'Contesté', tone: 'text-warn' };
  const c = computeConfidence(event, now);
  if (c >= 0.6) return { label: 'Fiabilité élevée', tone: 'text-ok' };
  if (c >= 0.4) return { label: 'Fiabilité moyenne', tone: 'text-warn' };
  return { label: 'Fiabilité faible', tone: 'text-unknown' };
}

export function CellSheet({ events, now, canVote, voteHint, busyId, onVote, onClose }: Props) {
  return (
    <Sheet title="Signalements dans cette zone" onClose={onClose}>
      {events.length === 0 && <p className="mb-4 text-muted">Ces signalements ont expiré.</p>}
      <ul className="flex flex-col gap-3">
        {events.map((event) => {
          const meta = EVENT_META[event.type];
          const rel = reliability(event, now);
          return (
            <li key={event.id} className="rounded-xl border-2 border-line p-3">
              <div className="flex items-start gap-3">
                <span aria-hidden="true" className="text-3xl leading-none">
                  {meta.icon}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="font-bold">{meta.label}</p>
                  <p className="text-sm text-muted">
                    Signalé {ago(now - event.createdAt)} · confirmé {ago(now - event.lastConfAt)}
                  </p>
                  <p className={`text-sm font-semibold ${rel.tone}`}>
                    {rel.label} · {event.conf} confirmation{event.conf > 1 ? 's' : ''}
                    {event.inv > 0 ? ` · ${event.inv} « plus d'actualité »` : ''}
                  </p>
                </div>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  disabled={!canVote || busyId === event.id}
                  onClick={() => onVote(event, 1)}
                  className="min-h-12 rounded-lg bg-ok px-2 font-bold text-white disabled:opacity-40"
                >
                  ✓ Toujours vrai
                </button>
                <button
                  type="button"
                  disabled={!canVote || busyId === event.id}
                  onClick={() => onVote(event, -1)}
                  className="min-h-12 rounded-lg border-2 border-line px-2 font-bold disabled:opacity-40"
                >
                  ✕ Plus d'actualité
                </button>
              </div>
            </li>
          );
        })}
      </ul>
      {voteHint && <p className="mt-3 text-sm font-semibold text-muted">{voteHint}</p>}
      <p className="mt-3 mb-2 text-xs text-muted">
        Informations communautaires, possiblement incomplètes ou inexactes.
      </p>
    </Sheet>
  );
}
