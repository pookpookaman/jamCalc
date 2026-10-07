/**
 * The `.jc` document.
 *
 * A single pretty-printed JSON file with canonical key ordering,
 * so it diffs and merges in git. That is a real advantage over an opaque zip
 * and it only holds if serialization is deterministic — hence the explicit key
 * order below rather than `JSON.stringify(obj)` over an arbitrary object.
 */

import type { Region, RegionId } from "./region.js";
import { runsFromText } from "./text.js";
import { readNumberFormat, type NumberFormat } from "./format.js";
import {
  readSheetTextStyle,
  readSheetUnits,
  sortedSheetUnits,
  sortedTextStyle,
  type SheetTextStyle,
} from "./settings.js";
import type { SheetUnits } from "../units/prefer.js";
import { migrateRaw } from "./migrate.js";
import { PAGE_SIZES, SCHEMA_VERSION, SheetFormatError } from "./schema.js";
import {
  BandFormatError,
  isEmptyBand,
  readBand,
  TITLE_BLOCK_KEYS,
  type BandItem,
  type PageBand,
  type TitleBlock,
} from "./bands.js";

// Re-exported so every existing importer of `sheet.js` keeps working; the
// definitions moved to break an import cycle, not to move ownership.
export { PAGE_SIZES, SCHEMA_VERSION, SheetFormatError };
export type { PageBand, TitleBlock };


/** One API mutation, for the change log. */
export interface ChangeEntry {
  readonly at: string;
  readonly client: string;
  readonly operation: "insert" | "update" | "delete" | "move";
  readonly region: RegionId;
  readonly before?: string;
  readonly after?: string;
}

/** Sheet margins in px at 96 dpi. Independent per edge. */
export interface Margins {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
}

export interface PageSetup {
  readonly size: "letter" | "a4";
  readonly orientation: "portrait" | "landscape";
  readonly margins: Margins;
  /** The number printed for this file's first page; 1 when absent. */
  readonly firstSheet?: number;
  /**
   * The package's total when this file is part of a larger set of sheets;
   * absent, it is this file's own last sheet number.
   */
  readonly totalSheets?: number;
  /** Absent means empty: nothing drawn, nothing printed. */
  readonly header?: PageBand;
  readonly footer?: PageBand;
}

export const DEFAULT_MARGINS: Margins = { top: 64, right: 48, bottom: 56, left: 48 };

export function pageBox(page: PageSetup): { width: number; height: number } {
  const base = PAGE_SIZES[page.size];
  return page.orientation === "landscape"
    ? { width: base.height, height: base.width }
    : base;
}

/**
 * The margins the sheet's contents actually sit inside.
 *
 * A header lives in the top margin and a footer in the bottom one. One taller
 * than its margin pushes the contents in rather than being drawn over them —
 * a header must never hide part of a calculation.
 */
export function contentMargins(page: PageSetup): Margins {
  const tall = (band: PageBand | undefined, margin: number): number =>
    isEmptyBand(band) ? margin : Math.max(margin, band?.height ?? margin);
  return {
    ...page.margins,
    top: tall(page.header, page.margins.top),
    bottom: tall(page.footer, page.margins.bottom),
  };
}

/** A band's drawn height: its own, or the margin it sits in. */
export function bandHeight(page: PageSetup, where: "header" | "footer"): number {
  const margin = where === "header" ? page.margins.top : page.margins.bottom;
  return Math.max(margin, page[where]?.height ?? margin);
}

export interface Sheet {
  readonly schemaVersion: number;
  readonly title: string;
  readonly page: PageSetup;
  /**
   * Stored with the document. It was previously app state, which meant Save
   * and Open silently dropped the project name and revision — the fields most
   * likely to matter on a printed sheet.
   */
  readonly titleBlock: TitleBlock;
  /**
   * The version of the app that last saved this file (ADR-0016). Carried as
   * read; written by whatever saves.
   */
  readonly savedWith?: string;
  /**
   * Units chosen for names in the values list, by name. Presentation only, and
   * only for the list: a region on the sheet shows the unit it asks for.
   */
  readonly valueUnits?: Readonly<Record<string, string>>;
  /** Default number format; a region may override it. */
  readonly format?: NumberFormat;
  /** Units a result is shown in when its region names none (ADR-0017). */
  readonly units?: SheetUnits;
  /** Default size, weight and font of regions that set none (ADR-0017). */
  readonly textStyle?: SheetTextStyle;
  readonly regions: readonly Region[];
  readonly changeLog: readonly ChangeEntry[];
}

