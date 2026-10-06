/**
 * Signalements des zones visibles (H3 rés. 7) : temps réel + polling de secours.
 *
 * - Temps réel connecté : polling espacé (resynchronisation de sécurité).
 * - Temps réel coupé : polling rapproché (§26, §57).
 * - Fusion par révision : quelle que soit la source (réponse REST en cache, message
 *   temps réel, réponse à notre propre vote), la version la plus récente gagne.
 *
 * Les données restent en mémoire : si le réseau tombe, la dernière carte reste affichée
 * avec l'âge des données. Rien n'est écrit sur le disque de l'appareil.
 */
import { degradationPolicy, type DegradationLevel, type PublicEvent } from '@safeway/shared';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from './api';
import { useRealtime } from './useRealtime';

/** Sans temps réel, le niveau de charge est relu au plus toutes les… */
const STATUS_REFRESH_MS = 30_000;
/** Durée pendant laquelle un retrait masque l'événement malgré des réponses en cache périmées. */
const TOMBSTONE_MS = 60_000;
/** Au-delà, le réseau est jugé saturé (réponses publiques normalement < 1 s). */
const SLOW_RESPONSE_MS = 5000;

export interface ZoneEventsState {
  events: PublicEvent[];
  /** Décalage horloge serveur - client (s). */
  clockSkew: number;
  /** Date (ms, horloge client) de la dernière donnée reçue (REST ou temps réel). */
  lastSuccessAt: number | null;
  /** Temps réel actif. */
  live: boolean;
  /** Réseau saturé ou coupé : chargements en échec répétés, ou très lents. */
  degraded: boolean;
  /** Niveau de dégradation contrôlée annoncé par le serveur (§56). */
  level: DegradationLevel;
  /** Ajoute des signalements reçus hors réseau (déjà vérifiés ou marqués non vérifiés). */
  importShared: (events: PublicEvent[]) => void;
  refresh: () => void;
  upsert: (event: PublicEvent) => void;
  remove: (id: string) => void;
  clear: () => void;
}

export function useZoneEvents(zones: readonly string[]): ZoneEventsState {
  const [polled, setPolled] = useState<Map<string, PublicEvent[]>>(new Map());
  const [pushed, setPushed] = useState<Map<string, PublicEvent>>(new Map());
  const [tombstones, setTombstones] = useState<Map<string, number>>(new Map());
  const [clockSkew, setClockSkew] = useState(0);
  const [lastSuccessAt, setLastSuccessAt] = useState<number | null>(null);
  // Santé du réseau, pour proposer le partage hors réseau quand il sature.
  const [failures, setFailures] = useState(0);
  const [slow, setSlow] = useState(false);
  const [level, setLevel] = useState<DegradationLevel>(0);
  const statusAt = useRef(0);
  const zonesKey = zones.join(',');
  const zonesRef = useRef(zones);
  zonesRef.current = zones;

  const upsertMany = useCallback((events: PublicEvent[]) => {
    if (events.length === 0) return;
    setPushed((prev) => {
      const next = new Map(prev);
      for (const event of events) {
        const current = next.get(event.id);
        if (!current || current.rev <= event.rev) next.set(event.id, event);
      }
      return next;
    });
  }, []);

  const removeMany = useCallback((ids: string[]) => {
    if (ids.length === 0) return;
    const until = Date.now() + TOMBSTONE_MS;
    setTombstones((prev) => {
      const next = new Map([...prev].filter(([, t]) => t > Date.now()));
      for (const id of ids) next.set(id, until);
      return next;
    });
    setPushed((prev) => {
      const next = new Map(prev);
      for (const id of ids) next.delete(id);
      return next;
    });
  }, []);

  const live = useRealtime(
    zones,
    useCallback(
      (events: PublicEvent[], removed: string[]) => {
        upsertMany(events);
        removeMany(removed);
        setLastSuccessAt(Date.now());
      },
      [upsertMany, removeMany],
    ),
    setLevel,
  );
  const liveRef = useRef(live);
  liveRef.current = live;

  const load = useCallback(async () => {
    const current = zonesRef.current;
    if (current.length === 0) return;
    const startedAt = Date.now();
    // Sans temps réel, le niveau de charge n'est pas poussé : on le relit de temps en temps.
    if (!liveRef.current && startedAt - statusAt.current > STATUS_REFRESH_MS) {
      statusAt.current = startedAt;
      api.mapStatus().then((s) => setLevel(s.level), () => {});
    }
    const results = await Promise.allSettled(current.map((z) => api.zoneEvents(z)));
    const allFailed = results.every((r) => r.status === 'rejected');
    setFailures((n) => (allFailed ? n + 1 : 0));
    setSlow(!allFailed && Date.now() - startedAt > SLOW_RESPONSE_MS);
    setPolled((prev) => {
      const next = new Map<string, PublicEvent[]>();
      results.forEach((r, i) => {
        const zone = current[i]!;
        if (r.status === 'fulfilled') next.set(zone, r.value.events);
        else if (prev.has(zone)) next.set(zone, prev.get(zone)!); // dernière version connue
      });
      return next;
    });
    const first = results.find((r) => r.status === 'fulfilled');
    if (first?.status === 'fulfilled') {
      setClockSkew(first.value.now - Math.floor(Date.now() / 1000));
      setLastSuccessAt(Date.now());
      // Les versions poussées expirées n'ont plus lieu d'être gardées.
      const now = first.value.now;
      setPushed((prev) => new Map([...prev].filter(([, e]) => e.expiresAt > now)));
    }
  }, []);

  // Polling : immédiat au changement de zones, puis à intervalle selon l'état du temps réel
  // et le niveau de charge (plus espacé quand le serveur est sous pression).
  const policy = degradationPolicy(level);
  const pollMs = (live ? policy.pollLiveSeconds : policy.pollFallbackSeconds) * 1000;

  // Chargement immédiat au changement de zones et à la (re)connexion du temps réel,
  // pour resynchroniser aussitôt ce qui a pu être manqué.
  useEffect(() => {
    void load();
  }, [zonesKey, live, load]);

  // Un changement de niveau ne déclenche PAS de requête immédiate : tous les clients
  // le reçoivent en même temps, ce serait un pic de trafic au pire moment.
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void load();
    }, pollMs);
    const onVisible = () => document.visibilityState === 'visible' && void load();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [pollMs, load]);

  const clear = useCallback(() => {
    setPolled(new Map());
    setPushed(new Map());
    setTombstones(new Map());
    setLastSuccessAt(null);
  }, []);

  const events = useMemo(() => {
    const merged = new Map([...polled.values()].flat().map((e) => [e.id, e]));
    for (const [id, event] of pushed) {
      const current = merged.get(id);
      if (!current || current.rev < event.rev) merged.set(id, event);
    }
    const now = Date.now();
    for (const [id, until] of tombstones) if (until > now) merged.delete(id);
    return [...merged.values()];
  }, [polled, pushed, tombstones]);

  return {
    events,
    clockSkew,
    lastSuccessAt,
    live,
    degraded: failures >= 2 || slow,
    level,
    importShared: upsertMany,
    refresh: () => void load(),
    upsert: useCallback((event: PublicEvent) => upsertMany([event]), [upsertMany]),
    remove: useCallback((id: string) => removeMany([id]), [removeMany]),
    clear,
  };
}
