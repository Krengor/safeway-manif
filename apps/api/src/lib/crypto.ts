import { createHash, createHmac, randomBytes } from 'node:crypto';

/** Jeton opaque aléatoire (sessions, challenges). */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/** Empreinte stockée côté serveur : une fuite Redis ne livre pas de jetons utilisables. */
export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('base64url');
}

/**
 * Jeton de votant anonyme : HMAC(secret, userId:eventId), tronqué à 128 bits.
 * Différent pour chaque événement → aucun lien entre les votes d'une même personne.
 */
export function actorToken(secret: string, userId: string, eventId: string): Buffer {
  return createHmac('sha256', secret).update(`${userId}:${eventId}`).digest().subarray(0, 16);
}

/** Pseudonymise une clé de rate limiting (IP, identifiant) avant de l'écrire dans Redis. */
export function rateKey(secret: string, value: string): string {
  return createHmac('sha256', secret).update(value).digest('base64url').slice(0, 22);
}
