/**
 * Score de confiance et couleur des zones (cahier §5.1, §10, §11).
 *
 * Calculé à partir de compteurs agrégés uniquement : aucun lien vers les votants.
 * La même fonction tourne côté serveur (expiration anticipée) et côté client (affichage),
 * le client peut donc recalculer la fraîcheur sans requête réseau.
 *
 * V0.2 : chaque vote pèse selon la réputation de son auteur (§21). Les poids cumulés
 * (supportW / againstW) sont publics et anonymes ; les nombres de personnes (conf / inv)
 * servent aux seuils qui doivent rester « au moins N personnes distinctes ».
 */
import { EVENT_META, type EventType } from './events.js';

export interface EventCounters {
  type: EventType;
  /** Confirmations, signalement initial inclus (nombre de personnes). */
  conf: number;
  /** Invalidations (« Plus d'actualité »), nombre de personnes. */
  inv: number;
  /** Poids cumulé des confirmations (réputations). Par défaut : `conf`. */
  supportW?: number;
  /** Poids cumulé des invalidations. Par défaut : `inv`. */
  againstW?: number;
  /** Epoch secondes. */
  lastConfAt: number;
  expiresAt: number;
}

type Weights = Pick<EventCounters, 'conf' | 'inv' | 'supportW' | 'againstW'>;
const support = (ev: Weights) => ev.supportW ?? ev.conf;
const against = (ev: Weights) => ev.againstW ?? ev.inv;

/** Au-delà de ce seuil un danger colore la zone en rouge, en dessous en orange. */
export const DANGER_THRESHOLD = 0.35;
/** Seuil pour qu'une info « passage libre » colore la zone en vert. */
export const CLEAR_THRESHOLD = 0.5;

/** Accord communautaire, prior bayésien neutre : 1 confirmation de poids 1 ≈ 0,4. */
function agreement(supportW: number, againstW: number): number {
  return supportW / (supportW + againstW + 1.5);
}

/** Fraîcheur : 1 juste après une confirmation, 0,5 au bout d'une durée de vie complète. */
function freshness(type: EventType, lastConfAt: number, now: number): number {
  const ttl = EVENT_META[type].ttlMinutes * 60;
  const age = Math.max(0, now - lastConfAt);
  return Math.max(0, 1 - 0.5 * Math.min(1, age / ttl));
}

export function computeConfidence(ev: EventCounters, now: number): number {
  if (now >= ev.expiresAt) return 0;
  const score = agreement(support(ev), against(ev)) * freshness(ev.type, ev.lastConfAt, now);
  return Math.round(score * 100) / 100;
}

/** Signalement contesté : poids des invalidations ≥ moitié du poids des confirmations. */
export function isContested(ev: Weights): boolean {
  return ev.inv > 0 && against(ev) * 2 >= support(ev);
}

/**
 * Retrait anticipé : au moins 3 personnes distinctes l'invalident ET leur poids est au
 * moins le double de celui des confirmations. Le serveur le passe alors en expiré.
 */
export function shouldWithdraw(ev: Weights): boolean {
  return ev.inv >= 3 && against(ev) >= support(ev) * 2;
}

export type ZoneStatus = 'green' | 'orange' | 'red' | 'grey';

/** Statut d'une cellule à partir des signalements actifs qu'elle contient. */
export function computeZoneStatus(events: readonly EventCounters[], now: number): ZoneStatus {
  let hasRed = false;
  let hasOrange = false;
  let hasGreen = false;

  for (const ev of events) {
    if (now >= ev.expiresAt) continue;
    const { category } = EVENT_META[ev.type];
    if (category === 'info') continue;
    const confidence = computeConfidence(ev, now);
    const contested = isContested(ev);

    if (category === 'danger') {
      if (confidence >= DANGER_THRESHOLD && !contested) hasRed = true;
      else hasOrange = true;
    } else if (category === 'caution') {
      hasOrange = true;
    } else if (category === 'clear') {
      if (confidence >= CLEAR_THRESHOLD && !contested) hasGreen = true;
      else hasOrange = true;
    }
  }

  // Le danger l'emporte toujours : un passage libre contredit par un danger n'est pas vert.
  if (hasRed) return 'red';
  if (hasOrange) return 'orange';
  if (hasGreen) return 'green';
  return 'grey';
}

/** Nouvelle date d'expiration après une confirmation : prolongation légère et plafonnée (§11). */
export function extendedExpiry(type: EventType, createdAt: number, currentExpiry: number, now: number): number {
  const ttl = EVENT_META[type].ttlMinutes * 60;
  const target = Math.min(now + ttl / 2, createdAt + ttl * 2);
  return Math.max(currentExpiry, Math.round(target));
}
