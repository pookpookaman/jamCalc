/**
 * The document API.
 *
 * Pure functions over a `Sheet`. They compute a `Worksheet` when they need
 * results and throw it away, so a caller never has to hold a session, and two
 * callers can never disagree about state they both thought they owned.
 *
 * Every operation the GUI performs must be expressible here. If
 * the GUI can do something these cannot, that is a bug in this file.
 */

import { Worksheet } from "../document/worksheet.js";
import { project } from "../document/projection.js";
import { formatResult } from "../document/projection.js";
import { resolveFormat } from "../document/format.js";
import { plainText } from "../document/text.js";
import { parseStatement } from "../parser.js";
import { setDisplayUnit } from "../document/source.js";
import { CalcError } from "../errors.js";
import { isMatrix } from "../value.js";
import { preferredUnit } from "../units/prefer.js";
import { valueIn, parseUnit } from "../units/parse.js";
import type { Region, RegionId, RegionResult } from "../document/region.js";
import type { Sheet } from "../document/sheet.js";
import { applyPatch, type PatchContext, type PatchOperation } from "./patch.js";
import { ApiError } from "./errors.js";

// --- shared shapes -----------------------------------------------------------

export interface ValueReport {
  /** Magnitude in the unit named below, or the plain number when there is none. */
  readonly value?: number;
  readonly unit?: string;
  /** Rendered exactly as the sheet shows it. */
  readonly display: string;
  /** SI magnitude and dimension, for a caller doing its own arithmetic. */
  readonly si?: number;
  readonly dimension?: string;
}

export interface RegionReport {
  readonly id: RegionId;
  readonly kind: Region["kind"];
  readonly source?: string;
  readonly text?: string;
  readonly defines?: string;
  readonly status: "ok" | "error" | "blocked" | "empty";
  readonly result?: ValueReport;
  readonly error?: ReturnType<CalcError["toJSON"]>;
  readonly blockedBy?: RegionId;
  readonly dependsOn?: readonly RegionId[];
  readonly author: "human" | "api";
  /** Image regions only: how large the embedded picture is. */
  readonly bytes?: number;
  /** Plot regions only: which values are drawn against which. */
  readonly series?: readonly { readonly x: string; readonly y: string }[];
  /** Table regions only: the columns and how many rows they hold. */
  readonly columns?: readonly { readonly name: string; readonly unit?: string }[];
  readonly rows?: number;
}

export interface SheetReport {
  readonly title: string;
  readonly pages: number;
  readonly regions: number;
  /** The linear text projection — the form to read. */
  readonly projection: string;
  readonly upToDate: boolean;
}

function reportValue(
  result: RegionResult | undefined,
  format: ReturnType<typeof resolveFormat>,
): ValueReport | undefined {
  if (!result || result.status !== "ok" || result.isFunction) return undefined;
  const display = formatResult(result, format);
  if (isMatrix(result.value)) {
    return { display, dimension: result.value.commonDimension()?.toString() ?? "mixed" };
  }
  const unit = result.displayUnit ?? preferredUnit(result.value.dimension);
  return {
    display,
    ...(unit !== undefined
      ? { unit, value: valueIn(result.value, unit) }
      : // A pure number — a ratio, a DCR, a pass/fail flag — has no unit to
        // name, and its value is its magnitude. Leaving it out left the value
        // column of every export empty for exactly the numbers people export.
        result.value.dimension.isDimensionless
        ? { value: result.value.si }
        : {}),
    si: result.value.si,
    dimension: result.value.dimension.toString(),
  };
}

function computed(sheet: Sheet): Worksheet {
  const ws = new Worksheet(sheet.regions);
  ws.recompute();
  return ws;
}

// --- reads -------------------------------------------------------------------

export function getSheet(sheet: Sheet): SheetReport {
  const ws = computed(sheet);
  const results = new Map<RegionId, RegionResult>();
  for (const r of sheet.regions) {
    const res = ws.getResult(r.id);
    if (res) results.set(r.id, res);
  }
  return {
    title: sheet.title,
    pages: 1,
    regions: sheet.regions.length,
    projection: project(sheet, ws.order, results),
    upToDate: ws.isUpToDate,
  };
}

