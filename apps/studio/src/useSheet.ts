/**
 * Worksheet state for the prototype shell.
 *
 * Every mutation goes through `apply`, which does three things in one place:
 * records the previous sheet for undo, applies the change to the live
 * Worksheet, and recomputes unless calculation is manual. Routing edits
 * through the real incremental path is what exercises it; the recompute stats
 * it returns are shown in the status bar so the incremental claim is visible
 * rather than asserted.
 */

import { useCallback, useMemo, useRef, useState } from "react";
import {
  ApiError,
  applyPatch,
  emptySheet,
  humanAuthorship,
  nextRegionId,
  paginate,
  parseSheet,
  project,
  serializeSheet,
  Worksheet,
  type Layout,
  type PatchOperation,
  type PatchResult,
  type MathRegion,
  type PageBand,
  type PageSetup,
  type Position,
  type RecomputeStats,
  type Region,
  type RegionId,
  type RegionResult,
  type StylePatch,
  type Sheet,
  type NumberFormatPatch,
  type Size,
  type PlotSeries,
  type TableColumn,
  type TableMetrics,
  type TextAlign,
  type TextRun,
  type TitleBlock,
} from "@jamcalc/engine";
import { applyStyleToRange, runsFromText } from "@jamcalc/engine";
import { pasteOperations, type Copied } from "./clipboard.js";



const STARTER: Region[] = [
  { kind: "text", id: "r_01", position: { x: 48, y: 16 }, runs: runsFromText("Simply supported beam — flexural check (AISC LRFD)"), origin: humanAuthorship() },
  { kind: "math", id: "r_02", position: { x: 48, y: 64 }, source: "w_u := 2.4 klf", origin: humanAuthorship() },
  { kind: "math", id: "r_03", position: { x: 48, y: 100 }, source: "L := 25 ft", origin: humanAuthorship() },
  { kind: "math", id: "r_04", position: { x: 48, y: 136 }, source: "M_u := w_u*L^2/8 = kip*ft", origin: humanAuthorship() },
  { kind: "text", id: "r_06", position: { x: 48, y: 220 }, runs: runsFromText("Section capacity — W21x44, Fy = 50 ksi"), origin: humanAuthorship() },
  { kind: "math", id: "r_07", position: { x: 48, y: 256 }, source: "Z_x := 95.4 in^3", origin: humanAuthorship() },
  { kind: "math", id: "r_08", position: { x: 340, y: 256 }, source: "F_y := 50 ksi", origin: humanAuthorship() },
  { kind: "math", id: "r_09", position: { x: 48, y: 292 }, source: "phi_M_n := 0.9*Z_x*F_y = kip*ft", origin: humanAuthorship() },
  { kind: "math", id: "r_11", position: { x: 48, y: 352 }, source: "DCR := M_u/phi_M_n =", origin: humanAuthorship() },
];

/** Consecutive edits to one region collapse into a single undo step. */
const COALESCE_MS = 700;