/** A new sheet's header and footer are empty: what goes in is the user's choice. */
export const DEFAULT_PAGE: PageSetup = {
  size: "letter",
  orientation: "portrait",
  margins: DEFAULT_MARGINS,
};

export function emptySheet(title = "Untitled"): Sheet {
  return {
    schemaVersion: SCHEMA_VERSION,
    title,
    page: DEFAULT_PAGE,
    titleBlock: {},
    regions: [],
    changeLog: [],
  };
}

/** Sequential ids. Stable, readable in diffs, and sortable. */
export function nextRegionId(existing: Iterable<RegionId>): RegionId {
  let max = 0;
  for (const id of existing) {
    const m = /^r_(\d+)$/.exec(id);
    if (m) max = Math.max(max, Number.parseInt(m[1] as string, 10));
  }
  return `r_${String(max + 1).padStart(2, "0")}`;
}

// --- canonical serialization ----------------------------------------------

function canonicalRegion(r: Region): Record<string, unknown> {
  const base: Record<string, unknown> = {
    id: r.id,
    kind: r.kind,
    position: { x: r.position.x, y: r.position.y },
  };
  if (r.size) base["size"] = r.size;
  if (r.format && Object.keys(r.format).length > 0) base["format"] = r.format;
  if (r.kind === "math") base["source"] = r.source;
  else if (r.kind === "text") {
    base["runs"] = r.runs;
    if (r.align !== undefined) base["align"] = r.align;
  }
  else if (r.kind === "table") {
    base["columns"] = r.columns;
    base["cells"] = r.cells;
  } else if (r.kind === "image") {
    base["src"] = r.src;
    if (r.alt !== undefined) base["alt"] = r.alt;
  } else if (r.kind === "plot") {
    base["series"] = r.series;
    if (r.xUnit !== undefined) base["xUnit"] = r.xUnit;
    if (r.yUnit !== undefined) base["yUnit"] = r.yUnit;
    if (r.xLabel !== undefined) base["xLabel"] = r.xLabel;
    if (r.yLabel !== undefined) base["yLabel"] = r.yLabel;
  }
  if (r.style && Object.keys(r.style).length > 0) base["style"] = r.style;
  base["origin"] =
    r.origin.client === undefined
      ? { author: r.origin.author, at: r.origin.at }
      : { author: r.origin.author, client: r.origin.client, at: r.origin.at };
  return base;
}

function canonicalItem(item: BandItem): Record<string, unknown> {
  const out: Record<string, unknown> = {
    id: item.id,
    kind: item.kind,
    x: item.x,
    y: item.y,
    width: item.width,
    height: item.height,
  };
  if (item.kind === "text") out["text"] = item.text;
  else if (item.kind === "field") {
    out["field"] = item.field;
    if (item.caption) out["caption"] = true;
  } else if (item.kind === "line") {
    if (item.vertical) out["vertical"] = true;
  } else if (item.kind === "image") {
    out["src"] = item.src;
    if (item.alt !== undefined) out["alt"] = item.alt;
  }
  if (item.style && Object.keys(item.style).length > 0) out["style"] = item.style;
  return out;
}

function canonicalBand(band: PageBand): Record<string, unknown> {
  return {
    ...(band.height !== undefined ? { height: band.height } : {}),
    ...(band.enabled === false ? { enabled: false } : {}),
    items: band.items.map(canonicalItem),
  };
}

