/**
 * The linear text projection.
 *
 * A worksheet rendered as one readable column: id, source, and the computed
 * result with units. This is the form a caller reads and edits — the JSON is
 * coordinate-oriented and verbose, and reasoning about a calculation through
 * it is like reading a document by its markup.
 *
 * WHAT ROUND-TRIPS: ids and sources — the content.
 * WHAT DOES NOT: position. That is deliberate, not a gap. Callers edit
 * meaning; the app owns placement. A projection edit that adds a region says
 * where it goes *semantically* (after which id), and layout is flowed to suit.
 */

import type { Region, RegionId, RegionResult, TableRegion } from "./region.js";
import { valueIn } from "../units/parse.js";
import { preferredUnit, type SheetUnits } from "../units/prefer.js";
import type { Sheet } from "./sheet.js";
import { plainText } from "./text.js";
import { formatNumber, resolveFormat, type NumberFormat } from "./format.js";
import { isMatrix } from "../value.js";
import type { MatrixValue } from "../matrix.js";
import type { Quantity } from "../quantity.js";

export interface ProjectionOptions {
  /** Include the `⇒ value` column. Off for a pure round-trip test. */
  readonly withResults?: boolean;
  /** Column at which results are aligned. */
  readonly resultColumn?: number;
}

const ID_PATTERN = /^\[([A-Za-z0-9_]+)\]\s?/;

/** How a page break appears in the projection, and how it is read back. */
export const PAGE_BREAK_LINE = "---- page break ----";

/**
 * `[1 ft, 2 ft; 3 ft, 4 ft]` — the literal syntax, so a projection round-trips
 * as something a caller could paste back.
 */
export function formatMatrix(m: MatrixValue, format?: NumberFormat, units?: SheetUnits): string {
  const cell = (q: Quantity): string => {
    if (q.dimension.isDimensionless) return formatNumber(q.si, format);
    const unit = preferredUnit(q.dimension, units);
    return unit === undefined
      ? `${formatNumber(q.si, format)} ${q.dimension.toString()}`
      : `${formatNumber(valueIn(q, unit), format)} ${unit}`;
  };
  return `[${m.toRows().map((row) => row.map(cell).join(", ")).join("; ")}]`;
}



/**
 * A result split into magnitude and unit.
 *
 * Kept separate because a renderer needs them apart — `kip*ft` printed as
 * written is code, while `kip·ft` with a real superscript is notation. The
 * text projection joins them again; the UI does not.
 */
export interface ResultParts {
  readonly text: string;
  readonly unit?: string;
}

export function formatResultParts(
  result: RegionResult | undefined,
  format?: NumberFormat,
  units?: SheetUnits,
): ResultParts {
  if (!result) return { text: "" };
  switch (result.status) {
    case "ok": {
      if (result.isFunction) return { text: "" };
      if (result.displayUnit !== undefined && result.displayValue !== undefined) {
        return {
          text: formatNumber(result.displayValue, format),
          unit: result.displayUnit,
        };
      }
      if (isMatrix(result.value)) return { text: formatMatrix(result.value, format, units) };
      if (result.value.dimension.isDimensionless) {
        return { text: formatNumber(result.value.si, format) };
      }
      // No unit chosen for this region: fall back to the discipline's default
      // rather than coherent SI, which is correct and unreadable.
      const preferred = preferredUnit(result.value.dimension, units);
      if (preferred !== undefined) {
        return {
          text: formatNumber(valueIn(result.value, preferred), format),
          unit: preferred,
        };
      }
      return {
        text: formatNumber(result.value.si, format),
        unit: result.value.dimension.toString(),
      };
    }
    case "error":
      return { text: `!! ${result.error.code}: ${result.error.message}` };
    case "blocked":
      return {
        text: `-- blocked: \`${result.missing}\` unavailable from ${result.because}`,
      };
    default:
      return { text: "" };
  }
}

export function formatResult(
  result: RegionResult | undefined,
  format?: NumberFormat,
  units?: SheetUnits,
): string {
  const { text, unit } = formatResultParts(result, format, units);
  return unit === undefined ? text : `${text} ${unit}`;
}

/**
 * Renders regions in evaluation order.
 *
 * `order` comes from the worksheet rather than being recomputed here, so the
 * projection always shows the order the sheet actually evaluated in — which is
 * the point of reading it.
 */
export function project(
  sheet: Sheet,
  order: readonly RegionId[],
  results: ReadonlyMap<RegionId, RegionResult>,
  options: ProjectionOptions = {},
): string {
  const withResults = options.withResults ?? true;
  const column = options.resultColumn ?? 44;
  const byId = new Map(sheet.regions.map((r) => [r.id, r]));

  const lines: string[] = [`# ${sheet.title}`, ""];

  for (const id of order) {
    const region = byId.get(id);
    if (!region) continue;

    if (region.kind === "text") {
      lines.push(`[${id}] : ${plainText(region.runs).replace(/\n/g, " ")}`);
      continue;
    }

    if (region.kind === "pagebreak") {
      lines.push(`[${id}] ${PAGE_BREAK_LINE}`);
      continue;
    }

    if (region.kind === "image") {
      // What it is, not what it contains: a data URI in the projection would
      // bury the sheet in base64 for a reader who cannot see the picture.
      lines.push(`[${id}] @ image${region.alt ? ` ${region.alt}` : ""}`);
      continue;
    }

    if (region.kind === "plot") {
      // Named series, not pixels: what a reader needs to know is which values
      // are drawn against which, and the numbers are already on the sheet.
      const series = region.series
        .map((s) => `${s.y} vs ${s.x}`)
        .join(", ");
      lines.push(`[${id}] ~ plot ${series}`);
      continue;
    }

    if (region.kind === "table") {
      // One line per row, each carrying the region id, so the grid survives
      // the projection instead of being summarised away. A caller handed the
      // projection to read a sheet must be able to see the data a lookup uses.
      for (const row of tableLines(region)) lines.push(`[${id}] ${row}`);
      continue;
    }

    const left = `[${id}] ${region.source}`;
    if (!withResults) {
      lines.push(left);
      continue;
    }
    const shown = formatResult(results.get(id), resolveFormat(region.format, sheet.format), sheet.units);
    if (shown === "") {
      lines.push(left);
      continue;
    }
    const pad = left.length >= column ? " " : " ".repeat(column - left.length);
    lines.push(`${left}${pad}⇒ ${shown}`);
  }

  return `${lines.join("\n")}\n`;
}

