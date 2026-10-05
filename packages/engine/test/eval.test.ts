import { describe, expect, it } from "vitest";
import { asScalar, type Value } from "../src/value.js";
import { CalcError } from "../src/errors.js";
import { evaluateStatement, getValue, type Environment } from "../src/eval.js";
import { parseStatement } from "../src/parser.js";
import { Quantity } from "../src/quantity.js";
import { valueIn } from "../src/units/parse.js";

/** Runs a sheet top-to-bottom and returns the environment plus last result. */
function runSheet(lines: string[]): {
  env: Environment;
  results: ReturnType<typeof evaluateStatement>[];
} {
  const env: Environment = new Map();
  const results = lines.map((l) => evaluateStatement(parseStatement(l), env));
  return { env, results };
}

describe("end to end: a real beam check from source strings", () => {

  it("displays one stored value in whichever unit is asked for", () => {
    const env: Environment = new Map();
    evaluateStatement(parseStatement("M_u := 2.4 klf*(25 ft)^2/8"), env);

    for (const [unit, expected] of [
      ["kip*ft", 187.5],
      ["kN*m", 254.219],
      ["lbf*in", 2250000],
    ] as const) {
      const r = evaluateStatement(parseStatement(`M_u = ${unit}`), env);
      expect(r.displayValue).toBeCloseTo(expected, 2);
    }
  });
});

describe("ACI concrete modulus, evaluated from source", () => {
  it("carries the half-power dimension through and lands in ksi", () => {
    const { env } = runSheet([
      "f_c := 4000 psi",
      "E_c := 57000*sqrt(f_c/1 psi)*1 psi",
    ]);
    expect(valueIn(getValue(env, "E_c") as Quantity, "ksi")).toBeCloseTo(3604.997, 2);
  });
});

describe("errors carry a code and a span, not just a sentence", () => {
  it("reports an undefined name with its span", () => {
    try {
      evaluateStatement(parseStatement("x := 2 kip + F_y"), new Map());
      expect.unreachable("should have thrown");
    } catch (e) {
      const err = e as CalcError;
      expect(err.code).toBe("undefined_name");
      expect(err.span).toEqual([13, 16]);
      expect(err.toJSON().code).toBe("undefined_name");
    }
  });

  it("points a unit mismatch at the offending subexpression", () => {
    const env: Environment = new Map();
    evaluateStatement(parseStatement("M := 100 kip*ft"), env);
    evaluateStatement(parseStatement("V := 30 kip"), env);
    try {
      evaluateStatement(parseStatement("bad := M + V"), env);
      expect.unreachable("should have thrown");
    } catch (e) {
      const err = e as CalcError;
      expect(err.code).toBe("unit_mismatch");
      // Plain statement of the clash; no dimensional algebra in the message.
      expect(err.message).toBe("units do not match — cannot add these quantities");
      expect(err.message).not.toContain("kg");
      expect(err.detail).toContain("kg·m^2·s^-2");
      // Span covers `M + V`, not the whole statement.
      expect(err.span).toEqual([7, 12]);
      // Both travel across the API boundary.
      expect(err.toJSON().detail).toBeDefined();
    }
  });

  it("refuses a dimensioned exponent", () => {
    const env: Environment = new Map();
    evaluateStatement(parseStatement("L := 25 ft"), env);
    try {
      evaluateStatement(parseStatement("x := 2^L"), env);
      expect.unreachable("should have thrown");
    } catch (e) {
      expect((e as CalcError).code).toBe("dimensioned_exponent");
    }
  });

  it("allows an exact fractional exponent on a dimensioned base", () => {
    const env: Environment = new Map();
    evaluateStatement(parseStatement("A := 16 in^2"), env);
    const r = evaluateStatement(parseStatement("s := A^(1/2)"), env);
    expect(valueIn(asScalar(r.value), "in")).toBeCloseTo(4, 9);
  });

  it("rejects an inexpressible exponent rather than approximating it", () => {
    const env: Environment = new Map();
    evaluateStatement(parseStatement("A := 16 in^2"), env);
    expect(() =>
      evaluateStatement(parseStatement("x := A^0.31831"), env),
    ).toThrow(CalcError);
  });

  it("rejects a display unit of the wrong dimension", () => {
    const env: Environment = new Map();
    evaluateStatement(parseStatement("M := 100 kip*ft"), env);
    expect(() => evaluateStatement(parseStatement("M = ksi"), env)).toThrow();
  });
});

describe("builtins", () => {
  it("treats angles as scaled dimensionless", () => {
    const r = evaluateStatement(parseStatement("30 deg ="), new Map());
    const s = evaluateStatement(parseStatement("sin(30 deg) ="), new Map());
    expect(asScalar(r.value).si).toBeCloseTo(Math.PI / 6, 12);
    expect(asScalar(s.value).si).toBeCloseTo(0.5, 12);
  });

  it("keeps units through min/max and rejects mismatched ones", () => {
    const env: Environment = new Map();
    const r = evaluateStatement(
      parseStatement("V := max(30 kip, 12 kip, 45 kip)"),
      env,
    );
    expect(valueIn(asScalar(r.value), "kip")).toBeCloseTo(45, 9);
    expect(() =>
      evaluateStatement(parseStatement("x := max(30 kip, 2 ft)"), env),
    ).toThrow(CalcError);
  });

  it("rejects a dimensioned argument to a trig function", () => {
    expect(() =>
      evaluateStatement(parseStatement("x := sin(2 kip)"), new Map()),
    ).toThrow(CalcError);
  });
});
