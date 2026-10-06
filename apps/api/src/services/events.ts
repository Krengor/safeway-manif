/**
 * Logique métier des signalements. Toutes les écritures d'un événement sont sérialisées
 * par un verrou de ligne (SELECT … FOR UPDATE) pour garder des compteurs exacts.
 *
 * Réputation : chaque vote pèse la réputation de son auteur ; les poids sont agrégés
 * (support_weight / against_weight) et le lien votant ↔ signalement ne vit que dans Redis.
 *
 * Note charge (§47, §68) : sur un événement « viral » recevant des milliers de votes/s,
 * ce verrou devient le goulot. Piste V0.3 : compteurs dans Redis + flush asynchrone.
 */
import {
  EVENT_META,
  PROBATION_DAYS,
  PROBATION_WEIGHT,
  REPUTATION_NEUTRAL,
  extendedExpiry,
  shouldWithdraw,
  zoneOf,
  type BusMessage,
  type EventType,
  type PublicEvent,
} from '@safeway/shared';
import type { TransactionSql } from 'postgres';
import type { Sql } from '../db.js';
import { noopBus, type EventBus } from '../lib/bus.js';
import { actorToken } from '../lib/crypto.js';
import { epoch } from '../lib/http.js';
import type { EventSigner } from '../lib/signing.js';
import { noopLinks, type ReputationLinks, type SettledEvent } from './reputation.js';

type Tx = TransactionSql;

interface EventRow {
  id: string;
  type: EventType;
  cell_id: string;
  confirmations: number;
  invalidations: number;
  support_weight: number;
  against_weight: number;
  created_at: Date;
  last_confirmation_at: Date;
  expires_at: Date;
  revision: number;
}

const COLUMNS =
  'id, type, cell_id, confirmations, invalidations, support_weight, against_weight, created_at, last_confirmation_at, expires_at, revision';

const round2 = (x: number) => Math.round(x * 100) / 100;

export function toPublic(row: EventRow): PublicEvent {
  return {
    id: row.id,
    type: row.type,
    cell: row.cell_id,
    conf: row.confirmations,
    inv: row.invalidations,
    supportW: round2(row.support_weight),
    againstW: round2(row.against_weight),
    createdAt: epoch(row.created_at),
    lastConfAt: epoch(row.last_confirmation_at),
    expiresAt: epoch(row.expires_at),
    rev: row.revision,
  };
}

export type Vote = 1 | -1;

/** Micro-cache des lectures de zone : sous forte affluence, des milliers de clients lisent les mêmes zones. */
const ZONE_CACHE_MS = 1000;
const ZONE_CACHE_MAX = 10_000;

export interface EventServiceOptions {
  /** Diffusion temps réel, après validation de la transaction uniquement. */
  bus?: EventBus;
  /** Liens éphémères pour la réputation (Redis). */
  links?: ReputationLinks;
  /** Règlement de la réputation des signalements purgés. */
  onSettled?: (events: SettledEvent[]) => Promise<unknown>;
  /** Signature des signalements publics (vérifiable hors ligne). */
  signer?: EventSigner;
}

export class EventService {
  private readonly bus: EventBus;
  private readonly links: ReputationLinks;
  private readonly onSettled: (events: SettledEvent[]) => Promise<unknown>;
  private readonly signer: EventSigner | null;
  /** zone → lecture récente ou en cours (les requêtes simultanées partagent la même requête SQL). */
  private readonly zoneCache = new Map<string, { at: number; events: Promise<PublicEvent[]> }>();

  constructor(
    private readonly sql: Sql,
    private readonly voteSecret: string,
    options: EventServiceOptions = {},
  ) {
    this.bus = options.bus ?? noopBus;
    this.links = options.links ?? noopLinks;
    this.onSettled = options.onSettled ?? (async () => {});
    this.signer = options.signer ?? null;
  }

  /** Représentation publique, signée si un signataire est configuré. */
  private pub(row: EventRow): PublicEvent {
    const event = toPublic(row);
    return this.signer ? this.signer.sign(event) : event;
  }

  /**
   * Signalements actifs d'une zone. Résultat partagé pendant 1 s entre toutes les requêtes de
   * l'instance (une requête SQL et une signature par zone et par seconde, quel que soit le
   * nombre de lecteurs) ; invalidé aussitôt par toute écriture locale sur la zone.
   */
  listZone(zone: string): Promise<PublicEvent[]> {
    const now = Date.now();
    const cached = this.zoneCache.get(zone);
    if (cached && now - cached.at < ZONE_CACHE_MS) return cached.events;
    if (this.zoneCache.size >= ZONE_CACHE_MAX) this.zoneCache.clear();
    const events = this.listByZones([zone]);
    this.zoneCache.set(zone, { at: now, events });
    events.catch(() => this.zoneCache.delete(zone)); // une erreur n'est jamais mise en cache
    return events;
  }

