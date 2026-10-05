/**
 * The canvas is larger than the paper.
 *
 * Somewhere to park a trial calculation, a check, a note. Those regions are
 * part of the sheet — they compute, they bind names, they take their turn in
 * evaluation order — and they do not print.
 */

import { describe, expect, it } from "vitest";
import { contentBox, paginate, placePoint } from "../src/document/layout.js";
import { DEFAULT_PAGE } from "../src/document/sheet.js";
import { humanAuthorship, type Region } from "../src/document/region.js";
import { Worksheet } from "../src/document/worksheet.js";

const AT = new Date("2026-09-06T00:00:00Z");
const W = contentBox(DEFAULT_PAGE).width;

const at = (id: string, x: number, y: number, width?: number): Region => ({
  kind: "math",
  id,
  position: { x, y },
  source: `${id} := 1 kip`,
  origin: humanAuthorship(AT),
  ...(width !== undefined ? { size: { width } } : {}),
});

describe("what is on the paper", () => {
  it("prints a region inside the page", () => {
    const l = paginate([at("a", 48, 0)], DEFAULT_PAGE);
    expect(l.placement.get("a")?.printable).toBe(true);
  });

  it("does not print one parked past the right edge", () => {
    const l = paginate([at("b", W + 40, 0)], DEFAULT_PAGE);
    expect(l.placement.get("b")?.printable).toBe(false);
  });

  it("judges by the right edge when the width is known", () => {
    // Starts on the page, ends off it: printing half a value is worse than
    // printing none of it.
    const l = paginate([at("c", W - 20, 0, 200)], DEFAULT_PAGE);
    expect(l.placement.get("c")?.printable).toBe(false);
  });

  it("accepts a measured width from the renderer", () => {
    const region = at("d", W - 20, 0);
    const widths = new Map([["d", 200]]);
    expect(paginate([region], DEFAULT_PAGE, { widths }).placement.get("d")?.printable)
      .toBe(false);
    expect(paginate([region], DEFAULT_PAGE).placement.get("d")?.printable)
      .toBe(true); // width unknown: position alone decides
  });

  it("never treats a page break as off-sheet", () => {
    const brk: Region = {
      kind: "pagebreak", id: "pb", position: { x: 900, y: 100 },
      origin: humanAuthorship(AT),
    };
    expect(paginate([brk], DEFAULT_PAGE).placement.get("pb")?.printable).toBe(true);
  });

  it("does not count a page that holds nothing printable", () => {
    const H = contentBox(DEFAULT_PAGE).height;
    // A region parked far down and far right adds no page to the document.
    const l = paginate([at("a", 48, 0), at("scratch", W + 200, H * 2 + 40)], DEFAULT_PAGE);
    expect(l.pageCount).toBe(1);
  });

  it("still counts pages that hold something printable", () => {
    const H = contentBox(DEFAULT_PAGE).height;
    const l = paginate([at("a", 48, 0), at("b", 48, H + 40)], DEFAULT_PAGE);
    expect(l.pageCount).toBe(2);
  });

  it("reports whether the cursor is on the paper", () => {
    const l = paginate([at("a", 48, 0)], DEFAULT_PAGE);
    expect(placePoint(l, { x: 48, y: 0 }).printable).toBe(true);
    expect(placePoint(l, { x: W + 100, y: 0 }).printable).toBe(false);
  });
});

describe("a parked region is still part of the sheet", () => {
  it("computes, and its value is usable on the page", () => {
    // The point of the working area: try something at the side, use the
    // answer in the calculation proper.
    const ws = new Worksheet([
      {
        kind: "math", id: "r_01", position: { x: 48, y: 0 },
        source: "L := 25 ft", origin: humanAuthorship(AT),
      },
      {
        kind: "math", id: "r_02", position: { x: W + 200, y: 20 },
        source: "trial := L*2 = ft", origin: humanAuthorship(AT),
      },
      {
        kind: "math", id: "r_03", position: { x: 48, y: 60 },
        source: "used := trial + 1 ft = ft", origin: humanAuthorship(AT),
      },
    ]);
    ws.recompute();
    const r = ws.getResult("r_03");
    expect(r?.status).toBe("ok");
    if (r?.status === "ok") expect(r.displayValue).toBeCloseTo(51, 6);
  });
});
