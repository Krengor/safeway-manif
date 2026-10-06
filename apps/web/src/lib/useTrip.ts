/**
 * Trajet en cours (§12, alertes sur trajet). Tout reste en mémoire sur l'appareil :
 * destination, itinéraire et cellules traversées disparaissent à l'arrêt du trajet
 * ou du Mode Manif. Le serveur ne suit pas le trajet.
 */
import { routeCells, type RouteResponse, type ZoneStatus } from '@safeway/shared';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, ApiRequestError } from './api';
import { newDangersOnRoute } from './routeAlerts';
import type { LocalPosition } from './useManifMode';

/** Délai minimal entre deux calculs (debounce côté client, §55). */
const RECOMPUTE_COOLDOWN_MS = 5000;

export function useTrip(position: LocalPosition | null, statusByCell: ReadonlyMap<string, ZoneStatus>) {
  const [picking, setPicking] = useState(false);
  const [destination, setDestination] = useState<LocalPosition | null>(null);
  const [route, setRoute] = useState<RouteResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [known, setKnown] = useState<Set<string>>(new Set());
  const [cooldown, setCooldown] = useState(false);
  const positionRef = useRef(position);
  positionRef.current = position;

  const compute = useCallback(async (dest: LocalPosition) => {
    const from = positionRef.current;
    if (!from) {
      setError('Position inconnue : activez le Mode Manif.');
      return;
    }
    setLoading(true);
    setError(null);
    setCooldown(true);
    window.setTimeout(() => setCooldown(false), RECOMPUTE_COOLDOWN_MS);
    try {
      const result = await api.route([from.lng, from.lat], [dest.lng, dest.lat]);
      setRoute(result);
      // Les dangers déjà connus au calcul sont affichés dans le résumé, pas en alerte.
      setKnown(new Set(result.crossing.danger));
    } catch (err) {
      setRoute(null);
      setError(err instanceof ApiRequestError ? err.message : 'Itinéraire indisponible.');
    } finally {
      setLoading(false);
    }
  }, []);

  const cells = useMemo(() => (route ? routeCells(route.shape) : []), [route]);
  const alerts = useMemo(() => newDangersOnRoute(cells, statusByCell, known), [cells, statusByCell, known]);

  // Vibration à chaque nouveau danger sur le trajet.
  const previousAlerts = useRef(0);
  useEffect(() => {
    if (alerts.length > previousAlerts.current) navigator.vibrate?.([200, 100, 200]);
    previousAlerts.current = alerts.length;
  }, [alerts.length]);

  const stop = useCallback(() => {
    setPicking(false);
    setDestination(null);
    setRoute(null);
    setError(null);
    setKnown(new Set());
  }, []);

  return {
    picking,
    active: picking || destination !== null,
    destination,
    route,
    loading,
    error,
    alertCount: alerts.length,
    canRecompute: !loading && !cooldown && destination !== null,
    startPicking: useCallback(() => setPicking(true), []),
    cancelPicking: useCallback(() => setPicking(false), []),
    chooseDestination: useCallback(
      (dest: LocalPosition) => {
        setPicking(false);
        setDestination(dest);
        void compute(dest);
      },
      [compute],
    ),
    recompute: useCallback(() => {
      if (destination) void compute(destination);
    }, [compute, destination]),
    stop,
  };
}