/** Title-block values in a fixed order, and only those that are set. */
function canonicalTitleBlock(block: TitleBlock): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of TITLE_BLOCK_KEYS) {
    const value = block[key];
    if (typeof value === "string") out[key] = value;
  }
  return out;
}

export function serializeSheet(sheet: Sheet): string {
  return `${JSON.stringify(
    {
      schemaVersion: sheet.schemaVersion,
      title: sheet.title,
      ...(sheet.savedWith !== undefined ? { savedWith: sheet.savedWith } : {}),
      titleBlock: canonicalTitleBlock(sheet.titleBlock),
      ...(sheet.valueUnits && Object.keys(sheet.valueUnits).length > 0
        ? { valueUnits: sortedValueUnits(sheet.valueUnits) }
        : {}),
      ...(sheet.format && Object.keys(sheet.format).length > 0
        ? { format: sheet.format }
        : {}),
      ...(sheet.units && Object.keys(sheet.units).length > 0 ? { units: sortedSheetUnits(sheet.units) } : {}),
      ...(sheet.textStyle && Object.keys(sheet.textStyle).length > 0
        ? { textStyle: sortedTextStyle(sheet.textStyle) }
        : {}),
      page: {
        size: sheet.page.size,
        orientation: sheet.page.orientation,
        margins: sheet.page.margins,
        ...(sheet.page.firstSheet !== undefined ? { firstSheet: sheet.page.firstSheet } : {}),
        ...(sheet.page.totalSheets !== undefined ? { totalSheets: sheet.page.totalSheets } : {}),
        ...(sheet.page.header ? { header: canonicalBand(sheet.page.header) } : {}),
        ...(sheet.page.footer ? { footer: canonicalBand(sheet.page.footer) } : {}),
      },
      // Serialization order is by id, NOT by position. Moving a region must
      // produce a one-line diff, not reshuffle the file.
      regions: [...sheet.regions]
        .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
        .map(canonicalRegion),
      changeLog: sheet.changeLog,
    },
    null,
    2,
  )}\n`;
}

/** Reads page setup; a margin left out takes its default. */
function readPageSetup(raw: unknown): PageSetup {
  if (typeof raw !== "object" || raw === null) return DEFAULT_PAGE;
  const p = raw as Record<string, any>;
  const margins: Margins =
    p["margins"] && typeof p["margins"] === "object"
      ? { ...DEFAULT_MARGINS, ...(p["margins"] as Partial<Margins>) }
      : DEFAULT_MARGINS;
  const header = optionalBand(p["header"]);
  const footer = optionalBand(p["footer"]);
  return {
    size: p["size"] === "a4" ? "a4" : "letter",
    orientation: p["orientation"] === "landscape" ? "landscape" : "portrait",
    margins,
    ...(isSheetNumber(p["firstSheet"]) ? { firstSheet: p["firstSheet"] } : {}),
    ...(isSheetNumber(p["totalSheets"]) ? { totalSheets: p["totalSheets"] } : {}),
    ...(header ? { header } : {}),
    ...(footer ? { footer } : {}),
  };
}

/** A sheet number: a whole number, 1 or more. */
export const isSheetNumber = (v: unknown): v is number =>
  typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 100_000;

/**
 * A band from a file. One that cannot be read is dropped, with the sheet
 * still opening: a header is not worth losing a calculation over.
 */
function optionalBand(raw: unknown): PageBand | undefined {
  if (raw === undefined || raw === null) return undefined;
  try {
    return readBand(raw);
  } catch (e) {
    if (e instanceof BandFormatError) return undefined;
    throw e;
  }
}

