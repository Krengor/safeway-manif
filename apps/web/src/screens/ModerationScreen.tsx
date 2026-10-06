/**
 * Écran de modération (§22) — administrateur uniquement.
 * Données volontairement limitées : signalements publics, chiffres agrégés, comptes à faible
 * fiabilité par tranche. Aucune position, aucun lien auteur ↔ signalement.
 */
import {
  DEGRADATION_LEVELS,
  EVENT_META,
  pseudoSchema,
  type AdminAccount,
  type AdminOverview,
  type DegradationLevel,
  type PublicEvent,
} from '@safeway/shared';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, ApiRequestError } from '../lib/api';

interface Props {
  onClose(): void;
}

const LEVEL_LABELS: Record<DegradationLevel, string> = {
  0: 'Normal',
  1: 'Forte charge',
  2: 'Critique',
  3: 'Survie',
};

const LEVEL_HINTS: Record<DegradationLevel, string> = {
  0: 'Temps réel complet, itinéraire, animations.',
  1: 'Mises à jour regroupées, cache plus long, sans animations.',
  2: 'Lecture prioritaire, itinéraire ralenti, fonctions secondaires coupées.',
  3: 'Carte et signalements uniquement, itinéraire coupé.',
};

const ago = (now: number, t: number) => {
  const min = Math.round((now - t) / 60);
  return min < 1 ? "à l'instant" : `il y a ${min} min`;
};

