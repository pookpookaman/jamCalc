/**
 * What the format bar acts on.
 *
 * The first test in the studio, and it exists because of a bug a user found
 * twice: choosing a font size with three words highlighted changed the size of
 * the whole paragraph. Colour and bold were fine, because their buttons refuse
 * focus; a `<select>` cannot, so by the time it reported a change the
 * highlight was gone and the answer had quietly become "everything".
 */

import { describe, expect, it } from "vitest";
import { formatTarget, rememberRange, type TextTarget } from "../src/formatTarget.js";

const range = (id: string, start: number, end: number): TextTarget<string> => ({
  id, start, end,
});

describe("remembering a highlight", () => {
  it("keeps a live one", () => {
    expect(rememberRange("r_01", { start: 0, end: 5 }, null)).toEqual(range("r_01", 0, 5));
  });

  it("ignores an empty one", () => {
    // A caret is not a selection; formatting would have nothing to apply to.
    expect(rememberRange("r_01", { start: 3, end: 3 }, null)).toBeNull();
  });

  it("holds the last one while the region is still being edited", () => {
    // This is the whole point: the highlight is gone from the DOM the instant
    // a control takes focus, and the format action has not happened yet.
    const held = range("r_01", 0, 5);
    expect(rememberRange("r_01", null, held)).toEqual(held);
  });

  it("forgets it when editing stops", () => {
    expect(rememberRange(null, null, range("r_01", 0, 5))).toBeNull();
  });

  it("forgets it when another region is edited", () => {
    // The offsets describe text that is no longer in front of the user.
    expect(rememberRange("r_02", null, range("r_01", 0, 5))).toBeNull();
  });

  it("replaces it when a new highlight is made", () => {
    expect(rememberRange("r_01", { start: 7, end: 9 }, range("r_01", 0, 5))).toEqual(
      range("r_01", 7, 9),
    );
  });
});

describe("choosing what to format", () => {
  it("uses the live highlight", () => {
    expect(formatTarget("r_01", { start: 2, end: 6 }, null)).toEqual(range("r_01", 2, 6));
  });

  it("prefers the live highlight over the remembered one", () => {
    expect(formatTarget("r_01", { start: 2, end: 6 }, range("r_01", 0, 1))).toEqual(
      range("r_01", 2, 6),
    );
  });

  it("falls back to the remembered one when focus has moved away", () => {
    // The case the bug was: a select has taken focus, the highlight is gone,
    // and the size must still apply to the words that were highlighted.
    expect(formatTarget("r_01", null, range("r_01", 0, 5))).toEqual(range("r_01", 0, 5));
  });

  it("falls back when the selection has collapsed to a caret", () => {
    expect(formatTarget("r_01", { start: 4, end: 4 }, range("r_01", 0, 5))).toEqual(
      range("r_01", 0, 5),
    );
  });

  it("has no target when nothing is being edited", () => {
    // The caller then styles whole selected regions, which is right: there is
    // no text in question.
    expect(formatTarget(null, null, null)).toBeNull();
  });

  it("has no target when the remembered range belongs elsewhere", () => {
    expect(formatTarget("r_02", null, range("r_01", 0, 5))).toBeNull();
  });

  it("has no target from a remembered range once editing stops", () => {
    // Otherwise a format action after clicking away would change text the
    // user is no longer looking at.
    expect(formatTarget(null, null, range("r_01", 0, 5))).toBeNull();
  });
});
