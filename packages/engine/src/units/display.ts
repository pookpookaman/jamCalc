/**
 * Candidate display units, as expressions rather than registry entries.
 *
 * The unit someone wants a result shown in is usually compound: `kip*ft`,
 * `in^4`, `kN*m`. Offering only the single named units in the registry meant a
 * moment could be displayed in joules and nothing else — technically correct,
 * useless on a calc sheet.
 *
 * The list is candidates, not truth: each is parsed and kept only if its
 * dimension matches, so an entry that stops being valid disappears rather than
 * producing a broken menu.
 */

import { Dimension } from "../dimension.js";
import { parseUnit } from "./parse.js";
import { allUnits } from "./registry.js";

/** Compounds worth offering, beyond every single unit in the registry. */
const COMPOUND = [
  // moment / energy
  "kip*ft", "kip*in", "lbf*ft", "lbf*in", "kN*m", "N*m", "N*mm",
  // area
  "in^2", "ft^2", "mm^2", "cm^2", "m^2",
  // volume, and section modulus
  "in^3", "ft^3", "mm^3", "cm^3", "m^3",
  // second moment of area
  "in^4", "mm^4", "cm^4", "m^4",
  // per-length and per-area
  "kip/ft", "kip/in", "lbf/ft", "lbf/in", "kN/m",
  "kip/ft^2", "lbf/ft^2", "lbf/in^2", "kN/m^2",
  // rates and densities
  "lbm/ft^3", "kg/m^3",
  "ft/s", "m/s", "ft/s^2", "m/s^2",
  // stiffness
  "kip/in", "kN/mm",
] as const;

export interface DisplayUnit {
  readonly expression: string;
  /** Scale to coherent SI, used only for ordering. */
  readonly scale: number;
}

let cache: { expression: string; dimension: Dimension; scale: number }[] | null = null;

function candidates(): { expression: string; dimension: Dimension; scale: number }[] {
  if (cache) return cache;
  const seen = new Set<string>();
  const out: { expression: string; dimension: Dimension; scale: number }[] = [];

  const add = (expression: string): void => {
    if (seen.has(expression)) return;
    seen.add(expression);
    try {
      const parsed = parseUnit(expression);
      out.push({ expression, dimension: parsed.dimension, scale: parsed.scale });
    } catch {
      // An expression that no longer parses is dropped rather than offered.
    }
  };

  // Affine units cannot express a difference, so they are not display units.
  for (const u of allUnits()) if (u.offset === undefined) add(u.name);
  for (const c of COMPOUND) add(c);

  cache = out;
  return out;
}

/** Units a value of this dimension can be shown in, largest first. */
export function displayUnitsFor(dimension: Dimension): DisplayUnit[] {
  return candidates()
    .filter((c) => c.dimension.equals(dimension))
    .sort((a, b) => b.scale - a.scale)
    .map((c) => ({ expression: c.expression, scale: c.scale }));
}
