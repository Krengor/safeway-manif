import { degradationPolicy, isNear, toEventCell, type EventType, type PublicEvent } from '@safeway/shared';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CellSheet } from './components/CellSheet';
import { Legend } from './components/Legend';
import { OfflineMapSuggestion } from './components/OfflineMapSuggestion';
import { ReportSheet } from './components/ReportSheet';
import { RoutePanel } from './components/RoutePanel';
import { api, ApiRequestError } from './lib/api';
import { useManifMode } from './lib/useManifMode';
import { useOnline, useOutbox } from './lib/useOutbox';
import { SHARE_FRAGMENT_PREFIX, loadSigningKey, readSharePacket } from './lib/offlineShare';
import { OfflineShareSheet } from './components/OfflineShareSheet';
import { useTrip } from './lib/useTrip';
import { useZoneEvents } from './lib/useZoneEvents';
import { MapView, type MapViewHandle } from './map/MapView';
import { summarizeCells } from './map/overlay';
import { AccountScreen } from './screens/AccountScreen';
import { AuthScreen } from './screens/AuthScreen';
import { ModerationScreen } from './screens/ModerationScreen';
import { PrivacyScreen } from './screens/PrivacyScreen';
import { Tutorial, markTutorialSeen, tutorialSeen } from './screens/Tutorial';

type Screen = 'map' | 'auth' | 'account' | 'privacy' | 'moderation';
const STALE_AFTER_MS = 45_000;

/**
 * Échec d'acheminement (pas de réponse, délai dépassé, ou serveur injoignable derrière le
 * proxy) : à distinguer d'un refus explicite, qui ne doit pas être renvoyé.
 */
const isNetworkError = (err: unknown) => err instanceof ApiRequestError && [0, 502, 503, 504].includes(err.status);

