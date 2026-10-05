/**
 * A table too tall for a page breaks between its rows.
 *
 * The last pagination case. A table that cannot fit anywhere
 * used to run off the bottom of the page onto an unnumbered sheet; pushing it
 * only moved the problem, so it was flagged and left. This splits it.
 */

import { describe, expect, it } from "vitest";
import { contentBox, paginate, type TableMetrics } from "../src/document/layout.js";
import { DEFAULT_PAGE } from "../src/document/sheet.js";
import { humanAuthorship, type Region, type TableRegion } from "../src/document/region.js";

const AT = new Date("2026-09-06T00:00:00Z");
const H = contentBox(DEFAULT_PAGE).height;

const table = (id: string, y: number, rows: number): TableRegion => ({
  kind: "table",
  id,
  position: { x: 48, y },
  columns: [{ name: "step" }, { name: "value" }],
  cells: Array.from({ length: rows }, (_, r) => [r + 1, r * 2]),
  origin: humanAuthorship(AT),
});

const math = (id: string, y: number): Region => ({
  kind: "math", id, position: { x: 48, y }, source: `${id} := 1`, origin: humanAuthorship(AT),
});

/** Header 40px, every row 20px — so 50 rows is 1040px, taller than a page. */
const metrics = (rows: number, rowHeight = 20, header = 40): TableMetrics => ({
  header,
  rows: Array.from({ length: rows }, () => rowHeight),
});

const opts = (id: string, m: TableMetrics) => ({ tableRows: new Map([[id, m]]) });

describe("splitting a tall table", () => {
  it("breaks it into pieces that each fit", () => {
    const rows = 60; // 40 + 60*20 = 1240 > 936
    const l = paginate([table("t", 0, rows)], DEFAULT_PAGE, opts("t", metrics(rows)));
    const parts = l.placement.get("t")?.fragments;
    expect(parts).toBeDefined();
    expect(parts!.length).toBeGreaterThan(1);
    for (const f of parts!) {
      const used = 40 + (f.endRow - f.firstRow) * 20;
      expect(f.y + used).toBeLessThanOrEqual(H);
    }
  });

  it("covers every row exactly once, in order", () => {
    const rows = 60;
    const l = paginate([table("t", 0, rows)], DEFAULT_PAGE, opts("t", metrics(rows)));
    const parts = l.placement.get("t")!.fragments!;
    expect(parts[0]!.firstRow).toBe(0);
    expect(parts[parts.length - 1]!.endRow).toBe(rows);
    for (let i = 1; i < parts.length; i += 1) {
      expect(parts[i]!.firstRow).toBe(parts[i - 1]!.endRow);
    }
  });

  it("puts each piece on its own page", () => {
    const rows = 60;
    const l = paginate([table("t", 0, rows)], DEFAULT_PAGE, opts("t", metrics(rows)));
    const pages = l.placement.get("t")!.fragments!.map((f) => f.page);
    expect(pages).toEqual([...new Set(pages)]);
    expect(pages).toEqual([...pages].sort((a, b) => a - b));
  });

  it("counts the pages the table actually occupies", () => {
    const rows = 60;
    const l = paginate([table("t", 0, rows)], DEFAULT_PAGE, opts("t", metrics(rows)));
    const last = l.placement.get("t")!.fragments!.at(-1)!;
    expect(l.pageCount).toBe(last.page + 1);
  });

  it("does not split a table that fits somewhere", () => {
    // Kept whole and pushed instead: a table broken for no reason is harder to
    // read than one that starts lower down.
    const rows = 20; // 440px, fits on a page
    const l = paginate(
      [table("t", H - 200, rows)],
      DEFAULT_PAGE,
      { ...opts("t", metrics(rows)), heights: new Map([["t", 440]]) },
    );
    const p = l.placement.get("t")!;
    expect(p.fragments).toBeUndefined();
    expect(p.page).toBe(1);
  });

  it("does not strand a heading with one row at the foot of a page", () => {
    const rows = 60;
    // Only 50px left on page 1: not enough for a heading and two rows.
    const l = paginate([table("t", H - 50, rows)], DEFAULT_PAGE, opts("t", metrics(rows)));
    const first = l.placement.get("t")!.fragments![0]!;
    expect(first.page).toBe(1);
    expect(first.y).toBe(0);
  });

  it("pushes what follows below the last piece", () => {
    const rows = 60;
    const l = paginate(
      [table("t", 0, rows), math("after", 1240)],
      DEFAULT_PAGE,
      opts("t", metrics(rows)),
    );
    const parts = l.placement.get("t")!.fragments!;
    const last = parts.at(-1)!;
    const after = l.placement.get("after")!;
    // Under the table's final piece, not over it and not pages away.
    expect(after.page).toBe(last.page);
    expect(after.y).toBeGreaterThanOrEqual(last.y + 40 + (last.endRow - last.firstRow) * 20);
  });

  it("reports a single row taller than a page rather than looping", () => {
    const l = paginate(
      [table("t", 0, 3)],
      DEFAULT_PAGE,
      opts("t", { header: 40, rows: [H + 100, 20, 20] }),
    );
    const p = l.placement.get("t")!;
    expect(p.overflows).toBe(true);
    expect(p.fragments!.at(-1)!.endRow).toBe(3);
  });

  it("leaves tables alone when no row heights were measured", () => {
    const l = paginate([table("t", 0, 60)], DEFAULT_PAGE);
    expect(l.placement.get("t")?.fragments).toBeUndefined();
  });

});
