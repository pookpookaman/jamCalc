import { describe, expect, it } from "vitest";
import type { PageBand } from "@jamcalc/engine";
import {
  addItem,
  moveItem,
  nextFreeSpot,
  removeItem,
  resizeBand,
  resizeItem,
  styleItem,
  MIN_BAND,
} from "../src/bandEdit.js";

const bounds = { width: 816, height: 64 };

describe("adding", () => {
  it("places a field where it was dropped, with the next id", () => {
    const { band, id } = addItem(undefined, { kind: "field", field: "project" }, { x: 100, y: 10 }, bounds);
    expect(id).toBe("i_01");
    expect(band.items[0]).toMatchObject({ kind: "field", field: "project", x: 100, y: 10 });
    const second = addItem(band, { kind: "box" }, { x: 0, y: 0 }, bounds);
    expect(second.id).toBe("i_02");
  });

  it("keeps a drop near the edge inside the band", () => {
    const { band } = addItem(undefined, { kind: "text" }, { x: 800, y: 60 }, bounds);
    const [item] = band.items;
    expect(item!.x + item!.width).toBeLessThanOrEqual(816);
    expect(item!.y + item!.height).toBeLessThanOrEqual(64);
  });

  it("gives a line no height", () => {
    const { band } = addItem(undefined, { kind: "line" }, { x: 48, y: 40 }, bounds);
    expect(band.items[0]!.height).toBe(0);
  });
});

describe("changing", () => {
  const start: PageBand = addItem(undefined, { kind: "box" }, { x: 100, y: 10 }, bounds).band;

  it("moves from where the gesture began, so moves do not compound", () => {
    const once = moveItem(start, "i_01", 50, 5, bounds);
    const again = moveItem(start, "i_01", 60, 5, bounds);
    expect(once.items[0]).toMatchObject({ x: 150, y: 15 });
    expect(again.items[0]).toMatchObject({ x: 160, y: 15 });
  });

  it("will not move an item out of the band", () => {
    expect(moveItem(start, "i_01", -500, -500, bounds).items[0]).toMatchObject({ x: 0, y: 0 });
  });

  it("resizes, never to nothing", () => {
    expect(resizeItem(start, "i_01", -1000, -1000, bounds).items[0]).toMatchObject({ width: 8, height: 8 });
  });

  it("styles and un-styles", () => {
    const bold = styleItem(start, "i_01", { bold: true, color: "#b3261e" });
    expect(bold.items[0]!.style).toEqual({ bold: true, color: "#b3261e" });
    const plain = styleItem(bold, "i_01", { bold: null, color: null });
    expect(plain.items[0]).not.toHaveProperty("style");
  });

  it("removes", () => {
    expect(removeItem(start, "i_01").items).toEqual([]);
  });
});

describe("the band's own height", () => {
  it("cannot be shrunk out from under what is in it", () => {
    const band = addItem(undefined, { kind: "box" }, { x: 0, y: 20 }, bounds).band;
    expect(resizeBand(band, 64, -60, 1056).height).toBe(60);
  });

  it("has a floor and a ceiling", () => {
    expect(resizeBand(undefined, 64, -100, 1056).height).toBe(MIN_BAND);
    expect(resizeBand(undefined, 64, 2000, 1056).height).toBe(352);
  });

  it("finds room below what is already there for a clicked-in item", () => {
    const band = addItem(undefined, { kind: "box" }, { x: 0, y: 4 }, { width: 816, height: 200 }).band;
    expect(nextFreeSpot(band, 48, { width: 816, height: 200 })).toEqual({ x: 48, y: 48 });
  });
});
