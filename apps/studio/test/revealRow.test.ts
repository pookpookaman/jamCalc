/**
 * Bringing a value into view when its region is clicked on the sheet.
 *
 * Boxes are in viewport coordinates, as getBoundingClientRect gives them. The
 * list below spans 100 to 500 on screen and each row is 20 tall.
 */

import { describe, expect, it } from "vitest";
import { revealRow } from "../src/revealRow.js";

const LIST = { top: 100, bottom: 500 };

describe("revealing a row in the values list", () => {
  it("leaves the list alone when the row is already visible", () => {
    expect(revealRow(LIST, { top: 300, bottom: 320 }, 250)).toBeNull();
  });

  it("counts a row touching the edges as visible", () => {
    expect(revealRow(LIST, { top: 100, bottom: 120 }, 0)).toBeNull();
    expect(revealRow(LIST, { top: 480, bottom: 500 }, 0)).toBeNull();
  });

  it("centres a row below the visible part", () => {
    // 700 on screen is 600 into the visible area; centring puts its top 190
    // below the top of the list.
    expect(revealRow(LIST, { top: 700, bottom: 720 }, 0)).toBe(410);
  });

  it("centres a row above the visible part", () => {
    expect(revealRow(LIST, { top: -300, bottom: -280 }, 800)).toBe(210);
  });

  it("scrolls a row that is only partly visible", () => {
    expect(revealRow(LIST, { top: 490, bottom: 510 }, 0)).toBe(200);
  });

  it("never scrolls above the top of the list", () => {
    expect(revealRow(LIST, { top: 90, bottom: 110 }, 0)).toBe(0);
  });
});