export function useSheet(initial?: Sheet | null) {
  const [sheet, setSheet] = useState<Sheet>(
    () =>
      initial ?? {
        ...emptySheet("Beam Check — W21x44"),
        titleBlock: { project: "Example Project", by: "JD", rev: "0" },
        regions: STARTER,
      },
  );

  const [autoCalc, setAutoCalc] = useState(true);
  /**
   * Measured region sizes, reported by the renderer.
   *
   * Pagination needs them to hold a region intact across a page boundary, and
   * only the browser can know them. There is no measure/layout loop: a push
   * moves a region down and never changes how tall or wide it is.
   */
  const [measured, setMeasured] = useState<{
    heights: ReadonlyMap<RegionId, number>;
    widths: ReadonlyMap<RegionId, number>;
    tableRows: ReadonlyMap<RegionId, TableMetrics>;
  }>({ heights: new Map(), widths: new Map(), tableRows: new Map() });
  /** What `measured` was last set to, for telling a real change from a repeat. */
  const lastReport = useRef(measured);
  const [version, setVersion] = useState(0);

  const wsRef = useRef<Worksheet | null>(null);
  const statsRef = useRef<RecomputeStats>({ evaluated: 0, reused: 0 });
  const past = useRef<Sheet[]>([]);
  const future = useRef<Sheet[]>([]);
  const lastEdit = useRef<{ tag: string; at: number } | null>(null);

  if (wsRef.current === null) {
    wsRef.current = new Worksheet(sheet.regions);
    wsRef.current.setDisplay({ format: sheet.format, units: sheet.units });
    statsRef.current = wsRef.current.recompute();
  }

  const bump = useCallback(() => setVersion((v) => v + 1), []);

  /**
   * Records the version a save was made with (ADR-0016). Not an edit: no undo
   * step, no recompute, and not a change to the sheet's content.
   */
  const stampSaved = useCallback((version: string) => {
    if (version) setSheet((s) => (s.savedWith === version ? s : { ...s, savedWith: version }));
  }, []);

  /** Rebuilds the engine from scratch — used by undo, redo and open. */
  const reload = useCallback(
    (next: Sheet) => {
      wsRef.current = new Worksheet(next.regions);
      wsRef.current.setDisplay({ format: next.format, units: next.units });
      statsRef.current = wsRef.current.recompute();
      setSheet(next);
      bump();
    },
    [bump],
  );

  /**
   * @param tag Identifies a run of related edits (typing in one region, say)
   *            so they collapse into a single undo step. Omit for discrete
   *            acts like insert or delete, which each deserve their own.
   */
  /**
   * Records undo, recomputes, and publishes the new sheet.
   *
   * @param tag Identifies a run of related edits (typing in one region, say)
   *            so they collapse into a single undo step. Omit for discrete
   *            acts like insert or delete, which each deserve their own.
   */
  const commit = useCallback(
    (next: Sheet, tag?: string) => {
      const now = Date.now();
      const continues =
        tag !== undefined &&
        lastEdit.current?.tag === tag &&
        now - lastEdit.current.at < COALESCE_MS;
      if (!continues) past.current.push(sheet);
      lastEdit.current = tag === undefined ? null : { tag, at: now };
      future.current = [];

      // In manual mode the mutation still lands; only evaluation waits.
      if (autoCalc) statsRef.current = (wsRef.current as Worksheet).recompute();
      setSheet(next);
      bump();
    },
    [sheet, autoCalc, bump],
  );

  const undo = useCallback(() => {
    const prev = past.current.pop();
    if (!prev) return;
    future.current.push(sheet);
    lastEdit.current = null;
    reload(prev);
  }, [sheet, reload]);

  const redo = useCallback(() => {
    const next = future.current.pop();
    if (!next) return;
    past.current.push(sheet);
    lastEdit.current = null;
    reload(next);
  }, [sheet, reload]);

  const calculateNow = useCallback(() => {
    statsRef.current = (wsRef.current as Worksheet).recompute();
    bump();
  }, [bump]);

  const setAuto = useCallback(
    (on: boolean) => {
      setAutoCalc(on);
      if (on) calculateNow();
    },
    [calculateNow],
  );

  const state = useMemo(() => {
    const ws = wsRef.current as Worksheet;
    const results = new Map<RegionId, RegionResult>();
    for (const r of sheet.regions) {
      const res = ws.getResult(r.id);
      if (res) results.set(r.id, res);
    }
    const layout: Layout = paginate(sheet.regions, sheet.page, {
      heights: measured.heights,
      widths: measured.widths,
      tableRows: measured.tableRows,
    });
    // Prose with its references filled in, where a region has any.
    const runs = new Map(
      sheet.regions.flatMap((r) => {
        const resolved = r.kind === "text" ? ws.getRuns(r.id) : undefined;
        return resolved ? [[r.id, resolved] as const] : [];
      }),
    );
    const plots = new Map(
      sheet.regions
        .filter((r) => r.kind === "plot")
        .flatMap((r) => {
          const model = ws.getPlot(r.id);
          return model ? [[r.id, model] as const] : [];
        }),
    );
    return {
      sheet,
      results,
      order: ws.order,
      symbols: ws.listSymbols(),
      stats: statsRef.current,
      projection: project(sheet, ws.order, results),
      pending: new Set(ws.pending),
      runs,
      plots,
      layout,
    };
    // `version` is the recompute signal; results live inside the Worksheet ref.
  }, [sheet, version, measured]);

  // --- mutations -----------------------------------------------------------
  //
  // Every one of these builds a patch and hands it to `applyPatch`. None of
  // them touches `Worksheet` or rebuilds a sheet by hand any more. The rule
  // is that anything the GUI can do must be expressible through the document API,
  // and the only way that claim stays true is if the GUI is a caller like any
  // other. When something here cannot be said as an operation, the fix is a
  // new operation, not a shortcut.

  /**
   * Applies a patch and brings the incremental evaluator alongside it.
   *
   * The operations are stateless — each returns a whole new sheet — but the
   * shell must not rebuild its evaluator on every keystroke. `changed` is what
   * makes both true at once: the operation decides *what* the edit means, and
   * this replays only the affected regions into the live `Worksheet`.
   */
  const patch = useCallback(
    (operations: readonly PatchOperation[], tag?: string): PatchResult | null => {
      if (operations.length === 0) return null;

      let result: PatchResult;
      try {
        result = applyPatch(sheet, operations, {
          client: "studio",
          // The user typed this. Marking it machine-authored would put the
          // provenance warning on every region and hide the case it is for.
          author: "human",
          // One change-log entry per keystroke would bury the remote edits the
          // log exists to record, and grow the file without bound.
          record: false,
        });
      } catch (e) {
        // A rejected patch changes nothing by construction, so there is
        // nothing to roll back. Anything that is not the operations refusing
        // the request is a real fault and must not be swallowed.
        if (e instanceof ApiError) return null;
        throw e;
      }

      const ws = wsRef.current as Worksheet;
      const before = new Map(sheet.regions.map((r) => [r.id, r]));
      const after = new Map(result.sheet.regions.map((r) => [r.id, r]));

      for (const id of result.changed) {
        const was = before.get(id);
        const now = after.get(id);
        if (!now) {
          ws.remove(id);
        } else if (!was) {
          ws.insert(now);
        } else if (was.kind === "math" && now.kind === "math" && was.source !== now.source) {
          // The cheap path: a source edit the graph can often answer without
          // rebuilding itself.
          ws.edit(id, now.source);
          if (was.position !== now.position) ws.move(id, now.position);
        } else if (
          was.position.x !== now.position.x ||
          was.position.y !== now.position.y
        ) {
          ws.move(id, now.position);
        } else {
          // Style, size, format, runs: nothing that changes a value, but the
          // evaluator holds its own copy of the region and a stale one there
          // is a bug waiting for the first reader of `ws.getRegion`.
          ws.remove(id);
          ws.insert(now);
        }
      }

      // The sheet's units and numbers are what prose quotes values in.
      if (result.sheet.format !== sheet.format || result.sheet.units !== sheet.units) {
        ws.setDisplay({ format: result.sheet.format, units: result.sheet.units });
      }

      commit(result.sheet, tag);
      return result;
    },
    [sheet, commit],
  );

  const editRegion = useCallback(
    (id: RegionId, source: string) => {
      patch([{ op: "update", id, source }], `edit:${id}`);
    },
    [patch],
  );

  const editText = useCallback(
    (id: RegionId, runs: readonly TextRun[]) => {
      patch([{ op: "update", id, runs }], `edit:${id}`);
    },
    [patch],
  );

  /**
   * Styles a character range inside one text region.
   *
   * Separate from styleRegions because the target is different: this changes
   * some characters, that changes a whole box. Collapsing them would make it
   * impossible to set a default for a region that has locally styled runs.
   */
  const styleTextRange = useCallback(
    (id: RegionId, start: number, end: number, style: StylePatch) => {
      const region = sheet.regions.find((r) => r.id === id);
      if (!region || region.kind !== "text") return;
      patch([
        { op: "update", id, runs: applyStyleToRange(region.runs, start, end, style) },
      ]);
    },
    [sheet, patch],
  );

  /** Moves a set of regions in one step, so a multi-select drag undoes once. */
  const moveRegions = useCallback(
    (moves: ReadonlyMap<RegionId, Position>, tag?: string) => {
      patch(
        [...moves].map(([id, to]) => ({ op: "move" as const, id, to })),
        tag,
      );
    },
    [patch],
  );

  const resizeRegion = useCallback(
    (id: RegionId, size: Size) => {
      patch([{ op: "update", id, size }], `resize:${id}`);
    },
    [patch],
  );

  const addRegion = useCallback(
    (
      kind: "math" | "text" | "table" | "plot" | "image" | "pagebreak",
      position: Position,
    ): RegionId => {
      // Two operations in one patch: the API appends, then puts the region
      // where the cursor is. Atomic, so a failure leaves no orphan.
      const id = nextRegionId(sheet.regions.map((r) => r.id));
      patch([
        { op: "insert", kind, id },
        { op: "move", id, to: position },
      ]);
      return id;
    },
    [sheet, patch],
  );

  /**
   * A picture, placed and filled in one patch.
   *
   * Not `addRegion` followed by `editImage`: a patch is applied against the
   * sheet as it was when the callback was made, so a second patch from an
   * asynchronous callback — reading the file — would name a region that sheet
   * has never heard of, and be rejected in silence.
   */
  const addImage = useCallback(
    (src: string, alt: string, position: Position): RegionId => {
      const id = nextRegionId(sheet.regions.map((r) => r.id));
      patch([
        { op: "insert", kind: "image", id },
        { op: "move", id, to: position },
        { op: "update", id, src, alt },
      ]);
      return id;
    },
    [sheet, patch],
  );

  /**
   * Regions from the clipboard, their top-left at `at`: one patch, so one
   * undo step. Returns the new ids, or none when the patch was refused.
   */
  const pasteRegions = useCallback(
    (copied: Copied, at: Position): RegionId[] => {
      const { operations, ids } = pasteOperations(copied, at, sheet.regions.map((r) => r.id));
      return patch(operations) ? ids : [];
    },
    [sheet, patch],
  );

  const removeRegions = useCallback(
    (ids: Iterable<RegionId>) => {
      patch([...new Set(ids)].map((id) => ({ op: "delete" as const, id })));
    },
    [patch],
  );

  const styleRegions = useCallback(
    (ids: Iterable<RegionId>, style: StylePatch) => {
      patch([...new Set(ids)].map((id) => ({ op: "update" as const, id, style })));
    },
    [patch],
  );

  // --- page setup ----------------------------------------------------------

  const setPage = useCallback(
    (page: Partial<PageSetup>) => {
      patch([{ op: "configure", page }]);
    },
    [patch],
  );

  /**
   * Replaces a header or footer; `null` empties it. `tag` groups a run of
   * changes — a drag, a typed value — into one undo step.
   */
  const setBand = useCallback(
    (which: "header" | "footer", band: PageBand | null, tag?: string) => {
      patch([{ op: "configure", [which]: band }], tag);
    },
    [patch],
  );

  /** The unit a name is listed in; null puts it back to the default. */
  const setValueUnit = useCallback(
    (name: string, unit: string | null) => {
      patch([{ op: "configure", valueUnits: { [name]: unit } }]);
    },
    [patch],
  );

  /** Replaces the header and footer together, as one undo step: a template. */
  const setBands = useCallback(
    (header: PageBand | null, footer: PageBand | null) => {
      patch([{ op: "configure", header, footer }]);
    },
    [patch],
  );

  const setTitle = useCallback(
    (title: string) => {
      patch([{ op: "configure", title }], "title");
    },
    [patch],
  );

  /** Sets title-block values; one set to "" is cleared rather than stored empty. */
  const setTitleBlock = useCallback(
    (block: TitleBlock) => {
      const next: Record<string, string> = { ...sheet.titleBlock };
      for (const [k, v] of Object.entries(block)) {
        if (typeof v === "string" && v !== "") next[k] = v;
        else delete next[k];
      }
      patch([{ op: "configure", titleBlock: next }], "titleBlock");
    },
    [sheet, patch],
  );

  /** Sheet-wide number format; a region may still override it. */
  const setSheetFormat = useCallback(
    (format: NumberFormatPatch) => {
      patch([{ op: "configure", format }]);
    },
    [patch],
  );

  /** The sheet's units (ADR-0017); a field given `null` goes back to its default. */
  const setSheetUnits = useCallback(
    (units: Extract<PatchOperation, { op: "configure" }>["units"] & object) => {
      patch([{ op: "configure", units }]);
    },
    [patch],
  );

  /** The sheet's default text and maths style (ADR-0017). */
  const setTextStyle = useCallback(
    (textStyle: Extract<PatchOperation, { op: "configure" }>["textStyle"] & object) => {
      patch([{ op: "configure", textStyle }]);
    },
    [patch],
  );

  const setRegionFormat = useCallback(
    (ids: Iterable<RegionId>, format: NumberFormatPatch) => {
      patch([...new Set(ids)].map((id) => ({ op: "update" as const, id, format })));
    },
    [patch],
  );

  /**
   * Sets the display unit, which the operation does by rewriting the region's
   * source — a bad unit is rejected there and the patch changes nothing.
   */
  /** Replaces a table's columns and grid in one operation. */
  const editTable = useCallback(
    (
      id: RegionId,
      columns: readonly TableColumn[],
      cells: readonly (readonly (number | null)[])[],
    ) => {
      patch([{ op: "update", id, columns, cells }], `table:${id}`);
    },
    [patch],
  );

  /** Sets how a block of prose sits in its box. */
  const setAlign = useCallback(
    (ids: Iterable<RegionId>, align: TextAlign | null) => {
      patch([...new Set(ids)].map((id) => ({ op: "update" as const, id, align })));
    },
    [patch],
  );

  /** Replaces an image's picture and its description. */
  const editImage = useCallback(
    (id: RegionId, src: string, alt?: string) => {
      patch([{ op: "update", id, src, ...(alt !== undefined ? { alt } : {}) }]);
    },
    [patch],
  );

  /** Replaces a plot's traces. */
  const editPlot = useCallback(
    (id: RegionId, series: readonly PlotSeries[]) => {
      patch([{ op: "update", id, series }], `plot:${id}`);
    },
    [patch],
  );

  const setUnit = useCallback(
    (id: RegionId, unit: string | null) => {
      patch([{ op: "update", id, unit }]);
    },
    [patch],
  );

  /** Starts over on an empty sheet. */
  const reset = useCallback(() => {
    past.current = [];
    future.current = [];
    reload(emptySheet("Untitled"));
  }, [reload]);

  const load = useCallback(
    (json: string) => {
      const next = parseSheet(json);
      past.current = [];
      future.current = [];
      reload(next);
    },
    [reload],
  );

  /**
   * Takes measured sizes from the renderer.
   *
   * Ignores a report that changes nothing, which is what stops the
   * measure-render-measure cycle from spinning.
   */
  const reportSizes = useCallback(
    (
      heights: ReadonlyMap<RegionId, number>,
      widths: ReadonlyMap<RegionId, number>,
      tableRows: ReadonlyMap<RegionId, TableMetrics>,
    ) => {
      // Compared with the last report, not with state inside an updater. React
      // may replay an updater against an older base state while a lower-
      // priority update is pending; the replay then looks like a change, the
      // new object re-renders, the layout effect reports again, and the loop
      // runs until React gives up. Not asking for an update at all when
      // nothing changed is the only answer that holds in every case.
      const last = lastReport.current;
      const same = (a: ReadonlyMap<RegionId, number>, b: ReadonlyMap<RegionId, number>) =>
        a.size === b.size && [...a].every(([k, v]) => b.get(k) === v);
      const sameRows = () =>
        last.tableRows.size === tableRows.size &&
        [...tableRows].every(([k, m]) => {
          const was = last.tableRows.get(k);
          return (
            was !== undefined &&
            was.header === m.header &&
            was.rows.length === m.rows.length &&
            was.rows.every((h, i) => h === m.rows[i])
          );
        });
      if (same(last.heights, heights) && same(last.widths, widths) && sameRows()) return;
      const next = { heights, widths, tableRows };
      lastReport.current = next;
      setMeasured(next);
    },
    [],
  );

  const save = useCallback(() => serializeSheet(sheet), [sheet]);
  const trace = useCallback((id: RegionId) => (wsRef.current as Worksheet).trace(id), []);

  return {
    ...state,
    autoCalc,
    canUndo: past.current.length > 0,
    canRedo: future.current.length > 0,
    undo,
    redo,
    setAuto,
    calculateNow,
    editRegion,
    editText,
    editTable,
    editPlot,
    editImage,
    setAlign,
    styleTextRange,
    moveRegions,
    resizeRegion,
    addRegion,
    addImage,
    pasteRegions,
    removeRegions,
    styleRegions,
    setPage,
    setBand,
    setBands,
    setValueUnit,
    stampSaved,
    setTitle,
    setTitleBlock,
    setSheetFormat,
    setSheetUnits,
    setTextStyle,
    setRegionFormat,
    setUnit,
    reset,
    load,
    save,
    trace,
    reportSizes,
  };
}

export type { MathRegion, Region, RegionId, RegionResult };
