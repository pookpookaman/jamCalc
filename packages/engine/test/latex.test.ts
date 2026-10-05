/**
 * The LaTeX boundary.
 *
 * The risk is a lossy round trip: if what the editor hands back
 * does not mean what the user typed, every edit corrupts a sheet in a way
 * nobody notices until print. The editor seeds itself from our LaTeX and hands
 * LaTeX back, so *that* is the round trip these tests exist to pin.
 */

import { describe, expect, it } from "vitest";
import { latexToSource, sourceToLatex } from "../src/latex.js";
import { parseStatement } from "../src/parser.js";
import { Worksheet } from "../src/document/worksheet.js";
import { humanAuthorship, type Region } from "../src/document/region.js";

const region = (id: string, source: string): Region => ({
  kind: "math", id, position: { x: 48, y: 0 }, source,
  origin: humanAuthorship(new Date("2026-09-05T00:00:00Z")),
});

/** Source -> LaTeX -> source, which is what an untouched edit does. */
const roundTrip = (source: string): string => latexToSource(sourceToLatex(source));

/**
 * Two sources agree when they parse to the same tree.
 *
 * Every span is dropped: the text moves, and where it sits is not what the
 * round trip is promising to preserve.
 */
const sameMeaning = (a: string, b: string): boolean => {
  const strip = (o: unknown): unknown =>
    JSON.parse(
      JSON.stringify(o, (k, v) => (/[Ss]pan$/.test(k) ? undefined : v)),
    );
  return (
    JSON.stringify(strip(parseStatement(a))) ===
    JSON.stringify(strip(parseStatement(b)))
  );
};

const CASES = [
  "a := 1",
  "L := 25 ft",
  "M_u := w_u*L^2/8",
  "M_u := w_u*L^2/8 = kip*ft",
  "DCR := M_u/phi_M_n =",
  "x := (a + b)*c",
  "y := a/(b*c)",
  "z := a/b/c",
  "s := sqrt(2*g*h)",
  "t := sin(theta) + cos(theta)",
  "f(x, y) := x*y + 1",
  "v := [1, 2; 3, 4]",
  "n := v[2]",
  "r := 1..5",
  "c := a <= b",
  "d := a != b",
  "e := -x + 2",
  "g := 2^(n + 1)",
  "h := f'_c",
  "k := alpha*beta",
  // The case that caught a wrong-number bug: without brackets round the united
  // number, the power bound to the unit and 187.5 kip*ft became 7.5.
  "M := 2.4 klf*(25 ft)^2/8 = kip*ft",
  "q := (2 m)^3",
  "p := 2 m^3",
];

describe("source survives a trip through the editor", () => {
  for (const source of CASES) {
    it(`round-trips \`${source}\``, () => {
      const back = roundTrip(source);
      expect(
        sameMeaning(source, back),
        `\`${source}\` came back as \`${back}\` (via ${sourceToLatex(source)})`,
      ).toBe(true);
    });
  }

  it("keeps the computed value identical across the trip", () => {
    // The real test of a round trip is not the text but the number.
    const source = "M := 2.4 klf*(25 ft)^2/8 = kip*ft";
    const one = new Worksheet([region("r_01", source)]);
    const two = new Worksheet([region("r_01", roundTrip(source))]);
    one.recompute();
    two.recompute();
    const a = one.getResult("r_01");
    const b = two.getResult("r_01");
    expect(a?.status).toBe("ok");
    expect(b?.status).toBe("ok");
    if (a?.status === "ok" && b?.status === "ok") {
      expect(b.value).toEqual(a.value);
    }
  });
});

describe("what the editor is given", () => {
  it("draws a division as a fraction", () => {
    expect(sourceToLatex("a := b/c")).toContain("\\frac{b}{c}");
  });

  it("draws a subscripted name as a subscript", () => {
    expect(sourceToLatex("M_u := 1")).toContain("M_{u}");
  });

  it("spells Greek as Greek", () => {
    expect(sourceToLatex("phi := 0.9")).toContain("\\phi");
  });

  it("sets units upright, so `2 m` does not read as `2 times m`", () => {
    expect(sourceToLatex("L := 2 m")).toContain("\\mathrm{m}");
  });

  it("brackets only where precedence needs it", () => {
    expect(sourceToLatex("x := (a + b)*c")).toContain("\\left(");
    expect(sourceToLatex("x := a + b*c")).not.toContain("\\left(");
  });

  it("keeps the display marker and its unit", () => {
    expect(sourceToLatex("M := 1 = kip*ft")).toMatch(/=\s*\\mathrm\{kip\*ft\}$/);
  });
});

describe("what comes back", () => {
  it("undoes a fraction", () => {
    expect(latexToSource("\\frac{a}{b}")).toBe("(a)/(b)");
  });

  it("undoes a nested fraction", () => {
    expect(latexToSource("\\frac{\\frac{a}{b}}{c}")).toBe("((a)/(b))/(c)");
  });

  it("turns \\cdot back into a multiply", () => {
    expect(latexToSource("a \\cdot b")).toBe("a * b");
  });

  it("keeps an exponent that needs its grouping", () => {
    expect(latexToSource("2^{n+1}")).toBe("2^(n+1)");
    expect(latexToSource("2^{3}")).toBe("2^3");
  });

  it("leaves something it does not understand alone", () => {
    // Better a visible syntax error than silently losing what was typed.
    const back = latexToSource("\\int_0^1 x");
    expect(back).toContain("int");
    expect(() => parseStatement(back)).toThrow();
  });

  it("does not mangle ordinary spaces", () => {
    expect(latexToSource("a + b")).toBe("a + b");
  });
});

describe("editing artefacts never reach the language", () => {
  /**
   * MathLive marks an empty slot with a placeholder, and a half-typed
   * expression is full of them. One reaching the parser turns the whole
   * region into "unexpected character", which is a report about the editor
   * rather than about the calculation.
   */
  it("drops a placeholder", () => {
    expect(latexToSource(String.raw`\placeholder{}`)).toBe("");
    expect(latexToSource(String.raw`a:=\placeholder{}`)).toBe("a:=");
    expect(latexToSource(String.raw`a:=b\cdot\placeholder{}`)).toBe("a:=b*");
  });

  it("drops a placeholder inside a fraction or a script", () => {
    expect(latexToSource(String.raw`\frac{b}{\placeholder{}}`)).toBe("(b)/()");
    expect(latexToSource(String.raw`M_{\placeholder{}}`)).toBe("M_");
  });

  it("drops presentation the language has no use for", () => {
    expect(latexToSource(String.raw`\displaystyle a:=5`)).toBe("a:=5");
  });

  /**
   * A command name ends at the first non-letter, which a word boundary does
   * not capture: between the `e` of `\le` and a following digit there is no
   * boundary at all, so these came through with the backslash intact.
   */
  it("converts a command that runs straight into a digit", () => {
    expect(latexToSource(String.raw`a\coloneq5`)).toBe("a:=5");
    expect(latexToSource(String.raw`a\le5`)).toBe("a<=5");
    expect(latexToSource(String.raw`a\ge5`)).toBe("a>=5");
    expect(latexToSource(String.raw`a\ne5`)).toBe("a!=5");
  });

  it("leaves a real backslash for anything it does not understand", () => {
    // Still the rule: unsupported maths must be visible as an error rather
    // than silently discarded.
    expect(latexToSource(String.raw`\int_0^1 x`)).toContain("int");
  });
});
