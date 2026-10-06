import { pseudoSchema } from '@safeway/shared';
import { useState, type FormEvent } from 'react';
import { loginWithPasskey, passkeyErrorMessage, passkeysSupported, registerWithPasskey } from '../lib/auth';

interface Props {
  reason: string | null;
  onDone(pseudo: string): void;
  onCancel(): void;
}

export function AuthScreen({ reason, onDone, onCancel }: Props) {
  const [pseudo, setPseudo] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const supported = passkeysSupported();

  async function run(action: () => Promise<string>) {
    setBusy(true);
    setError(null);
    try {
      onDone(await action());
    } catch (err) {
      setError(passkeyErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  function onRegister(e: FormEvent) {
    e.preventDefault();
    const parsed = pseudoSchema.safeParse(pseudo);
    if (!parsed.success) {
      setError('Pseudo : 3 à 24 caractères, lettres, chiffres, - et _ uniquement.');
      return;
    }
    void run(() => registerWithPasskey(parsed.data));
  }

  return (
    <main className="safe-top safe-bottom mx-auto flex min-h-full max-w-md flex-col gap-6 px-4">
      <button type="button" onClick={onCancel} className="self-start py-2 font-semibold text-muted">
        ← Retour à la carte
      </button>
      <header>
        <h1 className="text-2xl font-bold">Compte anonyme</h1>
        {reason && <p className="mt-1 font-semibold">{reason}</p>}
        <p className="mt-2 text-muted">
          Un pseudo et une passkey : pas d'e-mail, pas de téléphone, pas de mot de passe. La clé privée reste sur votre
          appareil.
        </p>
      </header>

      {!supported && (
        <p role="alert" className="rounded-xl border-2 border-danger p-3 font-semibold">
          Ce navigateur ne prend pas en charge les passkeys. Utilisez un navigateur récent.
        </p>
      )}

      <form onSubmit={onRegister} className="flex flex-col gap-3">
        <label htmlFor="pseudo" className="font-semibold">
          Choisir un pseudo
        </label>
        <input
          id="pseudo"
          value={pseudo}
          onChange={(e) => setPseudo(e.target.value)}
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          maxLength={24}
          placeholder="ex. renard_bleu"
          className="min-h-12 rounded-xl border-2 border-line bg-bg px-3 text-lg"
        />
        <p className="text-sm text-muted">N'utilisez pas votre vrai nom.</p>
        <button
          type="submit"
          disabled={busy || !supported}
          className="min-h-14 rounded-xl bg-accent text-lg font-bold text-accent-fg disabled:opacity-50"
        >
          Créer mon compte avec une passkey
        </button>
      </form>

      <div className="flex items-center gap-3 text-muted" aria-hidden="true">
        <span className="h-px flex-1 bg-line" />
        ou
        <span className="h-px flex-1 bg-line" />
      </div>

      <button
        type="button"
        disabled={busy || !supported}
        onClick={() => void run(loginWithPasskey)}
        className="min-h-14 rounded-xl border-2 border-line text-lg font-bold disabled:opacity-50"
      >
        J'ai déjà une passkey
      </button>

      {error && (
        <p role="alert" className="rounded-xl border-2 border-danger p-3 font-semibold">
          {error}
        </p>
      )}
    </main>
  );
}
