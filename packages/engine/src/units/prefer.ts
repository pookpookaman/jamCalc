/**
 * Default display units.
 *
 * A quantity with no display unit chosen still has to be shown as something,
 * and coherent SI is the wrong answer for this audience: `35025.4 kg·s^-2` is
 * a correct rendering of 2.4 klf and communicates nothing. Engineers read
 * `2.4 klf`.
 *
 * This is presentation only — it never touches stored magnitudes, and an
 * explicit display unit on a region always wins. The list is US-customary
 * first because the target discipline is; a metric profile is a different
 * table, not a different mechanism.
 */

import { Dimension, DIM } from "../dimension.js";

/** Ordered: the first dimensional match wins, so put the specific ones first. */
const PREFERRED: ReadonlyArray<readonly [string, Dimension]> = [
  ["kip*ft", DIM.MOMENT],
  ["ksi", DIM.STRESS],
  ["klf", DIM.LINE_LOAD],
  ["kip", DIM.FORCE],
  ["in^4", DIM.SECOND_MOMENT_OF_AREA],
  ["in^3", DIM.VOLUME],
  ["in^2", DIM.AREA],
  ["ft", DIM.LENGTH],
  ["lbm", DIM.MASS],
  ["s", DIM.TIME],
  ["gpm", DIM.FLOW],
  ["hp", DIM.POWER],
];

/** The unit to show a quantity in when the sheet has not chosen one. */
export function preferredUnit(dimension: Dimension): string | undefined {
  if (dimension.isDimensionless) return undefined;
  for (const [name, dim] of PREFERRED) {
    if (dimension.equals(dim)) return name;
  }
  return undefined;
}
