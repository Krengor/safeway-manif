import { useEffect, useRef, type ReactNode } from 'react';

interface Props {
  title: string;
  onClose(): void;
  children: ReactNode;
}

/** Panneau bas modal, accessible au clavier et aux lecteurs d'écran. */
export function Sheet({ title, onClose, children }: Props) {
  const dialog = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      previous?.focus?.();
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center">
      <button type="button" aria-label="Fermer" className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className="safe-bottom relative max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-t-2xl border-t border-line bg-panel px-4 pt-3 shadow-2xl outline-none"
      >
        <div className="mx-auto mb-3 h-1.5 w-12 rounded-full bg-line" aria-hidden="true" />
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="text-lg font-bold">{title}</h2>
          <button type="button" onClick={onClose} className="rounded-lg px-3 py-2 text-sm font-semibold text-muted">
            Fermer
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
