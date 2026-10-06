/**
 * Contrat d'API V1 (cahier §32). Schémas validés côté serveur ; types réutilisés par le client.
 *
 * Remarque privacy : aucun schéma n'accepte de latitude/longitude. Le client envoie
 * uniquement des cellules H3 (§14 « Préférer POST /presence-proof { area_token } »).
 */
import { z } from 'zod';
import { EVENT_TYPES } from './events.js';
import { isEventCell } from './geo.js';

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

export const registerOptionsSchema = z.object({ pseudo: pseudoSchema });
export const updatePseudoSchema = z.object({ pseudo: pseudoSchema });

/** Représentation publique d'un signalement. Aucune donnée sur l'auteur ni les votants. */
export interface PublicEvent {
  id: string;
  type: (typeof EVENT_TYPES)[number];
  cell: string;
  conf: number;
  inv: number;
  /** Epoch secondes. */
  createdAt: number;
  lastConfAt: number;
  expiresAt: number;
}

export interface ZoneEventsResponse {
  /** Heure serveur (epoch s) pour corriger la dérive d'horloge du client. */
  now: number;
  zones: string[];
  events: PublicEvent[];
}

export type DegradationLevel = 0 | 1 | 2 | 3;

export interface MapStatusResponse {
  now: number;
  /** Niveau de dégradation contrôlée (§56). */
  level: DegradationLevel;
  /** Intervalle de rafraîchissement conseillé au client (s). */
  refreshSeconds: number;
}

export interface MeResponse {
  pseudo: string;
}

export interface VoteResponse {
  event: PublicEvent | null;
}

export interface ApiError {
  error: string;
  message?: string;
}
