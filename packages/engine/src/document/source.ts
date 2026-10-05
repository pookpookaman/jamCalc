/**
 * Edits to a region's source that the UI needs to make on the user's behalf.
 *
 * These live in the engine, not the shell, because they are edits to the
 * language and must agree with the parser about what the text means. A UI that
 * spliced strings by regular expression would drift from the grammar the first
 * time the grammar changed.
 */

import { CalcError } from "../errors.js";
import { parseStatement } from "../parser.js";
import { parseUnit } from "../units/parse.js";

/**
 * Sets, replaces or clears the display unit of a statement.
 *
 * `M := w*L` + `kip*ft`  ->  `M := w*L = kip*ft`
 * `M := w*L = kN*m`      + `kip*ft`  ->  `M := w*L = kip*ft`
 * `M := w*L = kip*ft`    + null      ->  `M := w*L`
 *
 * Uses the parsed span rather than searching for `=`, because `=` also appears
 * inside `<=`, `>=`, `==` and `!=`.
 */
export function setDisplayUnit(source: string, unit: string | null): string {
  const statement = parseStatement(source);
  if (unit !== null) parseUnit(unit); // fail before rewriting anything

  const span = statement.displaySpan;
  // Clearing the UNIT keeps the `=`: the region should still show its value,
  // just in whatever unit the engine picks. Removing the marker as well would
  // silently stop displaying a result the user asked to see.
  const suffix = unit === null ? " =" : ` = ${unit}`;

  if (span) {
    const before = source.slice(0, span[0]).replace(/\s+$/, "");
    const after = source.slice(span[1]);
    return `${before}${suffix}${after}`;
  }

  // No display marker at all. Clearing is then a no-op rather than an
  // invitation to start showing a value nobody asked for.
  if (unit === null) return source;

  // An evaluation always has a marker, so this branch only sees `a := b`.
  if (statement.kind !== "definition") {
    throw new CalcError(
      "syntax",
      "cannot set a display unit on this statement",
      statement.span,
    );
  }
  return `${source.replace(/\s+$/, "")}${suffix}`;
}

/** The display unit currently written on a statement, if any. */
export function displayUnitOf(source: string): string | undefined {
  try {
    return parseStatement(source).displayUnit;
  } catch {
    return undefined;
  }
}
