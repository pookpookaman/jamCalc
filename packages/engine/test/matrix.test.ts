import { describe, expect, it } from "vitest";
import { evaluateStatement, getValue, type Environment } from "../src/eval.js";
import { parseStatement } from "../src/parser.js";
import { CalcError } from "../src/errors.js";
import { valueIn } from "../src/units/parse.js";
import { asScalar, isMatrix, type Value } from "../src/value.js";
import { MatrixValue } from "../src/matrix.js";
import { formatMatrix } from "../src/document/projection.js";

function run(lines: string[]): Environment {
  const env: Environment = new Map();
  for (const line of lines) evaluateStatement(parseStatement(line), env);
  return env;
}

const val = (env: Environment, name: string): Value => getValue(env, name) as Value;
const mat = (env: Environment, name: string): MatrixValue => {
  const v = val(env, name);
  if (!isMatrix(v)) throw new Error(`${name} is not a matrix`);
  return v;
};
const num = (env: Environment, name: string): number => asScalar(val(env, name)).si;

describe("literals", () => {
  it("builds a column vector", () => {
    const v = mat(run(["v := [1; 2; 3]"]), "v");
    expect([v.rows, v.cols]).toEqual([3, 1]);
    expect(v.cells.map((c) => c.si)).toEqual([1, 2, 3]);
  });

  it("builds a row and a grid", () => {
    expect([mat(run(["v := [1, 2, 3]"]), "v").rows, 3]).toEqual([1, 3]);
    const m = mat(run(["m := [1, 2; 3, 4]"]), "m");
    expect([m.rows, m.cols]).toEqual([2, 2]);
    expect(m.at(1, 0).si).toBe(3);
  });

  it("keeps a unit per cell", () => {
    // A tabulated lookup has columns in different units; a single dimension
    // for the whole matrix could not hold one.
    const m = mat(run(["m := [3 ft, 50 ksi; 4 ft, 60 ksi]"]), "m");
    expect(valueIn(m.at(0, 0), "ft")).toBeCloseTo(3, 9);
    expect(valueIn(m.at(1, 1), "ksi")).toBeCloseTo(60, 9);
    expect(m.commonDimension()).toBeUndefined();
  });

  it("rejects ragged rows", () => {
    expect(() => parseStatement("m := [1, 2; 3]")).toThrow(CalcError);
  });
});

describe("indexing is 1-based", () => {
  it("reads a vector cell", () => {
    const env = run(["v := [10; 20; 30]", "a := v[1]", "c := v[3]"]);
    expect(num(env, "a")).toBe(10);
    expect(num(env, "c")).toBe(30);
  });

  it("reads a matrix cell by row and column", () => {
    expect(num(run(["m := [1, 2; 3, 4]", "x := m[2, 1]"]), "x")).toBe(3);
  });

  it("selects a whole row with one index", () => {
    const r = mat(run(["m := [1, 2; 3, 4]", "row := m[2]"]), "row");
    expect([r.rows, r.cols]).toEqual([1, 2]);
    expect(r.cells.map((c) => c.si)).toEqual([3, 4]);
  });

  it("reports an index outside the matrix", () => {
    try {
      run(["v := [1; 2]", "x := v[3]"]);
      expect.unreachable("should have thrown");
    } catch (e) {
      expect((e as CalcError).code).toBe("index_out_of_range");
      // The message has to say where the count starts, or 0 vs 1 is a guess.
      expect((e as CalcError).hint).toContain("start at 1");
    }
  });

  it("rejects an index of zero, which betrays a 0-based assumption", () => {
    expect(() => run(["v := [1; 2]", "x := v[0]"])).toThrow(CalcError);
  });

  it("rejects an index with units", () => {
    expect(() => run(["v := [1; 2]", "x := v[1 ft]"])).toThrow(CalcError);
  });
});

describe("ranges", () => {
  it("builds a column of whole numbers", () => {
    const v = mat(run(["i := 1..5"]), "i");
    expect(v.cells.map((c) => c.si)).toEqual([1, 2, 3, 4, 5]);
  });

  it("counts down when the end is lower", () => {
    expect(mat(run(["i := 3..1"]), "i").cells.map((c) => c.si)).toEqual([3, 2, 1]);
  });

  it("binds looser than arithmetic, so 1..n+1 reaches n+1", () => {
    const v = mat(run(["n := 3", "i := 1..n+1"]), "i");
    expect(v.cells.map((c) => c.si)).toEqual([1, 2, 3, 4]);
  });

  it("rejects a range with units", () => {
    expect(() => run(["i := 1 ft..3 ft"])).toThrow(CalcError);
  });
});

