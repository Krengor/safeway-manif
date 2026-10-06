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
  /** Message affiché à l'utilisateur quand la limite est atteinte. */
  message?: string;
}

const TOO_FAST = 'Vous signalez trop vite : attendez un peu avant un nouveau signalement.';

export const RATE_RULES = {
  auth: { name: 'auth', limit: 30, windowSeconds: 600 },
  // Anti-spam par compte (§20) — uniquement pour la CRÉATION de signalements ;
  // confirmer un signalement existant relève de la règle `vote`.
  reportBurst: { name: 'report-burst', limit: 1, windowSeconds: 15, message: TOO_FAST },
  report: { name: 'report', limit: 5, windowSeconds: 600, message: TOO_FAST },
  /** Compte dont les signalements ont souvent été invalidés : quota réduit. */
  reportLowReputation: { name: 'report-low', limit: 2, windowSeconds: 600, message: TOO_FAST },
  /** Compte créé aujourd'hui ou hier (période probatoire). */
  reportProbation: { name: 'report-new', limit: 3, windowSeconds: 600, message: TOO_FAST },
  vote: { name: 'vote', limit: 60, windowSeconds: 600 },
  admin: { name: 'admin', limit: 120, windowSeconds: 60 },
  /**
   * Lecture de la carte, par IP. Volontairement large : derrière le NAT d'un opérateur mobile,
   * des centaines de manifestants partagent la même adresse, et lire la carte est la priorité
   * n° 1 (§56). Les lectures sont mutualisées (micro-cache par zone), un flood coûte peu.
   */
  read: { name: 'read', limit: 3000, windowSeconds: 60 },
} as const satisfies Record<string, RateRule>;

/** En dessous, le quota réduit s'applique (≈ 2 signalements retirés sans compensation). */
export const LOW_REPUTATION_THRESHOLD = 0.65;

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
      throw new HttpError(429, 'rate_limited', rule.message ?? 'Trop de requêtes, réessayez dans quelques minutes.');
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