  /** Après une écriture : invalide le cache local de la zone et diffuse en temps réel. */
  private notify(zone: string, message: BusMessage): void {
    this.zoneCache.delete(zone);
    this.bus.publish(zone, message);
  }

  async listByZones(zones: readonly string[]): Promise<PublicEvent[]> {
    const rows = await this.sql<EventRow[]>`
      SELECT ${this.sql.unsafe(COLUMNS)} FROM events
      WHERE zone_id = ANY(${zones as string[]}) AND expires_at > now()
      LIMIT 5000`;
    return rows.map((row) => this.pub(row));
  }

  async get(id: string): Promise<PublicEvent | null> {
    const [row] = await this.sql<EventRow[]>`
      SELECT ${this.sql.unsafe(COLUMNS)} FROM events WHERE id = ${id} AND expires_at > now()`;
    return row ? this.pub(row) : null;
  }

  /** Un signalement de ce type est-il déjà actif sur la cellule ? (création ou confirmation) */
  async isActive(cell: string, type: EventType): Promise<boolean> {
    const [row] = await this.sql`SELECT 1 FROM events WHERE cell_id = ${cell} AND type = ${type} AND expires_at > now()`;
    return Boolean(row);
  }

  /** Réputation interne d'un compte (jamais exposée) et période probatoire. */
  async standingOf(userId: string): Promise<{ reputation: number; probation: boolean }> {
    return this.standing(this.sql, userId);
  }

  private async standing(db: Sql | Tx, userId: string): Promise<{ reputation: number; probation: boolean }> {
    const [user] = await db<{ reputation_score: number; probation: boolean }[]>`
      SELECT reputation_score, created_at >= current_date - ${PROBATION_DAYS}::int AS probation
      FROM users WHERE id = ${userId}`;
    return { reputation: user?.reputation_score ?? REPUTATION_NEUTRAL, probation: user?.probation ?? false };
  }

  /** Cellule d'un événement actif (pour la vérification de proximité avant un vote). */
  async cellOf(id: string): Promise<string | null> {
    const [row] = await this.sql<{ cell_id: string }[]>`
      SELECT cell_id FROM events WHERE id = ${id} AND expires_at > now()`;
    return row?.cell_id ?? null;
  }

  /**
   * Crée un signalement, ou — si le même type est déjà actif sur la cellule — l'enregistre
   * comme confirmation. L'auteur n'est pas stocké en base : seul son jeton de vote anonyme l'est.
   */
  async report(userId: string, type: EventType, cell: string): Promise<{ event: PublicEvent; created: boolean }> {
    const ttlMinutes = EVENT_META[type].ttlMinutes;
    const result = await this.sql.begin(async (tx) => {
      const weight = await this.weightOf(tx, userId);
      // Un ancien signalement expiré mais pas encore purgé ne doit pas être « ressuscité ».
      await tx`DELETE FROM events WHERE cell_id = ${cell} AND type = ${type} AND expires_at <= now()`;

      const [inserted] = await tx<EventRow[]>`
        INSERT INTO events (zone_id, cell_id, type, expires_at, confirmations, support_weight)
        VALUES (${zoneOf(cell)}, ${cell}, ${type}, now() + make_interval(mins => ${ttlMinutes}), 1, ${weight})
        ON CONFLICT (cell_id, type) DO NOTHING
        RETURNING ${tx.unsafe(COLUMNS)}`;

      if (inserted) {
        await tx`
          INSERT INTO event_votes (event_id, actor_token, vote, weight)
          VALUES (${inserted.id}, ${actorToken(this.voteSecret, userId, inserted.id)}, 1, ${weight})`;
        return { event: this.pub(inserted), created: true };
      }

      const [existing] = await tx<EventRow[]>`
        SELECT ${tx.unsafe(COLUMNS)} FROM events WHERE cell_id = ${cell} AND type = ${type} FOR UPDATE`;
      if (!existing) throw new Error('signalement concurrent introuvable');
      const event = await this.applyVote(tx, existing, userId, 1, weight);
      return { event: event ?? this.pub(existing), created: false };
    });

    if (result.created) this.links.recordAuthor(result.event.id, userId);
    else this.links.recordVote(result.event.id, userId, 1);
    this.notify(zoneOf(cell), { event: result.event });
    return result;
  }

  /** Vote « Toujours vrai » (+1) ou « Plus d'actualité » (-1). Null si l'événement n'existe plus. */
  async vote(userId: string, eventId: string, vote: Vote): Promise<PublicEvent | null> {
    const result = await this.sql.begin(async (tx) => {
      const [row] = await tx<EventRow[]>`
        SELECT ${tx.unsafe(COLUMNS)} FROM events WHERE id = ${eventId} AND expires_at > now() FOR UPDATE`;
      if (!row) return null;
      const weight = await this.weightOf(tx, userId);
      return { cell: row.cell_id, event: await this.applyVote(tx, row, userId, vote, weight) };
    });
    if (!result) return null;
    this.links.recordVote(eventId, userId, vote);
    // Un événement retiré par la communauté est signalé aux clients pour disparaître aussitôt.
    this.notify(zoneOf(result.cell), result.event ? { event: result.event } : { removed: eventId });
    return result.event;
  }

