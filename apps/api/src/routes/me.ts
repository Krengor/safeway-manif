import { degradationPolicy, updatePseudoSchema, type MeResponse } from '@safeway/shared';
import type { FastifyInstance } from 'fastify';
import { HttpError, parse } from '../lib/http.js';
import type { AppContext } from '../server.js';

export async function meRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  const { sql, sessions } = ctx;

  app.get('/me', async (request): Promise<MeResponse> => {
    const userId = await ctx.requireUser(request);
    const [user] = await sql<{ pseudo: string; role: string }[]>`
      SELECT pseudo, role FROM users WHERE id = ${userId} AND status = 'active'`;
    if (!user) throw new HttpError(401, 'unauthenticated');
    return user.role === 'admin' ? { pseudo: user.pseudo, admin: true } : { pseudo: user.pseudo };
  });

  app.patch('/me/pseudo', async (request): Promise<MeResponse> => {
    const userId = await ctx.requireUser(request);
    // Fonction secondaire : suspendue en charge critique (§56).
    if (!degradationPolicy(ctx.load.level).secondary) {
      throw new HttpError(503, 'degraded', 'Fonction suspendue pendant la forte affluence, réessayez plus tard.');
    }
    const { pseudo } = parse(updatePseudoSchema, request.body);
    try {
      await sql`UPDATE users SET pseudo = ${pseudo} WHERE id = ${userId}`;
    } catch (err) {
      if ((err as { code?: string }).code === '23505') throw new HttpError(409, 'pseudo_taken', 'Ce pseudo est déjà pris.');
      throw err;
    }
    return { pseudo };
  });

  /**
   * Suppression instantanée et définitive (§33) : compte, clés publiques (cascade), sessions.
   * Les votes passés ne sont reliés au compte que par un HMAC non réversible : rien à purger.
   */
  app.delete('/me', async (request, reply) => {
    const userId = await ctx.requireUser(request);
    await sql`DELETE FROM users WHERE id = ${userId}`;
    await sessions.destroyAllForUser(userId);
    reply.clearCookie(ctx.sessionCookie, ctx.cookieOptions);
    return reply.code(204).send();
  });
}
