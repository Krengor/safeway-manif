import type { ZoneStatus } from '@safeway/shared';
import { describe, expect, it } from 'vitest';
import { newDangersOnRoute } from './routeAlerts';

const statuses = (entries: [string, ZoneStatus][]) => new Map(entries);

describe('newDangersOnRoute', () => {
  it('détecte une zone rouge apparue sur le trajet', () => {
    expect(newDangersOnRoute(['a', 'b', 'c'], statuses([['b', 'red']]), new Set())).toEqual(['b']);
  });

  it('ignore les dangers déjà connus ou déjà alertés', () => {
    expect(newDangersOnRoute(['a', 'b'], statuses([['b', 'red']]), new Set(['b']))).toEqual([]);
  });

  it('ignore les zones hors trajet et les zones non rouges', () => {
    expect(
      newDangersOnRoute(
        ['a', 'b'],
        statuses([
          ['a', 'orange'],
          ['z', 'red'],
        ]),
        new Set(),
      ),
    ).toEqual([]);
  });
});
