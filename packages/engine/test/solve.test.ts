/**
 * Root-finding, integration and differentiation.
 *
 * These were in the maths scope and did not exist. The
 * numerics are checked against answers known in closed form; the worksheet
 * tests check the thing that makes them useful on a calc sheet, which is that
 * the units come out right.
 */

import { describe, expect, it } from "vitest";
import { differentiate, findRoot, integrate } from "../src/solve.js";
import { Worksheet } from "../src/document/worksheet.js";
import { humanAuthorship, type Region } from "../src/document/region.js";
import { CalcError, type Span } from "../src/errors.js";

const SPAN: Span = [0, 0];
const AT = new Date("2026-09-06T00:00:00Z");

const math = (id: string, y: number, source: string): Region => ({
  kind: "math", id, position: { x: 48, y }, source, origin: humanAuthorship(AT),
});

/** Builds a sheet and returns the result of the last region. */
function compute(sources: readonly string[]) {
  const ws = new Worksheet(sources.map((s, i) => math(`r_${i}`, i * 40, s)));
  ws.recompute();
  return ws.getResult(`r_${sources.length - 1}`);
}

describe("finding a root", () => {
  it("finds one that is known exactly", () => {
    // x^2 - 2 = 0 between 0 and 2.
    expect(findRoot((x) => x * x - 2, 0, 2, SPAN)).toBeCloseTo(Math.SQRT2, 12);
  });

  it("finds a root of a cubic", () => {
    expect(findRoot((x) => x ** 3 - x - 2, 1, 2, SPAN)).toBeCloseTo(1.5213797068045676, 10);
  });

  it("returns an end that is already a root", () => {
    expect(findRoot((x) => x - 3, 3, 9, SPAN)).toBe(3);
  });

  it("works when the bracket is given backwards", () => {
    expect(findRoot((x) => x * x - 2, 2, 0, SPAN)).toBeCloseTo(Math.SQRT2, 12);
  });

  it("refuses a range that does not straddle a root", () => {
    // Guessing at a wider range would risk returning the wrong root of
    // several, silently.
    expect(() => findRoot((x) => x * x + 1, 0, 2, SPAN)).toThrow(/same sign at both ends/);
  });

  it("converges on a function that defeats plain interpolation", () => {
    // Steep and flat in the same bracket: the case Brent falls back to
    // bisection for.
    const f = (x: number): number => (x < 1 ? -1e-8 : (x - 1) ** 3 + 1e-8);
    expect(findRoot(f, 0, 3, SPAN)).toBeGreaterThanOrEqual(0.99);
  });
});

describe("integrating", () => {
  it("integrates a polynomial exactly", () => {
    // ∫x^2 from 0 to 3 = 9.
    expect(integrate((x) => x * x, 0, 3, SPAN)).toBeCloseTo(9, 10);
  });

  it("integrates a curve with no elementary answer to tolerance", () => {
    // ∫sin(x) from 0 to π = 2.
    expect(integrate(Math.sin, 0, Math.PI, SPAN)).toBeCloseTo(2, 9);
  });

  it("changes sign when the ends are swapped", () => {
    expect(integrate((x) => x * x, 3, 0, SPAN)).toBeCloseTo(-9, 10);
  });

  it("is zero over no interval at all", () => {
    expect(integrate(Math.sin, 1, 1, SPAN)).toBe(0);
  });

  it("handles a function that is nearly all in one place", () => {
    // A narrow spike is what an equal-strip rule misses and an adaptive one
    // subdivides into.
    const spike = (x: number): number => Math.exp(-((x - 5) ** 2) * 400);
    const exact = Math.sqrt(Math.PI / 400);
    expect(integrate(spike, 0, 10, SPAN)).toBeCloseTo(exact, 6);
  });
});

