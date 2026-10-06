/**
 * Prise en main express, montrée une fois après la création du compte.
 * 4 écrans, lisibles en quelques secondes chacun, et « Passer » toujours visible.
 */
import { useEffect, useRef, useState } from 'react';

interface Step {
  icon: string;
  title: string;
  lines: string[];
}

const STEPS: Step[] = [
  {
    icon: '📍',
    title: 'Activez le Mode Manif',
    lines: [
      'Le bouton en haut allume la localisation, seulement quand vous en avez besoin.',
      'Votre position reste sur votre téléphone : personne ne la voit.',
    ],
  },
  {
    icon: '🗺️',
    title: 'Lisez la carte',
    lines: [
      '✓ vert : passage confirmé · ? orange : incertain · ! rouge : danger ou blocage.',
      '« ● Direct » en haut à droite : les infos arrivent en temps réel.',
    ],
  },
  {
    icon: '⚠️',
    title: 'Signalez en 2 gestes',
    lines: [
      '« Signaler » puis le type de situation : c’est publié, anonymement.',
      'Touchez un marqueur pour confirmer « Toujours vrai » ou « Plus d’actualité ».',
    ],
  },
  {
    icon: '🧭',
    title: 'Trouvez un trajet',
    lines: [
      '« Trajet » puis touchez votre destination : l’itinéraire évite les zones signalées.',
      'Vous êtes alerté si un danger apparaît sur votre chemin. Restez vigilant : rien n’est garanti.',
    ],
  },
];

interface Props {
  onClose(): void;
}

export function Tutorial({ onClose }: Props) {
  const [index, setIndex] = useState(0);
  const dialog = useRef<HTMLDivElement>(null);
  const step = STEPS[index]!;
  const last = index === STEPS.length - 1;

  useEffect(() => {
    dialog.current?.focus();
  }, [index]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight') setIndex((i) => Math.min(i + 1, STEPS.length - 1));
      if (e.key === 'ArrowLeft') setIndex((i) => Math.max(i - 1, 0));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/50 sm:items-center">
      <div
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-label={`Prise en main, étape ${index + 1} sur ${STEPS.length}`}
        tabIndex={-1}
        className="safe-bottom w-full max-w-md rounded-t-3xl bg-panel px-6 pt-4 shadow-2xl outline-none sm:rounded-3xl sm:pb-6"
      >
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold text-muted">
            {index + 1} / {STEPS.length}
          </span>
          <button type="button" onClick={onClose} className="rounded-lg px-3 py-2 font-semibold text-muted">
            Passer
          </button>
        </div>

        <div className="py-6 text-center" aria-live="polite">
          <div aria-hidden="true" className="mb-4 text-6xl">
            {step.icon}
          </div>
          <h2 className="mb-3 text-2xl font-black">{step.title}</h2>
          {step.lines.map((line) => (
            <p key={line} className="mb-2 text-base leading-snug">
              {line}
            </p>
          ))}
        </div>

        <div className="mb-4 flex justify-center gap-2" aria-hidden="true">
          {STEPS.map((s, i) => (
            <span key={s.title} className={`h-2 rounded-full transition-all ${i === index ? 'w-6 bg-accent' : 'w-2 bg-line'}`} />
          ))}
        </div>

        <div className="mb-2 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setIndex((i) => i - 1)}
            disabled={index === 0}
            className="min-h-14 rounded-xl border-2 border-line font-bold disabled:invisible"
          >
            ← Retour
          </button>
          <button
            type="button"
            onClick={() => (last ? onClose() : setIndex((i) => i + 1))}
            className="min-h-14 rounded-xl bg-accent text-lg font-bold text-accent-fg"
          >
            {last ? 'C’est parti' : 'Suivant →'}
          </button>
        </div>
      </div>
    </div>
  );
}

const SEEN_KEY = 'sw_tutorial_seen';

/** Préférence d'affichage locale uniquement (aucune donnée personnelle). */
export function tutorialSeen(): boolean {
  try {
    return localStorage.getItem(SEEN_KEY) === '1';
  } catch {
    return false;
  }
}

export function markTutorialSeen(): void {
  try {
    localStorage.setItem(SEEN_KEY, '1');
  } catch {
    /* stockage indisponible (navigation privée) : on remontrera le tutoriel, sans gravité */
  }
}
