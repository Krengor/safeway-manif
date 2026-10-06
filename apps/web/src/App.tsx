import { isNear, toEventCell, type EventType, type PublicEvent } from '@safeway/shared';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CellSheet } from './components/CellSheet';
import { Legend } from './components/Legend';
import { ReportSheet } from './components/ReportSheet';
import { api, ApiRequestError } from './lib/api';
import { useManifMode } from './lib/useManifMode';
import { useZoneEvents } from './lib/useZoneEvents';
import { MapView, type MapViewHandle } from './map/MapView';
import { summarizeCells } from './map/overlay';
import { AccountScreen } from './screens/AccountScreen';
import { AuthScreen } from './screens/AuthScreen';
import { PrivacyScreen } from './screens/PrivacyScreen';

type Screen = 'map' | 'auth' | 'account' | 'privacy';
const STALE_AFTER_MS = 45_000;

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

  const zoneData = useZoneEvents(zones ?? []);
  const now = Math.floor(tick / 1000) + zoneData.clockSkew;
  const cells = useMemo(() => summarizeCells(zoneData.events, now), [zoneData.events, now]);

  useEffect(() => {
    api.me().then((me) => setPseudo(me.pseudo), () => setPseudo(null));
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
      // Fin de session : on efface les données locales (§4).
      zoneData.clear();
      setReportTarget(null);
      setSelectedCell(null);
      setToast('Mode Manif désactivé — position effacée.');
    } else {
      manif.start();
    }
  }, [manif, zoneData]);

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
    try {
      const { event, created } = await api.report({ type, cell: reportTarget.cell, presenceCell: manif.cell });
      zoneData.upsert(event);
      navigator.vibrate?.(40);
      setToast(created ? 'Signalement publié.' : 'Déjà signalé : votre confirmation est comptée.');
      setReportTarget(null);
    } catch (err) {
      handleApiError(err);
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

  return (
    <div className="relative h-full w-full overflow-hidden">
      <MapView
        ref={mapView}
        cells={cells}
        position={manif.position}
        dark={dark}
        onZonesChange={setZones}
        onSelectCell={setSelectedCell}
        onLongPress={onLongPress}
      />

      {/* En-tête */}
      <header className="safe-top pointer-events-none absolute inset-x-0 top-0 z-10 flex flex-col gap-2 px-3">
        <div className="pointer-events-auto flex items-center gap-1.5 rounded-2xl bg-panel/95 p-2 shadow-lg">
          <span className="truncate pl-1 text-sm font-black tracking-tight">SAFEWAY</span>
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
        {staleMinutes !== null && (
          <p role="status" className="pointer-events-auto rounded-xl bg-warn px-3 py-2 font-semibold text-white">
            Données non actualisées depuis {staleMinutes} min.
          </p>
        )}
        {zones === null && (
          <p role="status" className="pointer-events-auto self-center rounded-xl bg-panel/95 px-3 py-2 text-sm font-semibold shadow">
            Zoomez pour voir les signalements.
          </p>
        )}
        <Legend />
      </header>

      {/* Barre d'actions — utilisable au pouce */}
      <nav className="safe-bottom absolute inset-x-0 bottom-0 z-10 flex items-end gap-2 px-3" aria-label="Actions">
        <button
          type="button"
          onClick={openReport}
          className="min-h-16 flex-1 rounded-2xl bg-danger text-lg font-black text-white shadow-lg active:scale-[0.98]"
        >
          ⚠️ Signaler
        </button>
        <button
          type="button"
          disabled
          title="Itinéraire : disponible en V0.2"
          className="min-h-16 flex-1 rounded-2xl bg-panel text-lg font-bold opacity-60 shadow-lg"
        >
          🧭 Trajet <span className="block text-xs font-semibold">bientôt</span>
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
      </nav>

      {toast && (
        <div role="status" className="absolute inset-x-3 bottom-28 z-30 mx-auto max-w-md rounded-xl bg-accent px-4 py-3 text-center font-semibold text-accent-fg shadow-xl">
          {toast}
        </div>
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

      {screen !== 'map' && (
        <div className="absolute inset-0 z-50 overflow-y-auto bg-bg">
          {screen === 'auth' && (
            <AuthScreen
              reason={authReason}
              onCancel={() => setScreen('map')}
              onDone={(p) => {
                setPseudo(p);
                setScreen('map');
                setToast(`Connecté en tant que ${p}.`);
              }}
            />
          )}
          {screen === 'privacy' && <PrivacyScreen onClose={() => setScreen('map')} />}
          {screen === 'account' && pseudo && (
            <AccountScreen
              pseudo={pseudo}
              onPseudoChange={setPseudo}
              onClose={() => setScreen('map')}
              onSignedOut={() => {
                setPseudo(null);
                setScreen('map');
                setToast('Déconnecté.');
              }}
            />
          )}
        </div>
      )}
    </div>
  );
}