export function ModerationScreen({ onClose }: Props) {
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [events, setEvents] = useState<(PublicEvent & { zone: string })[]>([]);
  const [accounts, setAccounts] = useState<AdminAccount[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [pseudo, setPseudo] = useState('');

  const load = useCallback(async () => {
    try {
      const [o, e, a] = await Promise.all([api.admin.overview(), api.admin.events(), api.admin.accounts()]);
      setOverview(o);
      setEvents(e.events);
      setAccounts(a.accounts);
    } catch (err) {
      setMessage(err instanceof ApiRequestError ? err.message : 'Chargement impossible.');
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 15_000);
    return () => clearInterval(timer);
  }, [load]);

  const act = async (action: () => Promise<void>, done: string) => {
    setMessage(null);
    try {
      await action();
      setMessage(done);
      await load();
    } catch (err) {
      setMessage(err instanceof ApiRequestError ? err.message : 'Action impossible.');
    }
  };

  const onSuspend = (e: FormEvent) => {
    e.preventDefault();
    const parsed = pseudoSchema.safeParse(pseudo);
    if (!parsed.success) return setMessage('Pseudo invalide.');
    void act(() => api.admin.suspend(parsed.data), `${parsed.data} suspendu.`).then(() => setPseudo(''));
  };

  const now = overview?.now ?? Math.floor(Date.now() / 1000);

  return (
    <main className="safe-top safe-bottom mx-auto flex min-h-full max-w-2xl flex-col gap-6 px-4">
      <button type="button" onClick={onClose} className="self-start py-2 font-semibold text-muted">
        ← Retour
      </button>
      <h1 className="text-2xl font-bold">🛡️ Modération</h1>
      <p className="-mt-4 text-sm text-muted">
        Vous ne voyez ni positions, ni adresses IP, ni qui a publié quoi : ces informations n'existent pas.
      </p>

      {message && (
        <p role="status" className="rounded-xl border-2 border-line p-3 font-semibold">
          {message}
        </p>
      )}

      {overview && (
        <section aria-label="Vue d'ensemble" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[
            ['Signalements actifs', overview.activeEvents],
            ['Zones actives', overview.activeZones],
            ['Comptes', overview.accounts],
            ['Suspendus', overview.suspended],
          ].map(([label, value]) => (
            <div key={label} className="rounded-xl border-2 border-line p-3">
              <p className="text-2xl font-black">{value}</p>
              <p className="text-sm text-muted">{label}</p>
            </div>
          ))}
        </section>
      )}

      {overview && (
        <section aria-label="Charge du service" className="rounded-xl border-2 border-line p-3">
          <h2 className="text-lg font-bold">
            🚦 Charge : niveau {overview.load.level} — {LEVEL_LABELS[overview.load.level]}
          </h2>
          <p className="mb-2 text-sm text-muted">
            {LEVEL_HINTS[overview.load.level]}{' '}
            {overview.load.forcedUntil
              ? `Forcé jusqu'à ${new Date(overview.load.forcedUntil * 1000).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })} (mesuré : ${overview.load.auto}).`
              : 'Automatique, selon la charge mesurée.'}
          </p>
          <div className="flex flex-wrap gap-2">
            {DEGRADATION_LEVELS.map((level) => (
              <button
                key={level}
                type="button"
                aria-pressed={overview.load.forcedUntil !== undefined && overview.load.level === level}
                onClick={() => void act(() => api.admin.setLoad(level).then(() => {}), `Niveau ${level} forcé pour 1 h.`)}
                className="min-h-11 rounded-xl border-2 border-line px-3 text-sm font-semibold aria-pressed:bg-accent aria-pressed:text-accent-fg"
              >
                {level} · {LEVEL_LABELS[level]}
              </button>
            ))}
            {overview.load.forcedUntil !== undefined && (
              <button
                type="button"
                onClick={() => void act(() => api.admin.setLoad(null).then(() => {}), 'Retour au niveau automatique.')}
                className="min-h-11 rounded-xl bg-accent px-3 text-sm font-bold text-accent-fg"
              >
                Automatique
              </button>
            )}
          </div>
        </section>
      )}

      {overview && overview.surges.length > 0 && (
        <section role="alert" className="rounded-xl border-2 border-warn p-3">
          <h2 className="mb-1 text-lg font-bold">⚡ Pics inhabituels de nouveaux signalements</h2>
          <p className="mb-2 text-sm text-muted">
            Peut être une vraie dispersion… ou une tentative de saturer la carte. À vérifier dans la liste ci-dessous.
          </p>
          <ul className="flex flex-col gap-1">
            {overview.surges.map((s) => (
              <li key={s.zone} className="font-semibold">
                Zone {s.zone.slice(0, 8)}… : {s.newEvents} nouveaux signalements en 5 min
              </li>
            ))}
          </ul>
        </section>
      )}

      {overview && Object.keys(overview.byType).length > 0 && (
        <section>
          <h2 className="mb-2 text-lg font-bold">Par type</h2>
          <ul className="flex flex-wrap gap-2">
            {Object.entries(overview.byType).map(([type, n]) => (
              <li key={type} className="rounded-full border-2 border-line px-3 py-1 text-sm font-semibold">
                {EVENT_META[type as keyof typeof EVENT_META].icon} {EVENT_META[type as keyof typeof EVENT_META].short} : {n}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h2 className="mb-2 text-lg font-bold">Signalements actifs ({events.length})</h2>
        {events.length === 0 && <p className="text-muted">Aucun signalement actif.</p>}
        <ul className="flex flex-col gap-2">
          {events.map((ev) => {
            const meta = EVENT_META[ev.type];
            return (
              <li key={ev.id} className="flex items-center gap-3 rounded-xl border-2 border-line p-3">
                <span aria-hidden="true" className="text-2xl">
                  {meta.icon}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="font-bold">{meta.label}</p>
                  <p className="text-sm text-muted">
                    {ago(now, ev.createdAt)} · {ev.conf} ✓ / {ev.inv} ✕ · zone {ev.zone.slice(0, 8)}…
                  </p>
                </div>
                {confirmId === ev.id ? (
                  <div className="flex gap-1">
                    <button type="button" onClick={() => setConfirmId(null)} className="min-h-11 rounded-lg border-2 border-line px-2 text-sm font-semibold">
                      Annuler
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setConfirmId(null);
                        void act(() => api.admin.removeEvent(ev.id), 'Signalement supprimé.');
                      }}
                      className="min-h-11 rounded-lg bg-danger px-2 text-sm font-bold text-white"
                    >
                      Confirmer
                    </button>
                  </div>
                ) : (
                  <button type="button" onClick={() => setConfirmId(ev.id)} className="min-h-11 rounded-lg border-2 border-danger px-3 text-sm font-bold text-danger">
                    Supprimer
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      <section>
        <h2 className="mb-2 text-lg font-bold">Comptes à surveiller</h2>
        <p className="mb-2 text-sm text-muted">Fiabilité faible : signalements souvent invalidés par la communauté.</p>
        {accounts.length === 0 && <p className="text-muted">Aucun compte à faible fiabilité.</p>}
        <ul className="flex flex-col gap-2">
          {accounts.map((account) => (
            <li key={account.pseudo} className="flex items-center gap-3 rounded-xl border-2 border-line p-3">
              <div className="flex-1">
                <p className="font-bold">{account.pseudo}</p>
                <p className="text-sm text-muted">
                  Fiabilité {account.reliability}
                  {account.suspended ? ' · suspendu' : ''}
                </p>
              </div>
              {account.suspended ? (
                <button
                  type="button"
                  onClick={() => void act(() => api.admin.unsuspend(account.pseudo), `${account.pseudo} réactivé.`)}
                  className="min-h-11 rounded-lg border-2 border-line px-3 text-sm font-bold"
                >
                  Réactiver
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => void act(() => api.admin.suspend(account.pseudo), `${account.pseudo} suspendu.`)}
                  className="min-h-11 rounded-lg bg-danger px-3 text-sm font-bold text-white"
                >
                  Suspendre
                </button>
              )}
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2 className="mb-2 text-lg font-bold">Suspendre un pseudo</h2>
        <form onSubmit={onSuspend} className="flex gap-2">
          <label htmlFor="suspend-pseudo" className="sr-only">
            Pseudo
          </label>
          <input
            id="suspend-pseudo"
            value={pseudo}
            onChange={(e) => setPseudo(e.target.value)}
            maxLength={24}
            autoComplete="off"
            className="min-h-12 flex-1 rounded-xl border-2 border-line bg-bg px-3"
            placeholder="pseudo"
          />
          <button type="submit" className="min-h-12 rounded-xl bg-danger px-4 font-bold text-white">
            Suspendre
          </button>
        </form>
        <p className="mt-1 text-xs text-muted">Déconnexion immédiate de toutes ses sessions ; reconnexion refusée.</p>
      </section>
    </main>
  );
}
