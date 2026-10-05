/**
 * Headers and footers, laid out freely.
 *
 * docs/headers.md. A band is a strip across the top or bottom of every page
 * holding placed items — fields, text, lines, boxes, a logo — each with its
 * own position and size, the way regions sit on the sheet. Empty by default:
 * what goes in is the user's choice, not a convention imposed on them.
 *
 * The values a field shows are not stored in the band. They are the sheet's
 * (its title, its title block) or the moment's (the page number, the date it
 * was printed), so a band can be saved as a template and applied to another
 * sheet without carrying this sheet's project name along with it.
 *
 * Coordinates are px at 96 dpi from the band's own top-left corner, which is
 * the paper's left edge and the top of the band.
 */

import type { TextAlign } from "./region.js";

// --- fields --------------------------------------------------------------------

/**
 * Everything a band can show that is not typed into the band itself.
 *
 * A fixed list, not an expression language: a header that could compute would
 * be a second, worse calculation engine, and one that silently failed would
 * print a wrong sheet number on a submitted calculation.
 */
export type FieldName =
  | "title"
  | "project"
  | "job"
  | "subject"
  | "client"
  | "by"
  | "date"
  | "checkedBy"
  | "checkedDate"
  | "rev"
  | "sheet"
  | "sheets"
  | "page"
  | "pages"
  | "printed"
  | "version"
  | "savedWith"
  | "file";

export interface FieldInfo {
  readonly name: FieldName;
  /** The palette's name for it, and the caption above it when shown. */
  readonly label: string;
  /** Where its value comes from: typed once per sheet, or supplied at print. */
  readonly source: "sheet" | "automatic";
}

export const FIELDS: readonly FieldInfo[] = [
  { name: "title", label: "Title", source: "sheet" },
  { name: "project", label: "Project", source: "sheet" },
  { name: "job", label: "Job no.", source: "sheet" },
  { name: "subject", label: "Subject", source: "sheet" },
  { name: "client", label: "Client", source: "sheet" },
  { name: "by", label: "By", source: "sheet" },
  { name: "date", label: "Date", source: "sheet" },
  { name: "checkedBy", label: "Checked", source: "sheet" },
  { name: "checkedDate", label: "Checked date", source: "sheet" },
  { name: "rev", label: "Rev", source: "sheet" },
  { name: "sheet", label: "Sheet", source: "automatic" },
  { name: "sheets", label: "Of sheets", source: "automatic" },
  { name: "page", label: "Page", source: "automatic" },
  { name: "pages", label: "Pages", source: "automatic" },
  { name: "printed", label: "Date printed", source: "automatic" },
  { name: "version", label: "Version", source: "automatic" },
  { name: "savedWith", label: "Saved with", source: "automatic" },
  { name: "file", label: "File name", source: "automatic" },
];

const FIELD_NAMES = new Set<string>(FIELDS.map((f) => f.name));
export const isFieldName = (name: unknown): name is FieldName =>
  typeof name === "string" && FIELD_NAMES.has(name);

export const fieldInfo = (name: FieldName): FieldInfo =>
  FIELDS.find((f) => f.name === name) as FieldInfo;

/**
 * Title-block values: sheet metadata, typed once and shown wherever a band
 * places the field. Not part of the calculation.
 */
export interface TitleBlock {
  readonly project?: string;
  readonly job?: string;
  readonly subject?: string;
  readonly client?: string;
  readonly by?: string;
  /** As the engineer states it; not filled in automatically. */
  readonly date?: string;
  readonly checkedBy?: string;
  readonly checkedDate?: string;
  readonly rev?: string;
}

export const TITLE_BLOCK_KEYS = [
  "project",
  "job",
  "subject",
  "client",
  "by",
  "date",
  "checkedBy",
  "checkedDate",
  "rev",
] as const satisfies readonly (keyof TitleBlock & FieldName)[];

/** What a band needs to fill its fields on one page. */
export interface PageFields {
  readonly title: string;
  readonly titleBlock: TitleBlock;
  /** One-based, this file's own page. */
  readonly page: number;
  readonly pages: number;
  /** The number printed for this file's first page. */
  readonly firstSheet?: number;
  /** The package's total, when this file is part of a larger set. */
  readonly totalSheets?: number;
  readonly printed: Date;
  readonly version?: string;
  readonly savedWith?: string;
  readonly file?: string;
}

/** A field's value on one page; empty when the sheet has none. */
export function fieldValue(name: FieldName, f: PageFields): string {
  const first = f.firstSheet ?? 1;
  switch (name) {
    case "title":
      return f.title;
    case "sheet":
      return String(first + f.page - 1);
    case "sheets":
      return String(f.totalSheets ?? first + f.pages - 1);
    case "page":
      return String(f.page);
    case "pages":
      return String(f.pages);
    case "printed":
      return f.printed.toLocaleDateString();
    case "version":
      return f.version ?? "";
    case "savedWith":
      return f.savedWith ?? "";
    case "file":
      return f.file ?? "";
    default:
      return f.titleBlock[name] ?? "";
  }
}

