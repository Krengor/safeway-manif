/**
 * Contrat d'API V1 (cahier §32). Schémas validés côté serveur ; types réutilisés par le client.
 *
 * Remarque privacy : aucun schéma n'accepte de latitude/longitude. Le client envoie
 * uniquement des cellules H3 (§14 « Préférer POST /presence-proof { area_token } »).
 */
import { z } from 'zod';
import { EVENT_TYPES } from './events.js';
import { isEventCell } from './geo.js';
import type { DegradationLevel } from './load.js';
import { powSolutionSchema } from './pow.js';

export const API_PREFIX = '/api';

/** En-tête exigé sur toute requête d'écriture (défense CSRF en plus de SameSite=Strict). */
export const CSRF_HEADER = 'x-safeway';

export const eventCellSchema = z.string().max(20).refine(isEventCell, 'cellule H3 invalide');

export const pseudoSchema = z
  .string()
  .trim()
  .min(3)
  .max(24)
  .regex(/^[A-Za-z0-9_-]+$/, 'lettres, chiffres, - et _ uniquement');

export const createEventSchema = z.object({
  type: z.enum(EVENT_TYPES),
  /** Cellule visée par le signalement. */
  cell: eventCellSchema,
  /**
   * Preuve de proximité V1 (§15) : cellule de l'utilisateur, calculée sur l'appareil.
   * Vérifiée puis immédiatement oubliée — jamais stockée ni journalisée.
   */
  presenceCell: eventCellSchema,
});
export type CreateEventBody = z.infer<typeof createEventSchema>;

export const voteSchema = z.object({
  presenceCell: eventCellSchema,
});
export type VoteBody = z.infer<typeof voteSchema>;

export const registerOptionsSchema = z.object({ pseudo: pseudoSchema, pow: powSolutionSchema });
export const updatePseudoSchema = z.object({ pseudo: pseudoSchema });

/** Représentation publique d'un signalement. Aucune donnée sur l'auteur ni les votants. */
export interface PublicEvent {
  id: string;
  type: (typeof EVENT_TYPES)[number];
  cell: string;
  conf: number;
  inv: number;
  /** Poids cumulés (réputations) des confirmations / invalidations — anonymes. */
  supportW: number;
  againstW: number;
  /** Epoch secondes. */
  createdAt: number;
  lastConfAt: number;
  expiresAt: number;
  /** Révision croissante : en cas de versions concurrentes (cache, temps réel), la plus haute gagne. */
  rev: number;
  /** Signature Ed25519 du serveur (base64url), vérifiable hors ligne. */
  sig?: string;
  /**
   * Côté client uniquement : signalement reçu hors réseau sans signature valide (par ex. fait
   * hors ligne par un autre téléphone). Jamais affiché en rouge.
   */
  unverified?: true;
}

export interface ZoneEventsResponse {
  /** Heure serveur (epoch s) pour corriger la dérive d'horloge du client. */
  now: number;
  zones: string[];
  events: PublicEvent[];
}

export interface MapStatusResponse {
  now: number;
  /** Niveau de dégradation contrôlée (§56) ; le client en déduit sa politique (`degradationPolicy`). */
  level: DegradationLevel;
}

export interface MeResponse {
  pseudo: string;
  /** Présent et vrai uniquement pour l'administrateur. */
  admin?: true;
}

// --- Modération (§22) ----------------------------------------------------------------
// Ce que l'administrateur voit est volontairement limité (§34) : aucune position, aucune IP,
// aucun lien auteur ↔ signalement (il n'existe pas en base), réputation par tranche seulement.

export const accountActionSchema = z.object({ pseudo: pseudoSchema });

export interface AdminOverview {
  now: number;
  activeEvents: number;
  byType: Partial<Record<(typeof EVENT_TYPES)[number], number>>;
  activeZones: number;
  /** Zones (H3 rés. 7) les plus actives — données déjà publiques. */
  topZones: { zone: string; events: number }[];
  accounts: number;
  suspended: number;
  lowReliability: number;
  /** Zones recevant un nombre inhabituel de NOUVEAUX signalements (fenêtre de 5 min). */
  surges: { zone: string; newEvents: number }[];
  load: AdminLoadStatus;
}

/** État de la dégradation contrôlée (§56) vu par l'administrateur. */
export interface AdminLoadStatus {
  /** Niveau appliqué. */
  level: DegradationLevel;
  /** Niveau mesuré automatiquement (pire instance). */
  auto: DegradationLevel;
  /** Fin du forçage manuel (epoch s), absent si le niveau est automatique. */
  forcedUntil?: number;
}

/** Forcer un niveau pendant `minutes`, ou revenir à l'automatique (`level: null`). */
export const adminLoadSchema = z.object({
  level: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]).nullable(),
  minutes: z.number().int().min(1).max(240).default(60),
});

export interface AdminEventsResponse {
  events: (PublicEvent & { zone: string })[];
}

export type Reliability = 'faible' | 'très faible';

export interface AdminAccount {
  pseudo: string;
  reliability: Reliability;
  suspended: boolean;
}

export interface AdminAccountsResponse {
  accounts: AdminAccount[];
}

export interface VoteResponse {
  event: PublicEvent | null;
}

export interface ApiError {
  error: string;
  message?: string;
}
