import { describe, expect, it } from "vitest";
import {
  contentBox,
  offsetForPage,
  paginate,
  placePoint,
  pointAt,
} from "../src/document/layout.js";
import { DEFAULT_PAGE, parseSheet, serializeSheet, emptySheet } from "../src/document/sheet.js";
import { humanAuthorship, type Region } from "../src/document/region.js";
import { Worksheet } from "../src/document/worksheet.js";

const AT = new Date("2026-09-04T00:00:00Z");
const at = (id: string, y: number): Region => ({
  kind: "math", id, position: { x: 48, y }, source: `${id} := 1`, origin: humanAuthorship(AT),
});
const brk = (id: string, y: number): Region => ({
  kind: "pagebreak", id, position: { x: 0, y }, origin: humanAuthorship(AT),
});

describe("pagination", () => {
  const H = contentBox(DEFAULT_PAGE).height;

  it("keeps a short sheet on one page", () => {
    const l = paginate([at("a", 0), at("b", 200)], DEFAULT_PAGE);
    expect(l.pageCount).toBe(1);
    expect(l.placement.get("b")?.page).toBe(0);
  });

  it("flows past the bottom of a page", () => {
    const l = paginate([at("a", 0), at("b", H + 40)], DEFAULT_PAGE);
    expect(l.pageCount).toBe(2);
    expect(l.placement.get("b")).toMatchObject({ page: 1, y: 40 });
  });

  it("pushes everything after a break to the next page", () => {
    const l = paginate([at("a", 100), brk("pb", 300), at("b", 340)], DEFAULT_PAGE);
    expect(l.placement.get("a")?.page).toBe(0);
    expect(l.placement.get("b")?.page).toBe(1);
    // Lands near the top of page 2, not at its old y.
    expect(l.placement.get("b")?.y).toBe(40);
    expect(l.pageCount).toBe(2);
  });

  it("does not move stored coordinates", () => {
    const regions = [at("a", 100), brk("pb", 300), at("b", 340)];
    const before = regions.map((r) => r.position.y);
    paginate(regions, DEFAULT_PAGE);
    // A break that rewrote coordinates would make one edit touch the whole
    // file, and removing the break would be lossy.
    expect(regions.map((r) => r.position.y)).toEqual(before);
  });

  it("stacks consecutive breaks onto consecutive pages", () => {
    const l = paginate(
      [at("a", 10), brk("p1", 100), at("b", 110), brk("p2", 120), at("c", 130)],
      DEFAULT_PAGE,
    );
    expect(l.placement.get("a")?.page).toBe(0);
    expect(l.placement.get("b")?.page).toBe(1);
    expect(l.placement.get("c")?.page).toBe(2);
    expect(l.pageCount).toBe(3);
  });

  it("reports an offset that inverts the placement", () => {
    const l = paginate([brk("pb", 300), at("b", 340)], DEFAULT_PAGE);
    const p = l.placement.get("b");
    // The shell uses this to turn a pointer position back into a stored y.
    expect(p!.page * l.contentHeight + p!.y - p!.offset).toBe(340);
  });
});

describe("placing a bare point", () => {
  const H = contentBox(DEFAULT_PAGE).height;

  it("places a point on the same page as a region beside it", () => {
    const l = paginate([at("a", 100)], DEFAULT_PAGE);
    expect(placePoint(l, { x: 48, y: 100 })).toMatchObject({ page: 0, y: 100 });
  });

  it("carries a point past a break above it", () => {
    const l = paginate([brk("pb", 300)], DEFAULT_PAGE);
    // The cursor was on page 1 at y=340; the break moves it, exactly as it
    // moves a region, which is why the cursor is stored in document space.
    expect(placePoint(l, { x: 48, y: 340 })).toMatchObject({ page: 1, y: 40 });
  });

  it("leaves a point sitting exactly on a break at the foot of its page", () => {
    const l = paginate([brk("pb", 300)], DEFAULT_PAGE);
    expect(placePoint(l, { x: 48, y: 300 }).page).toBe(0);
    // One step below and it is on the next page: this is what makes inserting
    // a break advance the cursor to the new page.
    expect(placePoint(l, { x: 48, y: 301 }).page).toBe(1);
  });

  it("flows a point past the last region onto a page that has none", () => {
    const l = paginate([at("a", 0)], DEFAULT_PAGE);
    expect(l.pageCount).toBe(1);
    expect(placePoint(l, { x: 48, y: H + 60 })).toMatchObject({ page: 1, y: 60 });
  });

  it("round-trips a click through pointAt and back", () => {
    const l = paginate([brk("p1", 200), brk("p2", 400)], DEFAULT_PAGE);
    for (const page of [0, 1, 2]) {
      const doc = pointAt(l, page, 48, 90);
      expect(placePoint(l, doc)).toMatchObject({ page, x: 48, y: 90 });
    }
  });

  it("agrees with the offset paginate gave the regions on that page", () => {
    const l = paginate([brk("pb", 300), at("b", 340)], DEFAULT_PAGE);
    expect(offsetForPage(l, 1)).toBe(l.placement.get("b")!.offset);
    expect(offsetForPage(l, 0)).toBe(0);
  });
});

describe("page setup", () => {

  it("round-trips independent margins", () => {
    const sheet = {
      ...emptySheet("M"),
      page: { ...DEFAULT_PAGE, margins: { top: 90, right: 40, bottom: 70, left: 60 } },
    };
    expect(parseSheet(serializeSheet(sheet)).page.margins).toEqual({
      top: 90, right: 40, bottom: 70, left: 60,
    });
  });

  it("gives landscape a wider content box", () => {
    const portrait = contentBox(DEFAULT_PAGE);
    const landscape = contentBox({ ...DEFAULT_PAGE, orientation: "landscape" });
    expect(landscape.width).toBeGreaterThan(portrait.width);
    expect(landscape.height).toBeLessThan(portrait.height);
  });
});

describe("empty regions", () => {
  it("computes nothing and reports no error", () => {
    const ws = new Worksheet([
      { kind: "math", id: "r_01", position: { x: 0, y: 0 }, source: "", origin: humanAuthorship(AT) },
      at("r_02", 40),
    ]);
    ws.recompute();
    // A box the user just made is not a syntax error.
    expect(ws.getResult("r_01")).toBeUndefined();
    expect(ws.getResult("r_02")?.status).toBe("ok");
  });

  it("clears a result when a region is emptied", () => {
    const ws = new Worksheet([at("r_01", 0)]);
    ws.recompute();
    expect(ws.getResult("r_01")?.status).toBe("ok");
    ws.edit("r_01", "");
    ws.recompute();
    expect(ws.getResult("r_01")).toBeUndefined();
  });
});