  /** Poids d'un votant = sa réputation courante, plafonnée pendant la période probatoire. */
  private async weightOf(tx: Tx, userId: string): Promise<number> {
    const { reputation, probation } = await this.standing(tx, userId);
    return probation ? Math.min(reputation, PROBATION_WEIGHT) : reputation;
  }

  private async applyVote(tx: Tx, row: EventRow, userId: string, vote: Vote, weight: number): Promise<PublicEvent | null> {
    const token = actorToken(this.voteSecret, userId, row.id);
    const [previous] = await tx<{ vote: number; weight: number }[]>`
      SELECT vote, weight FROM event_votes WHERE event_id = ${row.id} AND actor_token = ${token}`;
    if (previous?.vote === vote) return this.pub(row);

    await tx`
      INSERT INTO event_votes (event_id, actor_token, vote, weight) VALUES (${row.id}, ${token}, ${vote}, ${weight})
      ON CONFLICT (event_id, actor_token) DO UPDATE SET vote = EXCLUDED.vote, weight = EXCLUDED.weight`;

    // Changement d'avis : on retire exactement le poids du vote précédent.
    const prev = previous?.vote ?? 0;
    const prevWeight = previous?.weight ?? 0;
    const conf = row.confirmations + (vote === 1 ? 1 : 0) - (prev === 1 ? 1 : 0);
    const inv = row.invalidations + (vote === -1 ? 1 : 0) - (prev === -1 ? 1 : 0);
    const supportW = Math.max(0, row.support_weight + (vote === 1 ? weight : 0) - (prev === 1 ? prevWeight : 0));
    const againstW = Math.max(0, row.against_weight + (vote === -1 ? weight : 0) - (prev === -1 ? prevWeight : 0));

    const now = Math.floor(Date.now() / 1000);
    let expiresAt = epoch(row.expires_at);
    if (vote === 1) expiresAt = extendedExpiry(row.type, epoch(row.created_at), expiresAt, now);
    if (shouldWithdraw({ conf, inv, supportW, againstW })) expiresAt = now;

    const [updated] = await tx<EventRow[]>`
      UPDATE events SET
        confirmations = ${conf},
        invalidations = ${inv},
        support_weight = ${supportW},
        against_weight = ${againstW},
        last_confirmation_at = CASE WHEN ${vote === 1} THEN now() ELSE last_confirmation_at END,
        expires_at = to_timestamp(${expiresAt}),
        revision = revision + 1
      WHERE id = ${row.id}
      RETURNING ${tx.unsafe(COLUMNS)}`;
    if (!updated) return null;
    return epoch(updated.expires_at) <= now ? null : this.pub(updated);
  }

  /** Liste complète des signalements actifs, pour la modération (données déjà publiques). */
  async listActive(limit = 500): Promise<(PublicEvent & { zone: string })[]> {
    const rows = await this.sql<(EventRow & { zone_id: string })[]>`
      SELECT ${this.sql.unsafe(COLUMNS)}, zone_id FROM events
      WHERE expires_at > now() ORDER BY created_at DESC LIMIT ${limit}`;
    return rows.map((row) => ({ ...this.pub(row), zone: row.zone_id }));
  }

  /** Suppression par la modération : retirée aussitôt chez tous les clients. */
  async remove(id: string): Promise<SettledEvent | null> {
    const [row] = await this.sql<(SettledEvent & { zone_id: string })[]>`
      DELETE FROM events WHERE id = ${id}
      RETURNING id, zone_id, confirmations, invalidations, support_weight, against_weight`;
    if (!row) return null;
    this.notify(row.zone_id, { removed: id });
    return row;
  }

  /**
   * Suppression physique des événements expirés, par lots (§30), puis règlement de la
   * réputation. Le DELETE … RETURNING « réserve » chaque événement : deux instances qui
   * purgent en même temps ne règlent jamais deux fois le même signalement.
   */
  async purgeExpired(batchSize = 5000): Promise<number> {
    let total = 0;
    for (;;) {
      const rows = await this.sql<SettledEvent[]>`
        DELETE FROM events WHERE id IN (
          SELECT id FROM events WHERE expires_at < now() LIMIT ${batchSize}
        )
        RETURNING id, confirmations, invalidations, support_weight, against_weight`;
      total += rows.length;
      if (rows.length) await this.onSettled([...rows]).catch(() => {});
      if (rows.length < batchSize) return total;
    }
  }
}
