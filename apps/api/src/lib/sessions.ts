/**
 * Sessions opaques stockées dans Redis (API stateless, §48).
 *
 * Cookie : jeton aléatoire 256 bits, HttpOnly, SameSite=Strict, Secure en production.
 * Redis ne connaît que sha256(jeton) → user_id, avec TTL. Aucune IP, aucun user-agent.
 */
import type { Redis } from 'ioredis';
import { randomToken, sha256 } from './crypto.js';

export const SESSION_TTL_SECONDS = 30 * 24 * 3600;
/** On ne rafraîchit le TTL que lorsqu'il est à moitié consommé (moins d'écritures). */
const REFRESH_BELOW_SECONDS = SESSION_TTL_SECONDS / 2;

const sessionKey = (hash: string) => `sess:${hash}`;
const userSessionsKey = (userId: string) => `usess:${userId}`;

export class SessionStore {
  constructor(private readonly redis: Redis) {}

  async create(userId: string): Promise<string> {
    const token = randomToken();
    const hash = sha256(token);
    await this.redis
      .multi()
      .set(sessionKey(hash), userId, 'EX', SESSION_TTL_SECONDS)
      // Index utilisateur → sessions, pour pouvoir toutes les révoquer à la suppression du compte.
      .sadd(userSessionsKey(userId), hash)
      .expire(userSessionsKey(userId), SESSION_TTL_SECONDS)
      .exec();
    return token;
  }

  async resolve(token: string): Promise<string | null> {
    const key = sessionKey(sha256(token));
    const [userId, ttl] = await Promise.all([this.redis.get(key), this.redis.ttl(key)]);
    if (userId && ttl > 0 && ttl < REFRESH_BELOW_SECONDS) {
      await this.redis.expire(key, SESSION_TTL_SECONDS);
      await this.redis.expire(userSessionsKey(userId), SESSION_TTL_SECONDS);
    }
    return userId;
  }

  async destroy(token: string): Promise<void> {
    const hash = sha256(token);
    const userId = await this.redis.get(sessionKey(hash));
    const tx = this.redis.multi().del(sessionKey(hash));
    if (userId) tx.srem(userSessionsKey(userId), hash);
    await tx.exec();
  }

  async destroyAllForUser(userId: string): Promise<void> {
    const hashes = await this.redis.smembers(userSessionsKey(userId));
    const tx = this.redis.multi().del(userSessionsKey(userId));
    for (const hash of hashes) tx.del(sessionKey(hash));
    await tx.exec();
  }
}
