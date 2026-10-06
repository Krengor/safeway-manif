/**
 * Résolution de la preuve de travail d'inscription (voir packages/shared/src/pow.ts).
 * Calcul par lots asynchrones (WebCrypto) pour ne pas figer l'interface.
 */
import { leadingZeroBits, powMessage, type PowChallenge, type PowSolution } from '@safeway/shared';

const BATCH = 512;
const encoder = new TextEncoder();

export async function solvePow({ challenge, difficulty }: PowChallenge, signal?: AbortSignal): Promise<PowSolution> {
  for (let start = 0; ; start += BATCH) {
    if (signal?.aborted) throw new DOMException('Annulé', 'AbortError');
    const hashes = await Promise.all(
      Array.from({ length: BATCH }, (_, i) =>
        crypto.subtle.digest('SHA-256', encoder.encode(powMessage(challenge, String(start + i)))),
      ),
    );
    const found = hashes.findIndex((h) => leadingZeroBits(new Uint8Array(h)) >= difficulty);
    if (found >= 0) return { challenge, nonce: String(start + found) };
  }
}
