/**
 * Region-level edits, applied atomically.
 *
 * A patch that fails validation changes nothing. Every
 * operation is checked against a working copy before anything is returned, so
 * a caller never has to reason about a half-applied batch — the state a
 * partially applied patch leaves behind is exactly what a caller cannot
 * recover from.
 *
 * Positions are semantic. `after: "r_04"` means "in evaluation order,
 * immediately after that region", never a coordinate. Evaluation order is
 * positional, so an insert has to translate that intent into
 * geometry — which is this module's real job.
 */

import { evaluationOrder } from "../document/order.js";
import {
  apiAuthorship,
  humanAuthorship,
  mergeStyle,
  type Position,
  type Region,
  type RegionId,
  type RegionStyle,
  type Size,
  type StylePatch,
  type PlotSeries,
  type TableColumn,
  type TextAlign,
} from "../document/region.js";
import { applyFormatPatch, NOTATIONS, type NumberFormatPatch } from "../document/format.js";
import {
  readSheetTextStyle,
  readSheetUnits,
  type SheetTextStyle,
} from "../document/settings.js";
import type { QuantityKey, SheetUnits, UnitSystem } from "../units/prefer.js";
import { readBand, TITLE_BLOCK_KEYS } from "../document/bands.js";
import {
  isSheetNumber,
  nextRegionId,
  readValueUnits,
  type ChangeEntry,
  type PageBand,
  type PageSetup,
  type Sheet,
  type TitleBlock,
} from "../document/sheet.js";
import { setDisplayUnit } from "../document/source.js";
import { runsFromText, plainText, type TextRun } from "../document/text.js";
import { ApiError } from "./errors.js";

/** A new table starts with two named columns and room to type. */
const DEFAULT_COLUMNS: readonly TableColumn[] = [{ name: "x" }, { name: "y" }];
const DEFAULT_ROWS = 3;

const emptyGrid = (cols: number, rows: number): (number | null)[][] =>
  Array.from({ length: rows }, () => Array.from({ length: cols }, () => null));

/** Vertical step used when making room for an inserted region. */
const ROW = 36;
/** Smallest gap worth inserting into without shifting anything. */
const MIN_GAP = 16;

