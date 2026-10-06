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
import { EventService } from '../src/services/events.js';
import { RedisReputationLinks, ReputationService } from '../src/services/reputation.js';

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
  return { id: user!.id, pseudo, cookie: `sw_session=${token}` };
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
  await sql`DELETE FROM events WHERE zone_id = ${zoneOf(HERE)} OR zone_id = ${zoneOf(FAR)}
            OR cell_id = ANY(${gridDisk(HERE, 2)})`;
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
    expect(Object.keys(event).sort()).toEqual([
      'againstW',
      'cell',
      'conf',
      'createdAt',
      'expiresAt',
      'id',
      'inv',
      'lastConfAt',
      'rev',
      'supportW',
      'type',
    ]);

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
    const other = await newUser();
    const e1 = (await post('/api/events', voter.cookie, { type: 'DEBRIS', cell: HERE, presenceCell: HERE })).json().event;
    const e2 = (await post('/api/events', other.cookie, { type: 'INCENDIE', cell: HERE, presenceCell: HERE })).json().event;
    await post(`/api/events/${e2.id}/confirm`, voter.cookie, { presenceCell: HERE });
    const tokens = await sql<{ actor_token: Buffer }[]>`
      SELECT actor_token FROM event_votes WHERE event_id IN (${e1.id}, ${e2.id})`;
    // 3 votes : voter sur e1 et e2, other sur e2 — tous les jetons sont différents.
    expect(tokens).toHaveLength(3);
    expect(new Set(tokens.map((t) => t.actor_token.toString('hex'))).size).toBe(3);
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

describe('anti-spam par compte', () => {
  it('refuse un second nouveau signalement immédiat du même compte', async () => {
    const user = await newUser();
    const first = await post('/api/events', user.cookie, { type: 'FOULE_DENSE', cell: HERE, presenceCell: HERE });
    expect(first.statusCode).toBe(201);
    const second = await post('/api/events', user.cookie, { type: 'GAZ_FUMEE', cell: NEAR, presenceCell: HERE });
    expect(second.statusCode).toBe(429);
    expect(second.json().message).toMatch(/trop vite/);
  });

  it("n'affecte pas les autres comptes", async () => {
    const a = await newUser();
    const b = await newUser();
    await post('/api/events', a.cookie, { type: 'FOULE_DENSE', cell: HERE, presenceCell: HERE });
    const res = await post('/api/events', b.cookie, { type: 'GAZ_FUMEE', cell: NEAR, presenceCell: HERE });
    expect(res.statusCode).toBe(201);
  });

  it('laisse confirmer un danger déjà signalé, sans compter comme un nouveau signalement', async () => {
    const author = await newUser();
    const user = await newUser();
    await post('/api/events', user.cookie, { type: 'FOULE_DENSE', cell: HERE, presenceCell: HERE });
    await post('/api/events', author.cookie, { type: 'GAZ_FUMEE', cell: NEAR, presenceCell: HERE });
    // Signaler le même gaz au même endroit = confirmation : autorisé malgré le délai.
    const confirm = await post('/api/events', user.cookie, { type: 'GAZ_FUMEE', cell: NEAR, presenceCell: HERE });
    expect(confirm.statusCode).toBe(200);
    expect(confirm.json().event.conf).toBe(2);
  });

  it('plafonne les nouveaux signalements sur 10 minutes, plus bas si la réputation est faible', async () => {
    const cells = gridDisk(HERE, 2); // 19 cellules à portée
    const types = ['FOULE_DENSE', 'GAZ_FUMEE', 'DEBRIS', 'INCENDIE', 'PASSAGE_BLOQUE', 'DANGER_AUTRE'] as const;
    const createMany = async (cookie: string, n: number) => {
      const codes: number[] = [];
      for (let i = 0; i < n; i++) {
        await redis.del(...(await redis.keys('rl:report-burst:*'))).catch(() => {}); // ignore le délai de 15 s
        const res = await post('/api/events', cookie, { type: types[i % types.length], cell: cells[i + 1], presenceCell: HERE });
        codes.push(res.statusCode);
      }
      return codes;
    };
    const normal = await newUser();
    expect(await createMany(normal.cookie, 6)).toEqual([201, 201, 201, 201, 201, 429]);

    const doubtful = await newUser();
    await sql`UPDATE users SET reputation_score = 0.5 WHERE id = ${doubtful.id}`;
    // Les cellules voisines peuvent appartenir à une autre zone : on nettoie par cellule.
    await sql`DELETE FROM events WHERE cell_id = ANY(${cells})`;
    expect(await createMany(doubtful.cookie, 3)).toEqual([201, 201, 429]);
  });
});