export function getRegion(sheet: Sheet, id: RegionId): RegionReport {
  const region = sheet.regions.find((r) => r.id === id);
  if (!region) throw new ApiError("unknown_region", `no region \`${id}\``, undefined, id);

  const ws = computed(sheet);
  return describe(sheet, region, ws);
}

export function listRegions(sheet: Sheet): RegionReport[] {
  const ws = computed(sheet);
  const byId = new Map(sheet.regions.map((r) => [r.id, r]));
  return ws.order
    .map((id) => byId.get(id))
    .filter((r): r is Region => r !== undefined)
    .map((r) => describe(sheet, r, ws));
}

function describe(sheet: Sheet, region: Region, ws: Worksheet): RegionReport {
  const result = ws.getResult(region.id);
  const format = resolveFormat(region.format, sheet.format);
  const base = {
    id: region.id,
    kind: region.kind,
    author: region.origin.author,
    dependsOn: ws.trace(region.id),
  } as const;

  if (region.kind === "text") {
    return { ...base, text: plainText(region.runs), status: "ok" };
  }
  if (region.kind === "pagebreak") {
    return { ...base, status: "ok" };
  }
  if (region.kind === "image") {
    // The bytes are deliberately not reported: a caller listing a sheet does
    // not want a megabyte of base64 per picture.
    return {
      ...base,
      status: "ok" as const,
      ...(region.alt !== undefined ? { text: region.alt } : {}),
      bytes: region.src.length,
    };
  }
  if (region.kind === "plot") {
    const plot = {
      ...base,
      series: region.series.map((s) => ({ x: s.x, y: s.y })),
    };
    return result?.status === "error"
      ? { ...plot, status: "error" as const, error: result.error.toJSON() }
      : result?.status === "blocked"
        ? { ...plot, status: "blocked" as const, blockedBy: result.because }
        : { ...plot, status: "ok" as const };
  }
  if (region.kind === "table") {
    // A table has no source and no single value: what a caller needs is the
    // shape and the names it binds, and its error when it has one.
    const table = {
      ...base,
      columns: region.columns.map((c) => ({
        name: c.name,
        ...(c.unit !== undefined ? { unit: c.unit } : {}),
      })),
      rows: region.cells.length,
      defines: region.columns.map((c) => c.name).join(", "),
    };
    return result?.status === "error"
      ? { ...table, status: "error", error: result.error.toJSON() }
      : { ...table, status: "ok" };
  }

  const defines = (() => {
    try {
      const statement = parseStatement(region.source);
      return statement.kind === "definition" ? statement.name : undefined;
    } catch {
      return undefined;
    }
  })();

  if (!result) {
    return { ...base, source: region.source, status: "empty" };
  }
  if (result.status === "error") {
    return {
      ...base,
      source: region.source,
      ...(defines !== undefined ? { defines } : {}),
      status: "error",
      error: result.error.toJSON(),
    };
  }
  if (result.status === "blocked") {
    return {
      ...base,
      source: region.source,
      ...(defines !== undefined ? { defines } : {}),
      status: "blocked",
      blockedBy: result.because,
    };
  }
  const value = reportValue(result, format);
  return {
    ...base,
    source: region.source,
    ...(defines !== undefined ? { defines } : {}),
    status: "ok",
    ...(value ? { result: value } : {}),
  };
}

export interface SymbolReport {
  readonly name: string;
  readonly definedIn: RegionId;
  readonly display: string;
  readonly si?: number;
  readonly dimension?: string;
}

/** How a caller orients itself in an unfamiliar sheet. */
export function listSymbols(sheet: Sheet): SymbolReport[] {
  const ws = computed(sheet);
  return ws.listSymbols().map((s) => {
    const region = sheet.regions.find((r) => r.id === s.definedIn);
    const format = resolveFormat(region?.format, sheet.format);
    const report = reportValue({ status: "ok", value: s.value }, format);
    return {
      name: s.name,
      definedIn: s.definedIn,
      display: report?.display ?? "",
      ...(report?.si !== undefined ? { si: report.si } : {}),
      ...(report?.dimension !== undefined ? { dimension: report.dimension } : {}),
    };
  });
}

