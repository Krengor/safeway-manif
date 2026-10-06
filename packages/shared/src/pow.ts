/**
 * Preuve de travail à l'inscription (cahier §20 « challenge anti-bot », sans CAPTCHA tiers
 * ni adresse IP) : le client cherche un nonce tel que SHA-256(challenge:nonce) commence par
 * `difficulty` bits à zéro. ~1 s pour un téléphone, mais très coûteux à grande échelle.
 */
import { z } from 'zod';

/** Difficulté de base et paliers selon le nombre d'inscriptions récentes (toutes confondues). */
export const POW_BASE_DIFFICULTY = 16;
export const POW_MAX_DIFFICULTY = 22;

export function powDifficultyFor(recentRegistrations: number): number {
  if (recentRegistrations > 500) return POW_MAX_DIFFICULTY;
  if (recentRegistrations > 200) return 20;
  if (recentRegistrations > 50) return 18;
  return POW_BASE_DIFFICULTY;
}

export interface PowChallenge {
  challenge: string;
  difficulty: number;
}

export const powSolutionSchema = z.object({
  challenge: z.string().min(16).max(64),
  nonce: z.string().min(1).max(20).regex(/^\d+$/),
});
export type PowSolution = z.infer<typeof powSolutionSchema>;

export const powMessage = (challenge: string, nonce: string) => `${challenge}:${nonce}`;

/** Nombre de bits à zéro en tête d'un condensat. */
export function leadingZeroBits(hash: Uint8Array): number {
  let bits = 0;
  for (const byte of hash) {
    if (byte === 0) {
      bits += 8;
      continue;
    }
    return bits + Math.clz32(byte) - 24;
  }
  return bits;
}
