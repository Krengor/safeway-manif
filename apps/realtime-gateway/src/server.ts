/**
 * Realtime gateway (§50.1) : WebSocket stateless, horizontalement scalable.
 *
 * Aucune donnée personnelle : pas d'authentification, pas de journalisation d'IP,
 * le gateway ne connaît que les zones suivies par chaque connexion, en mémoire.
 */
import {
  REALTIME_BATCH_MS,
  REALTIME_PATH,
  clientMessageSchema,
  zoneChannel,
  type BusMessage,
  type ServerMessage,
} from '@safeway/shared';
import type { Redis } from 'ioredis';
import { createServer, type Server } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import type { GatewayConfig } from './config.js';
import { Hub } from './hub.js';

const CHANNEL_PREFIX = zoneChannel('');
const HEARTBEAT_MS = 30_000;
const MAX_MESSAGE_BYTES = 2048;
/** Messages client autorisés par fenêtre (changements de vue) avant fermeture. */
const CLIENT_MSG_LIMIT = 20;
const CLIENT_MSG_WINDOW_MS = 10_000;

export const CLOSE_POLICY = 1008;
export const CLOSE_RESTART = 1012;

export interface Gateway {
  server: Server;
  hub: Hub;
  close(): Promise<void>;
}

export function createGateway(config: Pick<GatewayConfig, 'PUBLIC_ORIGIN' | 'MAX_CONNECTIONS'>, subscriber: Redis): Gateway {
  // Les (dés)abonnements sont sérialisés et attendent que la connexion soit prête :
  // un SUBSCRIBE envoyé pendant la poignée de main ioredis casse son contrôle INFO.
  // Après une reconnexion, ioredis rétablit lui-même les abonnements confirmés.
  let queue: Promise<unknown> = Promise.resolve();
  const whenReady = () =>
    subscriber.status === 'ready' ? Promise.resolve() : new Promise<void>((resolve) => subscriber.once('ready', () => resolve()));
  const enqueue = (command: () => Promise<unknown>) => {
    queue = queue.then(whenReady).then(command).catch(() => {});
  };

  const hub = new Hub(
    {
      subscribe: (zone) => enqueue(() => subscriber.subscribe(zoneChannel(zone))),
      unsubscribe: (zone) => enqueue(() => subscriber.unsubscribe(zoneChannel(zone))),
    },
    { batchMs: REALTIME_BATCH_MS, maxBufferedBytes: 512 * 1024 },
  );

  subscriber.on('message', (channel: string, raw: string) => {
    if (!channel.startsWith(CHANNEL_PREFIX)) return;
    let message: BusMessage;
    try {
      message = JSON.parse(raw) as BusMessage;
    } catch {
      return;
    }
    hub.dispatch(channel.slice(CHANNEL_PREFIX.length), message);
  });

  const server = createServer((req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end(JSON.stringify({ ok: true, ...hub.stats }));
      return;
    }
    if (req.url === '/ready') {
      const ready = subscriber.status === 'ready';
      res.writeHead(ready ? 200 : 503, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end(JSON.stringify({ redis: ready }));
      return;
    }
    res.writeHead(404).end();
  });

  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: MAX_MESSAGE_BYTES,
    // Payloads courts et JSON : la compression coûterait plus de CPU qu'elle ne ferait gagner.
    perMessageDeflate: false,
  });

  server.on('upgrade', (req, socket, head) => {
    const reject = (status: number, text: string) => {
      socket.write(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\n\r\n`);
      socket.destroy();
    };
    if (req.url?.split('?')[0] !== REALTIME_PATH) return reject(404, 'Not Found');
    // Les navigateurs envoient toujours Origin : seul notre front peut ouvrir une connexion.
    if (req.headers.origin !== config.PUBLIC_ORIGIN) return reject(403, 'Forbidden');
    if (hub.stats.clients >= config.MAX_CONNECTIONS) return reject(503, 'Service Unavailable');
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws));
  });

  const alive = new WeakMap<WebSocket, boolean>();

  wss.on('connection', (ws: WebSocket) => {
    alive.set(ws, true);
    hub.setZones(ws, []);
    let windowStart = Date.now();
    let count = 0;

    ws.on('pong', () => alive.set(ws, true));
    ws.on('message', (data, isBinary) => {
      const now = Date.now();
      if (now - windowStart > CLIENT_MSG_WINDOW_MS) {
        windowStart = now;
        count = 0;
      }
      if (++count > CLIENT_MSG_LIMIT || isBinary) return ws.close(CLOSE_POLICY, 'abus');

      let parsed;
      try {
        parsed = clientMessageSchema.safeParse(JSON.parse(data.toString()));
      } catch {
        return ws.close(CLOSE_POLICY, 'message invalide');
      }
      if (!parsed.success) return ws.close(CLOSE_POLICY, 'message invalide');
      hub.setZones(ws, parsed.data.zones);
    });
    ws.on('close', () => hub.removeClient(ws));
    ws.on('error', () => hub.removeClient(ws));

    const hello: ServerMessage = { t: 'hello', batchMs: REALTIME_BATCH_MS };
    ws.send(JSON.stringify(hello));
  });

  // Détection des connexions mortes (réseaux mobiles qui coupent sans prévenir).
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!alive.get(ws)) {
        ws.terminate();
        continue;
      }
      alive.set(ws, false);
      ws.ping();
    }
  }, HEARTBEAT_MS);

  hub.start();

  return {
    server,
    hub,
    async close() {
      clearInterval(heartbeat);
      hub.stop();
      // 1012 « service restart » : les clients se reconnectent aussitôt (sur une autre instance).
      for (const ws of wss.clients) ws.close(CLOSE_RESTART, 'redémarrage');
      await new Promise<void>((resolve) => wss.close(() => resolve()));
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
