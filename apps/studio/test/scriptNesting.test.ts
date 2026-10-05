/**
 * One level of subscript, and no more.
 *
 * The editor decides whether `_` should go into a script or come out of one by
 * asking what the text gains when the caret steps out of whatever it is in.
 * These are the six shapes that matters for, taken from what MathLive actually
 * produces — the braces around a single character really are dropped.
 */

import { describe, expect, it } from "vitest";
import { endsInScript } from "../src/scriptNesting.js";

describe("recognising a closed script", () => {
  it("sees a braced subscript", () => {
    expect(endsInScript("M_{u}")).toBe(true);
  });

  it("sees a subscript whose braces were dropped", () => {
    // MathLive writes a single character without them.
    expect(endsInScript("M_u")).toBe(true);
  });

  it("sees a superscript either way", () => {
    expect(endsInScript("x^{2}")).toBe(true);
    expect(endsInScript("x^2")).toBe(true);
  });

  it("sees a script holding a command", () => {
    expect(endsInScript("x^" + String.fromCharCode(92) + "alpha")).toBe(true);
  });

  it("sees one at the end of a longer expression", () => {
    expect(endsInScript("a + b \\cdot M_{u}")).toBe(true);
  });
});

describe("not mistaking other groups for scripts", () => {
  it("does not see a fraction", () => {
    // The case that matters: subscripting inside a numerator must still work,
    // so stepping out of one must not read as leaving a script.
    expect(endsInScript("\\frac{a}{b}")).toBe(false);
  });

  it("does not see a root", () => {
    expect(endsInScript("\\sqrt{ab}")).toBe(false);
  });

  it("does not see a plain group", () => {
    expect(endsInScript("\\left(a+b\\right)")).toBe(false);
  });

  it("does not see bare text", () => {
    expect(endsInScript("a+b")).toBe(false);
    expect(endsInScript("")).toBe(false);
  });

  it("does not see a script that is still open", () => {
    // Nothing has been closed yet, so there is nothing to come out of.
    expect(endsInScript("M_{")).toBe(false);
  });
});
