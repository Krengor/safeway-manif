/**
 * Modération (cahier §22) — réservée au compte « admin » (rôle attribué en ligne de commande).
 *
 * Limites volontaires (§34, administrateur compromis) : pas de position, pas d'IP, pas de lien
 * auteur ↔ signalement (inexistant en base), fiabilité des comptes par tranche uniquement.
 */
import {
  EVENT_TYPES,
  accountActionSchema,
  type AdminAccountsResponse,
  type AdminEventsResponse,
  type AdminOverview,
  type Reliability,
} from '@safeway/shared';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { HttpError, parse } from '../lib/http.js';
import { LOW_REPUTATION_THRESHOLD, RATE_RULES } from '../lib/rateLimit.js';
import type { AppContext } from '../server.js';

const idSchema = z.uuid();
const VERY_LOW_RELIABILITY = 0.45;

export async function adminRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  const { sql, events, sessions, limiter, reputation } = ctx;

  async function requireAdmin(request: FastifyRequest): Promise<string> {
    const userId = await ctx.requireUser(request);
    const [user] = await sql<{ role: string; status: string }[]>`SELECT role, status FROM users WHERE id = ${userId}`;
    if (user?.role !== 'admin' || user.status !== 'active') throw new HttpError(403, 'forbidden');
    await limiter.consume(RATE_RULES.admin, `admin:${userId}`);
    return userId;
  }

  app.get('/admin/overview', async (request): Promise<AdminOverview> => {
    await requireAdmin(request);
    const byTypeRows = await sql<{ type: string; n: number }[]>`
      SELECT type, count(*)::int AS n FROM events WHERE expires_at > now() GROUP BY type`;
    const zones = await sql<{ zone: string; events: number }[]>`
      SELECT zone_id AS zone, count(*)::int AS events FROM events WHERE expires_at > now()
      GROUP BY zone_id ORDER BY events DESC LIMIT 10`;
    const [zoneCount] = await sql<{ n: number }[]>`
      SELECT count(DISTINCT zone_id)::int AS n FROM events WHERE expires_at > now()`;
    const [accounts] = await sql<{ total: number; suspended: number; low: number }[]>`
      SELECT count(*)::int AS total,
             count(*) FILTER (WHERE status = 'suspended')::int AS suspended,
             count(*) FILTER (WHERE reputation_score < ${LOW_REPUTATION_THRESHOLD})::int AS low
      FROM users`;

    const byType: AdminOverview['byType'] = {};
    for (const row of byTypeRows) {
      if ((EVENT_TYPES as readonly string[]).includes(row.type)) byType[row.type as keyof typeof byType] = row.n;
    }
    return {
      now: Math.floor(Date.now() / 1000),
      activeEvents: byTypeRows.reduce((sum, r) => sum + r.n, 0),
      byType,
      activeZones: zoneCount?.n ?? 0,
      topZones: zones,
      accounts: accounts?.total ?? 0,
      suspended: accounts?.suspended ?? 0,
      lowReliability: accounts?.low ?? 0,
    };
  });

  app.get('/admin/events', async (request): Promise<AdminEventsResponse> => {
    await requireAdmin(request);
    return { events: await events.listActive() };
  });

  /** Supprimer un faux signalement : traité comme « retiré » pour la réputation de son auteur. */
  app.delete<{ Params: { id: string } }>('/admin/events/:id', async (request, reply) => {
    await requireAdmin(request);
    const removed = await events.remove(parse(idSchema, request.params.id));
    if (!removed) throw new HttpError(404, 'not_found');
    await reputation.settle([removed], 'withdrawn').catch(() => {});
    request.log.info({ action: 'admin_remove_event' }, 'modération');
    return reply.code(204).send();
  });

  app.get('/admin/accounts', async (request): Promise<AdminAccountsResponse> => {
    await requireAdmin(request);
    const rows = await sql<{ pseudo: string; reputation_score: number; status: string }[]>`
      SELECT pseudo, reputation_score, status FROM users
      WHERE reputation_score < ${LOW_REPUTATION_THRESHOLD} OR status = 'suspended'
      ORDER BY reputation_score ASC LIMIT 100`;
    return {
      accounts: rows.map((r) => ({
        pseudo: r.pseudo,
        reliability: (r.reputation_score < VERY_LOW_RELIABILITY ? 'très faible' : 'faible') satisfies Reliability,
        suspended: r.status === 'suspended',
      })),
    };
  });

  /** Suspendre : déconnexion immédiate de toutes les sessions, connexion refusée ensuite. */
  app.post('/admin/accounts/suspend', async (request, reply) => {
    await requireAdmin(request);
    const { pseudo } = parse(accountActionSchema, request.body);
    const [target] = await sql<{ id: string; role: string }[]>`
      SELECT id, role FROM users WHERE lower(pseudo) = lower(${pseudo})`;
    if (!target) throw new HttpError(404, 'not_found', 'Pseudo introuvable.');
    if (target.role === 'admin') throw new HttpError(400, 'forbidden_target', "Impossible de suspendre l'administrateur.");
    await sql`UPDATE users SET status = 'suspended' WHERE id = ${target.id}`;
    await sessions.destroyAllForUser(target.id);
    request.log.info({ action: 'admin_suspend' }, 'modération');
    return reply.code(204).send();
  });

  app.post('/admin/accounts/unsuspend', async (request, reply) => {
    await requireAdmin(request);
    const { pseudo } = parse(accountActionSchema, request.body);
    const result = await sql`UPDATE users SET status = 'active' WHERE lower(pseudo) = lower(${pseudo})`;
    if (!result.count) throw new HttpError(404, 'not_found', 'Pseudo introuvable.');
    request.log.info({ action: 'admin_unsuspend' }, 'modération');
    return reply.code(204).send();
  });
}