describe("differentiating", () => {
  it("differentiates a polynomial", () => {
    // d/dx x^3 at 2 = 12.
    expect(differentiate((x) => x ** 3, 2, SPAN)).toBeCloseTo(12, 7);
  });

  it("differentiates at zero", () => {
    // Where a step scaled to |x| would otherwise collapse.
    expect(differentiate(Math.cos, 0, SPAN)).toBeCloseTo(0, 8);
  });

  it("differentiates a long way from zero", () => {
    // Where a fixed step would be lost in rounding.
    expect(differentiate((x) => x * x, 1e6, SPAN)).toBeCloseTo(2e6, 2);
  });

  it("reports a point the function does not reach around", () => {
    expect(() => differentiate((x) => Math.sqrt(x - 5), 5, SPAN)).toThrow(CalcError);
  });
});

describe("on a sheet, with units", () => {
  it("gives a root the units of the range it was sought in", () => {
    // Depth at which the section's capacity reaches the demand.
    const r = compute([
      "gap(d) := d^2*1 kip/ft^2 - 9 kip",
      "d := root(gap, 0 ft, 10 ft) = ft",
    ]);
    expect(r?.status).toBe("ok");
    if (r?.status === "ok") expect(r.displayValue).toBeCloseTo(3, 8);
  });

  it("gives an integral the units of f times x", () => {
    // A pressure over a length is a force per unit width.
    const r = compute([
      "w(x) := 2 klf",
      "W := integral(w, 0 ft, 10 ft) = kip",
    ]);
    expect(r?.status).toBe("ok");
    if (r?.status === "ok") expect(r.displayValue).toBeCloseTo(20, 8);
  });

  it("gives a derivative the units of f over x", () => {
    // Rate of change of moment is shear.
    const r = compute([
      "M(x) := 5 kip*x",
      "V := deriv(M, 2 ft) = kip",
    ]);
    expect(r?.status).toBe("ok");
    if (r?.status === "ok") expect(r.displayValue).toBeCloseTo(5, 6);
  });

  it("integrates a varying load", () => {
    // ∫ 2x klf/ft dx from 0 to 10 ft = 100 kip.
    const r = compute([
      "w(x) := 2 klf/ft*x",
      "W := integral(w, 0 ft, 10 ft) = kip",
    ]);
    if (r?.status === "ok") expect(r.displayValue).toBeCloseTo(100, 6);
    else expect(r?.status).toBe("ok");
  });

  it("refuses a range whose ends are different kinds of quantity", () => {
    const r = compute(["f(x) := x", "y := root(f, 0 ft, 10 kip) ="]);
    expect(r?.status).toBe("error");
    if (r?.status === "error") expect(r.error.code).toBe("unit_mismatch");
  });

  it("refuses a function that changes what it returns", () => {
    // A solver cannot reason about a function that is force here and length
    // there, and finding out at the end would mean reporting a meaningless
    // number.
    const r = compute([
      "odd(x) := if(x < 5 ft, 1 kip, 1 ft)",
      "y := root(odd, 0 ft, 10 ft) =",
    ]);
    expect(r?.status).toBe("error");
    if (r?.status === "error") expect(r.error.code).toBe("unit_mismatch");
  });

  it("refuses a value where a function belongs", () => {
    const r = compute(["a := 2", "y := root(a, 0, 1) ="]);
    expect(r?.status).toBe("error");
    if (r?.status === "error") expect(r.error.code).toBe("not_a_function");
  });

  it("refuses a function of the wrong arity", () => {
    const r = compute(["g(x, y) := x + y", "z := deriv(g, 1) ="]);
    expect(r?.status).toBe("error");
    if (r?.status === "error") expect(r.error.code).toBe("wrong_arity");
  });

  it("says so when the range holds no root", () => {
    const r = compute(["f(x) := x^2 + 1 ft^2", "y := root(f, 0 ft, 2 ft) = ft"]);
    expect(r?.status).toBe("error");
    if (r?.status === "error") expect(r.error.message).toMatch(/same sign/);
  });
});
