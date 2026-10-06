/**
 * Protocole temps réel (cahier §13, §50, §51).
 *
 * - Pas de broadcast global : un client s'abonne aux seules zones H3 (rés. 7) de sa vue.
 * - L'API publie chaque changement sur le canal de sa zone ; les gateways relaient
 *   aux clients abonnés, regroupés par fenêtres de REALTIME_BATCH_MS.
 * - Aucune authentification : les données sont publiques et identiques pour tous.
 *   Le gateway ne connaît donc ni compte ni pseudo, seulement des zones.
 */
import { z } from 'zod';
import type { PublicEvent } from './api.js';
import { MAX_ZONES_PER_REQUEST, isZoneCell } from './geo.js';

export const REALTIME_PATH = '/ws';

/** Fenêtre de regroupement des mises à jour avant envoi (100-500 ms, §51). */
export const REALTIME_BATCH_MS = 250;

/** Canal de bus pour une zone. */
export const zoneChannel = (zone: string): string => `ev:${zone}`;

/** Message publié par l'API sur le bus. */
export type BusMessage = { event: PublicEvent } | { removed: string };

/** Client → gateway : remplace l'ensemble des zones suivies. */
export const clientMessageSchema = z.object({
  t: z.literal('sub'),
  zones: z.array(z.string().max(20).refine(isZoneCell)).max(MAX_ZONES_PER_REQUEST),
});
export type ClientMessage = z.infer<typeof clientMessageSchema>;

/**
 * Gateway → client. Un message `upd` concerne une seule zone : il est sérialisé une fois
 * et envoyé tel quel à tous les abonnés de la zone (fan-out sans re-sérialisation).
 */
export type ServerMessage =
  | { t: 'hello'; batchMs: number }
  | { t: 'upd'; zone: string; events: PublicEvent[]; removed: string[] };
