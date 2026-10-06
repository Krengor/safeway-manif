import { EVENT_META, EVENT_TYPES, type EventType } from '@safeway/shared';
import { useState } from 'react';
import { Sheet } from './Sheet';

interface Props {
  /** Signalement à un endroit choisi (appui long) plutôt qu'à sa position. */
  pinned: boolean;
  busy: boolean;
  onPick(type: EventType): void;
  onClose(): void;
}

const QUICK = EVENT_TYPES.filter((t) => EVENT_META[t].quick);
const OTHERS = EVENT_TYPES.filter((t) => !EVENT_META[t].quick);

/** Deuxième et dernière interaction : un appui sur un type publie le signalement (§24). */
export function ReportSheet({ pinned, busy, onPick, onClose }: Props) {
  const [more, setMore] = useState(false);
  const types = more ? [...QUICK, ...OTHERS] : QUICK;

  return (
    <Sheet title="Que se passe-t-il ?" onClose={onClose}>
      <p className="mb-3 text-sm text-muted">
        {pinned ? "À l'endroit sélectionné." : 'Autour de vous.'} Publication anonyme, effacée automatiquement.
      </p>
      <div className="grid grid-cols-2 gap-2">
        {types.map((type) => {
          const meta = EVENT_META[type];
          return (
            <button
              key={type}
              type="button"
              disabled={busy}
              onClick={() => onPick(type)}
              className="flex min-h-16 items-center gap-3 rounded-xl border-2 border-line bg-bg px-3 py-3 text-left text-base font-semibold active:scale-[0.98] disabled:opacity-50"
            >
              <span aria-hidden="true" className="text-2xl">
                {meta.icon}
              </span>
              <span>{meta.label}</span>
            </button>
          );
        })}
      </div>
      {!more && (
        <button type="button" onClick={() => setMore(true)} className="mt-3 w-full rounded-xl py-3 font-semibold text-muted underline">
          Autres situations…
        </button>
      )}
      <div className="h-3" />
    </Sheet>
  );
}
