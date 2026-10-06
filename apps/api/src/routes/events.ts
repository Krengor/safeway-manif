import { createEventSchema, isNear, voteSchema, zoneOf, type PublicEvent, type VoteResponse } from '@safeway/shared';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { HttpError, parse } from '../lib/http.js';
import { LOW_REPUTATION_THRESHOLD, RATE_RULES } from '../lib/rateLimit.js';
import type { AppContext } from '../server.js';
import type { Vote } from '../services/events.js';

const idSchema = z.uuid();

const TOO_FAR = () => new HttpError(403, 'too_far', 'Vous devez être à proximité de la zone.');

export async function eventRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  const { events, limiter } = ctx;

  /**
   * Création d'un signalement. `presenceCell` sert uniquement à la vérification de
   * proximité ci-dessous : elle n'est ni stockée, ni journalisée, ni renvoyée.
   */
  app.post('/events', async (request, reply): Promise<{ event: PublicEvent; created: boolean }> => {
    const userId = await ctx.requireUser(request);
    const body = parse(createEventSchema, request.body);
    if (!isNear(body.presenceCell, body.cell)) throw TOO_FAR();

    // Anti-spam par compte : seule la CRÉATION est limitée strictement ; signaler un
    // danger déjà actif revient à le confirmer (un seul vote par compte, quota de votes).
    const subject = `u:${userId}`;
    if (await events.isActive(body.cell, body.type)) {
      await limiter.consume(RATE_RULES.vote, subject);
    } else {
      await limiter.consume(RATE_RULES.reportBurst, subject);
      await limiter.consume(RATE_RULES.report, subject);
      const { reputation, probation } = await events.standingOf(userId);
      if (reputation < LOW_REPUTATION_THRESHOLD) await limiter.consume(RATE_RULES.reportLowReputation, subject);
      if (probation) await limiter.consume(RATE_RULES.reportProbation, subject);
    }

    const result = await events.report(userId, body.type, body.cell);
    if (result.created) ctx.surge.record(zoneOf(body.cell));
    ctx.metrics.reports.inc({ kind: result.created ? 'new' : 'merged' });
    reply.code(result.created ? 201 : 200);
    return result;
  });

  app.get<{ Params: { id: string } }>('/events/:id', async (request) => {
    const id = parse(idSchema, request.params.id);
    const event = await events.get(id);
    if (!event) throw new HttpError(404, 'not_found');
    return { event };
  });

  const voteHandler = (vote: Vote) =>
    async function (request: FastifyRequest<{ Params: { id: string } }>): Promise<VoteResponse> {
      const userId = await ctx.requireUser(request);
      const id = parse(idSchema, request.params.id);
      const { presenceCell } = parse(voteSchema, request.body);

      const cell = await events.cellOf(id);
      if (!cell) throw new HttpError(404, 'not_found', "Ce signalement n'est plus actif.");
      if (!isNear(presenceCell, cell)) throw TOO_FAR();
      await limiter.consume(RATE_RULES.vote, `u:${userId}`);

      const event = await events.vote(userId, id, vote);
      ctx.metrics.votes.inc({ kind: vote === 1 ? 'confirm' : 'invalidate' });
      return { event };
    };

  app.post<{ Params: { id: string } }>('/events/:id/confirm', voteHandler(1));
  app.post<{ Params: { id: string } }>('/events/:id/invalidate', voteHandler(-1));
}