describe('réputation', () => {
  const settle = async () => {
    await new Promise((r) => setTimeout(r, 100)); // écritures Redis « fire and forget »
    const reputation = new ReputationService(sql, new RedisReputationLinks(redis), redis);
    return new EventService(sql, 'x'.repeat(32), { onSettled: (rows) => reputation.settle(rows) });
  };
  const expire = (id: string) => sql`UPDATE events SET expires_at = now() - interval '1 second' WHERE id = ${id}`;
  const rep = async (id: string) =>
    (await sql<{ reputation_score: number }[]>`SELECT reputation_score FROM users WHERE id = ${id}`)[0]!.reputation_score;

  it('pondère chaque vote par la réputation de son auteur', async () => {
    const author = await newUser();
    const trusted = await newUser();
    await sql`UPDATE users SET reputation_score = 2 WHERE id = ${trusted.id}`;
    const event = (await post('/api/events', author.cookie, { type: 'GAZ_FUMEE', cell: HERE, presenceCell: HERE })).json().event;
    const res = await post(`/api/events/${event.id}/confirm`, trusted.cookie, { presenceCell: HERE });
    expect(res.json().event).toMatchObject({ conf: 2, supportW: 3 });
  });

  it("crédite l'auteur et les confirmateurs d'un signalement confirmé", async () => {
    const author = await newUser();
    const c1 = await newUser();
    const c2 = await newUser();
    const event = (await post('/api/events', author.cookie, { type: 'PASSAGE_BLOQUE', cell: HERE, presenceCell: HERE })).json().event;
    await post(`/api/events/${event.id}/confirm`, c1.cookie, { presenceCell: HERE });
    await post(`/api/events/${event.id}/confirm`, c2.cookie, { presenceCell: HERE });
    await expire(event.id);
    await (await settle()).purgeExpired();
    expect(await rep(author.id)).toBeCloseTo(1.1, 5);
    expect(await rep(c1.id)).toBeCloseTo(1.03, 5);
  });

  it("pénalise l'auteur d'un faux signalement et récompense ceux qui l'ont invalidé", async () => {
    const author = await newUser();
    const event = (await post('/api/events', author.cookie, { type: 'INCENDIE', cell: HERE, presenceCell: HERE })).json().event;
    const voters = [await newUser(), await newUser(), await newUser()];
    for (const v of voters) await post(`/api/events/${event.id}/invalidate`, v.cookie, { presenceCell: HERE });
    await (await settle()).purgeExpired(); // retiré → déjà expiré
    expect(await rep(author.id)).toBeCloseTo(0.8, 5);
    expect(await rep(voters[0]!.id)).toBeCloseTo(1.05, 5);
  });

  it('détruit les liens auteur/votants au règlement et ne les écrit jamais en base', async () => {
    const author = await newUser();
    const voter = await newUser();
    const event = (await post('/api/events', author.cookie, { type: 'DEBRIS', cell: HERE, presenceCell: HERE })).json().event;
    await post(`/api/events/${event.id}/confirm`, voter.cookie, { presenceCell: HERE });

    const tables = await sql`SELECT row_to_json(e)::text AS e FROM events e WHERE id = ${event.id}
                             UNION ALL SELECT row_to_json(v)::text FROM event_votes v WHERE event_id = ${event.id}`;
    expect(JSON.stringify(tables)).not.toContain(author.id);
    expect(JSON.stringify(tables)).not.toContain(voter.id);

    await new Promise((r) => setTimeout(r, 100));
    expect(await redis.exists(`rep:a:${event.id}`, `rep:v:${event.id}`)).toBe(2);
    await expire(event.id);
    await (await settle()).purgeExpired();
    expect(await redis.exists(`rep:a:${event.id}`, `rep:v:${event.id}`)).toBe(0);
  });

  it("n'expose jamais la réputation", async () => {
    const user = await newUser();
    const me = await app.inject({ method: 'GET', url: '/api/me', headers: { cookie: user.cookie } });
    expect(Object.keys(me.json())).toEqual(['pseudo']);
  });

  it('ramène les réputations vers la neutralité, sans résidu', async () => {
    const high = await newUser();
    const almost = await newUser();
    await sql`UPDATE users SET reputation_score = 2 WHERE id = ${high.id}`;
    await sql`UPDATE users SET reputation_score = 1.005 WHERE id = ${almost.id}`;
    await new ReputationService(sql, new RedisReputationLinks(redis)).decay();
    expect(await rep(high.id)).toBeCloseTo(1.99, 5);
    expect(await rep(almost.id)).toBe(1);
  });
});

