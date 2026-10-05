import { describe, expect, it } from "vitest";
import { CalcError } from "../src/errors.js";
import { parseExpression, parseStatement } from "../src/parser.js";
import type { BinaryExpr, NumberLiteral } from "../src/ast.js";

const num = (e: unknown): NumberLiteral => e as NumberLiteral;
const bin = (e: unknown): BinaryExpr => e as BinaryExpr;

describe("ADR-0003: unit suffixes, not implicit multiplication", () => {
  it("attaches a unit suffix to a numeric literal", () => {
    const e = num(parseExpression("2.4 klf"));
    expect(e.kind).toBe("number");
    expect(e.value).toBe(2.4);
    expect(e.unit).toBe("klf");
  });

  it("takes compound units into the suffix", () => {
    expect(num(parseExpression("187.5 kip*ft")).unit).toBe("kip*ft");
    expect(num(parseExpression("95.4 in^3")).unit).toBe("in^3");
    expect(num(parseExpression("2 lbf/in^2")).unit).toBe("lbf/in^2");
  });

  it("stops the suffix at the first term that is not a unit", () => {
    // `2 kip/L` is (2 kip) / L, not a unit called `kip/L`.
    const e = bin(parseExpression("2 kip/L"));
    expect(e.kind).toBe("binary");
    expect(e.operator).toBe("/");
    expect(num(e.left).unit).toBe("kip");
    expect(e.right.kind).toBe("identifier");
  });

  it("rejects juxtaposition of a number and a non-unit name", () => {
    try {
      parseExpression("2 L");
      expect.unreachable("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(CalcError);
      expect((e as CalcError).code).toBe("syntax");
    }
  });

  it("rejects juxtaposition of two names — `Mu` is one name, `M u` is an error", () => {
    expect(() => parseStatement("x := M u")).toThrow(CalcError);
    expect(() => parseStatement("x := Mu")).not.toThrow();
  });

  it("reads `2 kip^2` as 2·(kip²), never (2 kip)²", () => {
    const e = num(parseExpression("2 kip^2"));
    expect(e.kind).toBe("number");
    expect(e.unit).toBe("kip^2");
  });

  it("documents the known sharp edge: 1/2 kip is 1/(2 kip)", () => {
    const e = bin(parseExpression("1/2 kip"));
    expect(e.operator).toBe("/");
    expect(num(e.left).value).toBe(1);
    expect(num(e.right).unit).toBe("kip");
  });
});

describe("identifiers are notation, not code names", () => {
  it("accepts subscripts, primes and Greek", () => {
    for (const name of ["M_u", "f'_c", "phi", "φ", "Z_x", "V_u1"]) {
      const e = parseExpression(name);
      expect(e.kind).toBe("identifier");
    }
  });
});

describe("precedence", () => {
  it("binds ^ tighter than * and right-associatively", () => {
    const e = bin(parseExpression("2*3^2"));
    expect(e.operator).toBe("*");
    expect(bin(e.right).operator).toBe("^");

    const pow = bin(parseExpression("2^3^2"));
    expect(bin(pow.right).operator).toBe("^"); // 2^(3^2)
  });

  it("reads -x^2 as -(x^2)", () => {
    const e = parseExpression("-x^2");
    expect(e.kind).toBe("unary");
    expect(bin((e as { operand: unknown }).operand).operator).toBe("^");
  });
});

describe("statements", () => {
  it("distinguishes := from =", () => {
    const def = parseStatement("M_u := 187.5 kip*ft");
    expect(def.kind).toBe("definition");

    const ev = parseStatement("M_u =");
    expect(ev.kind).toBe("evaluation");
  });

  it("captures a display unit after =", () => {
    const ev = parseStatement("M_u = kip*ft");
    expect(ev.kind).toBe("evaluation");
    expect((ev as { displayUnit?: string }).displayUnit).toBe("kip*ft");
  });

  it("hints at ADR-0003 when juxtaposition is the mistake", () => {
    try {
      parseStatement("y := 2 x");
      expect.unreachable("should have thrown");
    } catch (e) {
      expect((e as CalcError).hint).toContain("implicit multiplication");
    }
  });
});
