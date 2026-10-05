/**
 * The operations the GUI needs.
 *
 * Every operation the GUI performs must be expressible through
 * the document API. Until now it could not express styling, sizing, display
 * units, number formats, styled runs, or any document setting — the GUI did
 * those by reaching into `Worksheet` directly, which is the API falling
 * behind the GUI, quietly. These tests pin the closed gap.
 */

import { describe, expect, it } from "vitest";
import { applyPatch } from "../src/api/patch.js";
import { ApiError } from "../src/api/errors.js";
import { emptySheet, type Sheet } from "../src/document/sheet.js";
import { humanAuthorship, type Region } from "../src/document/region.js";
import { plainText, runsFromText, type TextRun } from "../src/document/text.js";

const AT = new Date("2026-09-05T00:00:00Z");
const ctx = { client: "studio", now: () => AT };

const math = (id: string, y: number, source: string): Region => ({
  kind: "math", id, position: { x: 48, y }, source, origin: humanAuthorship(AT),
});
const text = (id: string, y: number, body: string): Region => ({
  kind: "text", id, position: { x: 48, y }, runs: runsFromText(body), origin: humanAuthorship(AT),
});

const base = (): Sheet => ({
  ...emptySheet("Sheet"),
  regions: [math("r_01", 0, "L := 25 ft"), math("r_02", 40, "M := L*2 ="), text("r_03", 80, "note")],
});

const region = (s: Sheet, id: string) => s.regions.find((r) => r.id === id)!;

describe("styling through the API", () => {
  it("sets a region style", () => {
    const { sheet } = applyPatch(base(), [
      { op: "update", id: "r_01", style: { fontSize: 16, color: "#b3261e" } },
    ], ctx);
    expect(region(sheet, "r_01").style).toEqual({ fontSize: 16, color: "#b3261e" });
  });

  it("merges into an existing style rather than replacing it", () => {
    const one = applyPatch(base(), [{ op: "update", id: "r_01", style: { fontSize: 16 } }], ctx);
    const two = applyPatch(one.sheet, [{ op: "update", id: "r_01", style: { bold: true } }], ctx);
    // Setting a colour must not silently clear a size someone chose earlier.
    expect(region(two.sheet, "r_01").style).toEqual({ fontSize: 16, bold: true });
  });
});

describe("size through the API", () => {
  it("sets and clears an explicit box size", () => {
    const set = applyPatch(base(), [{ op: "update", id: "r_03", size: { width: 240 } }], ctx);
    expect(region(set.sheet, "r_03").size).toEqual({ width: 240 });
    const cleared = applyPatch(set.sheet, [{ op: "update", id: "r_03", size: null }], ctx);
    expect(region(cleared.sheet, "r_03").size).toBeUndefined();
  });
});

describe("number format through the API", () => {
  it("sets a per-region format and clears one field", () => {
    const set = applyPatch(base(), [{ op: "update", id: "r_02", format: { decimals: 3 } }], ctx);
    expect(region(set.sheet, "r_02").format).toEqual({ decimals: 3 });
    const cleared = applyPatch(set.sheet, [
      { op: "update", id: "r_02", format: { decimals: undefined } },
    ], ctx);
    expect(region(cleared.sheet, "r_02").format).toBeUndefined();
  });
});

describe("display unit through the API", () => {
  it("rewrites the source rather than storing an override", () => {
    const { sheet } = applyPatch(base(), [{ op: "update", id: "r_02", unit: "in" }], ctx);
    // The printed sheet has to say what it computed, so the unit lives in the
    // source the reader sees — the same rule setInputs follows.
    expect((region(sheet, "r_02") as { source: string }).source).toBe("M := L*2 = in");
  });

  it("clears the unit but keeps the region showing its value", () => {
    const set = applyPatch(base(), [{ op: "update", id: "r_02", unit: "in" }], ctx);
    const { sheet } = applyPatch(set.sheet, [{ op: "update", id: "r_02", unit: null }], ctx);
    expect((region(sheet, "r_02") as { source: string }).source).toBe("M := L*2 =");
  });

  it("rejects a unit that is not one, changing nothing", () => {
    const before = base();
    expect(() => applyPatch(before, [{ op: "update", id: "r_02", unit: "wombats" }], ctx)).toThrow(
      ApiError,
    );
    expect(before.regions).toEqual(base().regions);
  });

  it("refuses a display unit on a text region", () => {
    expect(() => applyPatch(base(), [{ op: "update", id: "r_03", unit: "ft" }], ctx)).toThrow(
      /applies to math/,
    );
  });
});

describe("styled runs through the API", () => {
  it("accepts runs, preserving per-character styling", () => {
    const runs: TextRun[] = [
      { text: "safe", style: { color: "#1a7f37" } },
      { text: " margin" },
    ];
    const { sheet } = applyPatch(base(), [{ op: "update", id: "r_03", runs }], ctx);
    const r = region(sheet, "r_03") as Extract<Region, { kind: "text" }>;
    expect(plainText(r.runs)).toBe("safe margin");
    expect(r.runs[0]!.style).toEqual({ color: "#1a7f37" });
  });

  it("refuses text and runs together rather than guessing", () => {
    expect(() =>
      applyPatch(base(), [{ op: "update", id: "r_03", text: "a", runs: [{ text: "b" }] }], ctx),
    ).toThrow(/not both/);
  });

  it("rejects an update that changes nothing", () => {
    expect(() => applyPatch(base(), [{ op: "update", id: "r_01" }], ctx)).toThrow(/changes nothing/);
  });
});