describe('modération', () => {
  async function newAdmin() {
    const admin = await newUser();
    await sql`UPDATE users SET role = 'admin' WHERE id = ${admin.id}`;
    return admin;
  }
  const get = (url: string, cookie: string) => app.inject({ method: 'GET', url, headers: { cookie } });

  it("refuse l'accès à un compte normal", async () => {
    const user = await newUser();
    expect((await get('/api/admin/overview', user.cookie)).statusCode).toBe(403);
    expect((await post('/api/admin/accounts/suspend', user.cookie, { pseudo: 't_x' })).statusCode).toBe(403);
  });

  it("signale le rôle dans /me uniquement pour l'administrateur", async () => {
    const admin = await newAdmin();
    const user = await newUser();
    expect((await get('/api/me', admin.cookie)).json()).toMatchObject({ admin: true });
    expect((await get('/api/me', user.cookie)).json()).not.toHaveProperty('admin');
  });

  it('donne une vue agrégée, sans aucune donnée de position ni réputation exacte', async () => {
    const admin = await newAdmin();
    const user = await newUser();
    await post('/api/events', user.cookie, { type: 'GAZ_FUMEE', cell: HERE, presenceCell: HERE });
    const overview = (await get('/api/admin/overview', admin.cookie)).json();
    expect(overview.activeEvents).toBeGreaterThanOrEqual(1);
    expect(overview.byType.GAZ_FUMEE).toBeGreaterThanOrEqual(1);
    const raw = JSON.stringify(overview);
    expect(raw).not.toContain(HERE); // cellule fine absente : seulement des zones rés. 7
    expect(raw).not.toContain('reputation');
  });

  it("supprime un faux signalement, le retire chez les clients et pénalise son auteur", async () => {
    const admin = await newAdmin();
    const author = await newUser();
    const event = (await post('/api/events', author.cookie, { type: 'INCENDIE', cell: HERE, presenceCell: HERE })).json().event;
    await new Promise((r) => setTimeout(r, 100));

    const sub = redis.duplicate();
    if (sub.status !== 'ready') await new Promise((resolve) => sub.once('ready', resolve));
    const received: unknown[] = [];
    sub.on('message', (_c, m) => received.push(JSON.parse(m)));
    await sub.subscribe(zoneChannel(zoneOf(HERE)));
    try {
      const res = await app.inject({
        method: 'DELETE',
        url: `/api/admin/events/${event.id}`,
        headers: { cookie: admin.cookie, [CSRF_HEADER]: '1' },
      });
      expect(res.statusCode).toBe(204);
      await new Promise((r) => setTimeout(r, 150));
      expect(received).toContainEqual({ removed: event.id });
    } finally {
      sub.disconnect();
    }
    const [row] = await sql<{ reputation_score: number }[]>`SELECT reputation_score FROM users WHERE id = ${author.id}`;
    expect(row!.reputation_score).toBeCloseTo(0.8, 5);
  });

  it('suspend un compte : déconnexion immédiate, puis réactivation', async () => {
    const admin = await newAdmin();
    const target = await newUser();
    const { pseudo } = target;
    expect((await post('/api/admin/accounts/suspend', admin.cookie, { pseudo })).statusCode).toBe(204);
    expect((await get('/api/me', target.cookie)).statusCode).toBe(401);

    const list = (await get('/api/admin/accounts', admin.cookie)).json().accounts;
    expect(list).toContainEqual(expect.objectContaining({ pseudo, suspended: true }));
    expect(JSON.stringify(list)).not.toMatch(/\d\.\d/); // jamais de score chiffré

    expect((await post('/api/admin/accounts/unsuspend', admin.cookie, { pseudo })).statusCode).toBe(204);
    const [row] = await sql<{ status: string }[]>`SELECT status FROM users WHERE id = ${target.id}`;
    expect(row!.status).toBe('active');
  });

  it("refuse de suspendre l'administrateur", async () => {
    const admin = await newAdmin();
    expect((await post('/api/admin/accounts/suspend', admin.cookie, { pseudo: admin.pseudo })).statusCode).toBe(400);
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
