/**
 * Signature des signalements (partage hors réseau).
 *
 * Le serveur signe chaque signalement public (Ed25519). Un téléphone qui reçoit des
 * signalements d'un autre téléphone, sans réseau, peut ainsi vérifier qu'ils viennent bien
 * du serveur et n'ont pas été modifiés. La signature ne contient aucune donnée personnelle.
 */
import type { PublicEvent } from './api.js';

export const SIGNING_KEY_PATH = '/map/signing-key';

export interface SigningKeyResponse {
  alg: 'Ed25519';
  /** Clé publique brute (32 octets), base64url. */
  key: string;
}

/** Message canonique signé : tous les champs publics, dans un ordre fixe. */
export function eventSigningPayload(e: Omit<PublicEvent, 'sig' | 'unverified'>): string {
  return [
    'safeway-event-v1',
    e.id,
    e.type,
    e.cell,
    e.conf,
    e.inv,
    e.supportW,
    e.againstW,
    e.createdAt,
    e.lastConfAt,
    e.expiresAt,
    e.rev,
  ].join('|');
}
