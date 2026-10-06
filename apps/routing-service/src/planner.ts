/**
 * Choix de l'itinéraire (§12) : on calcule en parallèle jusqu'à trois variantes puis on
 * retient la plus prudente qui reste raisonnable par rapport au trajet direct.
 *
 *   avoid-all    : évite zones dangereuses ET incertaines, si ≤ 1,5 × le direct ;
 *   avoid-danger : évite les zones dangereuses,             si ≤ 3 × le direct ;
 *   direct       : sinon (le risque est alors signalé explicitement).
 *
 * Les cellules contenant le départ ou l'arrivée ne sont jamais exclues : sinon aucun
 * chemin n'existerait. Elles sont en revanche comptées dans les zones traversées.
 */
import {
  EVENT_RES,
  routeCells,
  type RouteResponse,
  type RouteRisk,
  type RouteStrategy,
} from '@safeway/shared';
import { cellsToMultiPolygon, latLngToCell } from 'h3-js';
import type { HazardMap } from './hazards.js';
import type { EngineRoute, RouteEngine } from './valhalla.js';

export const AVOID_ALL_MAX_RATIO = 1.5;
export const AVOID_DANGER_MAX_RATIO = 3;

/** Anneaux extérieurs ([lng, lat]) couvrant un ensemble de cellules, fusionnées. */
export function exclusionRings(cells: Iterable<string>): [number, number][][] {
  const list = [...cells];
  if (list.length === 0) return [];
  return cellsToMultiPolygon(list, true).map((polygon) => polygon[0] as [number, number][]);
}

export class NoRouteError extends Error {}

export async function planRoute(
  engine: RouteEngine,
  hazards: HazardMap,
  from: [number, number],
  to: [number, number],
): Promise<RouteResponse> {
  const endpoints = new Set([latLngToCell(from[1], from[0], EVENT_RES), latLngToCell(to[1], to[0], EVENT_RES)]);
  const avoidable = (cells: Set<string>) => [...cells].filter((c) => !endpoints.has(c));
  const danger = avoidable(hazards.danger);
  const uncertain = avoidable(hazards.uncertain);

  const [direct, avoidDanger, avoidAll] = await Promise.all([
    engine.route(from, to, []),
    danger.length ? engine.route(from, to, exclusionRings(danger)) : Promise.resolve(undefined),
    uncertain.length ? engine.route(from, to, exclusionRings([...danger, ...uncertain])) : Promise.resolve(undefined),
  ]);
  if (!direct) throw new NoRouteError('aucun chemin piéton');

  const within = (route: EngineRoute | null | undefined, ratio: number): route is EngineRoute =>
    !!route && route.distanceM <= direct.distanceM * ratio;

  let chosen: EngineRoute = direct;
  let strategy: RouteStrategy = 'direct';
  if (within(avoidAll, AVOID_ALL_MAX_RATIO)) {
    chosen = avoidAll;
    strategy = 'avoid-all';
  } else if (within(avoidDanger, AVOID_DANGER_MAX_RATIO)) {
    chosen = avoidDanger;
    strategy = 'avoid-danger';
  }
  // Sans aucune zone signalée, le direct est le seul calcul : on garde l'étiquette « direct ».

  const crossed = (route: EngineRoute) => {
    const cells = routeCells(route.shape);
    return {
      danger: cells.filter((c) => hazards.danger.has(c)),
      uncertain: cells.filter((c) => hazards.uncertain.has(c)),
    };
  };
  const crossing = crossed(chosen);
  const directCrossing = crossed(direct);

  const risk: RouteRisk = crossing.danger.length ? 'danger' : crossing.uncertain.length ? 'uncertain' : 'clear';

  return {
    shape: chosen.shape,
    distanceM: chosen.distanceM,
    durationS: chosen.durationS,
    strategy,
    risk,
    avoided: {
      danger: Math.max(0, directCrossing.danger.length - crossing.danger.length),
      uncertain: Math.max(0, directCrossing.uncertain.length - crossing.uncertain.length),
    },
    crossing,
    hazardsKnown: hazards.complete,
  };
}
