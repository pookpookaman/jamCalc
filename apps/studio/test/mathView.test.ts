/**
 * Square roots are drawn as radicals, not as a function called sqrt.
 *
 * Rendered to static markup, so this runs without a DOM. What the bar looks
 * like on paper is CSS and is checked by eye; what is tested here is the
 * structure that CSS relies on: the whole argument inside the radicand.
 */

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { parseStatement } from "@jamcalc/engine";
import { StatementView } from "../src/MathView.js";

const render = (source: string): string =>
  renderToStaticMarkup(createElement(StatementView, { statement: parseStatement(source) }));

describe("square roots", () => {
  it("draw a radical sign instead of the function name", () => {
    const html = render("a := sqrt(b)");
    expect(html).toContain("mv-sqrt");
    expect(html).toContain("mv-radical");
    expect(html).not.toContain(">sqrt<");
  });

  it("put the whole argument under the bar", () => {
    const html = render("a := sqrt(E/F_y)");
    const radicand = html.slice(html.indexOf("mv-radicand"));
    expect(radicand).toContain("mv-frac");
    expect(radicand).toContain("F");
  });

  it("leave other functions written by name", () => {
    const html = render("a := max(b, c)");
    expect(html).toContain(">max<");
    expect(html).not.toContain("mv-sqrt");
  });

  it("keep sqrt with the wrong number of arguments as written", () => {
    // The evaluator reports the arity error; the display must not hide it
    // behind a radical that looks like valid notation.
    const html = render("a := sqrt(b, c)");
    expect(html).toContain(">sqrt<");
  });
});

/**
 * Powers lay themselves out by what they are applied to. Position is CSS and
 * checked by measurement in the app; what is tested here is which layout each
 * base gets, and where brackets go.
 */
describe("powers", () => {
  it("keep a plain superscript beside a short base", () => {
    const html = render("a := x^2");
    expect(html).toContain("mv-exp");
    expect(html).not.toContain("mv-pow-tall");
    expect(html).not.toContain("mv-stretch");
  });

  it("raise the exponent beside a fraction, and bracket the fraction", () => {
    const html = render("a := (b/c)^2");
    expect(html).toContain("mv-pow-tall");
    const base = html.slice(html.indexOf("mv-pow-base"), html.indexOf("mv-exp"));
    expect(base).toContain("mv-stretch");
    expect(base).toContain("mv-frac");
  });

  it("leave a power inside a denominator alone", () => {
    // `b/c^2` squares only c: no brackets, and c is short.
    const html = render("a := b/c^2");
    expect(html).not.toContain("mv-pow-tall");
    expect(html).not.toContain("mv-stretch");
  });

  it("stretch the brackets round a sum that contains a fraction", () => {
    const html = render("a := (b + c/d)^2");
    expect(html).toContain("mv-pow-tall");
    expect(html).toContain("mv-stretch");
  });

  it("draw the brackets round a short sum too", () => {
    // Every bracket is drawn, so that all of them size to their contents;
    // there is no typed "(" left to be the wrong height beside a fraction.
    const html = render("a := (b + c)^2");
    expect(html).toContain("mv-stretch");
    expect(html).not.toContain("mv-paren");
  });

  it("draw the brackets round function arguments", () => {
    const html = render("a := max(b/c, d)");
    expect(html).toContain("mv-call");
    expect(html).toContain("mv-stretch");
    expect(html).not.toContain("mv-paren");
  });

  it("do not bracket a fraction that is not raised to a power", () => {
    expect(render("a := -(b/c)")).not.toContain("mv-stretch");
    expect(render("a := 2*b/c")).not.toContain("mv-stretch");
  });
});

describe("indexing", () => {
  it("draws the index of a plain name as a subscript", () => {
    const html = render("a := x[2]");
    expect(html).toContain("mv-index");
    expect(html).not.toContain("mv-index-bracket");
  });

  it("keeps the brackets when the name already has a subscript", () => {
    // w_t[row] once printed as w with subscript "trow".
    const html = render("a := w_t[row]");
    expect(html).toContain("mv-index-bracket");
    expect(html).not.toContain('class="mv-index"');
    const text = html.replace(/<[^>]+>/g, "");
    expect(text).toContain("wt[row]");
  });

  it("keeps the brackets on anything that is not a plain name", () => {
    expect(render("a := (b + c)[1]")).toContain("mv-index-bracket");
  });
});
