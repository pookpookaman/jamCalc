import { describe, expect, it } from "vitest";
import { formatNumber, resolveFormat } from "../src/document/format.js";
import { displayUnitOf, setDisplayUnit } from "../src/document/source.js";
import { unitsForDimension } from "../src/units/registry.js";
import { DIM } from "../src/dimension.js";
import { CalcError } from "../src/errors.js";
import { emptySheet, parseSheet, serializeSheet } from "../src/document/sheet.js";

describe("number formatting", () => {
  it("defaults to enough digits to be honest", () => {
    expect(formatNumber(0.5241087)).toBe("0.524109");
    expect(formatNumber(187.5)).toBe("187.5");
  });

  it("fixes decimal places", () => {
    expect(formatNumber(0.5241087, { decimals: 2 })).toBe("0.52");
    expect(formatNumber(187.5, { decimals: 0 })).toBe("188");
    expect(formatNumber(2, { decimals: 3 })).toBe("2.000");
  });

  it("never prints a negative zero", () => {
    // "-0.00" reads as a sign nobody intended.
    expect(formatNumber(-0.0001, { decimals: 2 })).toBe("0.00");
  });

  it("rounds to significant figures", () => {
    expect(formatNumber(0.5241087, { sig: 3 })).toBe("0.524");
    expect(formatNumber(187.5, { sig: 2 })).toBe("190");
  });

  it("prefers decimals when both are set", () => {
    expect(formatNumber(1.23456, { decimals: 1, sig: 4 })).toBe("1.2");
  });

  it("uses exponent form at the extremes", () => {
    expect(formatNumber(2250000)).toContain("e+");
    expect(formatNumber(0.0000123)).toContain("e-");
  });

  it("writes exponents as the sheet's notation says (ADR-0017)", () => {
    expect(formatNumber(27116400, { sig: 3, notation: "normal" })).toBe("27100000");
    expect(formatNumber(0.0000123, { sig: 3, notation: "normal" })).toBe("0.0000123");
    expect(formatNumber(27116400, { sig: 3, notation: "scientific" })).toBe("2.71e+7");
    expect(formatNumber(27116400, { sig: 3, notation: "engineering" })).toBe("27.1e+6");
    expect(formatNumber(0.00412, { decimals: 1, notation: "engineering" })).toBe("4.1e-3");
    // Rounding that carries into the next power moves the exponent, not the mantissa.
    expect(formatNumber(999.97, { sig: 3, notation: "engineering" })).toBe("1e+3");
  });

  it("falls back field by field from region to sheet", () => {
    expect(resolveFormat({ decimals: 2 }, { sig: 4 })).toEqual({ decimals: 2, sig: 4 });
    expect(resolveFormat(undefined, { decimals: 3 })).toEqual({ decimals: 3 });
    expect(resolveFormat(undefined, undefined)).toBeUndefined();
  });
});

describe("setting a display unit", () => {
  it("adds one to a definition that has none", () => {
    expect(setDisplayUnit("M := w*L", "kip*ft")).toBe("M := w*L = kip*ft");
  });

  it("replaces an existing one", () => {
    expect(setDisplayUnit("M := w*L = kN*m", "kip*ft")).toBe("M := w*L = kip*ft");
  });

  it("replaces one on a bare evaluation", () => {
    expect(setDisplayUnit("M = kN*m", "kip*ft")).toBe("M = kip*ft");
    expect(setDisplayUnit("M =", "kip*ft")).toBe("M = kip*ft");
  });

  it("clears one, leaving the value shown", () => {
    expect(setDisplayUnit("M := w*L = kip*ft", null)).toBe("M := w*L =");
  });

  it("is not fooled by = inside a comparison", () => {
    // A regex hunting for `=` would splice into `>=` and produce nonsense.
    expect(setDisplayUnit("ok := if(a >= b, a, b)", "kip")).toBe(
      "ok := if(a >= b, a, b) = kip",
    );
    expect(setDisplayUnit("d := a != b", "kip")).toBe("d := a != b = kip");
  });

  it("rejects a unit that does not parse, before touching the source", () => {
    expect(() => setDisplayUnit("M := w*L", "furlong")).toThrow();
  });

  it("reports the unit currently written", () => {
    expect(displayUnitOf("M := w*L = kip*ft")).toBe("kip*ft");
    expect(displayUnitOf("M := w*L")).toBeUndefined();
    expect(displayUnitOf("not valid ((")).toBeUndefined();
  });
});

describe("units offered for a dimension", () => {
  it("lists only compatible units, largest first", () => {
    const names = unitsForDimension(DIM.FORCE).map((u) => u.name);
    expect(names).toContain("kip");
    expect(names).toContain("lbf");
    expect(names).not.toContain("ft");
    expect(names.indexOf("kip")).toBeLessThan(names.indexOf("lbf"));
  });

  it("excludes affine units, which cannot express a difference", () => {
    const names = unitsForDimension(DIM.TEMPERATURE).map((u) => u.name);
    expect(names).not.toContain("degC");
    expect(names).toContain("delta_degC");
  });
});

describe("title block travels with the document", () => {
  it("round-trips through save and open", () => {
    // It used to be app state, so Save and Open silently dropped the project
    // name and revision — the fields most likely to matter on paper.
    const sheet = {
      ...emptySheet("T"),
      titleBlock: { project: "Riverside", by: "JD", rev: "B" },
      format: { decimals: 2 },
    };
    const back = parseSheet(serializeSheet(sheet));
    expect(back.titleBlock).toEqual({ project: "Riverside", by: "JD", rev: "B" });
    expect(back.format).toEqual({ decimals: 2 });
  });

  it("reads an older sheet that had no title block", () => {
    const back = parseSheet(
      JSON.stringify({ schemaVersion: 1, title: "Old", regions: [], changeLog: [] }),
    );
    expect(back.titleBlock).toEqual({});
  });
});

describe("errors from setDisplayUnit stay structured", () => {
  it("reports a source that does not parse", () => {
    expect(() => setDisplayUnit("a := ((", "kip")).toThrow(CalcError);
  });
});

describe("display units offered to the picker", () => {
  it("offers compound expressions, not just registry entries", async () => {
    const { displayUnitsFor } = await import("../src/units/display.js");
    const moment = displayUnitsFor(DIM.MOMENT).map((u) => u.expression);
    // A moment offered only as joules is technically correct and useless.
    expect(moment).toContain("kip*ft");
    expect(moment).toContain("kN*m");
    expect(moment).toContain("J");
    expect(moment.indexOf("kip*ft")).toBeLessThan(moment.indexOf("J"));
  });

  it("offers powers of length for a second moment of area", async () => {
    const { displayUnitsFor } = await import("../src/units/display.js");
    expect(displayUnitsFor(DIM.SECOND_MOMENT_OF_AREA).map((u) => u.expression)).toContain(
      "in^4",
    );
  });

  it("every offered expression actually parses to that dimension", async () => {
    const { displayUnitsFor } = await import("../src/units/display.js");
    const { parseUnit } = await import("../src/units/parse.js");
    for (const dim of [DIM.FORCE, DIM.MOMENT, DIM.STRESS, DIM.LENGTH, DIM.AREA]) {
      for (const u of displayUnitsFor(dim)) {
        expect(parseUnit(u.expression).dimension.equals(dim)).toBe(true);
      }
    }
  });
});
