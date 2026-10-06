/**
 * Partage hors réseau, de téléphone à téléphone (QR code, AirDrop, Quick Share, Bluetooth du système).
 *
 * Le paquet voyage dans le FRAGMENT d'une adresse (#p=…) : un fragment n'est jamais envoyé
 * à un serveur. Scanner le QR avec l'appareil photo ouvre SafeWay (déjà en cache, donc sans
 * réseau), qui importe et VÉRIFIE les signalements :
 *   - signés par le serveur (Ed25519) → affichés normalement ;
 *   - non signés (faits hors réseau par l'autre personne) → « non vérifiés », jamais rouges.
 * Ce qui est partagé : uniquement des signalements publics (type, zone ~70 m, compteurs, dates).
 */
import {
  API_PREFIX,
  EVENT_META,
  EVENT_TYPES,
  SIGNING_KEY_PATH,
  eventSigningPayload,
  type EventType,
  type PublicEvent,
  type SigningKeyResponse,
} from '@safeway/shared';

export const SHARE_FRAGMENT_PREFIX = '#p=';
/** Longueur maximale du paquet pour rester lisible par un QR code affiché sur un écran. */
export const MAX_PACKET_CHARS = 1800;

/** Signalement fait hors réseau par l'émetteur (pas encore envoyé au serveur). */
export interface PendingShare {
  type: EventType;
  cell: string;
  createdAt: number; // epoch s
}

type SignedTuple = [string, number, string, number, number, number, number, number, number, number, number, string];
type PendingTuple = [number, string, number];
interface Packet {
  v: 1;
  s: SignedTuple[];
  u: PendingTuple[];
}

// --- base64url + compression ----------------------------------------------------------

const toBase64url = (bytes: Uint8Array) => {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
};
const fromBase64url = (text: string) => {
  const binary = atob(text.replaceAll('-', '+').replaceAll('_', '/'));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
};

async function deflate(text: string): Promise<Uint8Array> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
async function inflate(bytes: Uint8Array): Promise<string> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Response(stream).text();
}

// --- encodage -------------------------------------------------------------------------

const typeIndex = (type: EventType) => EVENT_TYPES.indexOf(type);

function toTuple(e: PublicEvent): SignedTuple {
  return [e.id, typeIndex(e.type), e.cell, e.conf, e.inv, e.supportW, e.againstW, e.createdAt, e.lastConfAt, e.expiresAt, e.rev, e.sig!];
}

const priority = (e: { type: EventType }) => ({ danger: 0, caution: 1, clear: 2, info: 3 })[EVENT_META[e.type].category];

/**
 * Construit le paquet le plus complet qui tienne dans un QR code : dangers d'abord,
 * puis les plus récents. Retourne aussi le nombre d'éléments réellement inclus.
 */
export async function buildSharePacket(
  events: readonly PublicEvent[],
  pending: readonly PendingShare[],
  now: number,
): Promise<{ packet: string; included: number; unverified: number }> {
  const signed = events
    .filter((e) => e.sig && !e.unverified && e.expiresAt > now)
    .sort((a, b) => priority(a) - priority(b) || b.lastConfAt - a.lastConfAt)
    .map(toTuple);
  const unverified = pending
    .filter((p) => now - p.createdAt < EVENT_META[p.type].ttlMinutes * 60)
    .map((p): PendingTuple => [typeIndex(p.type), p.cell, p.createdAt]);

  const encode = async (nSigned: number, nPending: number) =>
    toBase64url(await deflate(JSON.stringify({ v: 1, s: signed.slice(0, nSigned), u: unverified.slice(0, nPending) } satisfies Packet)));

  // Les signalements non vérifiés (les plus frais, faits sur place) sont prioritaires.
  let nPending = unverified.length;
  let nSigned = signed.length;
  let packet = await encode(nSigned, nPending);
  while (packet.length > MAX_PACKET_CHARS && (nSigned > 0 || nPending > 0)) {
    if (nSigned > 0) nSigned = Math.floor(nSigned * 0.8);
    else nPending = Math.floor(nPending * 0.8);
    packet = await encode(nSigned, nPending);
  }
  return { packet, included: nSigned + nPending, unverified: nPending };
}

// --- réception ------------------------------------------------------------------------

const SIGNING_KEY_STORAGE = 'sw_signing_key';

/** Clé publique du serveur : téléchargée quand le réseau est là, conservée pour l'usage hors ligne. */
export async function loadSigningKey(): Promise<CryptoKey | null> {
  let raw: string | null = null;
  try {
    const res = await fetch(API_PREFIX + SIGNING_KEY_PATH);
    if (res.ok) {
      raw = ((await res.json()) as SigningKeyResponse).key;
      try {
        localStorage.setItem(SIGNING_KEY_STORAGE, raw);
      } catch {
        /* stockage indisponible */
      }
    }
  } catch {
    /* hors ligne : on se rabat sur la clé conservée */
  }
  if (!raw) {
    try {
      raw = localStorage.getItem(SIGNING_KEY_STORAGE);
    } catch {
      raw = null;
    }
  }
  if (!raw) return null;
  return crypto.subtle.importKey('raw', fromBase64url(raw) as BufferSource, { name: 'Ed25519' }, false, ['verify']);
}

export interface ImportedShare {
  verified: PublicEvent[];
  unverified: PublicEvent[];
  rejected: number;
}

export async function readSharePacket(packet: string, key: CryptoKey | null, now: number): Promise<ImportedShare> {
  const data = JSON.parse(await inflate(fromBase64url(packet))) as Packet;
  if (data.v !== 1) throw new Error('Format de partage inconnu.');

  const verified: PublicEvent[] = [];
  let rejected = 0;
  for (const t of data.s ?? []) {
    const type = EVENT_TYPES[t[1]];
    if (!type) {
      rejected++;
      continue;
    }
    const event: PublicEvent = {
      id: t[0], type, cell: t[2], conf: t[3], inv: t[4], supportW: t[5], againstW: t[6],
      createdAt: t[7], lastConfAt: t[8], expiresAt: t[9], rev: t[10], sig: t[11],
    };
    const ok =
      key !== null &&
      (await crypto.subtle.verify(
        { name: 'Ed25519' },
        key,
        fromBase64url(event.sig!) as BufferSource,
        new TextEncoder().encode(eventSigningPayload(event)) as BufferSource,
      ));
    // Signature invalide (falsifiée) ou impossible à vérifier : on écarte.
    if (ok && event.expiresAt > now) verified.push(event);
    else rejected++;
  }

  const unverified: PublicEvent[] = [];
  for (const [index, cell, createdAt] of data.u ?? []) {
    const type = EVENT_TYPES[index];
    if (!type) continue;
    const expiresAt = createdAt + EVENT_META[type].ttlMinutes * 60;
    if (expiresAt <= now) continue;
    unverified.push({
      id: `hors-reseau:${type}:${cell}:${createdAt}`,
      type, cell, conf: 1, inv: 0, supportW: 0, againstW: 0,
      createdAt, lastConfAt: createdAt, expiresAt, rev: 0, unverified: true,
    });
  }
  return { verified, unverified, rejected };
}

export const shareUrl = (packet: string) => `${window.location.origin}/${SHARE_FRAGMENT_PREFIX}${packet}`;
