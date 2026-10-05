/**
 * Lining a dragged region up with the ones already on the page.
 *
 * Coordinates are the content area's, the same ones regions are stored in.
 */

import { describe, expect, it } from "vitest";
import { alignSnap, SNAP_TOLERANCE, type Box } from "../src/alignSnap.js";

const box = (x: number, y: number, w = 100, h = 20): Box => ({ x, y, w, h });

describe("snapping a dragged region", () => {
  it("leaves a region alone when nothing is near", () => {
    const r = alignSnap(box(300, 300), [box(48, 40)]);
    expect(r).toEqual({ x: 300, y: 300, guides: [] });
  });

  it("lines up left edges", () => {
    const r = alignSnap(box(52, 200), [box(48, 40)]);
    expect(r.x).toBe(48);
    expect(r.guides.some((g) => g.axis === "x" && g.at === 48)).toBe(true);
  });

  it("lines up right edges", () => {
    // Moving box 100 wide ending at 146; the other ends at 148.
    const r = alignSnap(box(46, 200), [box(48, 40)]);
    expect(r.x).toBe(48);
  });

  it("lines up centres", () => {
    // Other spans 48..148, centre 98. A narrower box centred at 95 snaps.
    const r = alignSnap(box(75, 200, 40, 20), [box(48, 40)]);
    expect(r.x + 20).toBe(98);
  });

  it("does not snap a right edge to a neighbour's left edge", () => {
    // Being adjacent is not being aligned. Found by dragging: a box aimed at
    // the left column's edge landed a few pixels past it, because its own
    // right edge had caught the left edge of the column it came from.
    const moving = box(51, 200, 321);
    const r = alignSnap(moving, [box(372, 40)]);
    expect(r.x).toBe(51);
    expect(r.guides).toEqual([]);
  });

  it("snaps to the left edge it was aimed at, past an adjacent one", () => {
    // The same drag with both boxes present: the left edge wins, because the
    // right-to-left coincidence is not a candidate at all.
    const r = alignSnap(box(51, 200, 321), [box(48, 40), box(372, 40)]);
    expect(r.x).toBe(48);
  });

  it("prefers a left edge to a nearer centre", () => {
    // Found by dragging. The 56-wide box was aimed at the column's left edge
    // three pixels away, and landed on the neighbour's centre line instead
    // because that was one pixel nearer. A column of boxes of different
    // widths is the normal case on a sheet, so the edge has to win.
    const neighbour = box(48, 40, 64); // left 48, centre 80
    const r = alignSnap(box(51, 200, 56), [neighbour]); // left 51, centre 79
    expect(r.x).toBe(48);
    expect(r.guides.find((g) => g.axis === "x")?.at).toBe(48);
  });

  it("takes the nearest of several candidates", () => {
    const r = alignSnap(box(52, 200), [box(48, 40), box(50, 80)]);
    expect(r.x).toBe(50);
  });

  it("ignores anything beyond the tolerance", () => {
    const r = alignSnap(box(48 + SNAP_TOLERANCE + 1, 200), [box(48, 40)]);
    expect(r.x).toBe(48 + SNAP_TOLERANCE + 1);
    expect(r.guides).toEqual([]);
  });

  it("snaps both axes at once, with a line for each", () => {
    const r = alignSnap(box(52, 44), [box(48, 40)]);
    expect([r.x, r.y]).toEqual([48, 40]);
    expect(r.guides.map((g) => g.axis).sort()).toEqual(["x", "y"]);
  });

  it("lines up tops, middles and bottoms", () => {
    // The other box is 40..60, so its edges are top 40, middle 50, bottom 60.
    // Which edge catches depends on the height of what is being dragged, so
    // each case needs a height that puts a different one nearest.
    expect(alignSnap(box(300, 43), [box(48, 40)]).y).toBe(40); // top, 3 away
    expect(alignSnap(box(300, 32, 100, 40), [box(48, 40)]).y).toBe(30); // middle, 2
    expect(alignSnap(box(300, 55, 100, 10), [box(48, 40)]).y).toBe(50); // bottom, 5
  });

  it("does not snap a top to a neighbour's bottom", () => {
    // Sitting directly under something is not being aligned with it, and
    // treating it as alignment fights the drag rather than helping it.
    expect(alignSnap(box(300, 57), [box(48, 40)]).y).toBe(57);
  });

  it("draws the line across everything it lines up with", () => {
    // Two neighbours share the left edge; the line has to cover both and the
    // region being dragged, or it points at only half of what it means.
    const r = alignSnap(box(52, 400), [box(48, 40), box(48, 200)]);
    const guide = r.guides.find((g) => g.axis === "x");
    expect(guide).toBeDefined();
    expect(guide?.from).toBe(40);
    expect(guide?.to).toBe(420);
  });

  it("lines up with the page, which is just another box", () => {
    // The content area: lining up with its left edge or its centre is the
    // same operation as lining up with a neighbour.
    const content = box(0, 0, 720, 936);
    expect(alignSnap(box(4, 500), [content]).x).toBe(0);
    expect(alignSnap(box(307, 500), [content]).x + 50).toBe(360);
  });
});