describe("moving to coordinates", () => {
  it("moves a region to an explicit position", () => {
    const { sheet } = applyPatch(base(), [{ op: "move", id: "r_01", to: { x: 300, y: 200 } }], ctx);
    expect(region(sheet, "r_01").position).toEqual({ x: 300, y: 200 });
  });

  it("still supports the semantic form", () => {
    const { sheet } = applyPatch(base(), [{ op: "move", id: "r_01", after: "r_02" }], ctx);
    expect(region(sheet, "r_01").position.y).toBeGreaterThan(40);
  });

  it("insists on exactly one of after and to", () => {
    expect(() => applyPatch(base(), [{ op: "move", id: "r_01" }], ctx)).toThrow(/exactly one/);
    expect(() =>
      applyPatch(base(), [{ op: "move", id: "r_01", after: "r_02", to: { x: 0, y: 0 } }], ctx),
    ).toThrow(/exactly one/);
  });

  it("rejects a position off the page", () => {
    expect(() =>
      applyPatch(base(), [{ op: "move", id: "r_01", to: { x: -10, y: 0 } }], ctx),
    ).toThrow(/non-negative/);
  });
});

describe("document settings through the API", () => {
  it("sets the title and title block", () => {
    const { sheet, configured } = applyPatch(base(), [
      { op: "configure", title: "Footing F-1", titleBlock: { project: "P", by: "JD", rev: "A" } },
    ], ctx);
    expect(sheet.title).toBe("Footing F-1");
    expect(sheet.titleBlock).toEqual({ project: "P", by: "JD", rev: "A" });
    expect(configured).toBe(true);
  });

  it("merges page setup rather than replacing it", () => {
    const { sheet } = applyPatch(base(), [
      { op: "configure", page: { orientation: "landscape" } },
    ], ctx);
    expect(sheet.page.orientation).toBe("landscape");
    expect(sheet.page.margins).toEqual(base().page.margins);
  });

  it("sets a header band, and empties it with null", () => {
    const { sheet } = applyPatch(base(), [
      {
        op: "configure",
        header: { items: [{ id: "i_01", kind: "field", field: "project", x: 48, y: 20, width: 200, height: 18 }] },
      },
    ], ctx);
    expect(sheet.page.header?.items).toHaveLength(1);
    const emptied = applyPatch(sheet, [{ op: "configure", header: null }], ctx);
    expect(emptied.sheet.page.header).toBeUndefined();
  });

  it("refuses a header that is not a band", () => {
    expect(() =>
      applyPatch(base(), [{ op: "configure", header: { items: "nope" } as never }], ctx),
    ).toThrow(/header/);
  });

  it("sets the sheet-number offset, and refuses a nonsense one", () => {
    const { sheet } = applyPatch(base(), [{ op: "configure", page: { firstSheet: 12, totalSheets: 40 } }], ctx);
    expect([sheet.page.firstSheet, sheet.page.totalSheets]).toEqual([12, 40]);
    expect(() => applyPatch(base(), [{ op: "configure", page: { firstSheet: 0 } }], ctx)).toThrow(/firstSheet/);
    expect(() => applyPatch(base(), [{ op: "configure", page: { totalSheets: 2.5 } }], ctx)).toThrow(/totalSheets/);
  });

  it("refuses a title-block field that does not exist", () => {
    expect(() =>
      applyPatch(base(), [{ op: "configure", titleBlock: { nope: "x" } as never }], ctx),
    ).toThrow(/nope/);
  });

  it("sets and clears the sheet number format", () => {
    const set = applyPatch(base(), [{ op: "configure", format: { sig: 4 } }], ctx);
    expect(set.sheet.format).toEqual({ sig: 4 });
    const cleared = applyPatch(set.sheet, [
      { op: "configure", format: { sig: undefined } },
    ], ctx);
    expect(cleared.sheet.format).toBeUndefined();
  });

  it("rejects a configure that changes nothing", () => {
    expect(() => applyPatch(base(), [{ op: "configure" }], ctx)).toThrow(/changes nothing/);
  });
});

describe("what a patch reports back", () => {
  it("names every region it touched", () => {
    const { changed } = applyPatch(base(), [
      { op: "update", id: "r_01", source: "L := 30 ft" },
      { op: "update", id: "r_03", text: "revised" },
    ], ctx);
    expect(new Set(changed)).toEqual(new Set(["r_01", "r_03"]));
  });

  it("includes regions that only shifted to make room", () => {
    // The shell recomputes from `changed`; a region that moved but was not
    // named would keep a stale layout.
    const tight: Sheet = {
      ...emptySheet("S"),
      regions: [math("r_01", 0, "a := 1"), math("r_02", 12, "b := 2")],
    };
    const { changed } = applyPatch(tight, [
      { op: "insert", kind: "math", after: "r_01", source: "c := 3" },
    ], ctx);
    expect(changed).toContain("r_02");
  });

  it("names a deleted region", () => {
    const { changed } = applyPatch(base(), [{ op: "delete", id: "r_02" }], ctx);
    expect(changed).toEqual(["r_02"]);
  });

  it("reports configured only when a setting changed", () => {
    expect(applyPatch(base(), [{ op: "update", id: "r_01", style: { bold: true } }], ctx).configured)
      .toBe(false);
  });
});

describe("atomicity still holds across the new operations", () => {
  it("applies nothing when a later operation fails", () => {
    const before = base();
    expect(() =>
      applyPatch(before, [
        { op: "update", id: "r_01", style: { bold: true } },
        { op: "configure", title: "Changed" },
        { op: "update", id: "r_99", source: "x := 1" },
      ], ctx),
    ).toThrow(ApiError);
    expect(before.title).toBe("Sheet");
    expect(region(before, "r_01").style).toBeUndefined();
  });

});
