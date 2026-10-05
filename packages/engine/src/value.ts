/**
 * What an expression evaluates to: a single quantity, or a matrix of them.
 *
 * Introduced when matrices arrived. Keeping `Quantity` scalar and adding a
 * union above it — rather than making every quantity secretly 1×1 — means the
 * common case stays a plain number with a dimension, and matrix handling is
 * visible wherever it happens instead of hiding in every arithmetic operator.
 */

import { CalcError, type Span } from "./errors.js";
import { MatrixValue } from "./matrix.js";
import { Quantity, UnitMismatchError } from "./quantity.js";
import type { Rational } from "./rational.js";

export type Value = Quantity | MatrixValue;

export const isMatrix = (v: Value): v is MatrixValue => v instanceof MatrixValue;
export const isScalar = (v: Value): v is Quantity => v instanceof Quantity;

/** Narrows to a scalar, for callers that have no span to blame. */
export function asScalar(v: Value): Quantity {
  if (isMatrix(v)) {
    throw new TypeError(`expected a single value, got a ${v.rows}x${v.cols} matrix`);
  }
  return v;
}

export function requireScalar(v: Value, what: string, span: Span): Quantity {
  if (isMatrix(v)) {
    throw new CalcError(
      "shape_mismatch",
      `${what} needs a single value, not a ${v.rows}×${v.cols} matrix`,
      span,
    );
  }
  return v;
}

export function requireMatrix(v: Value, what: string, span: Span): MatrixValue {
  if (!isMatrix(v)) {
    throw new CalcError("shape_mismatch", `${what} needs a matrix`, span);
  }
  return v;
}

function shapeError(a: MatrixValue, b: MatrixValue, op: string, span: Span): CalcError {
  return new CalcError(
    "shape_mismatch",
    `cannot ${op} a ${a.rows}×${a.cols} and a ${b.rows}×${b.cols} matrix`,
    span,
  );
}

/** Elementwise, with a scalar broadcasting across a matrix. */
function zip(
  a: Value,
  b: Value,
  op: string,
  span: Span,
  fn: (x: Quantity, y: Quantity) => Quantity,
): Value {
  if (isMatrix(a) && isMatrix(b)) {
    if (!a.sameShape(b)) throw shapeError(a, b, op, span);
    return a.map((cell, r, c) => fn(cell, b.at(r, c)));
  }
  if (isMatrix(a)) return a.map((cell) => fn(cell, b as Quantity));
  if (isMatrix(b)) return b.map((cell) => fn(a as Quantity, cell));
  return fn(a, b);
}

function rethrowUnits(span: Span, run: () => Value): Value {
  try {
    return run();
  } catch (e) {
    if (e instanceof UnitMismatchError) {
      throw new CalcError("unit_mismatch", e.message, span, undefined, e.detail);
    }
    throw e;
  }
}

export function add(a: Value, b: Value, span: Span): Value {
  return rethrowUnits(span, () => zip(a, b, "add", span, (x, y) => x.add(y)));
}

export function sub(a: Value, b: Value, span: Span): Value {
  return rethrowUnits(span, () => zip(a, b, "subtract", span, (x, y) => x.sub(y)));
}

/**
 * `*` is matrix multiplication when both sides are matrices, and scaling when
 * one side is a scalar.
 *
 * Not elementwise. Elementwise multiplication of two matrices is a different
 * operation with a different meaning, and silently choosing it would give
 * wrong answers that look plausible — the worst kind. Elementwise work goes
 * through `map`.
 */
export function mul(a: Value, b: Value, span: Span): Value {
  if (isMatrix(a) && isMatrix(b)) {
    if (a.cols !== b.rows) {
      throw new CalcError(
        "shape_mismatch",
        `cannot multiply a ${a.rows}×${a.cols} by a ${b.rows}×${b.cols} matrix`,
        span,
        "the first matrix needs as many columns as the second has rows",
      );
    }
    const cells: Quantity[] = [];
    for (let r = 0; r < a.rows; r++) {
      for (let c = 0; c < b.cols; c++) {
        let acc: Quantity | undefined;
        for (let k = 0; k < a.cols; k++) {
          const term = a.at(r, k).mul(b.at(k, c));
          acc = acc === undefined ? term : acc.add(term);
        }
        cells.push(acc ?? Quantity.scalar(0));
      }
    }
    return rethrowUnits(span, () => MatrixValue.fromCells(a.rows, b.cols, cells));
  }
  return zip(a, b, "multiply", span, (x, y) => x.mul(y));
}

export function div(a: Value, b: Value, span: Span): Value {
  if (isMatrix(b)) {
    throw new CalcError("shape_mismatch", "cannot divide by a matrix", span);
  }
  return zip(a, b, "divide", span, (x, y) => x.div(y));
}

export function neg(a: Value): Value {
  return isMatrix(a) ? a.map((q) => q.neg()) : a.neg();
}

export function pow(a: Value, exp: Rational, span: Span): Value {
  if (isMatrix(a)) {
    throw new CalcError(
      "shape_mismatch",
      "a matrix cannot be raised to a power",
      span,
    );
  }
  return a.pow(exp);
}

export function compare(a: Value, b: Value, span: Span): number {
  const x = requireScalar(a, "a comparison", span);
  const y = requireScalar(b, "a comparison", span);
  try {
    return x.compare(y);
  } catch (e) {
    if (e instanceof UnitMismatchError) {
      throw new CalcError("unit_mismatch", e.message, span, undefined, e.detail);
    }
    throw e;
  }
}

export { MatrixValue };
