/**
 * Turning a plot region and the sheet's values into something drawable.
 *
 * The *model* is computed here — points in display units, axis ranges, tick
 * positions and labels — and only the drawing is left to the shell. Same rule
 * as pagination: the screen, the print path and any future PDF exporter must
 * agree, and they only can if the geometry has one source.
 *
 * A plot holds no data. It names vectors the sheet computes, so a plot cannot
 * disagree with the numbers printed beside it.
 */

import { CalcError, type Span } from "../errors.js";
import { MatrixValue } from "../matrix.js";
import type { Quantity } from "../quantity.js";
import { isMatrix, type Value } from "../value.js";
import { valueIn } from "../units/parse.js";
import { preferredUnit, type SheetUnits } from "../units/prefer.js";
import type { PlotRegion, PlotSeries } from "./region.js";

/** A plot has no source text, so there is no span to point at. */
const NO_SPAN: Span = [0, 0];

export interface PlotPoint {
  readonly x: number;
  readonly y: number;
}

export interface PlotTrace {
  readonly label: string;
  readonly color?: string;
  readonly points: readonly PlotPoint[];
}

export interface PlotTick {
  /** In the axis's display unit. */
  readonly value: number;
  readonly label: string;
}

export interface PlotAxis {
  readonly min: number;
  readonly max: number;
  readonly ticks: readonly PlotTick[];
  /** Display unit, absent when the quantity is dimensionless. */
  readonly unit?: string;
  readonly label?: string;
}

export interface PlotModel {
  readonly traces: readonly PlotTrace[];
  readonly x: PlotAxis;
  readonly y: PlotAxis;
}

/** The default palette, so two traces never come out the same colour. */
const COLORS = ["#1f5fa8", "#b3261e", "#1a7f37", "#8a6d00", "#6b3fa0"] as const;

function requireVector(
  value: Value | undefined,
  name: string,
  role: string,
): readonly Quantity[] {
  if (value === undefined) {
    throw new CalcError("undefined_name", `\`${name}\` is not defined`, NO_SPAN);
  }
  if (!isMatrix(value)) {
    throw new CalcError(
      "shape_mismatch",
      `\`${name}\` is a single value; the ${role} axis needs a column of them`,
      NO_SPAN,
      "a table column or a range gives you one",
    );
  }
  const m = value as MatrixValue;
  if (m.cols !== 1 && m.rows !== 1) {
    throw new CalcError(
      "shape_mismatch",
      `\`${name}\` is a grid, not a column`,
      NO_SPAN,
    );
  }
  return m.cells;
}

/**
 * "Nice" tick step: 1, 2 or 5 times a power of ten.
 *
 * The alternative — dividing the range into equal parts — puts ticks on values
 * like 3.7143, which nobody reads off a calc sheet.
 */
function niceStep(range: number, target: number): number {
  if (!(range > 0)) return 1;
  const rough = range / Math.max(1, target);
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const normalized = rough / magnitude;
  const step = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return step * magnitude;
}

function tickLabel(value: number, step: number): string {
  // Decimals implied by the step, so a 0.5 step reads 0.5 and not 0.50000001.
  const decimals = Math.max(0, Math.ceil(-Math.log10(step)));
  return value.toFixed(Math.min(decimals, 6));
}

function buildAxis(
  values: readonly number[],
  unit: string | undefined,
  label: string | undefined,
): PlotAxis {
  let min = Math.min(...values);
  let max = Math.max(...values);

  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    throw new CalcError("domain", "this plot has no finite values to draw", NO_SPAN);
  }
  if (min === max) {
    // A flat series still deserves a readable axis rather than a zero-width one.
    const pad = Math.abs(min) > 0 ? Math.abs(min) * 0.5 : 1;
    min -= pad;
    max += pad;
  }

  const step = niceStep(max - min, 5);
  const first = Math.floor(min / step) * step;
  const last = Math.ceil(max / step) * step;

  const ticks: PlotTick[] = [];
  // Counted rather than accumulated: repeated addition of 0.1 drifts, and the
  // drift lands in the printed tick labels.
  const count = Math.round((last - first) / step);
  for (let i = 0; i <= count; i += 1) {
    const value = first + i * step;
    ticks.push({ value, label: tickLabel(value, step) });
  }

  return {
    min: first,
    max: last,
    ticks,
    ...(unit !== undefined ? { unit } : {}),
    ...(label !== undefined ? { label } : {}),
  };
}

