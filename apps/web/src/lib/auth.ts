import {
  browserSupportsWebAuthn,
  startAuthentication,
  startRegistration,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
} from '@simplewebauthn/browser';
import { api } from './api';

export const passkeysSupported = browserSupportsWebAuthn;

/** Crée le compte : pseudo + passkey générée sur l'appareil. Aucun mot de passe. */
export async function registerWithPasskey(pseudo: string): Promise<string> {
  const options = (await api.registerOptions(pseudo)) as PublicKeyCredentialCreationOptionsJSON;
  const response = await startRegistration({ optionsJSON: options });
  const me = await api.registerVerify(response);
  return me.pseudo;
}

export async function loginWithPasskey(): Promise<string> {
  const options = (await api.loginOptions()) as PublicKeyCredentialRequestOptionsJSON;
  const response = await startAuthentication({ optionsJSON: options });
  const me = await api.loginVerify(response);
  return me.pseudo;
}

/** Message lisible pour les erreurs WebAuthn courantes (annulation, timeout…). */
export function passkeyErrorMessage(err: unknown): string {
  const name = (err as { name?: string })?.name;
  if (name === 'NotAllowedError') return 'Opération annulée ou expirée.';
  if (name === 'InvalidStateError') return 'Une passkey existe déjà sur cet appareil pour ce compte.';
  if (err instanceof Error && err.message) return err.message;
  return 'Échec de la passkey.';
}
