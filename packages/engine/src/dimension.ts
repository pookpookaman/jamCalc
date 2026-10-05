/**
 * Physical dimension: a vector of rational exponents over the 7 SI base
 * dimensions.
 *
 * Force is NOT a base dimension — it is mass·length/time². Keeping the SI
 * basis is what lets `lbf` and `kg` coexist in one sheet without a
 * gravitational fudge factor, which is the whole reason unit systems in
 * engineering software go wrong.
 */

import { Rational } from "./rational.js";

/** Index order is fixed and load-bearing; do not reorder. */
export const BASE_DIMENSIONS = [
  "length", // m
  "mass", // kg
  "time", // s
  "current", // A
  "temperature", // K
  "amount", // mol
  "luminosity", // cd
] as const;

export type BaseDimension = (typeof BASE_DIMENSIONS)[number];

const N = BASE_DIMENSIONS.length;

export class Dimension {
  /** Exponent per base dimension, in BASE_DIMENSIONS order. */
  readonly exponents: readonly Rational[];

  private constructor(exponents: readonly Rational[]) {
    this.exponents = exponents;
  }

  static of(partial: Partial<Record<BaseDimension, Rational | number>>): Dimension {
    const exps = BASE_DIMENSIONS.map((name) => {
      const v = partial[name];
      if (v === undefined) return Rational.ZERO;
      return typeof v === "number" ? Rational.of(v) : v;
    });
    return new Dimension(exps);
  }

  static readonly DIMENSIONLESS = Dimension.of({});

  private at(i: number): Rational {
    return this.exponents[i] ?? Rational.ZERO;
  }

  get isDimensionless(): boolean {
    return this.exponents.every((e) => e.isZero);
  }

  mul(o: Dimension): Dimension {
    return new Dimension(
      Array.from({ length: N }, (_, i) => this.at(i).add(o.at(i))),
    );
  }

  div(o: Dimension): Dimension {
    return new Dimension(
      Array.from({ length: N }, (_, i) => this.at(i).sub(o.at(i))),
    );
  }

  pow(exp: Rational): Dimension {
    return new Dimension(
      Array.from({ length: N }, (_, i) => this.at(i).mul(exp)),
    );
  }

  /** The operation that forces rational exponents to exist. */
  sqrt(): Dimension {
    return this.pow(Rational.HALF);
  }

  equals(o: Dimension): boolean {
    return this.exponents.every((e, i) => e.equals(o.at(i)));
  }

  /**
   * Human-readable SI form, e.g. "kg·m^(1/2)·s^-2".
   * Used in error messages, so it has to stay legible.
   */
  toString(): string {
    const SYMBOLS: Record<BaseDimension, string> = {
      length: "m",
      mass: "kg",
      time: "s",
      current: "A",
      temperature: "K",
      amount: "mol",
      luminosity: "cd",
    };
    // SI convention orders symbols kg·m·s·A·K·mol·cd, which is NOT the
    // storage order. Storage order is fixed for exponent arithmetic; this is
    // presentation only.
    const DISPLAY_ORDER: BaseDimension[] = [
      "mass",
      "length",
      "time",
      "current",
      "temperature",
      "amount",
      "luminosity",
    ];
    const parts: string[] = [];
    DISPLAY_ORDER.forEach((name) => {
      const i = BASE_DIMENSIONS.indexOf(name);
      const e = this.at(i);
      if (e.isZero) return;
      const sym = SYMBOLS[name];
      if (e.equals(Rational.ONE)) parts.push(sym);
      else if (e.isInteger) parts.push(`${sym}^${e.num}`);
      else parts.push(`${sym}^(${e.toString()})`);
    });
    return parts.length === 0 ? "dimensionless" : parts.join("·");
  }
}

// Dimensions worth naming, because they appear in error messages constantly.
export const DIM = {
  DIMENSIONLESS: Dimension.DIMENSIONLESS,
  LENGTH: Dimension.of({ length: 1 }),
  MASS: Dimension.of({ mass: 1 }),
  TIME: Dimension.of({ time: 1 }),
  AREA: Dimension.of({ length: 2 }),
  VOLUME: Dimension.of({ length: 3 }),
  /** Second moment of area — in^4 shows up on every steel calc. */
  SECOND_MOMENT_OF_AREA: Dimension.of({ length: 4 }),
  FORCE: Dimension.of({ mass: 1, length: 1, time: -2 }),
  MOMENT: Dimension.of({ mass: 1, length: 2, time: -2 }),
  STRESS: Dimension.of({ mass: 1, length: -1, time: -2 }),
  /** Force per unit length — plf, klf. */
  LINE_LOAD: Dimension.of({ mass: 1, time: -2 }),
  /** Force per unit area — same dimension as stress; psf vs psi is display only. */
  AREA_LOAD: Dimension.of({ mass: 1, length: -1, time: -2 }),
  ANGLE: Dimension.DIMENSIONLESS,
  TEMPERATURE: Dimension.of({ temperature: 1 }),
  /** Volume per unit time — gpm. */
  FLOW: Dimension.of({ length: 3, time: -1 }),
  /** Energy per unit time — hp, W. */
  POWER: Dimension.of({ mass: 1, length: 2, time: -3 }),
} as const;
