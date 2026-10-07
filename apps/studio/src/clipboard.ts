/**
 * Copying regions: what goes on the clipboard, and the patch a paste becomes.
 *
 * Two forms are written. A private one carries the regions whole — their
 * source, styling, size, format, table data and plot series — so a paste into
 * this sheet, another tab or another window reproduces them exactly. Plain
 * text goes beside it, so a copy pasted into an email or a document reads as
 * what the regions say.
 *
 * A paste is ordinary document operations, one patch: insert, put in place,
 * fill in. One undo step, and the API's checks apply to it like any other edit.
 */

import {
  nextRegionId,
  plainText,
  type PatchOperation,
  type Position,
  type Region,
  type RegionId,
  type TextRun,
} from "@jamcalc/engine";

/** The clipboard type the regions themselves travel under. */
export const REGIONS_TYPE = "application/x-jamcalc-regions";

const VERSION = 1;

/** A copied region: everything but its identity, placed relative to the copy's top-left. */
export type CopiedRegion = Omit<Region, "id" | "origin">;

export interface Copied {
  readonly regions: readonly CopiedRegion[];
}

/**
 * What a copy of `regions` puts on the clipboard, in reading order.
 * `resolved` gives prose with its values filled in, so the plain text reads
 * as the page does.
 */
export function copyRegions(
  regions: readonly Region[],
  resolved?: (id: RegionId) => readonly TextRun[] | undefined,
): { json: string; text: string } {
  const ordered = [...regions].sort((a, b) => a.position.y - b.position.y || a.position.x - b.position.x);
  const left = Math.min(...ordered.map((r) => r.position.x));
  const top = Math.min(...ordered.map((r) => r.position.y));
  const copied = ordered.map(({ id: _id, origin: _origin, ...rest }) => ({
    ...rest,
    position: { x: rest.position.x - left, y: rest.position.y - top },
  }));
  const text = ordered
    .map((r) =>
      r.kind === "math"
        ? r.source
        : r.kind === "text"
          ? plainText(resolved?.(r.id) ?? r.runs)
          : r.kind === "pagebreak"
            ? ""
            : `[${r.kind}]`,
    )
    .filter((line) => line !== "")
    .join("\n");
  return { json: JSON.stringify({ jamcalc: "regions", version: VERSION, regions: copied }), text };
}

/** The regions on the clipboard, or null when what is there is not a copy of regions. */
export function readCopied(json: string): Copied | null {
  try {
    const o = JSON.parse(json) as { jamcalc?: unknown; version?: unknown; regions?: unknown };
    if (o.jamcalc !== "regions" || o.version !== VERSION || !Array.isArray(o.regions)) return null;
    const regions = o.regions.filter(
      (r): r is CopiedRegion =>
        typeof r === "object" &&
        r !== null &&
        typeof (r as { kind?: unknown }).kind === "string" &&
        typeof (r as { position?: { x?: unknown } }).position?.x === "number" &&
        typeof (r as { position?: { y?: unknown } }).position?.y === "number",
    );
    return regions.length > 0 ? { regions } : null;
  } catch {
    return null;
  }
}

/**
 * The patch that pastes `copied` with its top-left at `at`, and the ids the
 * new regions get. Ids continue the sheet's own sequence.
 */
export function pasteOperations(
  copied: Copied,
  at: Position,
  existing: readonly RegionId[],
): { operations: PatchOperation[]; ids: RegionId[] } {
  const taken = [...existing];
  const operations: PatchOperation[] = [];
  const ids: RegionId[] = [];
  for (const r of copied.regions) {
    const id = nextRegionId(taken);
    taken.push(id);
    ids.push(id);
    operations.push(
      { op: "insert", kind: r.kind, id },
      { op: "move", id, to: { x: at.x + r.position.x, y: at.y + r.position.y } },
    );
    // The region's content and look, as one update. Absent fields are left
    // out rather than sent empty: an update that names a field changes it.
    const any = r as Record<string, unknown>;
    const fields: Record<string, unknown> = {};
    for (const key of [
      "source", "runs", "align", "columns", "cells", "series",
      "xUnit", "yUnit", "xLabel", "yLabel", "src", "alt", "style", "format", "size",
    ]) {
      if (any[key] !== undefined) fields[key] = any[key];
    }
    if (Object.keys(fields).length > 0) operations.push({ op: "update", id, ...fields } as PatchOperation);
  }
  return { operations, ids };
}