/** "What feeds this value?" — the most useful question when checking a calc. */
export function trace(sheet: Sheet, id: RegionId): RegionReport[] {
  const region = sheet.regions.find((r) => r.id === id);
  if (!region) throw new ApiError("unknown_region", `no region \`${id}\``, undefined, id);
  const ws = computed(sheet);
  const byId = new Map(sheet.regions.map((r) => [r.id, r]));
  return ws
    .trace(id)
    .map((dep) => byId.get(dep))
    .filter((r): r is Region => r !== undefined)
    .map((r) => describe(sheet, r, ws));
}

// --- writes ------------------------------------------------------------------

export { applyPatch };
export type { PatchOperation, PatchContext };

/**
 * Sets input variables and returns the sheet with them changed.
 *
 * Rewrites the defining region's source rather than injecting values beside
 * it, so the sheet remains a document that says what it computed. A stored
 * override invisible in the text would make a printed sheet a lie.
 */
export function setInputs(
  sheet: Sheet,
  values: Readonly<Record<string, string>>,
  context: PatchContext,
): Sheet {
  const ws = computed(sheet);
  const symbols = new Map(ws.listSymbols().map((s) => [s.name, s.definedIn]));
  const operations: PatchOperation[] = [];

  for (const [name, literal] of Object.entries(values)) {
    const id = symbols.get(name);
    if (id === undefined) {
      throw new ApiError("unknown_name", `\`${name}\` is not defined on this sheet`);
    }
    const region = sheet.regions.find((r) => r.id === id);
    if (!region || region.kind !== "math") {
      throw new ApiError("wrong_kind", `\`${name}\` is not defined by a math region`, undefined, id);
    }

    // Validate before rewriting: a bad literal must not land in the document.
    let statement;
    try {
      statement = parseStatement(`${name} := ${literal}`);
    } catch (e) {
      throw new ApiError(
        "invalid_value",
        `cannot set \`${name}\` to \`${literal}\`: ${(e as Error).message}`,
      );
    }

    // Keep whatever display unit the region already had.
    const existing = (() => {
      try {
        return parseStatement(region.source).displayUnit;
      } catch {
        return undefined;
      }
    })();
    let source = `${name} := ${literal}`;
    if (existing !== undefined) source = setDisplayUnit(source, existing);
    void statement;

    operations.push({ op: "update", id, source });
  }

  return applyPatch(sheet, operations, context).sheet;
}

export interface EvaluateOptions {
  /** Input overrides applied for this run only. */
  readonly set?: Readonly<Record<string, string>>;
}

export interface EvaluateReport {
  readonly regions: readonly RegionReport[];
  readonly symbols: readonly SymbolReport[];
  readonly errors: number;
}

/**
 * Runs the sheet without persisting anything.
 *
 * The dry run: a caller can check its work before
 * committing, and a script can validate before overwriting a file.
 */
export function evaluate(sheet: Sheet, options: EvaluateOptions = {}): EvaluateReport {
  const target = options.set
    ? setInputs(sheet, options.set, { client: "evaluate" })
    : sheet;
  const regions = listRegions(target);
  return {
    regions,
    symbols: listSymbols(target),
    errors: regions.filter((r) => r.status === "error" || r.status === "blocked").length,
  };
}

// --- export ------------------------------------------------------------------

export type ExportFormat = "json" | "csv" | "text";

export function exportSheet(sheet: Sheet, format: ExportFormat): string {
  if (format === "text") return getSheet(sheet).projection;

  const rows = listRegions(sheet).filter((r) => r.kind === "math");

  if (format === "json") {
    return `${JSON.stringify(
      {
        title: sheet.title,
        titleBlock: sheet.titleBlock,
        regions: rows,
      },
      null,
      2,
    )}\n`;
  }

  const escape = (s: string): string =>
    /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  const lines = ["id,defines,source,value,unit,status"];
  for (const r of rows) {
    lines.push(
      [
        r.id,
        r.defines ?? "",
        escape(r.source ?? ""),
        r.result?.value !== undefined ? String(r.result.value) : "",
        r.result?.unit ?? "",
        r.status,
      ].join(","),
    );
  }
  return `${lines.join("\n")}\n`;
}

/** Validates a unit expression on the caller's behalf. */
export function checkUnit(expression: string): boolean {
  try {
    parseUnit(expression);
    return true;
  } catch {
    return false;
  }
}
