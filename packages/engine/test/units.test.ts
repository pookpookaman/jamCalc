import { describe, expect, it } from "vitest";
import {
  DIM,
  Dimension,
  Quantity,
  Rational,
  UnitMismatchError,
  UnitParseError,
  parseUnit,
  quantityFrom,
  valueIn,
} from "../src/index.js";

describe("Rational", () => {
  it("normalizes and compares by value", () => {
    expect(Rational.of(2, 4).equals(Rational.HALF)).toBe(true);
    expect(Rational.of(-1, -2).equals(Rational.HALF)).toBe(true);
    expect(Rational.of(0, 5).equals(Rational.ZERO)).toBe(true);
  });

  it("survives the round trip that floats fail", () => {
    // (1/3) * 3 === 1 exactly. With float exponents, 0.1+0.2 style error
    // makes x^(1/3) cubed compare unequal to x.
    const third = Rational.of(1, 3);
    expect(third.mul(Rational.of(3)).equals(Rational.ONE)).toBe(true);
    expect(0.1 + 0.2 === 0.3).toBe(false); // the failure mode being avoided
  });

  it("rejects non-integer and zero-denominator construction", () => {
    expect(() => Rational.of(1, 0)).toThrow(RangeError);
    expect(() => Rational.of(1.5, 2)).toThrow(RangeError);
  });
});

describe("dimensional algebra", () => {
  it("derives stress from force over area", () => {
    expect(DIM.FORCE.div(DIM.AREA).equals(DIM.STRESS)).toBe(true);
  });

  it("derives moment from force times length", () => {
    expect(DIM.FORCE.mul(DIM.LENGTH).equals(DIM.MOMENT)).toBe(true);
  });

  it("treats psf and psi as the same dimension", () => {
    // They differ in scale, not dimension. A unit system that models them as
    // different dimensions will reject valid engineering expressions.
    expect(parseUnit("psf").dimension.equals(parseUnit("psi").dimension)).toBe(
      true,
    );
  });

  it("round-trips sqrt through square", () => {
    expect(DIM.STRESS.sqrt().pow(Rational.of(2)).equals(DIM.STRESS)).toBe(true);
  });
});

describe("ACI sqrt(f'c) — the case that requires rational exponents", () => {
  it("produces a half-power dimension that an integer system cannot represent", () => {
    const fc = quantityFrom(4000, "psi");
    const root = fc.sqrt();

    const expected = Dimension.of({
      mass: Rational.HALF,
      length: Rational.of(-1, 2),
      time: Rational.of(-1),
    });
    expect(root.dimension.equals(expected)).toBe(true);
    expect(root.dimension.equals(DIM.STRESS)).toBe(false);
  });

});

describe("unit expression parsing", () => {
  it("parses compound units", () => {
    expect(parseUnit("kip*ft").dimension.equals(DIM.MOMENT)).toBe(true);
    expect(parseUnit("lbf/in^2").dimension.equals(DIM.STRESS)).toBe(true);
    expect(parseUnit("in^4").dimension.equals(DIM.SECOND_MOMENT_OF_AREA)).toBe(
      true,
    );
    expect(parseUnit("kip/ft").dimension.equals(DIM.LINE_LOAD)).toBe(true);
  });

  it("accepts the middle-dot separator engineers actually type", () => {
    expect(parseUnit("kip·ft").dimension.equals(parseUnit("kip*ft").dimension))
      .toBe(true);
  });

  it("reports unknown units with a span, not prose", () => {
    try {
      parseUnit("kip*furlong");
      expect.unreachable("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(UnitParseError);
      const err = e as UnitParseError;
      expect(err.code).toBe("unknown_unit");
      expect(err.span).toEqual([4, 11]);
    }
  });

  it("refuses affine units inside compound expressions", () => {
    expect(() => parseUnit("degC/m")).toThrow(UnitParseError);
    expect(() => parseUnit("delta_degC/m")).not.toThrow();
  });
});

describe("ADR-0002: lb is force", () => {
  it("binds bare lb to force, not mass", () => {
    expect(parseUnit("lb").dimension.equals(DIM.FORCE)).toBe(true);
    expect(parseUnit("lbm").dimension.equals(DIM.MASS)).toBe(true);
    expect(parseUnit("kg").dimension.equals(DIM.MASS)).toBe(true);
    expect(parseUnit("kgf").dimension.equals(DIM.FORCE)).toBe(true);
  });

  it("hints at the ambiguity when lb is misused", () => {
    try {
      // Adding a force to a mass is the mistake this hint exists for.
      quantityFrom(1, "lb").add(quantityFrom(1, "lbm"));
      expect.unreachable("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(UnitMismatchError);
    }
  });

  it("uses exact 1959-agreement constants", () => {
    expect(valueIn(quantityFrom(1, "kip"), "lbf")).toBeCloseTo(1000, 10);
    expect(valueIn(quantityFrom(1, "ft"), "in")).toBeCloseTo(12, 12);
    expect(valueIn(quantityFrom(1, "ksi"), "psi")).toBeCloseTo(1000, 8);
  });
});

describe("worked example: simply supported beam", () => {

  it("rejects adding a moment to a force", () => {
    const Mu = quantityFrom(187.5, "kip*ft");
    const V = quantityFrom(30, "kip");
    expect(() => Mu.add(V)).toThrow(UnitMismatchError);
    try {
      Mu.add(V);
    } catch (e) {
      const err = e as UnitMismatchError;
      // The message states the clash and stops. Restating it as SI dimensions
      // is a notation the engineer never wrote, and the span already points at
      // the offending subexpression.
      expect(err.message).toBe("units do not match — cannot add these quantities");
      expect(err.message).not.toContain("kg");
      // The dimensional algebra survives, for developer surfaces.
      expect(err.detail).toContain("kg·m^2·s^-2");
      expect(err.detail).toContain("kg·m·s^-2");
    }
  });
});
