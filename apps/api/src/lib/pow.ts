/**
 * Preuve de travail des inscriptions : défis à usage unique (Redis, 5 min), difficulté
 * adaptée au volume global d'inscriptions récentes. Aucune donnée sur la personne.
 */
import {
  leadingZeroBits,
  powDifficultyFor,
  powMessage,
  type PowChallenge,
  type PowSolution,
} from '@safeway/shared';
import type { Redis } from 'ioredis';
import { createHash } from 'node:crypto';
import { randomToken } from './crypto.js';
import { HttpError } from './http.js';

const CHALLENGE_TTL_SECONDS = 300;
const WINDOW_SECONDS = 600;

const windowKey = () => `reg:count:${Math.floor(Date.now() / 1000 / WINDOW_SECONDS)}`;

export class ProofOfWork {
  constructor(private readonly redis: Redis) {}

  async issue(): Promise<PowChallenge> {
    const recent = Number(await this.redis.get(windowKey())) || 0;
    const challenge: PowChallenge = { challenge: randomToken(16), difficulty: powDifficultyFor(recent) };
    await this.redis.set(`pow:${challenge.challenge}`, String(challenge.difficulty), 'EX', CHALLENGE_TTL_SECONDS);
    return challenge;
  }

  /** Vérifie et consomme le défi (usage unique). */
  async verify(solution: PowSolution): Promise<void> {
    const stored = await this.redis.getdel(`pow:${solution.challenge}`);
    if (!stored) throw new HttpError(400, 'pow_expired', 'Vérification expirée, réessayez.');
    const hash = createHash('sha256').update(powMessage(solution.challenge, solution.nonce)).digest();
    if (leadingZeroBits(hash) < Number(stored)) throw new HttpError(400, 'pow_invalid', 'Vérification invalide.');
  }

  /** Compte une inscription réussie (fenêtre glissante grossière de 10 min). */
  async recordRegistration(): Promise<void> {
    const key = windowKey();
    await this.redis.multi().incr(key).expire(key, WINDOW_SECONDS * 2).exec();
  }
}
