/**
 * A backtick keeps a word as written (ADR-0015).
 *
 * `phi` prints as φ; `` `phi `` prints as the word. The backtick is part of the
 * name, which is what keeps every use of a name drawn the same way, and what
 * makes the did-you-mean message necessary.
 */

import { describe, expect, it } from "vitest";
import { splitName } from "../src/notation.js";
import { tokenize } from "../src/lexer.js";
import { parseStatement } from "../src/parser.js";
import { evaluateStatement, getValue, type Environment } from "../src/eval.js";
import { asScalar } from "../src/value.js";
import { isValidColumnName } from "../src/document/table.js";
import { latexToSource, sourceToLatex } from "../src/latex.js";
import type { Definition } from "../src/ast.js";

const BACKSLASH = String.fromCharCode(92);
const nameOf = (source: string): string => (parseStatement(source) as Definition).name;

describe("drawing a marked word", () => {
  it("keeps the word instead of the letter", () => {
    expect(splitName("`phi").base).toBe("phi");
    expect(splitName("phi").base).toBe("φ");
  });

  it("marks one word, not the whole name", () => {
    expect(splitName("`phi_alpha")).toEqual({ base: "phi", primes: "", subscript: "α" });
    expect(splitName("phi_`alpha")).toEqual({ base: "φ", primes: "", subscript: "alpha" });
    expect(splitName("M_`beta_c").subscript).toBe("beta,c");
  });

  it("keeps primes with a marked base", () => {
    expect(splitName("`f'_c")).toEqual({ base: "f", primes: "'", subscript: "c" });
  });
});

describe("writing a marked name", () => {
  it("reads the backtick as part of the name", () => {
    const [first] = tokenize("`phi := 1");
    expect(first).toMatchObject({ kind: "identifier", text: "`phi" });
    expect(nameOf("M_`beta := 1")).toBe("M_`beta");
  });

  it("refuses a backtick that is not directly before a word", () => {
    for (const bad of ["p`hi := 1", "M_u` := 1", "` := 1", "`2 := 1", "a_` := 1"]) {
      expect(() => tokenize(bad), bad).toThrow(/backtick/);
    }
  });

  it("points at the misplaced backtick", () => {
    try {
      tokenize("x := p`hi");
      expect.unreachable();
    } catch (e) {
      expect((e as { span: readonly number[] }).span).toEqual([6, 7]);
    }
  });

  it("applies the same rule to table columns", () => {
    expect(isValidColumnName("`beta")).toBe(true);
    expect(isValidColumnName("L_`span")).toBe(true);
    expect(isValidColumnName("be`ta")).toBe(false);
  });
});

describe("evaluating marked names", () => {
  const run = (src: string, env: Environment) => evaluateStatement(parseStatement(src), env);

  it("computes with them like any other name", () => {
    const env: Environment = new Map();
    run("`pi := 3", env);
    expect(asScalar(run("a := `pi*2 =", env).value).si).toBe(6);
  });

  it("keeps the marked and unmarked spellings apart", () => {
    const env: Environment = new Map();
    run("pi := 1", env);
    run("`pi := 2", env);
    expect(asScalar(getValue(env, "pi")!).si).toBe(1);
    expect(asScalar(getValue(env, "`pi")!).si).toBe(2);
  });

  it("names the spelling that does exist", () => {
    const env: Environment = new Map();
    run("`pi := 3", env);
    expect(() => run("a := pi*2", env)).toThrow(/did you mean “`pi”/);

    const other: Environment = new Map();
    run("beta := 1", other);
    expect(() => run("a := `beta", other)).toThrow(/did you mean `beta`/);
  });

  it("says nothing extra when neither spelling exists", () => {
    expect(() => run("a := zeta", new Map())).toThrow(/^`zeta` is not defined$/);
  });

  it("names the other spelling for a function too", () => {
    const env: Environment = new Map();
    run("`f(x) := x", env);
    expect(() => run("a := f(2)", env)).toThrow(/did you mean “`f”/);
  });
});

describe("marked names in the math editor", () => {
  it("is not given a Greek command", () => {
    const latex = sourceToLatex("`phi := 0.9");
    expect(latex).not.toContain(BACKSLASH + "phi");
    expect(latex).toContain("`phi");
  });

  it("round-trips a marked base and a marked subscript", () => {
    for (const source of ["`phi := 0.9", "M_`beta := 1", "`phi_`alpha := 2", "`f'_c := 4"]) {
      expect(nameOf(latexToSource(sourceToLatex(source))), source).toBe(nameOf(source));
    }
  });

  it("reads what the editor hands back when a backtick is typed", () => {
    // Taken from the editor itself: a typed backtick arrives untouched, and a
    // subscript arrives braced.
    expect(nameOf(latexToSource("`phi:=0.9"))).toBe("`phi");
    expect(nameOf(latexToSource("M_{`beta}:=1"))).toBe("M_`beta");
  });

  it("still turns an unmarked Greek name into the letter", () => {
    expect(nameOf(latexToSource(sourceToLatex("phi := 0.9")))).toBe("phi");
  });
});