describe("arithmetic", () => {
  it("adds elementwise and scales by a scalar", () => {
    const env = run(["a := [1; 2]", "b := [10; 20]", "s := a + b", "t := 3*a"]);
    expect(mat(env, "s").cells.map((c) => c.si)).toEqual([11, 22]);
    expect(mat(env, "t").cells.map((c) => c.si)).toEqual([3, 6]);
  });

  it("multiplies matrices, and does not do it elementwise", () => {
    // [1 2; 3 4] * [1; 1] = [3; 7]. Elementwise would be a shape error, and
    // silently choosing it would give a plausible wrong answer.
    const p = mat(run(["m := [1, 2; 3, 4]", "v := [1; 1]", "p := m*v"]), "p");
    expect([p.rows, p.cols]).toEqual([2, 1]);
    expect(p.cells.map((c) => c.si)).toEqual([3, 7]);
  });

  it("reports a shape mismatch", () => {
    try {
      run(["a := [1; 2]", "b := [1; 2; 3]", "c := a + b"]);
      expect.unreachable("should have thrown");
    } catch (e) {
      expect((e as CalcError).code).toBe("shape_mismatch");
    }
  });

  it("carries units through a product", () => {
    const env = run(["w := [2 klf; 3 klf]", "L := 10 ft", "M := w*L"]);
    expect(valueIn(mat(env, "M").at(0, 0), "kip")).toBeCloseTo(20, 9);
  });

  it("refuses to divide by a matrix", () => {
    expect(() => run(["v := [1; 2]", "x := 3/v"])).toThrow(CalcError);
  });
});

describe("reductions and map", () => {
  it("sums, averages and takes extremes over a vector", () => {
    const env = run([
      "v := [3 kip; 7 kip; 5 kip]",
      "t := sum(v)",
      "a := mean(v)",
      "m := max(v)",
    ]);
    expect(valueIn(asScalar(val(env, "t")), "kip")).toBeCloseTo(15, 9);
    expect(valueIn(asScalar(val(env, "a")), "kip")).toBeCloseTo(5, 9);
    expect(valueIn(asScalar(val(env, "m")), "kip")).toBeCloseTo(7, 9);
  });

  it("still accepts loose arguments", () => {
    expect(num(run(["m := max(3, 9, 4)"]), "m")).toBe(9);
  });

  it("reports mixed units in a reduction", () => {
    expect(() => run(["v := [3 kip; 2 ft]", "t := sum(v)"])).toThrow(CalcError);
  });

  it("applies a user function to every cell", () => {
    const env = run([
      "f(x) := x*x",
      "v := 1..4",
      "sq := map(f, v)",
    ]);
    expect(mat(env, "sq").cells.map((c) => c.si)).toEqual([1, 4, 9, 16]);
  });

  it("applies a builtin to every cell", () => {
    const env = run(["v := [1; 4; 9]", "r := map(sqrt, v)"]);
    expect(mat(env, "r").cells.map((c) => c.si)).toEqual([1, 2, 3]);
  });

  it("counts rows and columns, and transposes", () => {
    const env = run(["m := [1, 2, 3; 4, 5, 6]", "r := rows(m)", "c := cols(m)"]);
    expect(num(env, "r")).toBe(2);
    expect(num(env, "c")).toBe(3);
    const t = mat(run(["m := [1, 2, 3; 4, 5, 6]", "t := transpose(m)"]), "t");
    expect([t.rows, t.cols]).toEqual([3, 2]);
  });
});

describe("linterp", () => {
  const table = ["xs := [0 ft; 10 ft; 20 ft]", "ys := [1.0; 2.0; 4.0]"];

  it("interpolates between points", () => {
    expect(num(run([...table, "y := linterp(xs, ys, 5 ft)"]), "y")).toBeCloseTo(1.5, 9);
    expect(num(run([...table, "y := linterp(xs, ys, 15 ft)"]), "y")).toBeCloseTo(3.0, 9);
  });

  it("returns a tabulated point exactly", () => {
    expect(num(run([...table, "y := linterp(xs, ys, 10 ft)"]), "y")).toBeCloseTo(2.0, 9);
  });

  it("clamps outside the table rather than extrapolating", () => {
    // Tabulated data is defined over its stated range; extrapolating past it
    // produces a confident number with no basis.
    expect(num(run([...table, "y := linterp(xs, ys, -5 ft)"]), "y")).toBe(1.0);
    expect(num(run([...table, "y := linterp(xs, ys, 99 ft)"]), "y")).toBe(4.0);
  });

  it("requires the lookup column to be increasing", () => {
    expect(() =>
      run(["xs := [10; 0]", "ys := [1; 2]", "y := linterp(xs, ys, 5)"]),
    ).toThrow(CalcError);
  });

  it("requires the lookup value to match the table's units", () => {
    expect(() => run([...table, "y := linterp(xs, ys, 5 kip)"])).toThrow(CalcError);
  });

  it("reports mismatched column lengths", () => {
    expect(() =>
      run(["xs := [0; 1; 2]", "ys := [1; 2]", "y := linterp(xs, ys, 1)"]),
    ).toThrow(CalcError);
  });
});

describe("display", () => {
  it("prints a matrix in the literal syntax", () => {
    const m = mat(run(["m := [1 ft, 2 ft; 3 ft, 4 ft]"]), "m");
    expect(formatMatrix(m)).toBe("[1 ft, 2 ft; 3 ft, 4 ft]");
  });

  it("refuses a display unit on a matrix", () => {
    expect(() => run(["v := [1 ft; 2 ft]", "v = ft"])).toThrow(CalcError);
  });
});
