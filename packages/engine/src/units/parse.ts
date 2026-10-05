/**
 * Parser for unit expressions: "kip*ft", "in^4", "lbf/in^2", "kip/ft^2".
 *
 * Deliberately tiny and separate from the main expression parser. Unit
 * expressions have their own grammar (no functions, no variables, integer
 * exponents only as written) and appear in three places: literals, display
 * unit choices, and the API. One parser, three callers.
 *
 * Grammar:
 *   expr    := term (("*" | "/" | "·") term)*
 *   term    := name ("^" integer)?
 */

import { Dimension } from "../dimension.js";
import { Quantity } from "../quantity.js";
import { Rational } from "../rational.js";
import { AMBIGUITY_HINTS, lookupUnit } from "./registry.js";
import { CalcError, type ErrorCode, type Span } from "../errors.js";

/**
 * Extends CalcError rather than Error.
 *
 * It used to be a bare Error, so a bad display unit escaped every `catch (e)
 * if (e instanceof CalcError)` in the evaluator and propagated out of
 * `recompute` — one wrong unit took down the whole sheet instead of marking
 * one region. Anything a region can do wrong has to arrive as a CalcError.
 */
export class UnitParseError extends CalcError {
  constructor(
    code: ErrorCode,
    message: string,
    span: Span,
    hint?: string,
    detail?: string,
  ) {
    super(code, message, span, hint, detail);
    this.name = "UnitParseError";
  }
}

export interface ParsedUnit {
  /** Multiply a magnitude in this unit by `scale` to get coherent SI. */
  readonly scale: number;
  readonly dimension: Dimension;
  /** Canonical re-serialization, for round-trip tests and display. */
  readonly canonical: string;
}

const NAME_RE = /[A-Za-z_][A-Za-z0-9_]*/y;
const INT_RE = /[+-]?\d+/y;

export function parseUnit(source: string): ParsedUnit {
  let pos = 0;

  const skipSpace = (): void => {
    while (pos < source.length && /\s/.test(source[pos] as string)) pos++;
  };

  const parseTerm = (): { scale: number; dim: Dimension; text: string } => {
    skipSpace();
    NAME_RE.lastIndex = pos;
    const m = NAME_RE.exec(source);
    if (!m || m.index !== pos) {
      throw new UnitParseError(
        "unknown_unit",
        `expected a unit name at position ${pos}`,
        [pos, pos + 1],
      );
    }
    const name = m[0];
    const nameStart = pos;
    pos += name.length;

    const unit = lookupUnit(name);
    if (!unit) {
      throw new UnitParseError(
        "unknown_unit",
        `unknown unit \`${name}\``,
        [nameStart, pos],
        AMBIGUITY_HINTS[name],
      );
    }
    if (unit.offset !== undefined) {
      throw new UnitParseError(
        "unknown_unit",
        `\`${name}\` is an affine unit and cannot appear in a compound unit`,
        [nameStart, pos],
        AMBIGUITY_HINTS[name],
      );
    }

    let exp = Rational.ONE;
    skipSpace();
    if (source[pos] === "^") {
      pos++;
      skipSpace();
      INT_RE.lastIndex = pos;
      const e = INT_RE.exec(source);
      if (!e || e.index !== pos) {
        throw new UnitParseError(
          "unknown_unit",
          `expected an integer exponent after \`^\``,
          [pos, pos + 1],
        );
      }
      pos += e[0].length;
      exp = Rational.of(Number.parseInt(e[0], 10));
    }

    return {
      scale: Math.pow(unit.scale, exp.toNumber()),
      dim: unit.dimension.pow(exp),
      text: exp.equals(Rational.ONE) ? name : `${name}^${exp.toString()}`,
    };
  };

  let first = parseTerm();
  let scale = first.scale;
  let dim = first.dim;
  const parts: string[] = [first.text];

  for (;;) {
    skipSpace();
    const op = source[pos];
    if (op === "*" || op === "·") {
      pos++;
      const t = parseTerm();
      scale *= t.scale;
      dim = dim.mul(t.dim);
      parts.push(`*${t.text}`);
    } else if (op === "/") {
      pos++;
      const t = parseTerm();
      scale /= t.scale;
      dim = dim.div(t.dim);
      parts.push(`/${t.text}`);
    } else {
      break;
    }
  }

  skipSpace();
  if (pos < source.length) {
    throw new UnitParseError(
      "unknown_unit",
      `unexpected \`${source.slice(pos)}\` in unit expression`,
      [pos, source.length],
    );
  }

  return { scale, dimension: dim, canonical: parts.join("") };
}

/** Convert a magnitude written in `unitSource` into a Quantity. */
export function quantityFrom(magnitude: number, unitSource: string): Quantity {
  const parsed = parseUnit(unitSource);
  return new Quantity(magnitude * parsed.scale, parsed.dimension);
}

/**
 * Express a Quantity in a chosen unit. Throws if the dimensions disagree —
 * asking for a moment in `ksi` is a user error worth reporting, not rounding.
 */
export function valueIn(q: Quantity, unitSource: string): number {
  const parsed = parseUnit(unitSource);
  if (!q.dimension.equals(parsed.dimension)) {
    throw new UnitParseError(
      "unit_mismatch",
      `this value cannot be shown in \`${unitSource}\` — the units do not match`,
      [0, unitSource.length],
      undefined,
      `${q.dimension.toString()} vs ${parsed.dimension.toString()}`,
    );
  }
  return q.si / parsed.scale;
}
