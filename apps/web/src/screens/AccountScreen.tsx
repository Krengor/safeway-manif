import { pseudoSchema } from '@safeway/shared';
import { useState, type FormEvent } from 'react';
import { api, ApiRequestError } from '../lib/api';

interface Props {
  pseudo: string;
  onPseudoChange(pseudo: string): void;
  onSignedOut(): void;
  onClose(): void;
}

export function AccountScreen({ pseudo, onPseudoChange, onSignedOut, onClose }: Props) {
  const [value, setValue] = useState(pseudo);
  const [message, setMessage] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);

  async function guard(action: () => Promise<void>) {
    setBusy(true);
    setMessage(null);
    try {
      await action();
    } catch (err) {
      setMessage(err instanceof ApiRequestError ? err.message : 'Erreur inattendue.');
    } finally {
      setBusy(false);
    }
  }

  function onRename(e: FormEvent) {
    e.preventDefault();
    const parsed = pseudoSchema.safeParse(value);
    if (!parsed.success) return setMessage('Pseudo : 3 à 24 caractères, lettres, chiffres, - et _.');
    void guard(async () => {
      const me = await api.updatePseudo(parsed.data);
      onPseudoChange(me.pseudo);
      setMessage('Pseudo mis à jour.');
    });
  }

  return (
    <main className="safe-top safe-bottom mx-auto flex min-h-full max-w-md flex-col gap-6 px-4">
      <button type="button" onClick={onClose} className="self-start py-2 font-semibold text-muted">
        ← Retour à la carte
      </button>
      <h1 className="text-2xl font-bold">Compte</h1>

      <form onSubmit={onRename} className="flex flex-col gap-2">
        <label htmlFor="new-pseudo" className="font-semibold">
          Pseudo
        </label>
        <input
          id="new-pseudo"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          maxLength={24}
          autoComplete="off"
          className="min-h-12 rounded-xl border-2 border-line bg-bg px-3 text-lg"
        />
        <button type="submit" disabled={busy || value === pseudo} className="min-h-12 rounded-xl bg-accent font-bold text-accent-fg disabled:opacity-50">
          Changer de pseudo
        </button>
      </form>

      <button
        type="button"
        disabled={busy}
        onClick={() => void guard(async () => {
          await api.logout();
          onSignedOut();
        })}
        className="min-h-12 rounded-xl border-2 border-line font-bold"
      >
        Se déconnecter
      </button>

      <section className="rounded-xl border-2 border-danger p-3">
        <h2 className="text-lg font-bold">Supprimer mon compte</h2>
        <p className="mt-1 text-sm">
          Suppression immédiate et définitive du pseudo, de la clé publique et de toutes les sessions. Pensez à
          supprimer aussi la passkey « SafeWay » dans le gestionnaire de votre appareil.
        </p>
        {!confirmDelete ? (
          <button type="button" onClick={() => setConfirmDelete(true)} className="mt-3 min-h-12 w-full rounded-xl bg-danger font-bold text-white">
            Supprimer mon compte
          </button>
        ) : (
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button type="button" onClick={() => setConfirmDelete(false)} className="min-h-12 rounded-xl border-2 border-line font-bold">
              Annuler
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void guard(async () => {
                await api.deleteAccount();
                onSignedOut();
              })}
              className="min-h-12 rounded-xl bg-danger font-bold text-white"
            >
              Confirmer
            </button>
          </div>
        )}
      </section>

      {message && (
        <p role="status" className="font-semibold">
          {message}
        </p>
      )}
    </main>
  );
}
