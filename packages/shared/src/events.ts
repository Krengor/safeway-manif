/**
 * Catalogue des signalements (cahier §6, §11, §24).
 *
 * Un signalement décrit l'état d'une ZONE (cellule H3), jamais une personne.
 * Pas de champ texte libre : uniquement un type parmi cette liste fermée.
 */

export const EVENT_TYPES = [
  'PASSAGE_LIBRE',
  'PASSAGE_BLOQUE',
  'FOULE_DENSE',
  'MOUVEMENT_FOULE',
  'GAZ_FUMEE',
  'INCENDIE',
  'DEBRIS',
  'VEHICULE_BLOQUANT',
  'VIOLENCE_EN_COURS',
  'INTERVENTION_EN_COURS',
  'SECOURS_PRESENT',
  'SORTIE_ACCESSIBLE',
  'DANGER_AUTRE',
] as const;

export type EventType = (typeof EVENT_TYPES)[number];

/**
 * Effet d'un type sur la couleur des rues :
 * - clear   : rend la zone verte si l'info est fiable ;
 * - danger  : rend la zone rouge si l'info est fiable (orange sinon) ;
 * - caution : rend la zone orange ;
 * - info    : n'influence pas la couleur (marqueur seul).
 */
export type EventCategory = 'clear' | 'danger' | 'caution' | 'info';

export interface EventTypeMeta {
  label: string;
  /** Libellé court affiché sur la carte. */
  short: string;
  icon: string;
  category: EventCategory;
  /** Durée de vie initiale (minutes). */
  ttlMinutes: number;
  /** Proposé dans la grille rapide de signalement (§24). */
  quick: boolean;
}

export const EVENT_META: Record<EventType, EventTypeMeta> = {
  PASSAGE_LIBRE: { label: 'Passage libre', short: 'Libre', icon: '🟢', category: 'clear', ttlMinutes: 10, quick: true },
  PASSAGE_BLOQUE: { label: 'Passage bloqué', short: 'Bloqué', icon: '⛔', category: 'danger', ttlMinutes: 15, quick: true },
  FOULE_DENSE: { label: 'Foule dense', short: 'Foule', icon: '👥', category: 'caution', ttlMinutes: 10, quick: true },
  MOUVEMENT_FOULE: { label: 'Mouvement de foule', short: 'Mvt foule', icon: '🌊', category: 'danger', ttlMinutes: 10, quick: false },
  GAZ_FUMEE: { label: 'Gaz / fumée', short: 'Gaz', icon: '💨', category: 'danger', ttlMinutes: 15, quick: true },
  INCENDIE: { label: 'Incendie', short: 'Feu', icon: '🔥', category: 'danger', ttlMinutes: 20, quick: true },
  DEBRIS: { label: 'Débris / obstacle', short: 'Débris', icon: '🧱', category: 'caution', ttlMinutes: 30, quick: false },
  VEHICULE_BLOQUANT: { label: 'Véhicule bloquant', short: 'Véhicule', icon: '🚧', category: 'danger', ttlMinutes: 20, quick: false },
  VIOLENCE_EN_COURS: { label: 'Violence en cours', short: 'Violence', icon: '⚠️', category: 'danger', ttlMinutes: 10, quick: false },
  // Formulation volontairement agrégée et orientée sécurité (§6) : aucune donnée sur des agents.
  INTERVENTION_EN_COURS: { label: 'Intervention en cours — passage déconseillé', short: 'Intervention', icon: '🚨', category: 'danger', ttlMinutes: 10, quick: false },
  SECOURS_PRESENT: { label: 'Secours présents', short: 'Secours', icon: '🚑', category: 'info', ttlMinutes: 15, quick: true },
  SORTIE_ACCESSIBLE: { label: 'Sortie accessible', short: 'Sortie', icon: '↗️', category: 'clear', ttlMinutes: 15, quick: true },
  DANGER_AUTRE: { label: 'Autre danger', short: 'Danger', icon: '❗', category: 'caution', ttlMinutes: 15, quick: true },
};

export function isEventType(value: unknown): value is EventType {
  return typeof value === 'string' && (EVENT_TYPES as readonly string[]).includes(value);
}
