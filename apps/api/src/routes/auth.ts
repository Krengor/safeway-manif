/**
 * Authentification par passkey uniquement (cahier §3.2, option A).
 * Le serveur ne stocke que la clé publique ; aucun mot de passe n'existe.
 */
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type AuthenticatorTransportFuture,
  type RegistrationResponseJSON,
} from '@simplewebauthn/server';
import { registerOptionsSchema } from '@safeway/shared';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { randomToken } from '../lib/crypto.js';
import { HttpError, parse } from '../lib/http.js';
import { RATE_RULES } from '../lib/rateLimit.js';
import type { AppContext } from '../server.js';

const CHALLENGE_COOKIE = 'sw_chal';
const CHALLENGE_TTL_SECONDS = 120;

interface PendingRegistration {
  challenge: string;
  userId: string;
  pseudo: string;
}

interface PendingAuthentication {
  challenge: string;
}

function uuidToBytes(uuid: string): Uint8Array<ArrayBuffer> {
  return new Uint8Array(Buffer.from(uuid.replaceAll('-', ''), 'hex'));
}

export async function authRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  const { config, sql, redis, sessions, limiter } = ctx;
  const expectedOrigin = config.PUBLIC_ORIGIN;
  const rpID = config.WEBAUTHN_RP_ID;

  async function storeChallenge(reply: FastifyReply, kind: 'reg' | 'auth', payload: object): Promise<void> {
    const id = randomToken(16);
    await redis.set(`chal:${kind}:${id}`, JSON.stringify(payload), 'EX', CHALLENGE_TTL_SECONDS);
    reply.setCookie(CHALLENGE_COOKIE, id, { ...ctx.cookieOptions, maxAge: CHALLENGE_TTL_SECONDS });
  }

  /** Lit puis supprime le challenge : un challenge ne sert qu'une fois. */
  async function takeChallenge<T>(request: FastifyRequest, reply: FastifyReply, kind: 'reg' | 'auth'): Promise<T> {
    const id = request.cookies[CHALLENGE_COOKIE];
    reply.clearCookie(CHALLENGE_COOKIE, ctx.cookieOptions);
    if (!id) throw new HttpError(400, 'challenge_missing');
    const raw = await redis.getdel(`chal:${kind}:${id}`);
    if (!raw) throw new HttpError(400, 'challenge_expired');
    return JSON.parse(raw) as T;
  }

  async function openSession(reply: FastifyReply, userId: string): Promise<void> {
    const token = await sessions.create(userId);
    reply.setCookie(ctx.sessionCookie, token, { ...ctx.cookieOptions, maxAge: ctx.sessionTtl });
  }

  // --- Inscription -----------------------------------------------------------------

  app.post('/auth/passkey/register/options', async (request, reply) => {
    await limiter.consume(RATE_RULES.auth, `ip:${request.ip}`);
    const { pseudo } = parse(registerOptionsSchema, request.body);

    const [taken] = await sql`SELECT 1 FROM users WHERE lower(pseudo) = lower(${pseudo})`;
    if (taken) throw new HttpError(409, 'pseudo_taken', 'Ce pseudo est déjà pris.');

    const userId = randomUUID();
    const options = await generateRegistrationOptions({
      rpName: config.WEBAUTHN_RP_NAME,
      rpID,
      userID: uuidToBytes(userId),
      userName: pseudo,
      userDisplayName: pseudo,
      attestationType: 'none', // aucune information sur le modèle d'appareil
      authenticatorSelection: { residentKey: 'required', userVerification: 'preferred' },
      timeout: CHALLENGE_TTL_SECONDS * 1000,
    });
    await storeChallenge(reply, 'reg', { challenge: options.challenge, userId, pseudo } satisfies PendingRegistration);
    return options;
  });

  app.post('/auth/passkey/register/verify', async (request, reply) => {
    await limiter.consume(RATE_RULES.auth, `ip:${request.ip}`);
    const pending = await takeChallenge<PendingRegistration>(request, reply, 'reg');

    let verification;
    try {
      verification = await verifyRegistrationResponse({
        response: request.body as RegistrationResponseJSON,
        expectedChallenge: pending.challenge,
        expectedOrigin,
        expectedRPID: rpID,
        requireUserVerification: false,
      });
    } catch {
      throw new HttpError(400, 'passkey_invalid');
    }
    if (!verification.verified || !verification.registrationInfo) throw new HttpError(400, 'passkey_invalid');
    const { credential } = verification.registrationInfo;

    try {
      await sql.begin(async (tx) => {
        await tx`INSERT INTO users (id, pseudo) VALUES (${pending.userId}, ${pending.pseudo})`;
        await tx`
          INSERT INTO credentials (id, user_id, public_key, counter, transports)
          VALUES (${credential.id}, ${pending.userId}, ${Buffer.from(credential.publicKey)},
                  ${credential.counter}, ${(credential.transports ?? []) as string[]})`;
      });
    } catch (err) {
      if ((err as { code?: string }).code === '23505') throw new HttpError(409, 'pseudo_taken', 'Ce pseudo est déjà pris.');
      throw err;
    }

    await openSession(reply, pending.userId);
    return { pseudo: pending.pseudo };
  });

  // --- Connexion (passkey découvrable : pas besoin de saisir le pseudo) -------------

  app.post('/auth/passkey/login/options', async (request, reply) => {
    await limiter.consume(RATE_RULES.auth, `ip:${request.ip}`);
    const options = await generateAuthenticationOptions({
      rpID,
      userVerification: 'preferred',
      timeout: CHALLENGE_TTL_SECONDS * 1000,
    });
    await storeChallenge(reply, 'auth', { challenge: options.challenge } satisfies PendingAuthentication);
    return options;
  });

  app.post('/auth/passkey/login/verify', async (request, reply) => {
    await limiter.consume(RATE_RULES.auth, `ip:${request.ip}`);
    const pending = await takeChallenge<PendingAuthentication>(request, reply, 'auth');
    const body = request.body as AuthenticationResponseJSON;
    if (typeof body?.id !== 'string' || body.id.length > 1024) throw new HttpError(400, 'passkey_invalid');

    const [row] = await sql<
      { id: string; user_id: string; public_key: Buffer; counter: string; transports: string[]; pseudo: string; status: string }[]
    >`
      SELECT c.id, c.user_id, c.public_key, c.counter, c.transports, u.pseudo, u.status
      FROM credentials c JOIN users u ON u.id = c.user_id
      WHERE c.id = ${body.id}`;
    if (!row) throw new HttpError(401, 'passkey_unknown', 'Passkey inconnue (compte supprimé ?).');
    if (row.status !== 'active') throw new HttpError(403, 'account_suspended');

    let verification;
    try {
      verification = await verifyAuthenticationResponse({
        response: body,
        expectedChallenge: pending.challenge,
        expectedOrigin,
        expectedRPID: rpID,
        requireUserVerification: false,
        credential: {
          id: row.id,
          publicKey: new Uint8Array(row.public_key),
          counter: Number(row.counter),
          transports: row.transports as AuthenticatorTransportFuture[],
        },
      });
    } catch {
      throw new HttpError(401, 'passkey_invalid');
    }
    if (!verification.verified) throw new HttpError(401, 'passkey_invalid');

    await sql`UPDATE credentials SET counter = ${verification.authenticationInfo.newCounter} WHERE id = ${row.id}`;
    await openSession(reply, row.user_id);
    return { pseudo: row.pseudo };
  });

  app.post('/auth/logout', async (request, reply) => {
    const token = request.cookies[ctx.sessionCookie];
    if (token) await sessions.destroy(token);
    reply.clearCookie(ctx.sessionCookie, ctx.cookieOptions);
    return reply.code(204).send();
  });
}
