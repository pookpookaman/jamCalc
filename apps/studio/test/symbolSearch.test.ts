/**
 * Searching the values list.
 *
 * A name is found by how it is spelled and by how it is drawn, so a search for
 * what is printed on the page finds the definition behind it.
 */

import { describe, expect, it } from "vitest";
import { matchesSymbol } from "../src/symbolSearch.js";

describe("searching the values list", () => {
  it("shows everything for an empty search", () => {
    expect(matchesSymbol("M_u", "")).toBe(true);
    expect(matchesSymbol("M_u", "   ")).toBe(true);
  });

  it("matches part of a name, ignoring case", () => {
    expect(matchesSymbol("DCR_max", "dcr")).toBe(true);
    expect(matchesSymbol("DCR_max", "MAX")).toBe(true);
    expect(matchesSymbol("DCR_max", "phi")).toBe(false);
  });

  it("finds a subscripted name with or without the underscore", () => {
    expect(matchesSymbol("M_u", "M_u")).toBe(true);
    expect(matchesSymbol("M_u", "Mu")).toBe(true);
    expect(matchesSymbol("phi_M_n", "M_n")).toBe(true);
  });

  it("finds a Greek name by its spelling or its letter", () => {
    expect(matchesSymbol("phi_M_n", "phi")).toBe(true);
    expect(matchesSymbol("phi_M_n", "φ")).toBe(true);
    expect(matchesSymbol("lambda_pf", "λ")).toBe(true);
    expect(matchesSymbol("Delta_L", "Δ")).toBe(true);
  });

  it("finds a name kept as written with or without its backtick", () => {
    expect(matchesSymbol("`pi", "pi")).toBe(true);
    expect(matchesSymbol("`pi", "`pi")).toBe(true);
    expect(matchesSymbol("pi", "`pi")).toBe(true);
  });

  it("does not find a word kept as written by the letter it is not", () => {
    expect(matchesSymbol("`pi", "π")).toBe(false);
    expect(matchesSymbol("pi", "π")).toBe(true);
  });
});