export interface ProjectionEntry {
  /** Absent for a line the caller added without an id — a new region. */
  readonly id?: RegionId;
  readonly kind: "math" | "text" | "table" | "plot" | "image";
  readonly source: string;
}

/**
 * A table as projection rows: a header of `name (unit)`, then the data.
 *
 * Leading `|` marks the line as a table row, the way a leading `:` marks text.
 * Both are characters the lexer would reject at the start of a statement, so
 * neither can be confused with math.
 */
export function tableLines(region: TableRegion): readonly string[] {
  const header = region.columns.map((c) =>
    c.unit && c.unit.trim() !== "" ? `${c.name} (${c.unit})` : c.name,
  );
  const rows = region.cells.map((row) =>
    region.columns.map((_, i) => {
      const cell = row[i];
      return cell === null || cell === undefined ? "" : String(cell);
    }),
  );
  return [header, ...rows].map((cells) => `| ${cells.join(" | ")}`);
}

export interface ParsedProjection {
  readonly title?: string;
  readonly entries: readonly ProjectionEntry[];
}

/**
 * Reads a projection back.
 *
 * The `⇒ result` column is output, not input — it is stripped and ignored, so
 * a caller can hand back exactly what it was given. Requiring callers to
 * delete computed values before writing would be a trap.
 */
export function parseProjection(text: string): ParsedProjection {
  const entries: ProjectionEntry[] = [];
  let title: string | undefined;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    if (line.trim() === "") continue;

    if (line.startsWith("#")) {
      if (title === undefined) title = line.replace(/^#\s*/, "").trim();
      continue;
    }

    let rest = line;
    let id: RegionId | undefined;
    const m = ID_PATTERN.exec(rest);
    if (m) {
      id = m[1] as RegionId;
      rest = rest.slice(m[0].length);
    }

    // Drop the result column. `⇒` cannot appear in source: it is not an
    // operator and the lexer would reject it, so this is unambiguous.
    const arrow = rest.indexOf("⇒");
    if (arrow >= 0) rest = rest.slice(0, arrow);
    rest = rest.trim();
    if (rest === "") continue;

    if (rest.startsWith("@")) {
      entries.push({
        ...(id !== undefined ? { id } : {}),
        kind: "image",
        source: rest,
      });
      continue;
    }

    if (rest.startsWith("~")) {
      entries.push({
        ...(id !== undefined ? { id } : {}),
        kind: "plot",
        source: rest,
      });
      continue;
    }

    if (rest.startsWith("|")) {
      entries.push({
        ...(id !== undefined ? { id } : {}),
        kind: "table",
        source: rest,
      });
      continue;
    }

    if (rest.startsWith(":") && !rest.startsWith(":=")) {
      entries.push({
        ...(id !== undefined ? { id } : {}),
        kind: "text",
        source: rest.slice(1).trim(),
      });
      continue;
    }

    entries.push({
      ...(id !== undefined ? { id } : {}),
      kind: "math",
      source: rest,
    });
  }

  return title === undefined ? { entries } : { title, entries };
}

/** True when every region survives a project -> parse cycle unchanged. */
export function roundTrips(
  sheet: Sheet,
  order: readonly RegionId[],
  results: ReadonlyMap<RegionId, RegionResult>,
): boolean {
  const back = parseProjection(project(sheet, order, results));
  const byId = new Map<RegionId, Region>(sheet.regions.map((r) => [r.id, r]));
  const seen = new Set<RegionId>();
  const tableChecked = new Set<RegionId>();

  for (const entry of back.entries) {
    if (entry.id === undefined) return false;
    const region = byId.get(entry.id);
    if (!region) return false;
    seen.add(entry.id);
    if (region.kind === "pagebreak") {
      if (entry.source !== PAGE_BREAK_LINE) return false;
      continue;
    }
    if (region.kind === "image") {
      const want = `@ image${region.alt ? ` ${region.alt}` : ""}`;
      if (entry.source !== want) return false;
      continue;
    }
    if (region.kind === "plot") {
      const want = `~ plot ${region.series.map((s) => `${s.y} vs ${s.x}`).join(", ")}`;
      if (entry.source !== want) return false;
      continue;
    }
    if (region.kind === "table") {
      // A table spans several entries; check them together, once.
      if (tableChecked.has(region.id)) continue;
      tableChecked.add(region.id);
      const got = back.entries.filter((e) => e.id === region.id).map((e) => e.source);
      const want = tableLines(region);
      if (got.length !== want.length) return false;
      if (got.some((line, i) => line !== want[i])) return false;
      continue;
    }
    const original =
      region.kind === "math"
        ? region.source
        : plainText(region.runs).replace(/\n/g, " ");
    if (original.trim() !== entry.source) return false;
    if (region.kind !== entry.kind) return false;
  }
  return seen.size === sheet.regions.length;
}

export { valueIn };
