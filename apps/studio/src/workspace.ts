/**
 * Tabs and panes: which sheets are open, where each is shown, and which one
 * the keyboard and toolbar are talking to.
 *
 * A pure model, so that the rules people notice when they are wrong — which
 * tab comes forward when one closes, what happens to a pane that loses its
 * last tab, how many panes fit side by side — are decided here and tested,
 * rather than spread through drag handlers, which is where this app's
 * regressions have tended to live.
 *
 * A sheet is open in exactly one pane. Dragging a tab moves it; it does not
 * copy it.
 */

export type DocId = string;
export type PaneId = string;

export interface Pane {
  readonly id: PaneId;
  /** Tabs in the order they are shown. */
  readonly tabs: readonly DocId[];
  /** The tab on top. A pane with no tabs does not survive any operation. */
  readonly active: DocId | null;
}

export interface Layout {
  /** Left to right. Empty when nothing is open, which is the home screen. */
  readonly panes: readonly Pane[];
  /** The pane the keyboard and the toolbar act on. */
  readonly focused: PaneId | null;
}

/**
 * Side by side is only useful while each pane can still show a readable part
 * of a page. Past three, splitting again moves the tab into the neighbouring
 * pane instead.
 */
export const MAX_PANES = 3;

export const emptyLayout = (): Layout => ({ panes: [], focused: null });

export const paneOf = (layout: Layout, doc: DocId): Pane | undefined =>
  layout.panes.find((p) => p.tabs.includes(doc));

export const focusedPane = (layout: Layout): Pane | undefined =>
  layout.panes.find((p) => p.id === layout.focused);

/** The sheet the keyboard and toolbar act on, if any. */
export const focusedDoc = (layout: Layout): DocId | null => focusedPane(layout)?.active ?? null;

export const openDocs = (layout: Layout): DocId[] => layout.panes.flatMap((p) => p.tabs);

/** Replaces one pane, dropping it if it has been left without tabs. */
function withPane(layout: Layout, pane: Pane): Layout {
  const index = layout.panes.findIndex((p) => p.id === pane.id);
  if (index < 0) return layout;
  if (pane.tabs.length > 0) {
    const panes = [...layout.panes];
    panes[index] = pane;
    return { ...layout, panes };
  }
  // An empty pane goes. Focus moves to its neighbour — the one on the left if
  // there is one, since that is where the eye goes when a column closes.
  const panes = layout.panes.filter((p) => p.id !== pane.id);
  const neighbour = panes[Math.max(0, index - 1)];
  const focused = layout.focused === pane.id ? (neighbour?.id ?? null) : layout.focused;
  return { panes, focused };
}

/** Removes a tab from its pane, bringing a neighbour forward if it was on top. */
function withoutTab(pane: Pane, doc: DocId): Pane {
  const at = pane.tabs.indexOf(doc);
  if (at < 0) return pane;
  const tabs = pane.tabs.filter((t) => t !== doc);
  if (pane.active !== doc) return { ...pane, tabs };
  // The tab to the right comes forward, or the one to the left when the
  // closed tab was last — what browsers do, so what hands expect.
  return { ...pane, tabs, active: tabs[at] ?? tabs[at - 1] ?? null };
}

export function focusPane(layout: Layout, pane: PaneId): Layout {
  return layout.panes.some((p) => p.id === pane) ? { ...layout, focused: pane } : layout;
}

/** Brings a tab to the top of its pane, and focuses that pane. */
export function activateTab(layout: Layout, doc: DocId): Layout {
  const pane = paneOf(layout, doc);
  if (!pane) return layout;
  return focusPane(withPane(layout, { ...pane, active: doc }), pane.id);
}

/**
 * Opens a sheet in the focused pane, just after the tab on top. Opening one
 * already open brings it forward instead of opening it twice. `newPane` names
 * the pane to create when nothing is open yet.
 */
export function openTab(layout: Layout, doc: DocId, newPane: PaneId): Layout {
  if (paneOf(layout, doc)) return activateTab(layout, doc);
  const target = focusedPane(layout) ?? layout.panes[0];
  if (!target) {
    return { panes: [{ id: newPane, tabs: [doc], active: doc }], focused: newPane };
  }
  const after = target.active ? target.tabs.indexOf(target.active) + 1 : target.tabs.length;
  const tabs = [...target.tabs.slice(0, after), doc, ...target.tabs.slice(after)];
  return focusPane(withPane(layout, { ...target, tabs, active: doc }), target.id);
}

/** Closes a tab. The last tab of the last pane leaves nothing open: home. */
export function closeTab(layout: Layout, doc: DocId): Layout {
  const pane = paneOf(layout, doc);
  if (!pane) return layout;
  return withPane(layout, withoutTab(pane, doc));
}

/**
 * Moves a tab to `index` in another pane, or to another place in its own.
 *
 * `index` counts positions in the destination as it is once the tab has left
 * its old place, which is what a drop between two tabs means.
 */
export function moveTab(layout: Layout, doc: DocId, to: PaneId, index: number): Layout {
  const from = paneOf(layout, doc);
  const target = layout.panes.find((p) => p.id === to);
  if (!from || !target) return layout;

  if (from.id === target.id) {
    const rest = from.tabs.filter((t) => t !== doc);
    const at = Math.max(0, Math.min(index, rest.length));
    const tabs = [...rest.slice(0, at), doc, ...rest.slice(at)];
    return focusPane(withPane(layout, { ...from, tabs, active: doc }), from.id);
  }

  const at = Math.max(0, Math.min(index, target.tabs.length));
  const tabs = [...target.tabs.slice(0, at), doc, ...target.tabs.slice(at)];
  // Fill the destination first: removing the source may drop an empty pane,
  // which shifts positions, and the destination must be found by id after.
  let next = withPane(layout, { ...target, tabs, active: doc });
  next = withPane(next, withoutTab(from, doc));
  return focusPane(next, target.id);
}

/**
 * Puts a tab in a new pane beside `beside`, on the given side.
 *
 * At the pane limit it joins the existing neighbour on that side instead, and
 * where there is no neighbour it stays put. Splitting a pane's only tab away
 * from its own pane changes nothing, so that does nothing.
 */
export function splitTab(
  layout: Layout,
  doc: DocId,
  beside: PaneId,
  side: "left" | "right",
  newPane: PaneId,
): Layout {
  const from = paneOf(layout, doc);
  const anchorAt = layout.panes.findIndex((p) => p.id === beside);
  if (!from || anchorAt < 0) return layout;
  if (from.id === beside && from.tabs.length === 1) return layout;

  if (layout.panes.length >= MAX_PANES) {
    const neighbour = layout.panes[side === "left" ? anchorAt - 1 : anchorAt + 1];
    if (!neighbour) return layout;
    return moveTab(layout, doc, neighbour.id, neighbour.tabs.length);
  }

  const created: Pane = { id: newPane, tabs: [doc], active: doc };
  const panes = [...layout.panes];
  panes.splice(side === "left" ? anchorAt : anchorAt + 1, 0, created);
  const next = withPane({ ...layout, panes }, withoutTab(from, doc));
  return focusPane(next, newPane);
}