/** In name order, so choosing a unit is a one-line diff. */
function sortedValueUnits(units: Readonly<Record<string, string>>): Record<string, string> {
  return Object.fromEntries(Object.entries(units).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

/** A name and a unit, each short and plain; anything else is dropped. */
export function readValueUnits(raw: unknown): Record<string, string> | undefined {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return undefined;
  const out: Record<string, string> = {};
  for (const [name, unit] of Object.entries(raw as Record<string, unknown>)) {
    if (/^[`A-Za-z_][`\w']{0,63}$/.test(name) && typeof unit === "string" && unit.length > 0 && unit.length <= 40) {
      out[name] = unit;
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function readTitleBlock(raw: unknown): TitleBlock {
  if (typeof raw !== "object" || raw === null) return {};
  const r = raw as Record<string, unknown>;
  const out: Record<string, string> = {};
  for (const key of TITLE_BLOCK_KEYS) {
    if (typeof r[key] === "string") out[key] = r[key] as string;
  }
  return out;
}

export function parseSheet(json: string): Sheet {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch (e) {
    throw new SheetFormatError(`not valid JSON: ${(e as Error).message}`);
  }
  if (typeof raw !== "object" || raw === null) {
    throw new SheetFormatError("sheet must be an object");
  }
  // Carry an older file forward before reading it. A build that rejected
  // anything it did not already understand would destroy work the first time
  // the format moved.
  const o = migrateRaw(raw as Record<string, unknown>);
  if (!Array.isArray(o["regions"])) {
    throw new SheetFormatError("sheet.regions must be an array");
  }

  const regions = (o["regions"] as unknown[]).map((r, i) => {
    if (typeof r !== "object" || r === null) {
      throw new SheetFormatError(`region ${i} is not an object`);
    }
    const rr = r as Record<string, any>;
    if (typeof rr["id"] !== "string") {
      throw new SheetFormatError(`region ${i} has no id`);
    }
    if (
      rr["kind"] !== "math" &&
      rr["kind"] !== "text" &&
      rr["kind"] !== "table" &&
      rr["kind"] !== "plot" &&
      rr["kind"] !== "image" &&
      rr["kind"] !== "pagebreak"
    ) {
      throw new SheetFormatError(`region ${rr["id"]} has unknown kind`);
    }
    if (rr["kind"] === "plot" && !Array.isArray(rr["series"])) rr["series"] = [];
    // An image with no source is an empty frame, not a broken document. Nor is
    // one whose source is not a picture stored in the sheet: a web address
    // would be fetched the moment the sheet opened, telling whoever served it
    // that the file was read. A sheet never contacts anyone.
    if (
      rr["kind"] === "image" &&
      (typeof rr["src"] !== "string" || !rr["src"].startsWith("data:image/"))
    ) {
      rr["src"] = "";
    }
    if (rr["kind"] === "table") {
      // A table with no grid is not readable as one; treat it as empty rather
      // than letting `undefined.length` surface somewhere far away.
      if (!Array.isArray(rr["columns"])) rr["columns"] = [];
      if (!Array.isArray(rr["cells"])) rr["cells"] = [];
    }
    if (rr["kind"] === "text" && !Array.isArray(rr["runs"])) {
      // Older sheets stored one plain string. Read it as a single run rather
      // than losing the text.
      rr["runs"] = runsFromText(typeof rr["text"] === "string" ? rr["text"] : "");
      delete rr["text"];
    }
    return rr as unknown as Region;
  });

  const page = readPageSetup(o["page"]);
  return {
    schemaVersion: SCHEMA_VERSION,
    title: typeof o["title"] === "string" ? o["title"] : "Untitled",
    page,
    ...(typeof o["savedWith"] === "string" ? { savedWith: o["savedWith"] } : {}),
    titleBlock: readTitleBlock(o["titleBlock"]),
    ...(() => {
      const units = readValueUnits(o["valueUnits"]);
      return units ? { valueUnits: units } : {};
    })(),
    ...(() => {
      const format = readNumberFormat(o["format"]);
      return format ? { format } : {};
    })(),
    ...(() => {
      const units = readSheetUnits(o["units"]);
      return units ? { units } : {};
    })(),
    ...(() => {
      const textStyle = readSheetTextStyle(o["textStyle"]);
      return textStyle ? { textStyle } : {};
    })(),
    regions,
    changeLog: Array.isArray(o["changeLog"])
      ? (o["changeLog"] as ChangeEntry[])
      : [],
  };
}