export type PatchOperation =
  | {
      readonly op: "insert";
      readonly kind: "math" | "text" | "table" | "plot" | "image" | "pagebreak";
      /** Insert immediately after this region in evaluation order. */
      readonly after?: RegionId;
      readonly source?: string;
      readonly text?: string;
      /** Caller-chosen id. Must not already exist. */
      readonly id?: RegionId;
      /** Table regions: the columns, and the grid. */
      readonly columns?: readonly TableColumn[];
      readonly cells?: readonly (readonly (number | null)[])[];
      /** Plot regions: the traces to draw. */
      readonly series?: readonly PlotSeries[];
      /** Image regions: a `data:` URI, and what it shows. */
      readonly src?: string;
      readonly alt?: string;
    }
  | {
      readonly op: "update";
      readonly id: RegionId;
      readonly source?: string;
      readonly text?: string;
      /**
       * Styled runs, for a caller that has them. `text` is the plain-string
       * form and replaces all styling; a caller that only has words should use
       * it. They are mutually exclusive.
       */
      readonly runs?: readonly TextRun[];
      /**
       * Cosmetic only. Merged into any style already there; a property given
       * as `null` (or `undefined`, from code) is removed, going back to the
       * default.
       */
      readonly style?: StylePatch;
      /** Number formatting for this region. A field set to undefined clears it. */
      readonly format?: NumberFormatPatch;
      /** Display unit for a math region, or null to clear it. */
      readonly unit?: string | null;
      readonly size?: Size | null;
      /** Table regions: replace the columns, the grid, or both. */
      readonly columns?: readonly TableColumn[];
      readonly cells?: readonly (readonly (number | null)[])[];
      /** Plot regions: the traces, and how the axes are drawn. */
      readonly series?: readonly PlotSeries[];
      readonly xUnit?: string | null;
      readonly yUnit?: string | null;
      readonly xLabel?: string | null;
      readonly yLabel?: string | null;
      /** Image regions: replace the picture, or what it shows. */
      readonly src?: string;
      readonly alt?: string | null;
      /** Text regions: how the block sits in its box, or null for the default. */
      readonly align?: TextAlign | null;
    }
  | { readonly op: "delete"; readonly id: RegionId }
  | {
      readonly op: "move";
      readonly id: RegionId;
      /** Semantic: immediately after this region in evaluation order. */
      readonly after?: RegionId;
      /**
       * Explicit coordinates.
       *
       * ADR-0009 says a caller does not address a region by where it sits, and
       * that still holds for callers that are describing intent. A direct
       * manipulation surface is the exception the rule needs: dragging a box
       * *is* a coordinate, and making the GUI invent an anchor for it would be
       * a fiction that reorders the sheet in ways the user did not ask for.
       * Exactly one of `after` and `to` must be given.
       */
      readonly to?: Position;
    }
  | {
      /**
       * Document-level settings: everything that is not a region. Same batch,
       * same atomicity, same provenance as region edits.
       */
      readonly op: "configure";
      readonly title?: string;
      /** Replaces the title block; a key left out is cleared. */
      readonly titleBlock?: TitleBlock;
      readonly page?: Partial<PageSetup>;
      /** Replaces the band; `null` empties it. */
      readonly header?: PageBand | null;
      readonly footer?: PageBand | null;
      /**
       * Units for names in the values list. Merged: a name given `null` goes
       * back to its default.
       */
      readonly valueUnits?: Readonly<Record<string, string | null>>;
      readonly format?: NumberFormatPatch;
      /**
       * The sheet's units (ADR-0017). Merged: a field given `null` goes back
       * to its default.
       */
      readonly units?: { readonly system?: UnitSystem | null } & {
        readonly [K in QuantityKey]?: string | null;
      };
      /** Default text and maths style (ADR-0017). Merged, `null` clearing. */
      readonly textStyle?: { readonly [K in keyof SheetTextStyle]?: SheetTextStyle[K] | null };
    };

/**
 * A picture stored in the sheet, or none. Never an address: a sheet that
 * fetched its pictures would contact whoever served them each time it opened.
 */
const isEmbeddedPicture = (src: string): boolean => src === "" || src.startsWith("data:image/");

/** Sets or empties a band, checking every item on the way in. */
function withBand(
  page: PageSetup,
  where: "header" | "footer",
  raw: unknown,
  index: number,
): PageSetup {
  const { [where]: _drop, ...rest } = page;
  if (raw === null) return rest as PageSetup;
  let band: PageBand;
  try {
    band = readBand(raw);
  } catch (e) {
    throw new ApiError("invalid_value", `${where}: ${(e as Error).message}`, index);
  }
  return { ...rest, [where]: band } as PageSetup;
}

export interface PatchResult {
  readonly sheet: Sheet;
  /** Ids of regions created, in the order the operations named them. */
  readonly inserted: readonly RegionId[];
  /**
   * Every region this patch touched, including ones shifted to make room and
   * ones deleted.
   *
   * A stateless operation returns a whole new sheet, but a shell holding an
   * incremental evaluator must not rebuild it on every keystroke. This is what
   * lets the GUI route its edits through the operations and still recompute
   * only what moved.
   */
  readonly changed: readonly RegionId[];
  /** True when a document-level setting changed and layout must be redone. */
  readonly configured: boolean;
}

export interface PatchContext {
  /** Identifies the caller in region authorship and the change log. */
  readonly client: string;
  readonly now?: () => Date;
  /**
   * Who is to be recorded as having made the edit. Defaults to `api`.
   *
   * The GUI routes its edits through these operations, and it
   * must pass `human`: a region marked machine-authored gets a visible marker
   * on the sheet, and marking everything the user typed would turn that
   * warning into noise and hide the case it exists for.
   */
  readonly author?: "human" | "api";
  /**
   * Whether to append to the document's change log. Defaults to true.
   *
   * The log records mutations arriving from outside. The GUI
   * turns it off: one entry per keystroke would bury real remote edits and
   * grow the file without bound.
   */
  readonly record?: boolean;
}

