/**
 * Découpage de polylignes par un polygone convexe (algorithme de Cyrus–Beck).
 * Les hexagones H3 sont convexes ; à l'échelle d'une cellule (~100 m) on peut
 * travailler directement en lng/lat sans projection.
 */
export type Point = [number, number];

export interface BBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function bboxOf(points: readonly Point[]): BBox {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of points) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY };
}

export function bboxIntersects(a: BBox, b: BBox): boolean {
  return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
}

/** Prépare les demi-plans du polygone ; f(p) ≥ 0 ⇔ p du côté intérieur de l'arête. */
function halfPlanes(polygon: readonly Point[]) {
  const n = polygon.length;
  let cx = 0;
  let cy = 0;
  for (const [x, y] of polygon) {
    cx += x / n;
    cy += y / n;
  }
  return polygon.map((p, i) => {
    const q = polygon[(i + 1) % n]!;
    const ex = q[0] - p[0];
    const ey = q[1] - p[1];
    const side = Math.sign(ex * (cy - p[1]) - ey * (cx - p[0])) || 1;
    return (pt: Point) => side * (ex * (pt[1] - p[1]) - ey * (pt[0] - p[0]));
  });
}

function clipSegment(a: Point, b: Point, planes: ReturnType<typeof halfPlanes>): [Point, Point] | null {
  let tIn = 0;
  let tOut = 1;
  for (const f of planes) {
    const fa = f(a);
    const fb = f(b);
    if (fa < 0 && fb < 0) return null;
    if (fa >= 0 && fb >= 0) continue;
    const t = fa / (fa - fb);
    if (fa < 0) tIn = Math.max(tIn, t);
    else tOut = Math.min(tOut, t);
    if (tIn > tOut) return null;
  }
  const at = (t: number): Point => [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
  return [tIn === 0 ? a : at(tIn), tOut === 1 ? b : at(tOut)];
}

/** Retourne les morceaux de `line` situés à l'intérieur de `polygon` (convexe). */
export function clipLineToConvex(line: readonly Point[], polygon: readonly Point[]): Point[][] {
  const planes = halfPlanes(polygon);
  const parts: Point[][] = [];
  let current: Point[] | null = null;
  for (let i = 0; i < line.length - 1; i++) {
    const clipped = clipSegment(line[i]!, line[i + 1]!, planes);
    if (!clipped) {
      current = null;
      continue;
    }
    const [s, e] = clipped;
    const last = current?.[current.length - 1];
    if (current && last && last[0] === s[0] && last[1] === s[1]) {
      current.push(e);
    } else {
      current = [s, e];
      parts.push(current);
    }
    // Si le segment sort du polygone, le morceau suivant devra recommencer.
    if (e !== line[i + 1]) current = null;
  }
  return parts;
}
