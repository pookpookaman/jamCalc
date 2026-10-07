/**
 * Sheet settings (ADR-0017): the units a result with none of its own is shown
 * in, kept through a save, and refused when they make no sense.
 */

import { describe, expect, it } from "vitest";
import { DIM } from "../src/dimension.js";
import { preferredUnit } from "../src/units/prefer.js";
import { emptySheet, parseSheet, serializeSheet } from "../src/document/sheet.js";
import { applyPatch } from "../src/api/patch.js";
import { ApiError } from "../src/api/errors.js";

const CTX = { client: "test", now: () => new Date("2026-10-07T00:00:00Z") };

describe("sheet settings", () => {
  it("shows a result in the sheet's system, with its overrides on top", () => {
    expect(preferredUnit(DIM.MOMENT)).toBe("kip*ft");
    expect(preferredUnit(DIM.MOMENT, { system: "si" })).toBe("kN*m");
    expect(preferredUnit(DIM.LENGTH, { system: "si", length: "mm" })).toBe("mm");
    // An override of the wrong kind is ignored: a length is never shown in kip.
    expect(preferredUnit(DIM.LENGTH, { length: "kip" } as never)).toBe("ft");
  });

  it("keeps units, numbers and text through a save", () => {
    const { sheet } = applyPatch(emptySheet(), [
      {
        op: "configure",
        units: { system: "si", moment: "N*mm" },
        format: { sig: 3, notation: "engineering" },
        textStyle: { textSize: 16, textBold: false, textFont: "serif" },
      },
    ], CTX);
    const back = parseSheet(serializeSheet(sheet));
    expect(back.units).toEqual({ system: "si", moment: "N*mm" });
    expect(back.format).toEqual({ sig: 3, notation: "engineering" });
    expect(back.textStyle).toEqual({ textSize: 16, textBold: false, textFont: "serif" });
  });

  it("refuses a setting the sheet could not keep, and clears one given null", () => {
    expect(() => applyPatch(emptySheet(), [{ op: "configure", units: { length: "kip" } }], CTX)).toThrow(ApiError);
    const { sheet } = applyPatch(emptySheet(), [{ op: "configure", units: { system: "si", force: "kN" } }], CTX);
    const { sheet: cleared } = applyPatch(sheet, [{ op: "configure", units: { force: null } }], CTX);
    expect(cleared.units).toEqual({ system: "si" });
  });
});
