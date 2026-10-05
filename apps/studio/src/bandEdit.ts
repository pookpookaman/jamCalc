/**
 * Editing a header or footer, as pure functions of the band.
 *
 * Every change on the page — dropping a field, dragging an item, resizing
 * one, restyling it — is one of these, applied to the band as it was when the
 * gesture began. Pure, so they are tested without a page, and so a drag that
 * delivers ten moves before the next render cannot compound them.
 */

import {
  nextItemId,
  type BandItem,
  type BandItemStyle,
  type FieldName,
  type PageBand,
} from "@jamcalc/engine";

/** What the palette can place. */
export type NewItem =
  | { readonly kind: "field"; readonly field: FieldName }
  | { readonly kind: "text"; readonly text?: string }
  | { readonly kind: "line" }
  | { readonly kind: "box" }
  | { readonly kind: "image"; readonly src: string; readonly width: number; readonly height: number };

/** The band's own area, for keeping items inside it. */
export interface Bounds {
  readonly width: number;
  readonly height: number;
}

const DEFAULT_SIZE: Record<NewItem["kind"], { width: number; height: number }> = {
  field: { width: 160, height: 16 },
  text: { width: 160, height: 16 },
  line: { width: 240, height: 0 },
  box: { width: 160, height: 40 },
  image: { width: 120, height: 40 },
};

/** Smallest an item can be made, so it can still be grabbed. */
export const MIN_ITEM = 8;
/** A band from a sliver to a third of the page. */
export const MIN_BAND = 16;

const clamp = (v: number, lo: number, hi: number): number => Math.min(Math.max(v, lo), Math.max(lo, hi));
const round = (v: number): number => Math.round(v);

function fit(item: BandItem, bounds: Bounds): BandItem {
  const width = clamp(item.width, item.kind === "line" && item.vertical ? 0 : MIN_ITEM, bounds.width);
  const height = clamp(item.height, item.kind === "line" && !item.vertical ? 0 : MIN_ITEM, bounds.height);
  return {
    ...item,
    width: round(width),
    height: round(height),
    x: round(clamp(item.x, 0, bounds.width - width)),
    y: round(clamp(item.y, 0, bounds.height - height)),
  };
}

/** Places a new item with its top-left at `at`, kept inside the band. */
export function addItem(
  band: PageBand | undefined,
  what: NewItem,
  at: { x: number; y: number },
  bounds: Bounds,
): { band: PageBand; id: string } {
  const items = band?.items ?? [];
  const id = nextItemId(items);
  const size =
    what.kind === "image" ? { width: what.width, height: what.height } : DEFAULT_SIZE[what.kind];
  const base = { id, x: at.x, y: at.y, ...size };
  const item: BandItem =
    what.kind === "field"
      ? { ...base, kind: "field", field: what.field }
      : what.kind === "text"
        ? { ...base, kind: "text", text: what.text ?? "Text" }
        : what.kind === "image"
          ? { ...base, kind: "image", src: what.src }
          : { ...base, kind: what.kind };
  return { band: { ...(band ?? { items: [] }), items: [...items, fit(item, bounds)] }, id };
}

const update = (band: PageBand, id: string, change: (item: BandItem) => BandItem): PageBand => ({
  ...band,
  items: band.items.map((i) => (i.id === id ? change(i) : i)),
});

export function moveItem(band: PageBand, id: string, dx: number, dy: number, bounds: Bounds): PageBand {
  return update(band, id, (i) => fit({ ...i, x: i.x + dx, y: i.y + dy }, bounds));
}

export function resizeItem(band: PageBand, id: string, dw: number, dh: number, bounds: Bounds): PageBand {
  return update(band, id, (i) => fit({ ...i, width: i.width + dw, height: i.height + dh }, bounds));
}

export function removeItem(band: PageBand, id: string): PageBand {
  return { ...band, items: band.items.filter((i) => i.id !== id) };
}

/** Merges a style change; `undefined` or `null` puts a property back to its default. */
export function styleItem(
  band: PageBand,
  id: string,
  patch: { readonly [K in keyof BandItemStyle]?: BandItemStyle[K] | null },
): PageBand {
  return update(band, id, (i) => {
    const style: Record<string, unknown> = { ...(i.style ?? {}) };
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === undefined) delete style[k];
      else style[k] = v;
    }
    const { style: _drop, ...rest } = i;
    return (Object.keys(style).length > 0 ? { ...rest, style } : rest) as BandItem;
  });
}

/** Changes what an item says or shows, keeping where it is. */
export function changeItem(band: PageBand, id: string, change: Partial<BandItem>): PageBand {
  return update(band, id, (i) => ({ ...i, ...change }) as BandItem);
}

/**
 * The band's height after dragging its inner edge by `dy`. Items are kept
 * inside it: a band cannot be shrunk out from under what is in it.
 */
export function resizeBand(
  band: PageBand | undefined,
  from: number,
  dy: number,
  pageHeight: number,
): PageBand {
  const items = band?.items ?? [];
  const lowest = items.reduce((m, i) => Math.max(m, i.y + i.height), 0);
  const height = round(clamp(from + dy, Math.max(MIN_BAND, lowest), pageHeight / 3));
  return { ...(band ?? { items: [] }), height };
}

/** Where to put an item added by clicking rather than dropping: below the last. */
export function nextFreeSpot(band: PageBand | undefined, left: number, bounds: Bounds): { x: number; y: number } {
  const items = band?.items ?? [];
  const y = items.reduce((m, i) => Math.max(m, i.y + i.height + 4), 8);
  return { x: left, y: Math.min(y, Math.max(0, bounds.height - 16)) };
}
