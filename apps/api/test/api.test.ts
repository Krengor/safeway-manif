import { CSRF_HEADER, toEventCell, zoneChannel, zoneOf, type PublicEvent } from '@safeway/shared';
import type { FastifyInstance } from 'fastify';
import { gridDisk } from 'h3-js';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { createDb, type Sql } from '../src/db.js';
import { SessionStore } from '../src/lib/sessions.js';
import { migrate } from '../src/migrate.js';
import { createRedis, type Redis } from '../src/redis.js';
import { buildApp } from '../src/server.js';

// Cellules de test au milieu de l'Atlantique : aucune collision avec des données réelles.
const HERE = toEventCell(40.0001, -30.0001);
const NEAR = gridDisk(HERE, 1).find((c) => c !== HERE)!;
const FAR = toEventCell(40.05, -30.05);

let app: FastifyInstance;
let sql: Sql;
let redis: Redis;
let sessions: SessionStore;

async function newUser(pseudo = `t_${randomUUID().slice(0, 8)}`) {
  const [user] = await sql<{ id: string }[]>`INSERT INTO users (pseudo) VALUES (${pseudo}) RETURNING id`;
  const token = await sessions.create(user!.id);
  return { id: user!.id, cookie: `sw_session=${token}` };
}

function post(url: string, cookie: string | null, payload: unknown) {
  return app.inject({
    method: 'POST',
    url,
    payload: payload as object,
    headers: { [CSRF_HEADER]: '1', ...(cookie ? { cookie } : {}) },
  });
}

beforeAll(async () => {
  const config = loadConfig();
  sql = createDb(config.DATABASE_URL);
  redis = createRedis(config.REDIS_URL);
  await migrate(sql);
  sessions = new SessionStore(redis);
  app = await buildApp({ config, sql, redis });
});

beforeEach(async () => {
  await sql`DELETE FROM events WHERE zone_id = ${zoneOf(HERE)} OR zone_id = ${zoneOf(FAR)}`;
  await sql`DELETE FROM users WHERE pseudo LIKE 't\_%'`;
  const keys = await redis.keys('rl:*');
  if (keys.length) await redis.del(...keys);
});

afterAll(async () => {
  await app.close();
  await sql.end();
  redis.disconnect();
});

describe('sécurité HTTP', () => {
  it('refuse une écriture sans en-tête anti-CSRF', async () => {
    const { cookie } = await newUser();
    const res = await app.inject({ method: 'POST', url: '/api/events', headers: { cookie }, payload: {} });
    expect(res.statusCode).toBe(403);
  });

  it('refuse une écriture depuis une autre origine', async () => {
    const { cookie } = await newUser();
    const res = await app.inject({
      method: 'POST',
      url: '/api/events',
      headers: { cookie, [CSRF_HEADER]: '1', origin: 'https://evil.example' },
      payload: { type: 'PASSAGE_BLOQUE', cell: HERE, presenceCell: HERE },
    });
    expect(res.statusCode).toBe(403);
  });

  it('exige une session pour signaler', async () => {
    const res = await post('/api/events', null, { type: 'PASSAGE_BLOQUE', cell: HERE, presenceCell: HERE });
    expect(res.statusCode).toBe(401);
  });

  it('pose des en-têtes de sécurité et interdit le cache par défaut', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['referrer-policy']).toBe('no-referrer');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });
});

