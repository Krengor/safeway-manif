/** Test d'intégration : vrai serveur WebSocket + vrai Redis (celui de `npm run dev:infra`). */
import { LOAD_CHANNEL, REALTIME_PATH, toEventCell, zoneChannel, zoneOf, type ServerMessage } from '@safeway/shared';
import { Redis } from 'ioredis';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { CLOSE_POLICY, createGateway, type Gateway } from '../src/server.js';

const ORIGIN = 'http://localhost:5173';
const ZONE = zoneOf(toEventCell(40.0001, -30.0001));

let gateway: Gateway;
let subscriber: Redis;
let publisher: Redis;
let url: string;

function connect(origin = ORIGIN) {
  const ws = new WebSocket(url, { origin });
  const messages: ServerMessage[] = [];
  ws.on('message', (data) => messages.push(JSON.parse(data.toString()) as ServerMessage));
  const opened = new Promise<void>((resolve, reject) => {
    ws.once('open', () => resolve());
    ws.once('error', reject);
  });
  const closed = new Promise<number>((resolve) => ws.once('close', (code) => resolve(code)));
  return { ws, messages, opened, closed };
}

const until = async (predicate: () => boolean, timeout = 2000) => {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeout) throw new Error('délai dépassé');
    await new Promise((r) => setTimeout(r, 20));
  }
};

beforeAll(async () => {
  const redisUrl = process.env.REDIS_URL!;
  subscriber = new Redis(redisUrl);
  publisher = new Redis(redisUrl);
  gateway = createGateway({ PUBLIC_ORIGIN: ORIGIN, MAX_CONNECTIONS: 100 }, subscriber);
  await new Promise<void>((resolve) => gateway.server.listen(0, '127.0.0.1', resolve));
  url = `ws://127.0.0.1:${(gateway.server.address() as AddressInfo).port}${REALTIME_PATH}`;
});

afterAll(async () => {
  await gateway.close();
  subscriber.disconnect();
  publisher.disconnect();
});

describe('realtime-gateway', () => {
  it('relaie en moins d’une seconde un événement publié sur la zone suivie', async () => {
    const client = connect();
    await client.opened;
    await until(() => client.messages.some((m) => m.t === 'hello'));
    client.ws.send(JSON.stringify({ t: 'sub', zones: [ZONE] }));
    await until(() => gateway.hub.stats.zones === 1);
    await new Promise((r) => setTimeout(r, 100)); // abonnement Redis effectif

    const event = { id: 'e-test', type: 'GAZ_FUMEE', cell: 'x', conf: 1, inv: 0, createdAt: 0, lastConfAt: 0, expiresAt: 0, rev: 1 };
    const sentAt = Date.now();
    await publisher.publish(zoneChannel(ZONE), JSON.stringify({ event }));
    await until(() => client.messages.some((m) => m.t === 'upd'), 1000);
    expect(Date.now() - sentAt).toBeLessThan(1000);
    expect(client.messages.find((m) => m.t === 'upd')).toEqual({ t: 'upd', zone: ZONE, events: [event], removed: [] });
    client.ws.close();
  });

  it('suit le niveau de charge publié par l’API et le relaie aux clients', async () => {
    const client = connect();
    await client.opened;
    await until(() => client.messages.some((m) => m.t === 'hello'));
    expect(client.messages.find((m) => m.t === 'hello')).toEqual({ t: 'hello', batchMs: 250, level: 0 });

    await until(() => {
      void publisher.publish(LOAD_CHANNEL, '2');
      return gateway.level === 2;
    });
    expect(gateway.hub.batchMs).toBe(2500);
    await until(() => client.messages.some((m) => m.t === 'load'));
    expect(client.messages.find((m) => m.t === 'load')).toEqual({ t: 'load', level: 2 });

    await publisher.publish(LOAD_CHANNEL, 'n/a'); // ignoré
    await publisher.publish(LOAD_CHANNEL, '0');
    await until(() => gateway.level === 0);
    expect(gateway.hub.batchMs).toBe(250);
    client.ws.close();
  });

  it('refuse une connexion depuis une autre origine', async () => {
    const client = connect('https://evil.example');
    await expect(client.opened).rejects.toThrow(/403/);
  });

  it('ferme une connexion qui envoie un message invalide', async () => {
    const client = connect();
    await client.opened;
    client.ws.send(JSON.stringify({ t: 'sub', zones: ['pas-une-zone'] }));
    expect(await client.closed).toBe(CLOSE_POLICY);
  });

  it('ferme une connexion qui inonde le gateway', async () => {
    const client = connect();
    await client.opened;
    for (let i = 0; i < 30; i++) client.ws.send(JSON.stringify({ t: 'sub', zones: [ZONE] }));
    expect(await client.closed).toBe(CLOSE_POLICY);
  });

  it('libère les abonnements à la déconnexion', async () => {
    const client = connect();
    await client.opened;
    client.ws.send(JSON.stringify({ t: 'sub', zones: [ZONE] }));
    await until(() => gateway.hub.stats.zones === 1);
    client.ws.close();
    await until(() => gateway.hub.stats.clients === 0 && gateway.hub.stats.zones === 0);
  });
});
