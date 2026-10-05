/**
 * Turning a data table into values the sheet can use.
 *
 * A table region binds one name per column, each a column vector carrying that
 * column's unit. That choice is what makes it useful immediately: `linterp`
 * already takes two column vectors, so a code table feeds it with no new
 * language. Binding the whole grid to one name would instead require slicing,
 * which ADR-0008 deferred.
 *
 * Pure, and in the engine rather than the shell, for the same reason
 * everything else here is: the CLI, the API and the GUI must agree about what
 * a table means.
 */

import { CalcError, type Span } from "../errors.js";
import { MatrixValue } from "../matrix.js";
import { Quantity } from "../quantity.js";
import { IDENT_PART, IDENT_START, misplacedLiteralMark } from "../lexer.js";
import { parseUnit } from "../units/parse.js";
import type { TableColumn, TableRegion } from "./region.js";

/** A table has no source text, so there is no span to point at. */
const NO_SPAN: Span = [0, 0];

/**
 * True when nothing has been typed into the grid yet.
 *
 * A table the user has just inserted is not a broken table, in exactly the way
 * an empty math region is not a syntax error. Reporting one would put a red
 * marker on every table at the moment it is created.
 */
export function isBlankTable(region: TableRegion): boolean {
  return region.cells.every((row) => row.every((cell) => cell === null));
}

export interface TableEvaluation {
  /** Column name → its values as a column vector. */
  readonly values: ReadonlyMap<string, MatrixValue>;
  /** Names this table binds, in column order. */
  readonly provides: readonly string[];
}

/** Whether a string is usable as a name on the sheet. */
export function isValidColumnName(name: string): boolean {
  if (name.length === 0) return false;
  if (!IDENT_START.test(name[0] as string)) return false;
  for (const ch of name.slice(1)) if (!IDENT_PART.test(ch)) return false;
  if (misplacedLiteralMark(name) >= 0) return false;
  return true;
}

/**
 * Rows that are entirely empty at the bottom of the grid.
 *
 * Ignored rather than reported: an empty row under the data is what a grid
 * looks like while someone is still typing into it, and erroring on it would
 * make the table flash red through every edit.
 */
function usedRowCount(region: TableRegion): number {
  let n = region.cells.length;
  while (n > 0 && (region.cells[n - 1] as readonly (number | null)[]).every((c) => c === null)) {
    n -= 1;
  }
  return n;
}

/**
 * Evaluates a table, or throws the first thing wrong with it.
 *
 * Errors name the column, and the row where a row is at fault. A table is a
 * grid the reader is looking at; "row 7 of `span` is empty" is actionable and
 * "invalid table" is not.
 */
export function evaluateTable(region: TableRegion): TableEvaluation {
  const values = new Map<string, MatrixValue>();
  const provides: string[] = [];
  const seen = new Set<string>();

  if (region.columns.length === 0) {
    throw new CalcError("domain", "this table has no columns", NO_SPAN);
  }

  const rows = usedRowCount(region);
  if (rows === 0) {
    throw new CalcError("domain", "this table has no rows yet", NO_SPAN);
  }

  region.columns.forEach((column: TableColumn, index: number) => {
    if (!isValidColumnName(column.name)) {
      throw new CalcError(
        "syntax",
        column.name.trim() === ""
          ? `column ${index + 1} has no name`
          : `\`${column.name}\` is not a usable name`,
        NO_SPAN,
        "names start with a letter and hold letters, digits, _ and '",
      );
    }
    if (seen.has(column.name)) {
      // Two columns binding one name would make the sheet's value depend on
      // which column happened to be written last.
      throw new CalcError(
        "syntax",
        `\`${column.name}\` names two columns of this table`,
        NO_SPAN,
      );
    }
    seen.add(column.name);

    let scale = 1;
    let dimension: ReturnType<typeof parseUnit>["dimension"] | undefined;
    if (column.unit !== undefined && column.unit.trim() !== "") {
      try {
        const parsed = parseUnit(column.unit);
        scale = parsed.scale;
        dimension = parsed.dimension;
      } catch (e) {
        throw new CalcError(
          "unknown_unit",
          `column \`${column.name}\` is in \`${column.unit}\`, which is not a unit`,
          NO_SPAN,
          undefined,
          (e as Error).message,
        );
      }
    }

    const cells: Quantity[] = [];
    for (let r = 0; r < rows; r += 1) {
      const raw = region.cells[r]?.[index] ?? null;
      if (raw === null) {
        throw new CalcError(
          "domain",
          `row ${r + 1} of column \`${column.name}\` is empty`,
          NO_SPAN,
          "every cell above the last used row needs a value",
        );
      }
      if (!Number.isFinite(raw)) {
        throw new CalcError(
          "domain",
          `row ${r + 1} of column \`${column.name}\` is not a number`,
          NO_SPAN,
        );
      }
      cells.push(dimension === undefined ? Quantity.scalar(raw) : new Quantity(raw * scale, dimension));
    }

    values.set(column.name, MatrixValue.fromCells(rows, 1, cells));
    provides.push(column.name);
  });

  return { values, provides };
}

/** The names a table binds, without evaluating it. Used to build the graph. */
export function tableProvides(region: TableRegion): readonly string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const column of region.columns) {
    if (!isValidColumnName(column.name) || seen.has(column.name)) continue;
    seen.add(column.name);
    out.push(column.name);
  }
  return out;
}