/** How a plot finds a name's value. A function, not a map, so this module
 * stays independent of how the evaluator stores its bindings. */
export type Lookup = (name: string) => Value | undefined;

/**
 * Builds the model, or throws the first thing wrong with the plot.
 *
 * `lookup` resolves names as they stand at this region's position in
 * evaluation order, so a plot sees exactly the definitions a math region in
 * the same place would.
 */
export function buildPlot(region: PlotRegion, lookup: Lookup, units?: SheetUnits): PlotModel {
  if (region.series.length === 0) {
    throw new CalcError("domain", "this plot has no series yet", NO_SPAN);
  }

  // Units come from the first series: every trace shares the axes, so they
  // have to share the unit too, and a mismatch is reported below.
  const first = region.series[0] as PlotSeries;
  const firstX = requireVector(lookup(first.x), first.x, "x");
  const firstY = requireVector(lookup(first.y), first.y, "y");

  // An empty override means "no unit", not a unit named "" — the same rule a
  // table column follows. Without this, clearing the box in the UI produced
  // `cannot be drawn on an axis in \`\``, which explains nothing.
  const override = (u: string | undefined): string | undefined =>
    u === undefined || u.trim() === "" ? undefined : u;

  const xUnit =
    override(region.xUnit) ?? preferredUnit((firstX[0] as Quantity).dimension, units);
  const yUnit =
    override(region.yUnit) ?? preferredUnit((firstY[0] as Quantity).dimension, units);

  const traces: PlotTrace[] = [];
  const xs: number[] = [];
  const ys: number[] = [];

  region.series.forEach((series, i) => {
    const xv = requireVector(lookup(series.x), series.x, "x");
    const yv = requireVector(lookup(series.y), series.y, "y");
    if (xv.length !== yv.length) {
      throw new CalcError(
        "shape_mismatch",
        `\`${series.x}\` has ${xv.length} values and \`${series.y}\` has ${yv.length}`,
        NO_SPAN,
        "a trace needs one y for every x",
      );
    }

    const points: PlotPoint[] = [];
    for (let k = 0; k < xv.length; k += 1) {
      // A unit mismatch surfaces here, naming the axis rather than the
      // dimensional algebra behind it (ADR-0005).
      const x = convert(xv[k] as Quantity, xUnit, series.x);
      const y = convert(yv[k] as Quantity, yUnit, series.y);
      points.push({ x, y });
      xs.push(x);
      ys.push(y);
    }

    traces.push({
      label: series.label ?? `${series.y} vs ${series.x}`,
      color: series.color ?? (COLORS[i % COLORS.length] as string),
      points,
    });
  });

  return {
    traces,
    x: buildAxis(xs, xUnit, region.xLabel),
    y: buildAxis(ys, yUnit, region.yLabel),
  };
}

function convert(q: Quantity, unit: string | undefined, name: string): number {
  if (unit === undefined) return q.si;
  try {
    return valueIn(q, unit);
  } catch {
    throw new CalcError(
      "unit_mismatch",
      `\`${name}\` cannot be drawn on an axis in \`${unit}\``,
      NO_SPAN,
    );
  }
}

/** Names a plot reads, for the dependency graph. */
export function plotReads(region: PlotRegion): ReadonlySet<string> {
  const names = new Set<string>();
  for (const s of region.series) {
    names.add(s.x);
    names.add(s.y);
  }
  return names;
}

/**
 * True when the plot has nothing to draw yet, so it is not an error.
 *
 * A series whose names are still blank counts: an inserted plot arrives with
 * one empty trace so its two name boxes are there to type into, and that must
 * not read as a broken plot.
 */
export function isBlankPlot(region: PlotRegion): boolean {
  return region.series.every((s) => s.x.trim() === "" || s.y.trim() === "");
}
