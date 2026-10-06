import { describe, expect, it } from 'vitest';
import { clipLineToConvex, type Point } from './clip';

const square: Point[] = [
  [0, 0],
  [1, 0],
  [1, 1],
  [0, 1],
];

describe('clipLineToConvex', () => {
  it('garde une ligne entièrement intérieure', () => {
    const line: Point[] = [
      [0.2, 0.2],
      [0.5, 0.5],
      [0.8, 0.2],
    ];
    expect(clipLineToConvex(line, square)).toEqual([line]);
  });

  it('coupe une ligne qui traverse', () => {
    const parts = clipLineToConvex(
      [
        [-1, 0.5],
        [2, 0.5],
      ],
      square,
    );
    expect(parts).toHaveLength(1);
    expect(parts[0]![0]![0]).toBeCloseTo(0);
    expect(parts[0]![1]![0]).toBeCloseTo(1);
  });

  it('ignore une ligne extérieure', () => {
    expect(
      clipLineToConvex(
        [
          [2, 2],
          [3, 3],
        ],
        square,
      ),
    ).toEqual([]);
  });

  it('produit deux morceaux pour une ligne qui sort puis rentre', () => {
    const parts = clipLineToConvex(
      [
        [0.5, 0.5],
        [0.5, 2],
        [0.7, 2],
        [0.7, 0.5],
      ],
      square,
    );
    expect(parts).toHaveLength(2);
  });

  it('fonctionne quel que soit le sens du polygone', () => {
    const reversed = [...square].reverse();
    expect(
      clipLineToConvex(
        [
          [0.2, 0.2],
          [0.4, 0.4],
        ],
        reversed,
      ),
    ).toHaveLength(1);
  });
});
