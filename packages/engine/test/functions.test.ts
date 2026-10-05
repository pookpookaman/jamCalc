import { describe, expect, it } from "vitest";
import { asScalar, type Value } from "../src/value.js";
import { evaluateStatement, getValue, type Environment } from "../src/eval.js";
import { parseStatement } from "../src/parser.js";
import { CalcError } from "../src/errors.js";
import { valueIn } from "../src/units/parse.js";
import { Worksheet } from "../src/document/worksheet.js";
import { humanAuthorship, type Region } from "../src/document/region.js";
import type { Definition } from "../src/ast.js";

const AT = new Date("2026-09-04T00:00:00Z");
const math = (id: string, y: number, source: string): Region => ({
  kind: "math",
  id,
  position: { x: 48, y },
  source,
  origin: humanAuthorship(AT),
});

/** Runs lines top to bottom in one scope. */
function run(lines: string[]): Environment {
  const env: Environment = new Map();
  for (const line of lines) evaluateStatement(parseStatement(line), env);
  return env;
}

describe("user-defined functions", () => {
  it("parses a parameter list", () => {
    const stmt = parseStatement("f(x, y) := x + y") as Definition;
    expect(stmt.kind).toBe("definition");
    expect(stmt.name).toBe("f");
    expect(stmt.params?.map((p) => p.name)).toEqual(["x", "y"]);
  });

  it("is not confused by a call that is not a definition", () => {
    const stmt = parseStatement("sqrt(x) + 1");
    expect(stmt.kind).toBe("evaluation");
  });

  it("rejects a parameter list that is not plain names", () => {
    // `f(2) := ...` is a typo, not a definition; swallowing it would bind a
    // function nobody meant to write.
    expect(() => parseStatement("f(2) := 3")).toThrow(CalcError);
  });

  it("carries units through a call", () => {
    const env = run([
      "area(w, h) := w*h",
      "A := area(3 ft, 4 ft)",
    ]);
    expect(valueIn(getValue(env, "A") as never, "ft^2")).toBeCloseTo(12, 9);
  });

  it("evaluates arguments in the caller's scope, body in its own", () => {
    // `x` inside the body must mean the parameter, never the caller's `x`.
    const env = run([
      "x := 100",
      "double(x) := 2*x",
      "r := double(5)",
    ]);
    expect(asScalar(getValue(env, "r")!).si).toBe(10);
    expect(asScalar(getValue(env, "x")!).si).toBe(100);
  });

  it("closes over names visible where it was defined", () => {
    const env = run([
      "k := 3",
      "scaled(v) := k*v",
      "r := scaled(4)",
    ]);
    expect(asScalar(getValue(env, "r")!).si).toBe(12);
  });

  it("reports the wrong number of arguments", () => {
    expect(() => run(["f(a, b) := a+b", "r := f(1)"])).toThrow(CalcError);
  });

  it("refuses to use a function as a value", () => {
    try {
      run(["f(x) := x", "r := f + 1"]);
      expect.unreachable("should have thrown");
    } catch (e) {
      expect((e as CalcError).code).toBe("not_callable");
    }
  });

  it("stops runaway recursion instead of hanging", () => {
    try {
      run(["f(n) := f(n)", "r := f(1)"]);
      expect.unreachable("should have thrown");
    } catch (e) {
      expect((e as CalcError).code).toBe("call_depth");
    }
  });

  it("allows recursion that terminates", () => {
    const env = run([
      "fact(n) := if(n <= 1, 1, n*fact(n-1))",
      "r := fact(5)",
    ]);
    expect(asScalar(getValue(env, "r")!).si).toBe(120);
  });
});

describe("if", () => {
  it("chooses a branch", () => {
    expect(asScalar(getValue(run(["r := if(1 < 2, 10, 20)"]), "r")!).si).toBe(10);
    expect(asScalar(getValue(run(["r := if(1 > 2, 10, 20)"]), "r")!).si).toBe(20);
  });

  it("does not evaluate the branch it did not take", () => {
    // The whole point of a guard: sqrt(-1) must never run.
    const env = run(["x := -4", "r := if(x >= 0, sqrt(x), 0)"]);
    expect(asScalar(getValue(env, "r")!).si).toBe(0);
  });

  it("allows branches with different dimensions", () => {
    // A provision returning a moment in one case and zero in another is
    // ordinary; requiring both branches to agree would make `if` useless.
    const env = run(["r := if(1 > 0, 5 kip*ft, 0)"]);
    expect(valueIn(getValue(env, "r") as never, "kip*ft")).toBeCloseTo(5, 9);
  });

  it("chains conditions with a trailing fallback", () => {
    const sheet = (v: string) => [
      `x := ${v}`,
      "r := if(x < 10, 1, x < 20, 2, 3)",
    ];
    expect(asScalar(getValue(run(sheet("5")), "r")!).si).toBe(1);
    expect(asScalar(getValue(run(sheet("15")), "r")!).si).toBe(2);
    expect(asScalar(getValue(run(sheet("25")), "r")!).si).toBe(3);
  });

  it("reports a condition that carries units", () => {
    try {
      run(["r := if(2 kip, 1, 0)"]);
      expect.unreachable("should have thrown");
    } catch (e) {
      expect((e as CalcError).code).toBe("unit_mismatch");
      expect((e as CalcError).message).toBe("a condition cannot have units");
    }
  });

  it("reports an unmatched chain with no fallback", () => {
    try {
      run(["r := if(1 > 2, 5)"]);
      expect.unreachable("should have thrown");
    } catch (e) {
      expect((e as CalcError).code).toBe("domain");
    }
  });
});

describe("functions in a worksheet", () => {
  it("depends on the region that defines the function", () => {
    const ws = new Worksheet([
      math("r_01", 0, "k := 2"),
      math("r_02", 40, "f(x) := k*x"),
      math("r_03", 80, "r := f(3)"),
    ]);
    ws.recompute();
    const result = ws.getResult("r_03");
    expect(result?.status).toBe("ok");
    expect(result?.status === "ok" && asScalar(result.value).si).toBe(6);
    // Editing the function must invalidate the caller.
    ws.edit("r_02", "f(x) := k*x*10");
    expect(ws.pending).toContain("r_03");
    ws.recompute();
    expect(asScalar((ws.getResult("r_03") as { value: Value }).value).si).toBe(60);
  });

  it("does not treat a builtin call as an undefined name", () => {
    const ws = new Worksheet([math("r_01", 0, "r := sqrt(16)")]);
    ws.recompute();
    expect(ws.getResult("r_01")?.status).toBe("ok");
  });

  it("reports a call to a function defined nowhere", () => {
    const ws = new Worksheet([math("r_01", 0, "r := nope(1)")]);
    ws.recompute();
    const res = ws.getResult("r_01");
    expect(res?.status).toBe("error");
    expect(res?.status === "error" && res.error.code).toBe("not_a_function");
  });

  it("does not report a parameter as an undefined name", () => {
    const ws = new Worksheet([math("r_01", 0, "f(x) := 2*x")]);
    ws.recompute();
    expect(ws.getResult("r_01")?.status).toBe("ok");
  });

  it("binds a function positionally, like any other name", () => {
    const ws = new Worksheet([
      math("r_01", 0, "f(x) := x + 1"),
      math("r_02", 40, "a := f(1)"),
      math("r_03", 80, "f(x) := x + 100"),
      math("r_04", 120, "b := f(1)"),
    ]);
    ws.recompute();
    expect(asScalar((ws.getResult("r_02") as { value: Value }).value).si).toBe(2);
    expect(asScalar((ws.getResult("r_04") as { value: Value }).value).si).toBe(101);
  });
});
