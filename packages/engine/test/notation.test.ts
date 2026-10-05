import { describe, expect, it } from "vitest";
import { asScalar, type Value } from "../src/value.js";
import { renderNamePlain, splitName } from "../src/notation.js";
import { parseStatement } from "../src/parser.js";
import { evaluateStatement, getValue, type Environment } from "../src/eval.js";
import { valueIn } from "../src/units/parse.js";
import type { Definition } from "../src/ast.js";

describe("name splitting", () => {
  it("splits a subscript", () => {
    expect(splitName("M_u")).toEqual({ base: "M", primes: "", subscript: "u" });
  });

  it("keeps a prime with the base", () => {
    expect(splitName("f'_c")).toEqual({ base: "f", primes: "'", subscript: "c" });
  });

  it("treats only the first underscore as the split", () => {
    // phi_M_n is read "phi sub M-n", not a nested subscript.
    expect(splitName("phi_M_n")).toEqual({
      base: "φ",
      primes: "",
      subscript: "M,n",
    });
  });

  it("renders ASCII Greek as the letter", () => {
    expect(splitName("phi").base).toBe("φ");
    expect(splitName("Delta_T").base).toBe("Δ");
    expect(splitName("Mu").base).toBe("Mu"); // only whole words, not prefixes
  });

  it("leaves a plain name alone", () => {
    expect(splitName("DCR")).toEqual({ base: "DCR", primes: "" });
    expect(renderNamePlain("DCR")).toBe("DCR");
  });
});

describe("inline result: `a := 1+2 = 3`", () => {
  const run = (src: string, env: Environment = new Map()) =>
    evaluateStatement(parseStatement(src), env);

  it("defines and displays in one statement", () => {
    const stmt = parseStatement("a := 1+2 =") as Definition;
    expect(stmt.kind).toBe("definition");
    expect(stmt.showResult).toBe(true);

    const env: Environment = new Map();
    const r = run("a := 1+2 =", env);
    expect(r.defined).toBe("a");
    expect(r.showResult).toBe(true);
    expect(asScalar(r.value).si).toBe(3);
    expect(asScalar(getValue(env, "a")!).si).toBe(3); // still defines the name
  });

  it("accepts a display unit on the same line", () => {
    const env: Environment = new Map();
    run("w_u := 2.4 klf", env);
    run("L := 25 ft", env);
    const r = run("M_u := w_u*L^2/8 = kip*ft", env);

    expect(r.defined).toBe("M_u");
    expect(r.displayUnit).toBe("kip*ft");
    expect(r.displayValue).toBeCloseTo(187.5, 9);
    expect(valueIn(getValue(env, "M_u") as never, "kip*ft")).toBeCloseTo(187.5, 9);
  });

  it("leaves a plain definition undisplayed", () => {
    const stmt = parseStatement("a := 1+2") as Definition;
    expect(stmt.showResult).toBeUndefined();
    expect(run("a := 1+2").showResult).toBeUndefined();
  });

  it("still parses a bare evaluation", () => {
    const env: Environment = new Map();
    run("a := 5 ft", env);
    const r = run("a = in", env);
    expect(r.defined).toBeUndefined();
    expect(r.displayValue).toBeCloseTo(60, 9);
  });

  it("rejects a bad display unit on a definition", () => {
    const env: Environment = new Map();
    expect(() => run("M := 3 kip = ksi", env)).toThrow();
  });
});