/**
 * Fills `{field}` in text. An unknown name prints as written rather than
 * vanishing, so a typo shows on the page instead of leaving a silent gap.
 */
export function fillBandText(text: string, fields: PageFields): string {
  return text.replace(/\{(\w+)\}/g, (whole, name: string) =>
    isFieldName(name) ? fieldValue(name, fields) : whole,
  );
}

// --- items -------------------------------------------------------------------

export interface BandItemStyle {
  readonly fontSize?: number;
  readonly bold?: boolean;
  readonly italic?: boolean;
  readonly color?: string;
  readonly align?: TextAlign;
}

interface BandItemBase {
  /** Unique within its band. */
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly style?: BandItemStyle;
}

/** Typed text, which may contain `{field}`s. */
export interface BandText extends BandItemBase {
  readonly kind: "text";
  readonly text: string;
}

/** One field's value, optionally with its name as a small caption above. */
export interface BandField extends BandItemBase {
  readonly kind: "field";
  readonly field: FieldName;
  readonly caption?: boolean;
}

/** A rule along the item's top edge, or its left edge when vertical. */
export interface BandLine extends BandItemBase {
  readonly kind: "line";
  readonly vertical?: boolean;
}

/** A rectangle outline, for boxed title blocks. */
export interface BandBox extends BandItemBase {
  readonly kind: "box";
}

/** A picture — a logo — stored in the sheet as pictures on the sheet are. */
export interface BandImage extends BandItemBase {
  readonly kind: "image";
  /** A `data:image/…` URI. Nothing else: a sheet must not fetch from anywhere. */
  readonly src: string;
  readonly alt?: string;
}

export type BandItem = BandText | BandField | BandLine | BandBox | BandImage;

export interface PageBand {
  /**
   * Height in px. A header this tall pushes the sheet's contents down if it
   * is taller than the top margin; absent, it is exactly the margin.
   */
  readonly height?: number;
  /** False hides the band without deleting what is in it. */
  readonly enabled?: boolean;
  readonly items: readonly BandItem[];
}

export const EMPTY_BAND: PageBand = { items: [] };

/** A band that draws nothing — so takes no room and prints nothing. */
export const isEmptyBand = (band: PageBand | undefined): boolean =>
  !band || band.enabled === false || band.items.length === 0;

/** Sequential item ids within a band, `i_01`, `i_02`… */
export function nextItemId(items: readonly BandItem[]): string {
  let max = 0;
  for (const item of items) {
    const m = /^i_(\d+)$/.exec(item.id);
    if (m) max = Math.max(max, Number.parseInt(m[1] as string, 10));
  }
  return `i_${String(max + 1).padStart(2, "0")}`;
}

// --- reading -----------------------------------------------------------------

/** Thrown for a band that cannot be read as one. */
export class BandFormatError extends Error {}

const finite = (v: unknown, fallback: number): number =>
  typeof v === "number" && Number.isFinite(v) ? v : fallback;
const size = (v: unknown): number => Math.max(0, finite(v, 0));

const ALIGNS = new Set(["left", "center", "right"]);
const COLOUR = /^#[0-9a-f]{3}([0-9a-f]{3})?$/i;
const IMAGE_DATA = /^data:image\/(png|jpeg|gif|webp|svg\+xml);base64,[A-Za-z0-9+/=\s]*$/;

function readStyle(raw: unknown): BandItemStyle | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const s = raw as Record<string, unknown>;
  const style: Record<string, unknown> = {};
  if (typeof s["fontSize"] === "number" && s["fontSize"] > 0 && s["fontSize"] <= 96) {
    style["fontSize"] = s["fontSize"];
  }
  if (s["bold"] === true) style["bold"] = true;
  if (s["italic"] === true) style["italic"] = true;
  if (typeof s["color"] === "string" && COLOUR.test(s["color"])) style["color"] = s["color"];
  if (typeof s["align"] === "string" && ALIGNS.has(s["align"])) style["align"] = s["align"];
  return Object.keys(style).length > 0 ? (style as BandItemStyle) : undefined;
}

/**
 * One item, checked. Anything malformed is dropped rather than trusted: a band
 * comes from a file or an API caller, and a header that could not be drawn
 * must not stop the sheet opening.
 */
