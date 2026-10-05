/**
 * Evaluation order.
 *
 * Order follows region *position* — top to bottom, then left to
 * right — not order in the file. This is the rule that makes a free-form 2D
 * canvas behave predictably, and it is why `patch` takes `after: "r_042"`
 * rather than coordinates (§5.2).
 *
 * The subtlety is ties. Regions in the same horizontal band evaluate
 * left-to-right, and the obvious implementation — "same y within a tolerance" — is a
 * NON-TRANSITIVE comparator: with a=0, b=6, c=12 and tolerance 8, a~b and b~c
 * but a<c. Feeding that to a sort is undefined behaviour, and it shows up as a
 * sheet that computes differently after an unrelated edit.
 *
 * So bands are quantized instead of compared. `floor(y / bandHeight)` is
 * transitive by construction. The cost is a hard edge: two regions 1px apart
 * can land in different bands. That is predictable and visible, which is worth
 * more here than being clever.
 */

import type { Region, RegionId } from "./region.js";

export const DEFAULT_BAND_HEIGHT = 12;

export interface OrderOptions {
  readonly bandHeight?: number;
}

export function bandOf(y: number, bandHeight: number): number {
  return Math.floor(y / bandHeight);
}

/** Regions in evaluation order. Ties beyond position fall back to id, so the
 * order is total and stable regardless of input order. */
export function evaluationOrder(
  regions: readonly Region[],
  options: OrderOptions = {},
): Region[] {
  const bandHeight = options.bandHeight ?? DEFAULT_BAND_HEIGHT;
  return [...regions].sort((a, b) => {
    const ba = bandOf(a.position.y, bandHeight);
    const bb = bandOf(b.position.y, bandHeight);
    if (ba !== bb) return ba - bb;
    if (a.position.x !== b.position.x) return a.position.x - b.position.x;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

export function orderedIds(
  regions: readonly Region[],
  options: OrderOptions = {},
): RegionId[] {
  return evaluationOrder(regions, options).map((r) => r.id);
}
