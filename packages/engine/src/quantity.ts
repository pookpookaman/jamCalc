/**
 * A number with a dimension.
 *
 * The magnitude is ALWAYS stored in coherent SI base units. Display units are
 * a separate, per-result concern and never affect
 * arithmetic. One representation in, one representation out — this is what
 * keeps `1 kip + 1 kN` from being a special case.
 */

import { Dimension } from "./dimension.js";
import { Rational } from "./rational.js";

export class UnitMismatchError extends Error {
  readonly code = "unit_mismatch";
  /** SI dimensions of both sides, for developer surfaces only. */
  readonly detail: string;

  constructor(
    readonly operation: string,
    readonly left: Dimension,
    readonly right: Dimension,
  ) {
    // "these units do not match" is the whole actionable message. Which two
    // dimensions clashed is visible in the expression the span points at.
    super(`units do not match — cannot ${operation} these quantities`);
    this.detail = `${operation}: ${left.toString()} vs ${right.toString()}`;
    this.name = "UnitMismatchError";
  }
}

export class Quantity {
  /** Magnitude in coherent SI base units. */
  readonly si: number;
  readonly dimension: Dimension;

  constructor(si: number, dimension: Dimension = Dimension.DIMENSIONLESS) {
    this.si = si;
    this.dimension = dimension;
  }

  static scalar(v: number): Quantity {
    return new Quantity(v, Dimension.DIMENSIONLESS);
  }

  add(o: Quantity): Quantity {
    if (!this.dimension.equals(o.dimension)) {
      throw new UnitMismatchError("add", this.dimension, o.dimension);
    }
    return new Quantity(this.si + o.si, this.dimension);
  }

  sub(o: Quantity): Quantity {
    if (!this.dimension.equals(o.dimension)) {
      throw new UnitMismatchError("subtract", this.dimension, o.dimension);
    }
    return new Quantity(this.si - o.si, this.dimension);
  }

  mul(o: Quantity): Quantity {
    return new Quantity(this.si * o.si, this.dimension.mul(o.dimension));
  }

  div(o: Quantity): Quantity {
    return new Quantity(this.si / o.si, this.dimension.div(o.dimension));
  }

  neg(): Quantity {
    return new Quantity(-this.si, this.dimension);
  }

  /**
   * Exponentiation by a rational. A dimensioned base requires a rational
   * exponent that is known at evaluation time — `x^y` with dimensioned `x`
   * and computed `y` is an error, not something to approximate.
   */
  pow(exp: Rational): Quantity {
    return new Quantity(
      Math.pow(this.si, exp.toNumber()),
      this.dimension.pow(exp),
    );
  }

  sqrt(): Quantity {
    if (this.si < 0) {
      throw new RangeError("sqrt of a negative quantity");
    }
    return new Quantity(Math.sqrt(this.si), this.dimension.sqrt());
  }

  /** Comparisons require matching dimensions, same as addition. */
  compare(o: Quantity): number {
    if (!this.dimension.equals(o.dimension)) {
      throw new UnitMismatchError("compare", this.dimension, o.dimension);
    }
    return this.si < o.si ? -1 : this.si > o.si ? 1 : 0;
  }

  toString(): string {
    return this.dimension.isDimensionless
      ? String(this.si)
      : `${this.si} ${this.dimension.toString()}`;
  }
}
