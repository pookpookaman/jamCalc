/**
 * Which unit a value is shown in when it is listed rather than placed on the
 * sheet — the values panel, and anything else that shows a name's value
 * outside the region that defines it.
 *
 * On the sheet a result shows in the unit its region asks for, or the
 * discipline default (`prefer.ts`). A list has no region to ask, and the
 * discipline default alone read badly there: 65 psf listed as 0.000451 ksi, a
 * 17.7 in depth as 1.475 ft. So a listed value is shown, in order of
 * preference, in:
 *
 *   1. the unit the user chose for it in the list, when it fits;
 *   2. the unit its definition asks for (`= kip*ft`) or was written in
 *      (`65 psf`) — what the engineer typed is what they think in;
 *   3. a unit that suits its size (`readableUnit`).
 *
 * Presentation only: nothing here changes a stored or computed magnitude.
 */

import type { Expr } from "../ast.js";
import { isMatrix, type Value } from "../value.js";
import type { MatrixValue } from "../matrix.js";
import type { Quantity } from "../quantity.js";
import { DIM, type Dimension } from "../dimension.js";
import { parseStatement } from "../parser.js";
import { parseUnit, valueIn } from "../units/parse.js";
import { preferredUnit } from "../units/prefer.js";
import { formatNumber, type NumberFormat } from "./format.js";
import type { ResultParts } from "./projection.js";

/**
 * Families of units for a dimension, largest first. A value takes the first
 * in which it is at least 1, so a stress reads 36 ksi, 150 psi or 65 psf as
 * suits it, rather than every stress in ksi.
 */
const FAMILIES: ReadonlyArray<readonly [Dimension, readonly string[]]> = [
  [DIM.STRESS, ["ksi", "psi", "psf"]],
  [DIM.LINE_LOAD, ["klf", "plf"]],
  [DIM.FORCE, ["kip", "lbf"]],
  [DIM.MOMENT, ["kip*ft", "kip*in", "lbf*ft"]],
  [DIM.LENGTH, ["ft", "in"]],
  [DIM.AREA, ["ft^2", "in^2"]],
  [DIM.VOLUME, ["ft^3", "in^3"]],
  [DIM.SECOND_MOMENT_OF_AREA, ["ft^4", "in^4"]],
];

/** A unit that suits a quantity's size, or the discipline default. */
export function readableUnit(q: Quantity): string | undefined {
  if (q.dimension.isDimensionless) return undefined;
  const family = FAMILIES.find(([dim]) => dim.equals(q.dimension))?.[1];
  if (!family) return preferredUnit(q.dimension);
  if (q.si === 0 || !Number.isFinite(q.si)) return family[0];
  for (const unit of family) {
    if (Math.abs(valueIn(q, unit)) >= 1) return unit;
  }
  return family[family.length - 1];
}

/** Whether `unit` parses and is a unit of `dimension`. */
export function unitFits(unit: string, dimension: Dimension): boolean {
  try {
    return parseUnit(unit).dimension.equals(dimension);
  } catch {
    return false;
  }
}

const literalUnit = (e: Expr): string | undefined => {
  if (e.kind === "number") return e.unit;
  if (e.kind === "unary") return literalUnit(e.operand);
  if (e.kind === "matrix") {
    const units = e.rows.flat().map(literalUnit);
    const first = units[0];
    return first !== undefined && units.every((u) => u === first) ? first : undefined;
  }
  return undefined;
};

/**
 * The unit a region's definition asks for, or was written in: `= kip*ft` if
 * it has one, otherwise the unit on a plain literal — `65 psf`, `-3 in`,
 * `[2 ft; 3 ft]`. Undefined for anything computed.
 */
export function writtenUnitOf(source: string): string | undefined {
  try {
    const statement = parseStatement(source);
    if (statement.displayUnit !== undefined) return statement.displayUnit;
    return statement.kind === "definition" && !statement.params
      ? literalUnit(statement.value)
      : undefined;
  } catch {
    return undefined;
  }
}

function quantityParts(q: Quantity, unit: string | undefined, format?: NumberFormat): ResultParts {
  if (q.dimension.isDimensionless) return { text: formatNumber(q.si, format) };
  const u = unit !== undefined && unitFits(unit, q.dimension) ? unit : readableUnit(q);
  return u === undefined
    ? { text: formatNumber(q.si, format), unit: q.dimension.toString() }
    : { text: formatNumber(valueIn(q, u), format), unit: u };
}

function matrixParts(m: MatrixValue, unit: string | undefined, format?: NumberFormat): ResultParts {
  const rows = m.toRows();
  const common = m.commonDimension();
  // One unit for the whole list when every cell shares a dimension: the unit
  // asked for if it fits, else the one that suits the largest cell.
  if (common && !common.isDimensionless) {
    const cells = rows.flat();
    const largest = cells.reduce((a, b) => (Math.abs(b.si) > Math.abs(a.si) ? b : a));
    const u = unit !== undefined && unitFits(unit, common) ? unit : readableUnit(largest);
    if (u !== undefined) {
      const text = `[${rows.map((r) => r.map((q) => formatNumber(valueIn(q, u), format)).join(", ")).join("; ")}]`;
      return { text, unit: u };
    }
  }
  const cell = (q: Quantity): string => {
    const p = quantityParts(q, unit, format);
    return p.unit === undefined ? p.text : `${p.text} ${p.unit}`;
  };
  return { text: `[${rows.map((r) => r.map(cell).join(", ")).join("; ")}]` };
}

/** A value split into number and unit, shown in `unit` where it fits. */
export function formatValueParts(value: Value, unit?: string, format?: NumberFormat): ResultParts {
  return isMatrix(value) ? matrixParts(value, unit, format) : quantityParts(value, unit, format);
}
