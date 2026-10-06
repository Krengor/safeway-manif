/**
 * Rate limiting à fenêtre fixe (§18, §20, §66).
 *
 * - Clés pseudonymisées par HMAC avant d'atteindre Redis : aucune IP en clair.
 * - TTL = durée de la fenêtre : rien ne subsiste au-delà.
 * - Si Redis est indisponible, repli sur un compteur en mémoire locale à l'instance
 *   (dégradé mais protégé, plutôt que fail-open complet).
 */
import type { Redis } from 'ioredis';
import { rateKey } from './crypto.js';
import { HttpError } from './http.js';

export interface RateRule {
  name: string;
  limit: number;
  windowSeconds: number;
}

export const RATE_RULES = {
  auth: { name: 'auth', limit: 30, windowSeconds: 600 },
  report: { name: 'report', limit: 10, windowSeconds: 600 },
  vote: { name: 'vote', limit: 60, windowSeconds: 600 },
  read: { name: 'read', limit: 600, windowSeconds: 60 },
} as const satisfies Record<string, RateRule>;

export class RateLimiter {
  private readonly memory = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly redis: Redis,
    private readonly secret: string,
  ) {}

  /** Lève une HttpError 429 si la limite est atteinte. */
  async consume(rule: RateRule, subject: string): Promise<void> {
    const key = `rl:${rule.name}:${rateKey(this.secret, subject)}`;
    let count: number;
    try {
      const results = await this.redis.multi().incr(key).expire(key, rule.windowSeconds, 'NX').exec();
      const incr = results?.[0]?.[1];
      if (typeof incr !== 'number') throw new Error('réponse Redis inattendue');
      count = incr;
    } catch {
      count = this.consumeInMemory(key, rule);
    }
    if (count > rule.limit) {
      throw new HttpError(429, 'rate_limited', 'Trop de requêtes, réessayez dans quelques minutes.');
    }
  }

  private consumeInMemory(key: string, rule: RateRule): number {
    const now = Date.now();
    const entry = this.memory.get(key);
    if (!entry || entry.resetAt <= now) {
      if (this.memory.size > 50_000) this.memory.clear(); // borne mémoire stricte
      this.memory.set(key, { count: 1, resetAt: now + rule.windowSeconds * 1000 });
      return 1;
    }
    entry.count += 1;
    return entry.count;
  }
}
