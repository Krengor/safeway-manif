/**
 * Signature Ed25519 des signalements publics (partage hors réseau, vérification hors ligne).
 *
 * EVENT_SIGNING_KEY : clé privée PKCS#8 (DER) en base64url, commune à toutes les instances.
 * Générer : node -e "const c=require('crypto');console.log(c.generateKeyPairSync('ed25519').privateKey.export({type:'pkcs8',format:'der'}).toString('base64url'))"
 * Sans clé (développement / tests uniquement), une clé éphémère est générée au démarrage.
 */
import { eventSigningPayload, type PublicEvent, type SigningKeyResponse } from '@safeway/shared';
import { createPrivateKey, createPublicKey, generateKeyPairSync, sign, type KeyObject } from 'node:crypto';

export class EventSigner {
  private readonly privateKey: KeyObject;
  readonly publicKey: SigningKeyResponse;

  constructor(pkcs8Base64url?: string) {
    this.privateKey = pkcs8Base64url
      ? createPrivateKey({ key: Buffer.from(pkcs8Base64url, 'base64url'), format: 'der', type: 'pkcs8' })
      : generateKeyPairSync('ed25519').privateKey;
    const jwk = createPublicKey(this.privateKey).export({ format: 'jwk' }) as { x: string };
    this.publicKey = { alg: 'Ed25519', key: jwk.x };
  }

  sign<T extends PublicEvent>(event: T): T {
    const signature = sign(null, Buffer.from(eventSigningPayload(event)), this.privateKey);
    return { ...event, sig: signature.toString('base64url') };
  }
}
