/**
 * Keeping a region intact across a page boundary.
 *
 * A region was meant to stay whole across a page break, but pagination had
 * no idea how tall anything was, so a region ran past the bottom of the page
 * and onto an unnumbered sheet. The PDF of `print-edge-cases.jc` showed a
 * three-page sheet producing four pages, the last with no header, no footer
 * and no number.
 */

import { describe, expect, it } from "vitest";
import { contentBox, paginate, placePoint } from "../src/document/layout.js";
import { DEFAULT_PAGE } from "../src/document/sheet.js";
import { humanAuthorship, type Region } from "../src/document/region.js";

const AT = new Date("2026-09-06T00:00:00Z");
const H = contentBox(DEFAULT_PAGE).height;

const at = (id: string, y: number, x = 48): Region => ({
  kind: "math", id, position: { x, y }, source: `${id} := 1`, origin: humanAuthorship(AT),
});
const brk = (id: string, y: number): Region => ({
  kind: "pagebreak", id, position: { x: 0, y }, origin: humanAuthorship(AT),
});

const heights = (entries: Record<string, number>) =>
  ({ heights: new Map(Object.entries(entries)) });

describe("a region that will not fit", () => {
  it("moves whole to the next page rather than running off this one", () => {
    // Starts 100px above the bottom and is 300px tall.
    const l = paginate([at("a", H - 100)], DEFAULT_PAGE, heights({ a: 300 }));
    const p = l.placement.get("a")!;
    expect(p.page).toBe(1);
    expect(p.y).toBe(0);
  });

  it("takes everything below it along, as an explicit break would", () => {
    const l = paginate(
      [at("a", H - 100), at("b", H - 40)],
      DEFAULT_PAGE,
      heights({ a: 300, b: 20 }),
    );
    expect(l.placement.get("a")?.page).toBe(1);
    // `b` sat below `a` and must still sit below it.
    expect(l.placement.get("b")?.page).toBe(1);
    expect(l.placement.get("b")!.y).toBeGreaterThan(l.placement.get("a")!.y);
  });

  it("does not move a region that fits", () => {
    const l = paginate([at("a", H - 300)], DEFAULT_PAGE, heights({ a: 200 }));
    expect(l.placement.get("a")).toMatchObject({ page: 0, y: H - 300 });
  });

  it("does not move anything when heights are unknown", () => {
    // Guessing would shuffle a sheet for no reason.
    const l = paginate([at("a", H - 100)], DEFAULT_PAGE);
    expect(l.placement.get("a")?.page).toBe(0);
  });

  it("counts the pages it actually produced", () => {
    const l = paginate([at("a", H - 100)], DEFAULT_PAGE, heights({ a: 300 }));
    expect(l.pageCount).toBe(2);
  });
});

describe("a region taller than any page", () => {
  it("is reported rather than shuffled", () => {
    // Pushing it would only move the problem. Splitting it between rows is a
    // separate piece of work; until then, say so.
    const l = paginate([at("a", 40)], DEFAULT_PAGE, heights({ a: H + 200 }));
    const p = l.placement.get("a")!;
    expect(p.overflows).toBe(true);
    expect(p.page).toBe(0);
  });

  it("leaves a region that fits unmarked", () => {
    const l = paginate([at("a", 40)], DEFAULT_PAGE, heights({ a: 100 }));
    expect(l.placement.get("a")?.overflows).toBeUndefined();
  });
});

describe("implicit and explicit breaks agree", () => {
  it("puts the cursor where the regions went", () => {
    // placePoint reads the same break schedule, so the worksheet cursor
    // follows an implicit push exactly as it follows a real page break.
    const l = paginate([at("a", H - 100)], DEFAULT_PAGE, heights({ a: 300 }));
    expect(placePoint(l, { x: 48, y: H - 50 }).page).toBe(1);
  });

  it("leaves a region alone when the break already gave it room", () => {
    // 40px below the break, so it starts 40px down the new page; it fits in
    // what is left and must not be pushed again.
    const l = paginate(
      [brk("pb", 200), at("a", 240)],
      DEFAULT_PAGE,
      heights({ a: H - 60 }),
    );
    expect(l.placement.get("a")).toMatchObject({ page: 1, y: 40 });
  });

  it("pushes a region an explicit break left short of room", () => {
    // Same 40px gap, but this one is too tall for what remains.
    const l = paginate(
      [brk("pb", 200), at("a", 240)],
      DEFAULT_PAGE,
      heights({ a: H - 20 }),
    );
    expect(l.placement.get("a")).toMatchObject({ page: 2, y: 0 });
  });

  it("pushes a region that lands near the foot of a page after a break", () => {
    // `a` clears the break and sits near the bottom of page 2; `b` follows it
    // and has to go to page 3.
    const l = paginate(
      [brk("pb", 100), at("a", 140), at("b", H + 50)],
      DEFAULT_PAGE,
      heights({ a: 40, b: 200 }),
    );
    expect(l.placement.get("a")?.page).toBe(1);
    expect(l.placement.get("b")?.page).toBe(2);
    expect(l.placement.get("b")?.y).toBe(0);
  });
});
