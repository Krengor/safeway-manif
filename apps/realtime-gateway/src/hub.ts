/**
 * Hub d'abonnements par zone (§50, §51).
 *
 * - zone → ensemble de clients ; abonnement au bus seulement tant qu'une zone a des clients.
 * - Les messages du bus sont accumulés par zone puis envoyés toutes les `batchMs` :
 *   N changements d'un même événement → 1 seule version (révision la plus haute).
 * - Chaque lot est sérialisé UNE fois par zone, puis la même chaîne part à tous les abonnés.
 * - Contre-pression : un client qui n'absorbe plus (tampon d'envoi trop plein) est
 *   déconnecté ; il se reconnecte et se resynchronise via l'API REST.
 */
import type { BusMessage, PublicEvent, ServerMessage } from '@safeway/shared';

export interface HubClient {
  send(data: string): void;
  /** Octets en attente d'envoi (ws.bufferedAmount). */
  readonly bufferedAmount: number;
  close(code: number, reason: string): void;
}

export interface BusSubscriber {
  subscribe(zone: string): void;
  unsubscribe(zone: string): void;
}

interface ZoneBatch {
  events: Map<string, PublicEvent>;
  removed: Set<string>;
}

export interface HubOptions {
  batchMs: number;
  /** Au-delà, le client est jugé trop lent et déconnecté. */
  maxBufferedBytes: number;
}

export const CLOSE_TOO_SLOW = 4008;

export class Hub {
  private readonly subscribers = new Map<string, Set<HubClient>>();
  private readonly clientZones = new Map<HubClient, Set<string>>();
  private readonly pending = new Map<string, ZoneBatch>();
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly bus: BusSubscriber,
    private readonly options: HubOptions,
  ) {}

  start(): void {
    this.timer ??= setInterval(() => this.flush(), this.options.batchMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  get stats() {
    return { clients: this.clientZones.size, zones: this.subscribers.size };
  }

  /** Remplace les zones suivies par un client. */
  setZones(client: HubClient, zones: readonly string[]): void {
    const next = new Set(zones);
    const previous = this.clientZones.get(client) ?? new Set<string>();
    for (const zone of previous) if (!next.has(zone)) this.leave(client, zone);
    for (const zone of next) if (!previous.has(zone)) this.join(client, zone);
    this.clientZones.set(client, next);
  }

  removeClient(client: HubClient): void {
    for (const zone of this.clientZones.get(client) ?? []) this.leave(client, zone);
    this.clientZones.delete(client);
  }

  /** Message reçu du bus pour une zone. Ignoré si plus personne ne suit la zone. */
  dispatch(zone: string, message: BusMessage): void {
    if (!this.subscribers.has(zone)) return;
    let batch = this.pending.get(zone);
    if (!batch) {
      batch = { events: new Map(), removed: new Set() };
      this.pending.set(zone, batch);
    }
    if ('removed' in message) {
      batch.events.delete(message.removed);
      batch.removed.add(message.removed);
      return;
    }
    const { event } = message;
    const current = batch.events.get(event.id);
    if (!current || current.rev <= event.rev) batch.events.set(event.id, event);
    batch.removed.delete(event.id);
  }

  /** Envoie les lots accumulés. Exposé pour les tests. */
  flush(): void {
    if (this.pending.size === 0) return;
    const batches = [...this.pending];
    this.pending.clear();
    for (const [zone, batch] of batches) {
      const clients = this.subscribers.get(zone);
      if (!clients || clients.size === 0) continue;
      const payload: ServerMessage = {
        t: 'upd',
        zone,
        events: [...batch.events.values()],
        removed: [...batch.removed],
      };
      const data = JSON.stringify(payload);
      for (const client of clients) {
        if (client.bufferedAmount > this.options.maxBufferedBytes) {
          client.close(CLOSE_TOO_SLOW, 'client trop lent');
          this.removeClient(client);
          continue;
        }
        client.send(data);
      }
    }
  }

  private join(client: HubClient, zone: string): void {
    let clients = this.subscribers.get(zone);
    if (!clients) {
      clients = new Set();
      this.subscribers.set(zone, clients);
      this.bus.subscribe(zone);
    }
    clients.add(client);
  }

  private leave(client: HubClient, zone: string): void {
    const clients = this.subscribers.get(zone);
    if (!clients) return;
    clients.delete(client);
    if (clients.size === 0) {
      this.subscribers.delete(zone);
      this.pending.delete(zone);
      this.bus.unsubscribe(zone);
    }
  }
}
