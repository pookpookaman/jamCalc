/**
 * Lining a region up with the ones already on the page.
 *
 * Dragging to a position that only looks aligned is how a sheet ends up with
 * eight equations at eight slightly different left edges, which reads as
 * carelessness on paper. So while a region is moved, its edges are compared
 * with every other region's: the nearest match within a few pixels wins, the
 * region lands exactly there, and a line says what it lined up with.
 *
 * The decision is here rather than in the component because it is arithmetic
 * with an answer that can be checked.
 */

export interface Box {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** A line to draw, in the same coordinates as the boxes. */
export interface Guide {
  /** `x` is a vertical line at `at`; `y` is a horizontal one. */
  readonly axis: "x" | "y";
  readonly at: number;
  /** The line spans this range along the other axis. */
  readonly from: number;
  readonly to: number;
}

export interface SnapResult {
  readonly x: number;
  readonly y: number;
  readonly guides: readonly Guide[];
}

/**
 * How close an edge has to be before it snaps.
 *
 * Wide enough to catch what was meant, narrow enough that a position chosen
 * deliberately between two others is left alone.
 */
export const SNAP_TOLERANCE = 6;

/** Left, centre, right — or top, middle, bottom. */
const edgesX = (b: Box): number[] => [b.x, b.x + b.w / 2, b.x + b.w];
const edgesY = (b: Box): number[] => [b.y, b.y + b.h / 2, b.y + b.h];

interface Best {
  readonly delta: number;
  readonly at: number;
}

/**
 * Like with like: left to left, centre to centre, right to right.
 *
 * Comparing every edge with every other edge looks more helpful and is not.
 * A region whose right edge happens to fall a pixel from its neighbour's left
 * edge is not aligned with anything — the two are merely adjacent — and
 * snapping there moves the region away from the left edge it was being lined
 * up with. Found by dragging: a box aimed at x = 48 landed on 52.
 */
function nearest(
  moving: readonly number[],
  others: readonly Box[],
  edgesOf: (b: Box) => number[],
  tolerance: number,
  which: readonly number[],
): Best | null {
  let best: Best | null = null;
  for (const other of others) {
    const targets = edgesOf(other);
    for (const i of which) {
      const target = targets[i] as number;
      const delta = target - (moving[i] as number);
      if (Math.abs(delta) > tolerance) continue;
      // A tie goes to the first found, which is the earlier region: with two
      // equally close candidates the choice must not depend on drag order.
      if (best === null || Math.abs(delta) < Math.abs(best.delta)) {
        best = { delta, at: target };
      }
    }
  }
  return best;
}

/**
 * An edge beats a centre, however close the centre is.
 *
 * A sheet is columns of boxes with a shared left edge and every width under
 * the sun. Nearest-wins put a box on its neighbour's centre line because that
 * happened to be a pixel nearer than the left edge it was being dragged to,
 * which is not what anyone is doing when they line up a column. Centres still
 * catch when no edge is in range, which is what lines something up with the
 * middle of the page.
 */
function bestOffset(
  moving: readonly number[],
  others: readonly Box[],
  edgesOf: (b: Box) => number[],
  tolerance: number,
): Best | null {
  return (
    nearest(moving, others, edgesOf, tolerance, [0, 2]) ??
    nearest(moving, others, edgesOf, tolerance, [1])
  );
}

/** Every box whose edge sits exactly on `at`, once the move is applied. */
function touching(
  others: readonly Box[],
  at: number,
  edgesOf: (b: Box) => number[],
): Box[] {
  return others.filter((b) => edgesOf(b).some((e) => Math.abs(e - at) < 0.5));
}

/**
 * Where a dragged box should land, and the lines that say why.
 *
 * `others` are the boxes it can line up with — the rest of the page, and the
 * content area itself, so that lining up with the margin or the centre of the
 * page works the same way as lining up with a neighbour.
 */
export function alignSnap(
  moving: Box,
  others: readonly Box[],
  tolerance: number = SNAP_TOLERANCE,
): SnapResult {
  const guides: Guide[] = [];

  const x = bestOffset(edgesX(moving), others, edgesX, tolerance);
  const y = bestOffset(edgesY(moving), others, edgesY, tolerance);

  const moved: Box = {
    ...moving,
    x: moving.x + (x?.delta ?? 0),
    y: moving.y + (y?.delta ?? 0),
  };

  if (x) {
    const span = [moved, ...touching(others, x.at, edgesX)];
    guides.push({
      axis: "x",
      at: x.at,
      from: Math.min(...span.map((b) => b.y)),
      to: Math.max(...span.map((b) => b.y + b.h)),
    });
  }
  if (y) {
    const span = [moved, ...touching(others, y.at, edgesY)];
    guides.push({
      axis: "y",
      at: y.at,
      from: Math.min(...span.map((b) => b.x)),
      to: Math.max(...span.map((b) => b.x + b.w)),
    });
  }

  return { x: moved.x, y: moved.y, guides };
}