describe('signalements', () => {
  it('refuse les coordonnées GPS brutes', async () => {
    const { cookie } = await newUser();
    const res = await post('/api/events', cookie, { type: 'PASSAGE_BLOQUE', lat: 48.86, lng: 2.36, presenceCell: HERE });
    expect(res.statusCode).toBe(400);
  });

  it('refuse un signalement loin de la position déclarée', async () => {
    const { cookie } = await newUser();
    const res = await post('/api/events', cookie, { type: 'PASSAGE_BLOQUE', cell: FAR, presenceCell: HERE });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe('too_far');
  });

  it('crée un signalement sans auteur ni position stockés', async () => {
    const { cookie } = await newUser();
    const res = await post('/api/events', cookie, { type: 'PASSAGE_BLOQUE', cell: NEAR, presenceCell: HERE });
    expect(res.statusCode).toBe(201);
    const event: PublicEvent = res.json().event;
    expect(event).toMatchObject({ type: 'PASSAGE_BLOQUE', cell: NEAR, conf: 1, inv: 0 });
    expect(Object.keys(event).sort()).toEqual(['cell', 'conf', 'createdAt', 'expiresAt', 'id', 'inv', 'lastConfAt', 'rev', 'type']);

    // La cellule de présence n'apparaît nulle part en base.
    const [row] = await sql`SELECT * FROM events WHERE id = ${event.id}`;
    expect(JSON.stringify(row)).not.toContain(HERE);
  });

  it('transforme un doublon en confirmation et ignore un double vote', async () => {
    const a = await newUser();
    const b = await newUser();
    const body = { type: 'GAZ_FUMEE', cell: HERE, presenceCell: HERE };
    const first = (await post('/api/events', a.cookie, body)).json().event as PublicEvent;
    const again = await post('/api/events', a.cookie, body);
    expect(again.statusCode).toBe(200);
    expect(again.json().event.conf).toBe(1);

    const second = await post('/api/events', b.cookie, body);
    expect(second.json().event).toMatchObject({ id: first.id, conf: 2 });
  });

  it('expose les signalements actifs par zone avec un cache public court', async () => {
    const { cookie } = await newUser();
    await post('/api/events', cookie, { type: 'FOULE_DENSE', cell: HERE, presenceCell: HERE });
    const res = await app.inject({ method: 'GET', url: `/api/map/zones/${zoneOf(HERE)}` });
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toContain('public');
    expect(res.json().events).toHaveLength(1);
  });

  it('rejette une zone invalide', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/map/zones/${HERE}` });
    expect(res.statusCode).toBe(400);
  });
});

describe('votes', () => {
  async function createEvent() {
    const author = await newUser();
    const res = await post('/api/events', author.cookie, { type: 'PASSAGE_BLOQUE', cell: HERE, presenceCell: HERE });
    return res.json().event as PublicEvent;
  }

  it('confirme puis change d’avis sans double comptage', async () => {
    const event = await createEvent();
    const voter = await newUser();
    const confirmed = await post(`/api/events/${event.id}/confirm`, voter.cookie, { presenceCell: NEAR });
    expect(confirmed.json().event).toMatchObject({ conf: 2, inv: 0 });
    expect(confirmed.json().event.expiresAt).toBeGreaterThanOrEqual(event.expiresAt);

    const flipped = await post(`/api/events/${event.id}/invalidate`, voter.cookie, { presenceCell: NEAR });
    expect(flipped.json().event).toMatchObject({ conf: 1, inv: 1 });
  });

  it('refuse un vote à distance', async () => {
    const event = await createEvent();
    const voter = await newUser();
    const res = await post(`/api/events/${event.id}/confirm`, voter.cookie, { presenceCell: FAR });
    expect(res.statusCode).toBe(403);
  });

  it('retire un signalement massivement invalidé', async () => {
    const event = await createEvent();
    let last;
    for (let i = 0; i < 3; i++) {
      const voter = await newUser();
      last = await post(`/api/events/${event.id}/invalidate`, voter.cookie, { presenceCell: HERE });
    }
    expect(last!.json().event).toBeNull();
    const res = await app.inject({ method: 'GET', url: `/api/events/${event.id}` });
    expect(res.statusCode).toBe(404);
  });

  it('stocke un jeton de votant différent par événement', async () => {
    const voter = await newUser();
    const e1 = (await post('/api/events', voter.cookie, { type: 'DEBRIS', cell: HERE, presenceCell: HERE })).json().event;
    const e2 = (await post('/api/events', voter.cookie, { type: 'INCENDIE', cell: HERE, presenceCell: HERE })).json().event;
    const tokens = await sql<{ actor_token: Buffer }[]>`
      SELECT actor_token FROM event_votes WHERE event_id IN (${e1.id}, ${e2.id})`;
    expect(tokens).toHaveLength(2);
    expect(tokens[0]!.actor_token.equals(tokens[1]!.actor_token)).toBe(false);
    expect(JSON.stringify(tokens)).not.toContain(voter.id);
  });
});

describe('temps réel', () => {
  async function listen(zone: string) {
    const sub = redis.duplicate();
    if (sub.status !== 'ready') await new Promise((resolve) => sub.once('ready', resolve));
    const received: unknown[] = [];
    sub.on('message', (_channel, message) => received.push(JSON.parse(message)));
    await sub.subscribe(zoneChannel(zone));
    return { received, close: () => sub.disconnect() };
  }
  const settle = () => new Promise((r) => setTimeout(r, 150));

  it('publie création et votes sur le canal de la zone, avec une révision croissante', async () => {
    const bus = await listen(zoneOf(HERE));
    try {
      const author = await newUser();
      const voter = await newUser();
      const event = (await post('/api/events', author.cookie, { type: 'FOULE_DENSE', cell: HERE, presenceCell: HERE })).json()
        .event as PublicEvent;
      await post(`/api/events/${event.id}/confirm`, voter.cookie, { presenceCell: HERE });
      await settle();
      expect(bus.received).toEqual([
        { event: expect.objectContaining({ id: event.id, conf: 1, rev: 1 }) },
        { event: expect.objectContaining({ id: event.id, conf: 2, rev: 2 }) },
      ]);
    } finally {
      bus.close();
    }
  });

  it('publie le retrait d’un signalement invalidé', async () => {
    const author = await newUser();
    const event = (await post('/api/events', author.cookie, { type: 'DEBRIS', cell: HERE, presenceCell: HERE })).json().event;
    const bus = await listen(zoneOf(HERE));
    try {
      for (let i = 0; i < 3; i++) {
        const voter = await newUser();
        await post(`/api/events/${event.id}/invalidate`, voter.cookie, { presenceCell: HERE });
      }
      await settle();
      expect(bus.received.at(-1)).toEqual({ removed: event.id });
    } finally {
      bus.close();
    }
  });

  it('ne publie aucune donnée de présence ni d’utilisateur', async () => {
    const bus = await listen(zoneOf(HERE));
    try {
      const user = await newUser();
      await post('/api/events', user.cookie, { type: 'INCENDIE', cell: NEAR, presenceCell: HERE });
      await settle();
      const raw = JSON.stringify(bus.received);
      expect(raw).not.toContain(HERE);
      expect(raw).not.toContain(user.id);
    } finally {
      bus.close();
    }
  });
});

describe('expiration', () => {
  it('purge physiquement les signalements expirés', async () => {
    const { cookie } = await newUser();
    const event = (await post('/api/events', cookie, { type: 'DEBRIS', cell: HERE, presenceCell: HERE })).json().event;
    await sql`UPDATE events SET expires_at = now() - interval '1 second' WHERE id = ${event.id}`;
    const { EventService } = await import('../src/services/events.js');
    await new EventService(sql, 'x'.repeat(32)).purgeExpired();
    const rows = await sql`SELECT 1 FROM events WHERE id = ${event.id}`;
    expect(rows).toHaveLength(0);
    const votes = await sql`SELECT 1 FROM event_votes WHERE event_id = ${event.id}`;
    expect(votes).toHaveLength(0);
  });
});

describe('compte', () => {
  it('supprime le compte et révoque toutes les sessions', async () => {
    const user = await newUser();
    const token2 = await sessions.create(user.id);
    const res = await app.inject({ method: 'DELETE', url: '/api/me', headers: { cookie: user.cookie, [CSRF_HEADER]: '1' } });
    expect(res.statusCode).toBe(204);
    const me = await app.inject({ method: 'GET', url: '/api/me', headers: { cookie: `sw_session=${token2}` } });
    expect(me.statusCode).toBe(401);
    expect(await sql`SELECT 1 FROM users WHERE id = ${user.id}`).toHaveLength(0);
  });

  it('refuse un pseudo déjà pris (insensible à la casse)', async () => {
    await newUser('t_Taken');
    const res = await post('/api/auth/passkey/register/options', null, { pseudo: 'T_TAKEN' });
    expect(res.statusCode).toBe(409);
  });

  it('fournit des options WebAuthn sans attestation', async () => {
    const res = await post('/api/auth/passkey/register/options', null, { pseudo: 't_newcomer' });
    expect(res.statusCode).toBe(200);
    expect(res.json().attestation).toBe('none');
    expect(res.json().authenticatorSelection.residentKey).toBe('required');
    expect(res.headers['set-cookie']).toContain('HttpOnly');
  });
});
