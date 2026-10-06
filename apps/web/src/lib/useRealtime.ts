/**
 * Connexion temps réel au gateway (§13, §50) : abonnement aux zones visibles uniquement.
 *
 * - Reconnexion automatique avec backoff exponentiel + jitter (§58) : après une panne,
 *   les clients ne reviennent pas tous à la même seconde.
 * - En cas d'échec, l'app continue en polling : le temps réel est une amélioration,
 *   jamais une dépendance (§57).
 */
import { REALTIME_PATH, type PublicEvent, type ServerMessage } from '@safeway/shared';
import { useEffect, useRef, useState } from 'react';

const MAX_BACKOFF_MS = 30_000;

export type RealtimeHandler = (events: PublicEvent[], removed: string[]) => void;

export function useRealtime(zones: readonly string[], onUpdate: RealtimeHandler): boolean {
  const [connected, setConnected] = useState(false);
  const socket = useRef<WebSocket | null>(null);
  const zonesRef = useRef(zones);
  zonesRef.current = zones;
  const handler = useRef(onUpdate);
  handler.current = onUpdate;
  const zonesKey = zones.join(',');

  useEffect(() => {
    let disposed = false;
    let attempt = 0;
    let retryTimer: number | undefined;

    const sendZones = (ws: WebSocket) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ t: 'sub', zones: zonesRef.current }));
    };

    const connect = () => {
      if (disposed) return;
      const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
      const ws = new WebSocket(`${scheme}://${location.host}${REALTIME_PATH}`);
      socket.current = ws;

      ws.onopen = () => {
        attempt = 0;
        setConnected(true);
        sendZones(ws);
      };
      ws.onmessage = (msg) => {
        let data: ServerMessage;
        try {
          data = JSON.parse(String(msg.data)) as ServerMessage;
        } catch {
          return;
        }
        if (data.t === 'upd') handler.current(data.events, data.removed);
      };
      ws.onclose = () => {
        setConnected(false);
        if (socket.current === ws) socket.current = null;
        if (disposed) return;
        const base = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** attempt);
        attempt += 1;
        retryTimer = window.setTimeout(connect, base * (0.5 + Math.random()));
      };
    };

    // Retour au premier plan : on tente aussitôt plutôt que d'attendre le backoff.
    const onVisible = () => {
      if (document.visibilityState === 'visible' && !socket.current) {
        window.clearTimeout(retryTimer);
        attempt = 0;
        connect();
      }
    };

    connect();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      disposed = true;
      window.clearTimeout(retryTimer);
      document.removeEventListener('visibilitychange', onVisible);
      socket.current?.close();
      socket.current = null;
    };
  }, []);

  // Changement de vue : on remplace l'abonnement.
  useEffect(() => {
    const ws = socket.current;
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ t: 'sub', zones: zonesRef.current }));
  }, [zonesKey]);

  return connected;
}
