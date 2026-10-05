/**
 * The unit a value is listed in (values panel): the user's choice, else what
 * the definition was written in, else a unit that suits its size.
 */

import { describe, expect, it } from "vitest";
import { formatValueParts, readableUnit, writtenUnitOf } from "../src/document/valueUnits.js";
import { applyPatch } from "../src/api/operations.js";
import { emptySheet, parseSheet, serializeSheet } from "../src/document/sheet.js";
import { evaluateStatement, type Environment } from "../src/eval.js";
import { parseStatement } from "../src/parser.js";
import type { Value } from "../src/value.js";

/** The value of one expression, written as it would be on a sheet. */
const value = (src: string): never => {
  const env: Environment = new Map();
  return (evaluateStatement(parseStatement(`x := ${src}`), env) as { value: Value }).value as never;
};

describe("what the definition was written in", () => {
  it("takes a literal's unit", () => {
    expect(writtenUnitOf("q_D := 65 psf")).toBe("psf");
    expect(writtenUnitOf("d := -17.7 in")).toBe("in");
    expect(writtenUnitOf("v := [2 ft; 3 ft]")).toBe("ft");
  });

  it("prefers the unit the region asks to be shown in", () => {
    expect(writtenUnitOf("M := w*L^2/8 = kip*ft")).toBe("kip*ft");
  });

  it("has none for something computed, mixed, or not a definition", () => {
    expect(writtenUnitOf("w := q*s")).toBeUndefined();
    expect(writtenUnitOf("v := [2 ft; 3 in]")).toBeUndefined();
    expect(writtenUnitOf("f(x) := 2 ft")).toBeUndefined();
    expect(writtenUnitOf("not ( valid")).toBeUndefined();
  });
});

describe("a unit that suits the size", () => {
  it("reads a small stress in psf, not thousandths of a ksi", () => {
    expect(readableUnit(value("65 psf"))).toBe("psf");
    expect(readableUnit(value("150 psi"))).toBe("psi");
    expect(readableUnit(value("36 ksi"))).toBe("ksi");
  });

  it("reads a flange thickness in inches and a span in feet", () => {
    expect(readableUnit(value("0.366 in"))).toBe("in");
    expect(readableUnit(value("30 ft"))).toBe("ft");
  });

  it("reads section properties in inches", () => {
    expect(readableUnit(value("6.07 in^3"))).toBe("in^3");
    expect(readableUnit(value("510 in^4"))).toBe("in^4");
  });
});

describe("listing a value", () => {
  it("uses the unit asked for when it fits, and ignores one that does not", () => {
    expect(formatValueParts(value("65 psf"), "ksi")).toEqual({ text: "0.000451389", unit: "ksi" });
    expect(formatValueParts(value("65 psf"), "ft")).toEqual({ text: "65", unit: "psf" });
    expect(formatValueParts(value("65 psf"), "nonsense")).toEqual({ text: "65", unit: "psf" });
  });

  it("lists a column of one dimension under one unit", () => {
    expect(formatValueParts(value("[0.0295 in; 0.0358 in]"))).toEqual({ text: "[0.0295; 0.0358]", unit: "in" });
  });

  it("lists a plain number as a plain number", () => {
    expect(formatValueParts(value("0.9"))).toEqual({ text: "0.9" });
  });
});

describe("the list's units, in the sheet", () => {
  const ctx = { client: "test" };

  it("are set, merged, and cleared with null", () => {
    let { sheet } = applyPatch(emptySheet(), [{ op: "configure", valueUnits: { q_D: "psf", d: "in" } }], ctx);
    expect(sheet.valueUnits).toEqual({ q_D: "psf", d: "in" });
    ({ sheet } = applyPatch(sheet, [{ op: "configure", valueUnits: { d: null, L: "ft" } }], ctx));
    expect(sheet.valueUnits).toEqual({ q_D: "psf", L: "ft" });
    ({ sheet } = applyPatch(sheet, [{ op: "configure", valueUnits: { q_D: null, L: null } }], ctx));
    expect(sheet).not.toHaveProperty("valueUnits");
  });

  it("refuses something that is not a name and a unit", () => {
    expect(() =>
      applyPatch(emptySheet(), [{ op: "configure", valueUnits: { "not a name": "ft" } }], ctx),
    ).toThrow(/valueUnits/);
  });

  it("round-trip through the file, in name order", () => {
    const { sheet } = applyPatch(emptySheet(), [{ op: "configure", valueUnits: { z: "in", a: "ft" } }], ctx);
    const text = serializeSheet(sheet);
    expect(text.indexOf('"a": "ft"')).toBeLessThan(text.indexOf('"z": "in"'));
    expect(parseSheet(text).valueUnits).toEqual({ a: "ft", z: "in" });
  });
});
