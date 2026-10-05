/**
 * Where to scroll a list so that one of its rows can be seen.
 *
 * Clicking a region on the sheet brings its value into view in the side
 * panel, the mirror of clicking a value to jump to where it is defined.
 *
 * Returns null when the row is already fully visible: a list that shifts every
 * time you click something it is already showing is worse than one that never
 * moves. Otherwise the row is centred, as the sheet is when jumping the other
 * way, and the result never scrolls above the top of the list.
 */

export interface VerticalBox {
  readonly top: number;
  readonly bottom: number;
}

export function revealRow(
  list: VerticalBox,
  row: VerticalBox,
  scrollTop: number,
): number | null {
  if (row.top >= list.top && row.bottom <= list.bottom) return null;
  const listHeight = list.bottom - list.top;
  const rowHeight = row.bottom - row.top;
  return Math.max(0, scrollTop + (row.top - list.top) - (listHeight - rowHeight) / 2);
}
