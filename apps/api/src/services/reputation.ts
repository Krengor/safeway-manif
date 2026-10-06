/**
 * Réputation (cahier §21) — voir packages/shared/src/reputation.ts pour les règles.
 *
 * Le lien « qui a signalé / voté quoi » est indispensable pour créditer ou pénaliser,
 * mais il ne doit pas survivre au signalement : il vit dans Redis, avec TTL, et il est
 * détruit au moment du règlement. PostgreSQL ne contient jamais ce lien.
 */
import {
  REPUTATION_HOURLY_DECAY,
  REPUTATION_MAX,
  REPUTATION_MIN,
  eventOutcome,
  reputationDelta,
} from '@safeway/shared';
import type { Redis } from 'ioredis';
import type { Sql } from '../db.js';

/** Au-delà de la durée de vie maximale d'un signalement (2 × 30 min) : marge confortable. */
const LINK_TTL_SECONDS = 3 * 3600;

const authorKey = (eventId: string) => `rep:a:${eventId}`;
const votesKey = (eventId: string) => `rep:v:${eventId}`;

export interface EventParticipants {
  author: string | null;
  votes: Map<string, 1 | -1>;
}

export interface ReputationLinks {
  recordAuthor(eventId: string, userId: string): void;
  recordVote(eventId: string, userId: string, vote: 1 | -1): void;
  /** Lit puis détruit les liens d'un signalement. */
  take(eventId: string): Promise<EventParticipants>;
}

export const noopLinks: ReputationLinks = {
  recordAuthor: () => {},
  recordVote: () => {},
  take: async () => ({ author: null, votes: new Map() }),
};

export class RedisReputationLinks implements ReputationLinks {
  constructor(private readonly redis: Redis) {}

  // Écritures « fire and forget » : sans Redis, la réputation ne bouge simplement pas.
  recordAuthor(eventId: string, userId: string): void {
    this.redis.set(authorKey(eventId), userId, 'EX', LINK_TTL_SECONDS, 'NX').catch(() => {});
  }

  recordVote(eventId: string, userId: string, vote: 1 | -1): void {
    this.redis
      .multi()
      .hset(votesKey(eventId), userId, String(vote))
      .expire(votesKey(eventId), LINK_TTL_SECONDS)
      .exec()
      .catch(() => {});
  }

  async take(eventId: string): Promise<EventParticipants> {
    const results = await this.redis
      .multi()
      .get(authorKey(eventId))
      .hgetall(votesKey(eventId))
      .del(authorKey(eventId), votesKey(eventId))
      .exec();
    const author = (results?.[0]?.[1] as string | null) ?? null;
    const raw = (results?.[1]?.[1] as Record<string, string> | null) ?? {};
    const votes = new Map<string, 1 | -1>();
    for (const [userId, vote] of Object.entries(raw)) {
      if (userId !== author) votes.set(userId, vote === '1' ? 1 : -1);
    }
    return { author, votes };
  }
}

export interface SettledEvent {
  id: string;
  confirmations: number;
  invalidations: number;
  support_weight: number;
  against_weight: number;
}

export class ReputationService {
  constructor(
    private readonly sql: Sql,
    private readonly links: ReputationLinks,
    private readonly redis: Redis | null = null,
  ) {}

  /** Règle des signalements arrivés à terme : crédits/pénalités, puis destruction des liens. */
  async settle(events: readonly SettledEvent[]): Promise<number> {
    const deltas = new Map<string, number>();
    const add = (userId: string, delta: number) => {
      if (delta !== 0) deltas.set(userId, (deltas.get(userId) ?? 0) + delta);
    };

    for (const ev of events) {
      let participants: EventParticipants;
      try {
        participants = await this.links.take(ev.id);
      } catch {
        continue; // Redis indisponible : pas de réputation pour ce signalement.
      }
      const outcome = eventOutcome({
        conf: ev.confirmations,
        inv: ev.invalidations,
        supportW: ev.support_weight,
        againstW: ev.against_weight,
      });
      if (outcome === 'neutral') continue;
      if (participants.author) add(participants.author, reputationDelta('author', outcome));
      for (const [userId, vote] of participants.votes) {
        add(userId, reputationDelta(vote === 1 ? 'confirmer' : 'invalidator', outcome));
      }
    }

    if (deltas.size === 0) return 0;
    const ids = [...deltas.keys()];
    const values = ids.map((id) => deltas.get(id)!);
    const result = await this.sql`
      UPDATE users AS u
      SET reputation_score = LEAST(${REPUTATION_MAX}, GREATEST(${REPUTATION_MIN}, u.reputation_score + d.delta))
      FROM unnest(${ids}::uuid[], ${values}::real[]) AS d(id, delta)
      WHERE u.id = d.id`;
    return result.count;
  }

  /**
   * Retour vers la neutralité, une fois par heure pour tout le cluster (verrou Redis).
   * Les écarts résiduels minimes sont remis exactement à 1 : aucune trace d'activité ancienne.
   */
  async decayIfDue(now = new Date()): Promise<boolean> {
    if (!this.redis) return false;
    const hourKey = `rep:decay:${now.toISOString().slice(0, 13)}`;
    let acquired: string | null;
    try {
      acquired = await this.redis.set(hourKey, '1', 'EX', 7200, 'NX');
    } catch {
      return false;
    }
    if (acquired !== 'OK') return false;
    await this.decay();
    return true;
  }

  async decay(): Promise<void> {
    await this.sql`
      UPDATE users SET reputation_score = CASE
        WHEN abs(reputation_score - 1) * ${REPUTATION_HOURLY_DECAY} < 0.01 THEN 1
        ELSE 1 + (reputation_score - 1) * ${REPUTATION_HOURLY_DECAY}
      END
      WHERE reputation_score <> 1`;
  }
}
