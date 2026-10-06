/**
 * Chargement des signalements des zones visibles (H3 rés. 7), rafraîchi périodiquement.
 * V0.2 remplacera le polling par un abonnement temps réel aux mêmes zones (§50).
 *
 * Les données restent en mémoire : si le réseau tombe, la dernière carte reste affichée
 * avec l'âge des données (§26). Rien n'est écrit sur le disque de l'appareil.
 */
import type { PublicEvent } from '@safeway/shared';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from './api';

const DEFAULT_REFRESH_MS = 10_000;
/**
 * Les lectures de zone sont mises en cache quelques secondes (navigateur + CDN) : pendant
 * ce délai, nos propres écritures priment sur les réponses potentiellement périmées.
 */
const LOCAL_OVERRIDE_MS = 20_000;

export interface ZoneEventsState {
  events: PublicEvent[];
  /** Décalage horloge serveur - client (s). */
  clockSkew: number;
  /** Date (ms, horloge client) de la dernière actualisation réussie. */
  lastSuccessAt: number | null;
  error: boolean;
  refresh: () => void;
  upsert: (event: PublicEvent) => void;
  remove: (id: string) => void;
  clear: () => void;
}

export function useZoneEvents(zones: readonly string[]): ZoneEventsState {
  const [byZone, setByZone] = useState<Map<string, PublicEvent[]>>(new Map());
  const [clockSkew, setClockSkew] = useState(0);
  const [lastSuccessAt, setLastSuccessAt] = useState<number | null>(null);
  const [error, setError] = useState(false);
  const zonesKey = zones.join(',');
  const zonesRef = useRef(zones);
  zonesRef.current = zones;

  const load = useCallback(async () => {
    const current = zonesRef.current;
    if (current.length === 0) return;
    const results = await Promise.allSettled(current.map((z) => api.zoneEvents(z)));
    const ok = results.filter((r) => r.status === 'fulfilled').length;
    setByZone((prev) => {
      const next = new Map<string, PublicEvent[]>();
      results.forEach((r, i) => {
        const zone = current[i]!;
        if (r.status === 'fulfilled') {
          next.set(zone, r.value.events);
        } else if (prev.has(zone)) {
          next.set(zone, prev.get(zone)!); // on garde la dernière version connue
        }
      });
      return next;
    });
    const first = results.find((r) => r.status === 'fulfilled');
    if (first?.status === 'fulfilled') setClockSkew(first.value.now - Math.floor(Date.now() / 1000));
    if (ok > 0) setLastSuccessAt(Date.now());
    setError(ok < results.length);
  }, []);

  useEffect(() => {
    void load();
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void load();
    }, DEFAULT_REFRESH_MS);
    const onVisible = () => document.visibilityState === 'visible' && void load();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [zonesKey, load]);

  // id → version locale (null = supprimé) et date limite de priorité.
  const [overrides, setOverrides] = useState<Map<string, { event: PublicEvent | null; until: number }>>(new Map());

  const override = useCallback((id: string, event: PublicEvent | null) => {
    setOverrides((prev) => {
      const now = Date.now();
      const next = new Map([...prev].filter(([, o]) => o.until > now));
      next.set(id, { event, until: now + LOCAL_OVERRIDE_MS });
      return next;
    });
  }, []);

  const upsert = useCallback((event: PublicEvent) => override(event.id, event), [override]);
  const remove = useCallback((id: string) => override(id, null), [override]);

  const clear = useCallback(() => {
    setByZone(new Map());
    setOverrides(new Map());
    setLastSuccessAt(null);
  }, []);

  // Fusion serveur + écritures locales récentes, dédoublonnée par id.
  // Recalculée à chaque réponse serveur, ce qui purge aussi les priorités échues.
  const events = useMemo(() => {
    const merged = new Map([...byZone.values()].flat().map((e) => [e.id, e]));
    const now = Date.now();
    for (const [id, o] of overrides) {
      if (o.until <= now) continue;
      if (o.event) merged.set(id, o.event);
      else merged.delete(id);
    }
    return [...merged.values()];
  }, [byZone, overrides]);

  return { events, clockSkew, lastSuccessAt, error, refresh: () => void load(), upsert, remove, clear };
}