function useDarkMode(): boolean {
  const query = '(prefers-color-scheme: dark)';
  const [dark, setDark] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const onChange = () => setDark(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return dark;
}

function useTick(ms: number): number {
  const [t, setT] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setT(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return t;
}

export function App() {
  const dark = useDarkMode();
  const tick = useTick(10_000);
  const manif = useManifMode();
  const mapView = useRef<MapViewHandle>(null);

  const [screen, setScreen] = useState<Screen>('map');
  const [authReason, setAuthReason] = useState<string | null>(null);
  const [pseudo, setPseudo] = useState<string | null | undefined>(undefined);
  const [zones, setZones] = useState<string[] | null>(null);
  const [reportTarget, setReportTarget] = useState<{ cell: string; pinned: boolean } | null>(null);
  const [selectedCell, setSelectedCell] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [showTutorial, setShowTutorial] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [offlineMode, setOfflineMode] = useState(false);
  const [showShare, setShowShare] = useState(false);
  const [degradedDismissedAt, setDegradedDismissedAt] = useState(0);

  const zoneData = useZoneEvents(zones ?? []);
  const now = Math.floor(tick / 1000) + zoneData.clockSkew;
  const cells = useMemo(() => summarizeCells(zoneData.events, now), [zoneData.events, now]);
  const statusByCell = useMemo(() => new Map(cells.map((c) => [c.cell, c.status])), [cells]);
  // Dégradation contrôlée (§56) : le serveur annonce son niveau de charge, l'app s'allège.
  const policy = degradationPolicy(zoneData.level);
  const trip = useTrip(manif.position, statusByCell, policy.routeRecomputeSeconds * 1000);

  useEffect(() => {
    if (policy.animations) delete document.documentElement.dataset.motion;
    else document.documentElement.dataset.motion = 'off';
  }, [policy.animations]);
  const online = useOnline();
  const outbox = useOutbox((event, item) => {
    if (event) zoneData.upsert(event);
    else if (item.kind === 'vote') zoneData.remove(item.eventId);
    setToast(item.kind === 'report' ? 'Signalement en attente envoyé.' : 'Vote en attente envoyé.');
  });

  useEffect(() => {
    api.me().then(
      (me) => {
        setPseudo(me.pseudo);
        setIsAdmin(me.admin === true);
      },
      () => setPseudo(null),
    );
  }, []);

  // Partage hors réseau reçu (QR scanné / lien partagé) : import + vérification des signatures.
  // Au passage, la clé publique du serveur est mise en cache pour les réceptions hors ligne.
  useEffect(() => {
    const hash = window.location.hash;
    const packet = hash.startsWith(SHARE_FRAGMENT_PREFIX) ? hash.slice(SHARE_FRAGMENT_PREFIX.length) : null;
    void (async () => {
      const key = await loadSigningKey().catch(() => null);
      if (!packet) return;
      history.replaceState(null, '', window.location.pathname); // le paquet ne reste pas dans l'historique
      try {
        const received = await readSharePacket(packet, key, Math.floor(Date.now() / 1000));
        zoneData.importShared([...received.verified, ...received.unverified]);
        const total = received.verified.length + received.unverified.length;
        setToast(
          total === 0
            ? 'Partage reçu : aucun signalement encore valable.'
            : `📡 ${total} signalement${total > 1 ? 's' : ''} reçu${total > 1 ? 's' : ''} hors réseau` +
                (received.unverified.length ? ` (${received.unverified.length} non vérifié${received.unverified.length > 1 ? 's' : ''})` : '') +
                (received.rejected ? ` · ${received.rejected} écarté${received.rejected > 1 ? 's' : ''} (signature invalide)` : '') +
                '.',
        );
      } catch {
        setToast('Partage reçu illisible.');
      }
    })();
    // Une seule fois, au chargement.
  }, []);

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(id);
  }, [toast]);

  // Premier positionnement : on centre la carte une fois.
  const centered = useRef(false);
  useEffect(() => {
    if (manif.position && !centered.current) {
      centered.current = true;
      mapView.current?.recenter(manif.position);
    }
    if (!manif.active) centered.current = false;
  }, [manif.position, manif.active]);

  const toggleManif = useCallback(() => {
    if (manif.active) {
      manif.stop();
      // Fin de session : on efface les données locales (§4), trajet et envois en attente compris.
      zoneData.clear();
      trip.stop();
      outbox.clear();
      setReportTarget(null);
      setSelectedCell(null);
      setToast('Mode Manif désactivé — position et trajet effacés.');
    } else {
      manif.start();
    }
  }, [manif, zoneData, trip, outbox]);

  // Localisation coupée (désactivation, refus du GPS…) : le trajet n'a plus de sens
  // et ne doit pas rester en mémoire.
  const stopTrip = trip.stop;
  useEffect(() => {
    if (!manif.active) stopTrip();
  }, [manif.active, stopTrip]);

  const openTrip = () => {
    if (!policy.routing) {
      setToast('Itinéraire suspendu pendant la forte affluence. Carte et signalements restent disponibles.');
      return;
    }
    if (!manif.position) {
      if (!manif.active) manif.start();
      setToast('Activez le Mode Manif : la position de départ est nécessaire.');
      return;
    }
    trip.startPicking();
  };

  const requireAccount = (reason: string): boolean => {
    if (pseudo) return true;
    setAuthReason(reason);
    setScreen('auth');
    return false;
  };

  const handleApiError = (err: unknown) => {
    if (err instanceof ApiRequestError && err.status === 401) {
      setPseudo(null);
      requireAccount('Session expirée, reconnectez-vous.');
      return;
    }
    setToast(err instanceof ApiRequestError ? err.message : 'Erreur inattendue.');
  };

  const openReport = () => {
    if (!manif.cell) {
      if (!manif.active) manif.start();
      setToast('Activez le Mode Manif : la localisation est nécessaire pour signaler.');
      return;
    }
    if (!requireAccount('Un compte anonyme est nécessaire pour signaler.')) return;
    setReportTarget({ cell: manif.cell, pinned: false });
  };

  const onLongPress = ({ lng, lat }: { lng: number; lat: number }) => {
    const target = toEventCell(lat, lng);
    if (!manif.cell) {
      setToast('Activez le Mode Manif pour signaler.');
      return;
    }
    if (!isNear(manif.cell, target)) {
      setToast('Trop loin : on ne peut signaler qu’à moins de ~200 m de soi.');
      return;
    }
    if (!requireAccount('Un compte anonyme est nécessaire pour signaler.')) return;
    setReportTarget({ cell: target, pinned: true });
  };

  const onPick = async (type: EventType) => {
    if (!reportTarget || !manif.cell) return;
    setBusy('report');
    const body = { type, cell: reportTarget.cell, presenceCell: manif.cell };
    try {
      const { event, created } = await api.report(body);
      zoneData.upsert(event);
      navigator.vibrate?.(40);
      setToast(created ? 'Signalement publié.' : 'Déjà signalé : votre confirmation est comptée.');
      setReportTarget(null);
    } catch (err) {
      if (isNetworkError(err)) {
        outbox.add({ kind: 'report', body });
        navigator.vibrate?.(40);
        setToast('Pas de réseau : signalement gardé, envoi automatique dès le retour du réseau.');
        setReportTarget(null);
      } else handleApiError(err);
    } finally {
      setBusy(null);
    }
  };

  const onVote = async (event: PublicEvent, vote: 1 | -1) => {
    if (!manif.cell) return;
    setBusy(event.id);
    try {
      const res = vote === 1 ? await api.confirm(event.id, manif.cell) : await api.invalidate(event.id, manif.cell);
      if (res.event) zoneData.upsert(res.event);
      else zoneData.remove(event.id);
      navigator.vibrate?.(30);
      setToast(vote === 1 ? 'Merci, confirmation enregistrée.' : 'Merci, signalement marqué comme plus d’actualité.');
    } catch (err) {
      if (isNetworkError(err)) {
        outbox.add({ kind: 'vote', eventId: event.id, vote, presenceCell: manif.cell });
        setToast('Pas de réseau : vote gardé, envoi automatique dès le retour du réseau.');
        return;
      }
      if (err instanceof ApiRequestError && err.status === 404) zoneData.remove(event.id);
      handleApiError(err);
    } finally {
      setBusy(null);
    }
  };

  const selected = selectedCell ? (cells.find((c) => c.cell === selectedCell)?.events ?? []) : [];
  const voteHint = !pseudo
    ? 'Connectez-vous pour voter.'
    : !manif.cell
      ? 'Activez le Mode Manif pour voter.'
      : selectedCell && !isNear(manif.cell, selectedCell)
        ? 'Vous devez être à proximité (~200 m) pour voter.'
        : null;

  const staleMinutes =
    zoneData.lastSuccessAt && tick - zoneData.lastSuccessAt > STALE_AFTER_MS
      ? Math.max(1, Math.round((tick - zoneData.lastSuccessAt) / 60_000))
      : null;

  // Réseau coupé, saturé (échecs / lenteur) ou envois bloqués : on propose le partage hors réseau.
  const networkDegraded = !online || zoneData.degraded || outbox.pending > 0;
  const suggestOffline = networkDegraded && !offlineMode && tick - degradedDismissedAt > 10 * 60_000;

  return (
    <div className="relative h-full w-full overflow-hidden">
      <MapView
        ref={mapView}
        cells={cells}
        position={manif.position}
        dark={dark}
        route={trip.route ? { shape: trip.route.shape, risk: trip.route.risk } : null}
        destination={trip.destination}
        animate={policy.animations}
        onZonesChange={setZones}
        onSelectCell={setSelectedCell}
        onLongPress={onLongPress}
        onTap={(point) => trip.picking && trip.chooseDestination(point)}
      />

      {/* En-tête */}
      <header className="safe-top pointer-events-none absolute inset-x-0 top-0 z-10 flex flex-col gap-2 px-3">
        <div className="pointer-events-auto flex items-center gap-1.5 rounded-2xl bg-panel/95 p-2 shadow-lg">
          <span className="truncate pl-1 text-sm font-black tracking-tight max-[359px]:hidden">SAFEWAY</span>
          <button
            type="button"
            role="switch"
            aria-checked={manif.active}
            onClick={toggleManif}
            className={`ml-auto flex min-h-11 items-center gap-1.5 whitespace-nowrap rounded-xl px-2.5 text-sm font-bold ${
              manif.active ? 'bg-ok text-white' : 'border-2 border-line'
            }`}
          >
            <span aria-hidden="true">{manif.active ? '●' : '○'}</span>
            Mode Manif : {manif.state === 'locating' ? '…' : manif.active ? 'ON' : 'OFF'}
          </button>
          <button
            type="button"
            onClick={() => (pseudo ? setScreen('account') : requireAccount(''))}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border-2 border-line"
            aria-label={pseudo ? `Compte ${pseudo}` : 'Se connecter'}
            title={pseudo ? `Compte ${pseudo}` : 'Se connecter'}
          >
            {pseudo ? '👤' : '🔑'}
          </button>
          <button
            type="button"
            onClick={() => setScreen('privacy')}
            title="Confidentialité"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border-2 border-line"
            aria-label="Confidentialité"
          >
            🔒
          </button>
        </div>

        {manif.state === 'denied' && (
          <p role="alert" className="pointer-events-auto rounded-xl bg-danger px-3 py-2 font-semibold text-white">
            Localisation refusée : autorisez-la dans les réglages du navigateur pour utiliser le Mode Manif.
          </p>
        )}
        {!online && (
          <p role="status" className="pointer-events-auto rounded-xl bg-unknown px-3 py-2 font-semibold text-white">
            📴 Hors ligne : carte et derniers signalements connus.
          </p>
        )}
        {suggestOffline && (
          <div role="alert" className="pointer-events-auto flex items-center gap-2 rounded-xl bg-warn px-3 py-2 font-semibold text-white">
            <span className="flex-1">📡 Réseau saturé ? Partagez les signalements de proche en proche, sans réseau.</span>
            <button type="button" onClick={() => setOfflineMode(true)} className="rounded-lg bg-white px-2 py-1 text-warn">
              Mode hors réseau
            </button>
            <button type="button" aria-label="Plus tard" onClick={() => setDegradedDismissedAt(Date.now())} className="px-1">
              ✕
            </button>
          </div>
        )}
        <OfflineMapSuggestion position={manif.position} disabled={!policy.secondary} />
        {outbox.pending > 0 && (
          <p role="status" className="pointer-events-auto rounded-xl bg-panel/95 px-3 py-2 text-sm font-semibold shadow">
            📤 {outbox.pending} envoi{outbox.pending > 1 ? 's' : ''} en attente du réseau
          </p>
        )}
        {zoneData.level >= 2 && (
          <p role="status" className="pointer-events-auto rounded-xl bg-panel/95 px-3 py-2 text-sm font-semibold shadow">
            🚦 Forte affluence : mises à jour un peu plus lentes
            {policy.routing ? '' : ', itinéraire suspendu'}. Signaler fonctionne normalement.
          </p>
        )}
        {staleMinutes !== null && online && (
          <p role="status" className="pointer-events-auto rounded-xl bg-warn px-3 py-2 font-semibold text-white">
            Données non actualisées depuis {staleMinutes} min.
          </p>
        )}
        {trip.picking && (
          <div role="status" className="pointer-events-auto flex items-center gap-2 rounded-xl bg-accent px-3 py-2 font-semibold text-accent-fg shadow-lg">
            <span className="flex-1">🧭 Touchez votre destination sur la carte.</span>
            <button type="button" onClick={trip.cancelPicking} className="rounded-lg px-2 py-1 underline">
              Annuler
            </button>
          </div>
        )}
        {zones === null && (
          <p role="status" className="pointer-events-auto self-center rounded-xl bg-panel/95 px-3 py-2 text-sm font-semibold shadow">
            Zoomez pour voir les signalements.
          </p>
        )}
        <Legend live={zoneData.live} />
      </header>

      {/* Barre d'actions — utilisable au pouce */}
      <nav className="safe-bottom absolute inset-x-0 bottom-0 z-10 flex flex-col gap-2 px-3" aria-label="Actions">
        {trip.destination && (
          <RoutePanel
            route={trip.route}
            loading={trip.loading}
            error={trip.error}
            alertCount={trip.alertCount}
            canRecompute={trip.canRecompute && policy.routing}
            onRecompute={trip.recompute}
            onStop={trip.stop}
          />
        )}
        {offlineMode && (
          <section aria-label="Mode hors réseau" className="pointer-events-auto mx-auto flex w-full max-w-lg items-center gap-2 rounded-2xl border-2 border-warn bg-panel p-2 shadow-xl">
            <span className="flex-1 pl-1 text-sm font-semibold">📡 Mode hors réseau : partagez et recevez par QR code.</span>
            <button type="button" onClick={() => setShowShare(true)} className="min-h-11 rounded-xl bg-accent px-3 font-bold text-accent-fg">
              Partager
            </button>
            <button type="button" onClick={() => setOfflineMode(false)} className="min-h-11 rounded-xl border-2 border-line px-2 text-sm font-semibold">
              Quitter
            </button>
          </section>
        )}
        <div className="flex items-end gap-2">
        <button
          type="button"
          onClick={openReport}
          className="min-h-16 flex-1 rounded-2xl bg-danger text-lg font-black text-white shadow-lg active:scale-[0.98]"
        >
          ⚠️ Signaler
        </button>
        <button
          type="button"
          onClick={openTrip}
          aria-pressed={trip.active}
          className={`min-h-16 flex-1 rounded-2xl text-lg font-bold shadow-lg active:scale-[0.98] ${
            trip.active ? 'bg-accent text-accent-fg' : 'bg-panel'
          }`}
        >
          🧭 {trip.destination ? 'Nouvelle destination' : 'Trajet'}
        </button>
        <button
          type="button"
          onClick={() => setOfflineMode((on) => !on)}
          aria-pressed={offlineMode}
          aria-label={offlineMode ? 'Quitter le mode hors réseau' : 'Activer le mode hors réseau'}
          title="Mode hors réseau (partage par QR code)"
          className={`min-h-16 rounded-2xl px-4 text-xl shadow-lg ${offlineMode ? 'bg-warn text-white' : 'bg-panel'}`}
        >
          📡
        </button>
        {manif.position && (
          <button
            type="button"
            onClick={() => manif.position && mapView.current?.recenter(manif.position)}
            className="min-h-16 rounded-2xl bg-panel px-4 text-xl shadow-lg"
            aria-label="Recentrer sur ma position"
          >
            ◎
          </button>
        )}
        </div>
      </nav>

      {toast && (
        <div role="status" className="absolute inset-x-3 bottom-28 z-30 mx-auto max-w-md rounded-xl bg-accent px-4 py-3 text-center font-semibold text-accent-fg shadow-xl">
          {toast}
        </div>
      )}

      {showShare && (
        <OfflineShareSheet
          events={zoneData.events}
          pending={outbox.pendingReports}
          now={now}
          onClose={() => setShowShare(false)}
        />
      )}

      {reportTarget && (
        <ReportSheet pinned={reportTarget.pinned} busy={busy === 'report'} onPick={(t) => void onPick(t)} onClose={() => setReportTarget(null)} />
      )}
      {selectedCell && (
        <CellSheet
          events={selected}
          now={now}
          canVote={voteHint === null}
          voteHint={voteHint}
          busyId={busy}
          onVote={(e, v) => void onVote(e, v)}
          onClose={() => setSelectedCell(null)}
        />
      )}

      {showTutorial && (
        <Tutorial
          onClose={() => {
            markTutorialSeen();
            setShowTutorial(false);
          }}
        />
      )}

      {screen !== 'map' && (
        <div className="absolute inset-0 z-50 overflow-y-auto bg-bg">
          {screen === 'auth' && (
            <AuthScreen
              reason={authReason}
              onCancel={() => setScreen('map')}
              onDone={(p, created) => {
                setPseudo(p);
                setScreen('map');
                setToast(`Connecté en tant que ${p}.`);
                api.me().then((me) => setIsAdmin(me.admin === true), () => setIsAdmin(false));
                // Juste après le choix du pseudo : prise en main express (une seule fois).
                if (created && !tutorialSeen()) setShowTutorial(true);
              }}
            />
          )}
          {screen === 'privacy' && (
            <PrivacyScreen
              secondary={policy.secondary}
              position={manif.position}
              onClose={() => setScreen('map')}
              onShowTutorial={() => {
                setScreen('map');
                setShowTutorial(true);
              }}
            />
          )}
          {screen === 'account' && pseudo && (
            <AccountScreen
              pseudo={pseudo}
              isAdmin={isAdmin}
              secondary={policy.secondary}
              onModeration={() => setScreen('moderation')}
              onPseudoChange={setPseudo}
              onClose={() => setScreen('map')}
              onSignedOut={() => {
                setPseudo(null);
                setIsAdmin(false);
                setScreen('map');
                setToast('Déconnecté.');
              }}
            />
          )}
          {screen === 'moderation' && isAdmin && <ModerationScreen onClose={() => setScreen('account')} />}
        </div>
      )}
    </div>
  );
}
