/**
 * Logique métier des signalements. Toutes les écritures d'un événement sont sérialisées
 * par un verrou de ligne (SELECT … FOR UPDATE) pour garder des compteurs exacts.
 *
 * Note charge (§47, §68) : sur un événement « viral » recevant des milliers de votes/s,
 * ce verrou devient le goulot. Piste V0.3 : compteurs dans Redis + flush asynchrone.
 */
import {
  EVENT_META,
  extendedExpiry,
  shouldWithdraw,
  zoneOf,
  type EventType,
  type PublicEvent,
} from '@safeway/shared';
import type { TransactionSql } from 'postgres';
import type { Sql } from '../db.js';
import { noopBus, type EventBus } from '../lib/bus.js';
import { actorToken } from '../lib/crypto.js';
import { epoch } from '../lib/http.js';

type Tx = TransactionSql;

interface EventRow {
  id: string;
  type: EventType;
  cell_id: string;
  confirmations: number;
  invalidations: number;
  created_at: Date;
  last_confirmation_at: Date;
  expires_at: Date;
  revision: number;
}

const COLUMNS = 'id, type, cell_id, confirmations, invalidations, created_at, last_confirmation_at, expires_at, revision';

export function toPublic(row: EventRow): PublicEvent {
  return {
    id: row.id,
    type: row.type,
    cell: row.cell_id,
    conf: row.confirmations,
    inv: row.invalidations,
    createdAt: epoch(row.created_at),
    lastConfAt: epoch(row.last_confirmation_at),
    expiresAt: epoch(row.expires_at),
    rev: row.revision,
  };
}

export type Vote = 1 | -1;

export class EventService {
  constructor(
    private readonly sql: Sql,
    private readonly voteSecret: string,
    /** Diffusion temps réel, après validation de la transaction uniquement. */
    private readonly bus: EventBus = noopBus,
  ) {}

  async listByZones(zones: readonly string[]): Promise<PublicEvent[]> {
    const rows = await this.sql<EventRow[]>`
      SELECT ${this.sql.unsafe(COLUMNS)} FROM events
      WHERE zone_id = ANY(${zones as string[]}) AND expires_at > now()
      LIMIT 5000`;
    return rows.map(toPublic);
  }

  async get(id: string): Promise<PublicEvent | null> {
    const [row] = await this.sql<EventRow[]>`
      SELECT ${this.sql.unsafe(COLUMNS)} FROM events WHERE id = ${id} AND expires_at > now()`;
    return row ? toPublic(row) : null;
  }

  /** Cellule d'un événement actif (pour la vérification de proximité avant un vote). */
  async cellOf(id: string): Promise<string | null> {
    const [row] = await this.sql<{ cell_id: string }[]>`
      SELECT cell_id FROM events WHERE id = ${id} AND expires_at > now()`;
    return row?.cell_id ?? null;
  }

  /**
   * Crée un signalement, ou — si le même type est déjà actif sur la cellule — l'enregistre
   * comme confirmation. L'auteur n'est pas stocké : seul son jeton de vote anonyme l'est.
   */
  async report(userId: string, type: EventType, cell: string): Promise<{ event: PublicEvent; created: boolean }> {
    const ttlMinutes = EVENT_META[type].ttlMinutes;
    const result = await this.sql.begin(async (tx) => {
      // Un ancien signalement expiré mais pas encore purgé ne doit pas être « ressuscité ».
      await tx`DELETE FROM events WHERE cell_id = ${cell} AND type = ${type} AND expires_at <= now()`;

      const [inserted] = await tx<EventRow[]>`
        INSERT INTO events (zone_id, cell_id, type, expires_at, confirmations)
        VALUES (${zoneOf(cell)}, ${cell}, ${type}, now() + make_interval(mins => ${ttlMinutes}), 1)
        ON CONFLICT (cell_id, type) DO NOTHING
        RETURNING ${tx.unsafe(COLUMNS)}`;

      if (inserted) {
        await tx`
          INSERT INTO event_votes (event_id, actor_token, vote)
          VALUES (${inserted.id}, ${actorToken(this.voteSecret, userId, inserted.id)}, 1)`;
        return { event: toPublic(inserted), created: true };
      }

      const [existing] = await tx<EventRow[]>`
        SELECT ${tx.unsafe(COLUMNS)} FROM events WHERE cell_id = ${cell} AND type = ${type} FOR UPDATE`;
      if (!existing) throw new Error('signalement concurrent introuvable');
      const event = await this.applyVote(tx, existing, userId, 1);
      return { event: event ?? toPublic(existing), created: false };
    });
    this.bus.publish(zoneOf(cell), { event: result.event });
    return result;
  }

  /** Vote « Toujours vrai » (+1) ou « Plus d'actualité » (-1). Null si l'événement n'existe plus. */
  async vote(userId: string, eventId: string, vote: Vote): Promise<PublicEvent | null> {
    const result = await this.sql.begin(async (tx) => {
      const [row] = await tx<EventRow[]>`
        SELECT ${tx.unsafe(COLUMNS)} FROM events WHERE id = ${eventId} AND expires_at > now() FOR UPDATE`;
      if (!row) return null;
      return { cell: row.cell_id, event: await this.applyVote(tx, row, userId, vote) };
    });
    if (!result) return null;
    // Un événement retiré par la communauté est signalé aux clients pour disparaître aussitôt.
    this.bus.publish(zoneOf(result.cell), result.event ? { event: result.event } : { removed: eventId });
    return result.event;
  }

  private async applyVote(tx: Tx, row: EventRow, userId: string, vote: Vote): Promise<PublicEvent | null> {
    const token = actorToken(this.voteSecret, userId, row.id);
    const [previous] = await tx<{ vote: number }[]>`
      SELECT vote FROM event_votes WHERE event_id = ${row.id} AND actor_token = ${token}`;
    if (previous?.vote === vote) return toPublic(row);

    await tx`
      INSERT INTO event_votes (event_id, actor_token, vote) VALUES (${row.id}, ${token}, ${vote})
      ON CONFLICT (event_id, actor_token) DO UPDATE SET vote = EXCLUDED.vote`;

    const prev = previous?.vote ?? 0;
    const conf = row.confirmations + (vote === 1 ? 1 : 0) - (prev === 1 ? 1 : 0);
    const inv = row.invalidations + (vote === -1 ? 1 : 0) - (prev === -1 ? 1 : 0);

    const now = Math.floor(Date.now() / 1000);
    let expiresAt = epoch(row.expires_at);
    if (vote === 1) expiresAt = extendedExpiry(row.type, epoch(row.created_at), expiresAt, now);
    if (shouldWithdraw({ conf, inv })) expiresAt = now;

    const [updated] = await tx<EventRow[]>`
      UPDATE events SET
        confirmations = ${conf},
        invalidations = ${inv},
        last_confirmation_at = CASE WHEN ${vote === 1} THEN now() ELSE last_confirmation_at END,
        expires_at = to_timestamp(${expiresAt}),
        revision = revision + 1
      WHERE id = ${row.id}
      RETURNING ${tx.unsafe(COLUMNS)}`;
    if (!updated) return null;
    return epoch(updated.expires_at) <= now ? null : toPublic(updated);
  }

  /** Suppression physique des événements expirés, par lots (§30). Retourne le nombre supprimé. */
  async purgeExpired(batchSize = 5000): Promise<number> {
    let total = 0;
    for (;;) {
      const result = await this.sql`
        DELETE FROM events WHERE id IN (
          SELECT id FROM events WHERE expires_at < now() LIMIT ${batchSize}
        )`;
      total += result.count;
      if (result.count < batchSize) return total;
    }
  }
}
