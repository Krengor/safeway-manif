/**
 * Envois en attente (cahier §26 « synchronisation lorsque la connexion revient »).
 *
 * Un signalement ou un vote fait sans réseau est gardé EN MÉMOIRE (jamais sur le disque :
 * il contient une cellule de position) puis renvoyé automatiquement. Au-delà de
 * OUTBOX_MAX_AGE_MS, l'information est trop ancienne pour être utile : elle est abandonnée.
 *
 * Les renvois sont sans risque de doublon : côté serveur, un même signalement devient une
 * confirmation et chaque compte n'a qu'un vote par signalement.
 */
import type { CreateEventBody, PublicEvent } from '@safeway/shared';

export const OUTBOX_MAX_AGE_MS = 10 * 60_000;

export type OutboxItem =
  | { id: string; kind: 'report'; body: CreateEventBody; createdAt: number }
  | { id: string; kind: 'vote'; eventId: string; vote: 1 | -1; presenceCell: string; createdAt: number };

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
/** Élément à ajouter : l'identifiant et la date sont attribués par la file. */
export type NewOutboxItem = DistributiveOmit<OutboxItem, 'id' | 'createdAt'>;

export type SendResult = { ok: true; event: PublicEvent | null } | { ok: false; retry: boolean };

/**
 * Tente d'envoyer les éléments dans l'ordre. S'arrête au premier échec réseau (inutile
 * d'insister) ; abandonne les éléments refusés par le serveur ou trop anciens.
 */
export async function flushOutbox(
  items: readonly OutboxItem[],
  send: (item: OutboxItem) => Promise<SendResult>,
  now: number,
): Promise<{ remaining: OutboxItem[]; sent: { item: OutboxItem; event: PublicEvent | null }[]; dropped: OutboxItem[] }> {
  const remaining: OutboxItem[] = [];
  const sent: { item: OutboxItem; event: PublicEvent | null }[] = [];
  const dropped: OutboxItem[] = [];
  let networkDown = false;

  for (const item of items) {
    if (now - item.createdAt > OUTBOX_MAX_AGE_MS) {
      dropped.push(item);
      continue;
    }
    if (networkDown) {
      remaining.push(item);
      continue;
    }
    const result = await send(item);
    if (result.ok) sent.push({ item, event: result.event });
    else if (result.retry) {
      networkDown = true;
      remaining.push(item);
    } else dropped.push(item);
  }
  return { remaining, sent, dropped };
}