function findRegion(regions: readonly Region[], id: RegionId, index: number): Region {
  const region = regions.find((r) => r.id === id);
  if (!region) {
    throw new ApiError("unknown_region", `no region \`${id}\``, index, id);
  }
  return region;
}

/**
 * Where to put a region so it evaluates immediately after `anchor`.
 *
 * Slots into the gap below the anchor when there is one, and only shifts the
 * regions below when there is not. Shifting everything on every insert would
 * turn a one-region change into a diff touching the whole file.
 */
function placeAfter(
  regions: readonly Region[],
  anchor: Region,
): { position: { x: number; y: number }; shiftBelow: boolean } {
  const ordered = evaluationOrder(regions);
  const at = ordered.findIndex((r) => r.id === anchor.id);
  const next = ordered[at + 1];

  if (!next) return { position: { x: anchor.position.x, y: anchor.position.y + ROW }, shiftBelow: false };

  const gap = next.position.y - anchor.position.y;
  if (gap >= 2 * MIN_GAP) {
    return {
      position: { x: anchor.position.x, y: anchor.position.y + Math.round(gap / 2) },
      shiftBelow: false,
    };
  }
  return { position: { x: anchor.position.x, y: anchor.position.y + MIN_GAP }, shiftBelow: true };
}

export function applyPatch(
  sheet: Sheet,
  operations: readonly PatchOperation[],
  context: PatchContext,
): PatchResult {
  const now = context.now ?? (() => new Date());
  const authorship = context.author === "human" ? humanAuthorship : (at: Date) => apiAuthorship(context.client, at);
  const record = context.record ?? true;
  // A working copy: nothing escapes this function unless every operation
  // validated, so a rejected patch leaves the caller's sheet untouched.
  let regions: Region[] = [...sheet.regions];
  const log: ChangeEntry[] = [];
  const inserted: RegionId[] = [];
  const changed = new Set<RegionId>();
  let page = sheet.page;
  let title = sheet.title;
  let titleBlock = sheet.titleBlock;
  let valueUnits = sheet.valueUnits;
  let sheetFormat = sheet.format;
  let units = sheet.units;
  let textStyle = sheet.textStyle;
  let configured = false;

  /**
   * Merges a settings group, `null` removing a field, and refuses anything
   * the reader would drop: a patch that is quietly half-applied is worse than
   * one that is refused.
   */
  const mergeSettings = <T extends object>(
    name: string,
    base: T | undefined,
    change: object,
    read: (raw: unknown) => T | undefined,
    index: number,
  ): T | undefined => {
    if (typeof change !== "object" || change === null) {
      throw new ApiError("invalid_value", `${name} must be an object`, index);
    }
    const merged: Record<string, unknown> = { ...base };
    for (const [k, v] of Object.entries(change)) {
      if (v === null) delete merged[k];
      else merged[k] = v;
    }
    const clean = (read(merged) ?? {}) as Record<string, unknown>;
    for (const k of Object.keys(merged)) {
      if (!(k in clean)) throw new ApiError("invalid_value", `${name}.${k} cannot be ${JSON.stringify(merged[k])}`, index);
    }
    return Object.keys(clean).length > 0 ? (clean as T) : undefined;
  };

  const touch = (...ids: RegionId[]) => {
    for (const id of ids) changed.add(id);
  };
  /** Every region a y-shift moved. They did not change, but they did move. */
  const shiftBelow = (list: Region[], y: number): Region[] =>
    list.map((r) => {
      if (r.position.y <= y) return r;
      touch(r.id);
      return { ...r, position: { ...r.position, y: r.position.y + ROW } };
    });

  operations.forEach((operation, index) => {
    const origin = authorship(now());

    switch (operation.op) {
      case "insert": {
        const id = operation.id ?? nextRegionId(regions.map((r) => r.id));
        if (regions.some((r) => r.id === id)) {
          throw new ApiError("duplicate_id", `region \`${id}\` already exists`, index, id);
        }

        let position = { x: 48, y: 0 };
        if (operation.after !== undefined) {
          const anchor = findRegion(regions, operation.after, index);
          const placed = placeAfter(regions, anchor);
          position = placed.position;
          if (placed.shiftBelow) regions = shiftBelow(regions, anchor.position.y);
        } else {
          // No anchor: after everything, which is what "append" means on a
          // sheet whose order is vertical.
          const lowest = regions.reduce((m, r) => Math.max(m, r.position.y), 0);
          position = { x: 48, y: regions.length === 0 ? 48 : lowest + ROW };
        }

        if (operation.kind === "image" && operation.src !== undefined && !isEmbeddedPicture(operation.src)) {
          throw new ApiError("invalid_value", "an image must be an embedded `data:image/` URI", index);
        }
        const region: Region =
          operation.kind === "math"
            ? { kind: "math", id, position, source: operation.source ?? "", origin }
            : operation.kind === "text"
              ? { kind: "text", id, position, runs: runsFromText(operation.text ?? ""), origin }
              : operation.kind === "image"
                ? {
                    kind: "image",
                    id,
                    position,
                    src: operation.src ?? "",
                    ...(operation.alt !== undefined ? { alt: operation.alt } : {}),
                    origin,
                  }
                : operation.kind === "plot"
                ? {
                    kind: "plot",
                    id,
                    position,
                    // One empty trace, so the boxes to name are on screen
                    // rather than behind a control the user has to find.
                    series: operation.series ?? [{ x: "", y: "" }],
                    origin,
                  }
                : operation.kind === "table"
                ? {
                    kind: "table",
                    id,
                    position,
                    columns: operation.columns ?? DEFAULT_COLUMNS,
                    cells: operation.cells ?? emptyGrid(
                      (operation.columns ?? DEFAULT_COLUMNS).length,
                      DEFAULT_ROWS,
                    ),
                    origin,
                  }
                : { kind: "pagebreak", id, position, origin };

        regions = [...regions, region];
        inserted.push(id);
        log.push({
          at: origin.at,
          client: context.client,
          operation: "insert",
          region: id,
          after: operation.source ?? operation.text ?? "",
        });
        touch(id);
        return;
      }

      case "update": {
        const region = findRegion(regions, operation.id, index);
        let next: Region = region;

        const sets = [
          "source", "text", "runs", "style", "format", "unit", "size",
          "columns", "cells", "series", "xUnit", "yUnit", "xLabel", "yLabel",
          "src", "alt", "align",
        ] as const;
        if (!sets.some((k) => operation[k] !== undefined)) {
          throw new ApiError(
            "invalid_patch",
            `update of \`${region.id}\` changes nothing`,
            index,
            region.id,
          );
        }
        if (operation.text !== undefined && operation.runs !== undefined) {
          throw new ApiError(
            "invalid_patch",
            "give either `text` or `runs`, not both",
            index,
            region.id,
          );
        }

        let before: string | undefined;
        let after: string | undefined;

        if (operation.source !== undefined) {
          if (region.kind !== "math") {
            throw new ApiError(
              "wrong_kind",
              `region \`${region.id}\` is ${region.kind}; \`source\` applies to math`,
              index,
              region.id,
            );
          }
          before = region.source;
          after = operation.source;
          next = { ...(next as typeof region), source: operation.source };
        }

        if (operation.text !== undefined || operation.runs !== undefined) {
          if (region.kind !== "text") {
            throw new ApiError(
              "wrong_kind",
              `region \`${region.id}\` is ${region.kind}; \`text\` applies to text`,
              index,
              region.id,
            );
          }
          const runs =
            operation.runs !== undefined ? operation.runs : runsFromText(operation.text as string);
          before = plainText(region.runs);
          after = plainText(runs);
          next = { ...(next as typeof region), runs };
        }

        if (operation.unit !== undefined) {
          if (region.kind !== "math") {
            throw new ApiError(
              "wrong_kind",
              `region \`${region.id}\` is ${region.kind}; a display unit applies to math`,
              index,
              region.id,
            );
          }
          const math = next as Extract<Region, { kind: "math" }>;
          try {
            // Rewrites the source, so the printed sheet says what it computed
            // — the same reason `setInputs` rewrites rather than overrides.
            const source = setDisplayUnit(math.source, operation.unit);
            before = before ?? math.source;
            after = source;
            next = { ...math, source };
          } catch (e) {
            throw new ApiError(
              "invalid_value",
              `\`${String(operation.unit)}\` is not a unit this sheet can display`,
              index,
              region.id,
            );
          }
        }

        if (operation.columns !== undefined || operation.cells !== undefined) {
          if (region.kind !== "table") {
            throw new ApiError(
              "wrong_kind",
              `region \`${region.id}\` is ${region.kind}; \`columns\`/\`cells\` apply to a table`,
              index,
              region.id,
            );
          }
          const tableNow = next as Extract<Region, { kind: "table" }>;
          const columns = operation.columns ?? tableNow.columns;
          const cells = operation.cells ?? tableNow.cells;
          if (cells.some((row) => row.length !== columns.length)) {
            // A ragged grid would read a column off the end of a row and call
            // the cell empty, which is a confusing way to say "wrong shape".
            throw new ApiError(
              "invalid_patch",
              `every row must have ${columns.length} cells`,
              index,
              region.id,
            );
          }
          before = before ?? `${tableNow.columns.length}x${tableNow.cells.length}`;
          after = `${columns.length}x${cells.length}`;
          next = { ...tableNow, columns, cells };
        }

        if (operation.align !== undefined) {
          if (region.kind !== "text") {
            throw new ApiError(
              "wrong_kind",
              `region \`${region.id}\` is ${region.kind}; alignment applies to text`,
              index,
              region.id,
            );
          }
          const asText = next as Extract<Region, { kind: "text" }>;
          const { align: _drop, ...rest } = asText;
          next = (operation.align === null
            ? rest
            : { ...rest, align: operation.align }) as typeof asText;
          before = before ?? (asText.align ?? "left");
          after = operation.align ?? "left";
        }

        if (operation.src !== undefined || operation.alt !== undefined) {
          if (region.kind !== "image") {
            throw new ApiError(
              "wrong_kind",
              `region \`${region.id}\` is ${region.kind}; \`src\`/\`alt\` apply to an image`,
              index,
              region.id,
            );
          }
          let image = next as Extract<Region, { kind: "image" }>;
          if (operation.src !== undefined) {
            if (!isEmbeddedPicture(operation.src)) {
              // A remote URL would make a sheet depend on a network it may not
              // have when it is printed, and on a server that may not be there
              // when it is checked.
              throw new ApiError(
                "invalid_value",
                "an image must be an embedded `data:image/` URI",
                index,
                region.id,
              );
            }
            image = { ...image, src: operation.src };
          }
          if (operation.alt !== undefined) {
            const { alt: _drop, ...rest } = image;
            image = (operation.alt === null
              ? rest
              : { ...rest, alt: operation.alt }) as typeof image;
          }
          before = before ?? `${(next as typeof image).src.length} bytes`;
          after = `${image.src.length} bytes`;
          next = image;
        }

        const plotKeys = ["series", "xUnit", "yUnit", "xLabel", "yLabel"] as const;
        if (plotKeys.some((k) => operation[k] !== undefined)) {
          if (region.kind !== "plot") {
            throw new ApiError(
              "wrong_kind",
              `region \`${region.id}\` is ${region.kind}; plot fields apply to a plot`,
              index,
              region.id,
            );
          }
          let plot = next as Extract<Region, { kind: "plot" }>;
          if (operation.series !== undefined) {
            // Blank names are allowed: a trace being typed is half-named for
            // as long as it takes to type it, and `isBlankPlot` treats that as
            // "not drawn yet" rather than as an error.
            plot = { ...plot, series: operation.series };
          }
          // `null` clears an axis override and returns it to the engine's
          // preferred unit; leaving it out changes nothing.
          for (const key of ["xUnit", "yUnit", "xLabel", "yLabel"] as const) {
            const v = operation[key];
            if (v === undefined) continue;
            const { [key]: _drop, ...rest } = plot;
            plot = (v === null ? rest : { ...rest, [key]: v }) as typeof plot;
          }
          before = before ?? `${(next as typeof plot).series.length} series`;
          after = `${plot.series.length} series`;
          next = plot;
        }

        if (operation.style !== undefined) {
          const merged = mergeStyle(next.style, operation.style);
          // Back to all defaults is no style at all, not an empty one: the
          // file then reads the same as one that never had a colour.
          const { style: _drop, ...rest } = next as Region & { style?: unknown };
          next = (Object.keys(merged).length === 0
            ? rest
            : { ...rest, style: merged }) as Region;
        }

        if (operation.format !== undefined) {
          const notation = operation.format.notation;
          if (notation !== undefined && !NOTATIONS.includes(notation)) {
            throw new ApiError("invalid_value", `format.notation must be one of ${NOTATIONS.join(", ")}`, index);
          }
          const format = applyFormatPatch(next.format, operation.format);
          const { format: _drop, ...rest } = next as Region & { format?: unknown };
          next = (format === undefined ? rest : { ...rest, format }) as Region;
        }

        if (operation.size !== undefined) {
          const { size: _drop, ...rest } = next as Region & { size?: unknown };
          next = (operation.size === null ? rest : { ...rest, size: operation.size }) as Region;
        }

        next = { ...next, origin } as Region;
        regions = regions.map((r) => (r.id === region.id ? next : r));
        log.push({
          at: origin.at,
          client: context.client,
          operation: "update",
          region: region.id,
          ...(before === undefined ? {} : { before }),
          ...(after === undefined ? {} : { after }),
        });
        touch(region.id);
        return;
      }

      case "delete": {
        const region = findRegion(regions, operation.id, index);
        log.push({
          at: origin.at,
          client: context.client,
          operation: "delete",
          region: region.id,
          before: region.kind === "math" ? region.source : region.kind === "text" ? plainText(region.runs) : "",
        });
        regions = regions.filter((r) => r.id !== region.id);
        touch(region.id);
        return;
      }

      case "move": {
        const region = findRegion(regions, operation.id, index);
        if ((operation.after === undefined) === (operation.to === undefined)) {
          throw new ApiError(
            "invalid_patch",
            "a move needs exactly one of `after` and `to`",
            index,
            region.id,
          );
        }

        if (operation.to !== undefined) {
          const to = operation.to;
          if (!Number.isFinite(to.x) || !Number.isFinite(to.y) || to.x < 0 || to.y < 0) {
            throw new ApiError(
              "invalid_patch",
              "a position must be two non-negative numbers",
              index,
              region.id,
            );
          }
          regions = regions.map((r) =>
            r.id === region.id ? { ...r, position: to, origin } : r,
          );
          log.push({
            at: origin.at,
            client: context.client,
            operation: "move",
            region: region.id,
            before: `${region.position.x},${region.position.y}`,
            after: `${to.x},${to.y}`,
          });
          touch(region.id);
          return;
        }

        const anchor = findRegion(regions, operation.after as RegionId, index);
        if (anchor.id === region.id) {
          throw new ApiError("invalid_patch", "a region cannot move after itself", index, region.id);
        }
        const others = regions.filter((r) => r.id !== region.id);
        const placed = placeAfter(others, anchor);
        const next = placed.shiftBelow ? shiftBelow(others, anchor.position.y) : others;
        regions = [...next, { ...region, position: placed.position, origin }];
        log.push({
          at: origin.at,
          client: context.client,
          operation: "move",
          region: region.id,
          after: anchor.id,
        });
        touch(region.id);
        return;
      }

      case "configure": {
        const keys = ["title", "titleBlock", "page", "header", "footer", "format", "valueUnits", "units", "textStyle"] as const;
        if (!keys.some((k) => operation[k] !== undefined)) {
          throw new ApiError("invalid_patch", "configure changes nothing", index);
        }
        if (operation.title !== undefined) {
          if (typeof operation.title !== "string") {
            throw new ApiError("invalid_value", "title must be a string", index);
          }
          title = operation.title;
        }
        if (operation.titleBlock !== undefined) {
          if (typeof operation.titleBlock !== "object" || operation.titleBlock === null) {
            throw new ApiError("invalid_value", "titleBlock must be an object", index);
          }
          for (const [k, v] of Object.entries(operation.titleBlock)) {
            if (!(TITLE_BLOCK_KEYS as readonly string[]).includes(k)) {
              throw new ApiError("invalid_value", `titleBlock has no field \`${k}\``, index);
            }
            if (typeof v !== "string") {
              throw new ApiError("invalid_value", `titleBlock.${k} must be text`, index);
            }
          }
          titleBlock = operation.titleBlock;
        }
        if (operation.page !== undefined) {
          const { header: _h, footer: _f, ...rest } = operation.page;
          for (const key of ["firstSheet", "totalSheets"] as const) {
            const v = rest[key];
            if (v !== undefined && !isSheetNumber(v)) {
              throw new ApiError("invalid_value", `${key} must be a whole number, 1 or more`, index);
            }
          }
          page = { ...page, ...rest };
          // Bands arrive through `header`/`footer`, where they are checked.
          if (_h !== undefined) page = withBand(page, "header", _h, index);
          if (_f !== undefined) page = withBand(page, "footer", _f, index);
        }
        if (operation.valueUnits !== undefined) {
          if (typeof operation.valueUnits !== "object" || operation.valueUnits === null) {
            throw new ApiError("invalid_value", "valueUnits must be an object", index);
          }
          const merged: Record<string, string> = { ...(valueUnits ?? {}) };
          for (const [name, unit] of Object.entries(operation.valueUnits)) {
            if (unit === null) delete merged[name];
            else merged[name] = unit;
          }
          const clean = readValueUnits(merged) ?? {};
          if (Object.keys(clean).length !== Object.keys(merged).length) {
            throw new ApiError("invalid_value", "valueUnits takes a name and a unit for each entry", index);
          }
          valueUnits = Object.keys(clean).length > 0 ? clean : undefined;
        }
        if (operation.header !== undefined) page = withBand(page, "header", operation.header, index);
        if (operation.footer !== undefined) page = withBand(page, "footer", operation.footer, index);
        if (operation.format !== undefined) {
          const notation = operation.format.notation;
          if (notation !== undefined && !NOTATIONS.includes(notation)) {
            throw new ApiError("invalid_value", `format.notation must be one of ${NOTATIONS.join(", ")}`, index);
          }
          sheetFormat = applyFormatPatch(sheetFormat, operation.format);
        }
        if (operation.units !== undefined) {
          units = mergeSettings<SheetUnits>("units", units, operation.units, readSheetUnits, index);
        }
        if (operation.textStyle !== undefined) {
          textStyle = mergeSettings<SheetTextStyle>("textStyle", textStyle, operation.textStyle, readSheetTextStyle, index);
        }
        configured = true;
        log.push({
          at: origin.at,
          client: context.client,
          operation: "update",
          region: "" as RegionId,
          after: keys.filter((k) => operation[k] !== undefined).join(","),
        });
        return;
      }

      default: {
        const bad = operation as { op?: string };
        throw new ApiError("invalid_patch", `unknown operation \`${String(bad.op)}\``, index);
      }
    }
  });

  const { valueUnits: _was, units: _u, textStyle: _t, ...unchanged } = sheet;
  const next: Sheet = {
    ...unchanged,
    ...(valueUnits ? { valueUnits } : {}),
    ...(units ? { units } : {}),
    ...(textStyle ? { textStyle } : {}),
    title,
    titleBlock,
    page,
    regions,
    changeLog: record ? [...sheet.changeLog, ...log] : sheet.changeLog,
  };
  return {
    sheet:
      sheetFormat === undefined
        ? (() => {
            const { format: _drop, ...rest } = next;
            return rest as Sheet;
          })()
        : { ...next, format: sheetFormat },
    inserted,
    changed: [...changed],
    configured,
  };
}