function readItem(raw: unknown, seen: Set<string>): BandItem | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r["id"] !== "string" || r["id"] === "" || seen.has(r["id"])) return null;
  const style = readStyle(r["style"]);
  const base = {
    id: r["id"],
    x: finite(r["x"], 0),
    y: finite(r["y"], 0),
    width: size(r["width"]),
    height: size(r["height"]),
    ...(style ? { style } : {}),
  };
  let item: BandItem | null = null;
  switch (r["kind"]) {
    case "text":
      if (typeof r["text"] === "string") item = { ...base, kind: "text", text: r["text"] };
      break;
    case "field":
      if (isFieldName(r["field"])) {
        item = { ...base, kind: "field", field: r["field"], ...(r["caption"] === true ? { caption: true } : {}) };
      }
      break;
    case "line":
      item = { ...base, kind: "line", ...(r["vertical"] === true ? { vertical: true } : {}) };
      break;
    case "box":
      item = { ...base, kind: "box" };
      break;
    case "image":
      if (typeof r["src"] === "string" && IMAGE_DATA.test(r["src"])) {
        item = {
          ...base,
          kind: "image",
          src: r["src"],
          ...(typeof r["alt"] === "string" ? { alt: r["alt"] } : {}),
        };
      }
      break;
    default:
      break;
  }
  if (item) seen.add(item.id);
  return item;
}

/** Reads a band from a file or an API caller. */
export function readBand(raw: unknown): PageBand {
  if (typeof raw !== "object" || raw === null) throw new BandFormatError("a band must be an object");
  const b = raw as Record<string, unknown>;
  if (b["items"] !== undefined && !Array.isArray(b["items"])) {
    throw new BandFormatError("band.items must be an array");
  }
  const seen = new Set<string>();
  const items = ((b["items"] as unknown[] | undefined) ?? [])
    .map((i) => readItem(i, seen))
    .filter((i): i is BandItem => i !== null);
  return {
    ...(typeof b["height"] === "number" && Number.isFinite(b["height"]) && b["height"] >= 0
      ? { height: b["height"] }
      : {}),
    ...(b["enabled"] === false ? { enabled: false } : {}),
    items,
  };
}

// --- the format-1 band, carried forward ----------------------------------------

/**
 * Format 1's three-slot band, as it was stored. Kept only so a migration can
 * read it; nothing else should ever see this shape again.
 */
interface SlotBandV1 {
  readonly left?: string;
  readonly center?: string;
  readonly right?: string;
  readonly enabled?: boolean;
  readonly height?: number;
  readonly fontSize?: number;
  readonly offset?: number;
  readonly rule?: boolean;
}

const V1_DEFAULTS = { height: 18, fontSize: 10, offset: 24 };

/**
 * A format-1 band as items, drawn where it was drawn before.
 *
 * The three slots were equal thirds of the content width, text centred
 * vertically in a strip `offset` from the paper edge, with a rule on the
 * strip's inner edge. They become three text items in exactly those places and
 * a line where the rule was, so an old sheet prints as it did.
 *
 * `{date}` meant the day of printing then. The same name now means the date
 * the engineer states, so it is carried as `{printed}` to keep what it showed.
 */
export function bandFromSlots(
  raw: SlotBandV1,
  where: "header" | "footer",
  paper: { width: number },
  margins: { top: number; right: number; bottom: number; left: number },
): PageBand {
  const stripHeight = finite(raw.height, V1_DEFAULTS.height);
  const offset = finite(raw.offset, V1_DEFAULTS.offset);
  const fontSize = finite(raw.fontSize, V1_DEFAULTS.fontSize);
  const slots = [raw.left, raw.center, raw.right].map((s) =>
    typeof s === "string" ? s.replace(/\{date\}/g, "{printed}") : "",
  );

  const margin = where === "header" ? margins.top : margins.bottom;
  const height = Math.max(margin, offset + stripHeight);
  // The strip's top, within the band.
  const top = where === "header" ? offset : height - offset - stripHeight;
  const width = paper.width - margins.left - margins.right;
  const third = width / 3;
  const aligns = ["left", "center", "right"] as const;

  const items: BandItem[] = [];
  slots.forEach((text, i) => {
    if (!text) return;
    items.push({
      id: `i_${String(items.length + 1).padStart(2, "0")}`,
      kind: "text",
      text,
      x: margins.left + i * third,
      y: top,
      width: third,
      height: stripHeight,
      style: { fontSize, align: aligns[i] as TextAlign },
    });
  });
  // An empty band drew nothing, its rule included.
  if (items.length > 0 && raw.rule !== false) {
    items.push({
      id: `i_${String(items.length + 1).padStart(2, "0")}`,
      kind: "line",
      x: margins.left,
      y: where === "header" ? top + stripHeight - 1 : top,
      width,
      height: 0,
    });
  }
  return {
    ...(height !== margin ? { height } : {}),
    ...(raw.enabled === false ? { enabled: false } : {}),
    items,
  };
}
