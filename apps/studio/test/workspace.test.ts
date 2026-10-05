/**
 * Tabs and panes.
 *
 * The rules a user notices at once when they are wrong: which tab comes
 * forward, where a new tab goes, what happens to an emptied pane, and how many
 * panes fit.
 */

import { describe, expect, it } from "vitest";
import {
  MAX_PANES,
  activateTab,
  closeTab,
  emptyLayout,
  focusedDoc,
  moveTab,
  openDocs,
  openTab,
  splitTab,
  type Layout,
} from "../src/workspace.js";

/** Opens each doc in turn in the focused pane. */
const opened = (...docs: string[]): Layout =>
  docs.reduce((layout, doc) => openTab(layout, doc, "p1"), emptyLayout());

const tabsOf = (layout: Layout): string[][] => layout.panes.map((p) => [...p.tabs]);

describe("opening", () => {
  it("starts with nothing open", () => {
    expect(emptyLayout()).toEqual({ panes: [], focused: null });
    expect(focusedDoc(emptyLayout())).toBeNull();
  });

  it("creates the first pane for the first sheet", () => {
    const layout = opened("a");
    expect(tabsOf(layout)).toEqual([["a"]]);
    expect(focusedDoc(layout)).toBe("a");
  });

  it("opens next to the tab on top, and brings it forward", () => {
    let layout = opened("a", "b", "c");
    layout = activateTab(layout, "a");
    layout = openTab(layout, "d", "unused");
    expect(tabsOf(layout)).toEqual([["a", "d", "b", "c"]]);
    expect(focusedDoc(layout)).toBe("d");
  });

  it("brings forward a sheet that is already open rather than opening it twice", () => {
    const layout = openTab(opened("a", "b"), "a", "unused");
    expect(tabsOf(layout)).toEqual([["a", "b"]]);
    expect(focusedDoc(layout)).toBe("a");
  });
});

describe("closing", () => {
  it("brings the tab to the right forward", () => {
    const layout = closeTab(activateTab(opened("a", "b", "c"), "b"), "b");
    expect(tabsOf(layout)).toEqual([["a", "c"]]);
    expect(focusedDoc(layout)).toBe("c");
  });

  it("brings the tab to the left forward when the last one closes", () => {
    const layout = closeTab(opened("a", "b", "c"), "c");
    expect(focusedDoc(layout)).toBe("b");
  });

  it("leaves the tab on top alone when a background tab closes", () => {
    const layout = closeTab(opened("a", "b", "c"), "a");
    expect(focusedDoc(layout)).toBe("c");
  });

  it("returns to home when the last sheet closes", () => {
    expect(closeTab(opened("a"), "a")).toEqual(emptyLayout());
  });

  it("removes a pane that loses its last tab, and focuses its neighbour", () => {
    let layout = splitTab(opened("a", "b"), "b", "p1", "right", "p2");
    expect(tabsOf(layout)).toEqual([["a"], ["b"]]);
    layout = closeTab(layout, "b");
    expect(tabsOf(layout)).toEqual([["a"]]);
    expect(layout.focused).toBe("p1");
  });
});

describe("moving tabs", () => {
  it("reorders within a pane", () => {
    const layout = moveTab(opened("a", "b", "c"), "a", "p1", 2);
    expect(tabsOf(layout)).toEqual([["b", "c", "a"]]);
  });

  it("clamps an index past the end", () => {
    const layout = moveTab(opened("a", "b"), "a", "p1", 99);
    expect(tabsOf(layout)).toEqual([["b", "a"]]);
  });

  it("moves a tab into another pane, where it comes forward and takes focus", () => {
    let layout = splitTab(opened("a", "b", "c"), "c", "p1", "right", "p2");
    layout = moveTab(layout, "a", "p2", 0);
    expect(tabsOf(layout)).toEqual([["b"], ["a", "c"]]);
    expect(layout.focused).toBe("p2");
    expect(focusedDoc(layout)).toBe("a");
  });

  it("drops the pane it emptied, and still lands in the right place", () => {
    let layout = splitTab(opened("a", "b", "c"), "a", "p1", "left", "p0");
    expect(tabsOf(layout)).toEqual([["a"], ["b", "c"]]);
    layout = moveTab(layout, "a", "p1", 1);
    expect(tabsOf(layout)).toEqual([["b", "a", "c"]]);
    expect(focusedDoc(layout)).toBe("a");
  });
});

describe("splitting", () => {
  it("puts the tab in a new pane on the chosen side", () => {
    const right = splitTab(opened("a", "b"), "b", "p1", "right", "p2");
    expect(tabsOf(right)).toEqual([["a"], ["b"]]);
    expect(right.panes.map((p) => p.id)).toEqual(["p1", "p2"]);

    const left = splitTab(opened("a", "b"), "b", "p1", "left", "p0");
    expect(left.panes.map((p) => p.id)).toEqual(["p0", "p1"]);
  });

  it("does nothing to a pane's only tab", () => {
    const layout = opened("a");
    expect(splitTab(layout, "a", "p1", "right", "p2")).toBe(layout);
  });

  it("stops at the pane limit and joins the neighbour instead", () => {
    let layout = opened("a", "b", "c", "d");
    layout = splitTab(layout, "d", "p1", "right", "p2");
    layout = splitTab(layout, "c", "p2", "right", "p3");
    expect(layout.panes).toHaveLength(MAX_PANES);
    // A fourth split to the right of the middle pane joins the right-hand one.
    layout = splitTab(layout, "b", "p2", "right", "p4");
    expect(layout.panes).toHaveLength(MAX_PANES);
    expect(tabsOf(layout)).toEqual([["a"], ["d"], ["c", "b"]]);
  });

  it("never loses or duplicates a sheet, whatever is done", () => {
    let layout = opened("a", "b", "c", "d", "e");
    layout = splitTab(layout, "e", "p1", "right", "p2");
    layout = moveTab(layout, "a", "p2", 0);
    layout = splitTab(layout, "b", "p2", "left", "p3");
    layout = closeTab(layout, "c");
    layout = moveTab(layout, "d", "p3", 5);
    const docs = openDocs(layout);
    expect([...docs].sort()).toEqual(["a", "b", "d", "e"]);
    expect(new Set(docs).size).toBe(docs.length);
    expect(layout.panes.every((p) => p.tabs.length > 0 && p.tabs.includes(p.active as string))).toBe(true);
  });
});
