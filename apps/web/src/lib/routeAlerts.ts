/**
 * Alertes sur trajet (§1, V0.2) — calcul 100 % local.
 *
 * Le trajet n'est jamais renvoyé au serveur pour être « suivi » : l'appareil compare
 * les cellules de son propre trajet aux signalements publics qu'il reçoit déjà.
 */
import type { ZoneStatus } from '@safeway/shared';

/**
 * Cellules du trajet devenues dangereuses et pas encore signalées à l'utilisateur
 * (ni connues au moment du calcul, ni déjà alertées).
 */
export function newDangersOnRoute(
  routeCells: readonly string[],
  statusByCell: ReadonlyMap<string, ZoneStatus>,
  alreadyKnown: ReadonlySet<string>,
): string[] {
  return routeCells.filter((cell) => statusByCell.get(cell) === 'red' && !alreadyKnown.has(cell));
}
