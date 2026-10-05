/**
 * Regions — what a worksheet is made of.
 *
 * Two invariants, both load-bearing for the API:
 *
 *   1. `id` is identity. `position` is layout. A caller addresses a region by
 *      id, never by where it sits on the page.
 *   2. Every region records authorship (§5.4). This is two fields now so that
 *      the review gate the AI layer will need is a UI change later rather than
 *      a schema migration.
 */

import type { Value } from "../value.js";
import type { CalcError } from "../errors.js";
import type { TextRun } from "./text.js";
import type { NumberFormat } from "./format.js";

export type RegionId = string;

/** Who put this content here. `api` covers scripts today and agents later. */
export interface Authorship {
  readonly author: "human" | "api";
  /** Identifier of the API client, when author is `api`. */
  readonly client?: string;
  /** ISO-8601. */
  readonly at: string;
}

export interface Position {
  readonly x: number;
  readonly y: number;
}

/**
 * Explicit box size. Absent means "as wide as the content needs", which is the
 * right default for math — an equation should never wrap. A text region with a
 * width wraps inside it, which is what makes commentary blocks possible.
 */
export interface Size {
  readonly width: number;
  readonly height?: number;
}

/**
 * Presentation for one region. Purely cosmetic: nothing here can change a
 * computed value, which is why it lives beside the content rather than in it.
 */
export interface RegionStyle {
  readonly fontSize?: number;
  /** The region's ink. In a math region, the equation — its units included. */
  readonly color?: string;
  /**
   * Math regions only: the computed result and its unit. Separate from
   * `color` so a result can be picked out from the working, or matched to it.
   */
  readonly resultColor?: string;
  readonly bold?: boolean;
  readonly italic?: boolean;
}

/**
 * A change to a style: what is given is set, and a property given as `null`
 * goes back to its default. Absent means "leave it alone".
 */
export type StylePatch = { readonly [K in keyof RegionStyle]?: RegionStyle[K] | null };

/** Applies a `StylePatch`, dropping what it resets rather than storing a null. */
export function mergeStyle(style: RegionStyle | undefined, patch: StylePatch): RegionStyle {
  const merged: Record<string, unknown> = { ...(style ?? {}) };
  for (const [k, v] of Object.entries(patch)) {
    if (v === null || v === undefined) delete merged[k];
    else merged[k] = v;
  }
  return merged as RegionStyle;
}

export interface RegionBase {
  readonly id: RegionId;
  readonly position: Position;
  readonly size?: Size;
  readonly origin: Authorship;
  readonly style?: RegionStyle;
  /** How this region's numbers are written. Falls back to the sheet default. */
  readonly format?: NumberFormat;
}

/** A math region holds exactly one statement: `a := b` or `expr =`. */
export interface MathRegion extends RegionBase {
  readonly kind: "math";
  readonly source: string;
}

/** How a block of prose sits in its box. */
export type TextAlign = "left" | "center" | "right";

export interface TextRegion extends RegionBase {
  readonly kind: "text";
  /**
   * Alignment of the whole block.
   *
   * A property of the region rather than of a run, because that is what it is:
   * you cannot align three words in the middle of a sentence. Keeping it out
   * of `RegionStyle` means the range-formatting path cannot write it into a
   * run where it would mean nothing.
   */
  readonly align?: TextAlign;
  /**
   * Styled runs, not a plain string.
   *
   * Formatting a selection inside a paragraph is character-level, so the text
   * cannot be one string with one style beside it. The region's own `style` is
   * still the default a run inherits when it sets nothing of its own.
   */
  readonly runs: readonly TextRun[];
}

/** One column of a data table. */
export interface TableColumn {
  /**
   * The name this column binds on the sheet.
   *
   * A table defines one name per column rather than one name for the grid,
   * because that is what the language can already use: `linterp(span, load, L)`
   * takes two column vectors. Naming the whole table instead would require
   * slicing, which ADR-0008 deferred for good reasons.
   */
  readonly name: string;
  /** Unit every cell in this column is in, e.g. `ft`. Absent means a plain number. */
  readonly unit?: string;
  /** Heading shown above the column. Defaults to the name. */
  readonly label?: string;
}

/**
 * A grid of numbers with named, united columns.
 *
 * A tabulated lookup typed as a matrix literal in one math
 * region is unreadable past about six rows, and a code table is the most
 * common thing a real calc sheet needs to carry.
 *
 * Cells are numbers, not expressions. A table is data; putting formulas in
 * cells would make it a second, weaker evaluator living beside the real one.
 */
export interface TableRegion extends RegionBase {
  readonly kind: "table";
  readonly columns: readonly TableColumn[];
  /** Row-major. `null` is an empty cell. */
  readonly cells: readonly (readonly (number | null)[])[];
}

/** One traced curve on a plot: a pair of column vectors already on the sheet. */
export interface PlotSeries {
  /** Name of the vector supplying x. */
  readonly x: string;
  /** Name of the vector supplying y. */
  readonly y: string;
  readonly label?: string;
  readonly color?: string;
}

/**
 * A 2-D X-Y plot of vectors defined elsewhere on the sheet.
 *
 * This covers essentially all calc-sheet plotting. It holds no
 * data of its own: a plot names vectors, and the sheet computes them. A plot
 * that carried its own numbers would be a second place for the truth to live,
 * and the one on the page would go stale without saying so.
 */
export interface PlotRegion extends RegionBase {
  readonly kind: "plot";
  readonly series: readonly PlotSeries[];
  /** Units to draw the axes in. Absent means the engine's preferred unit. */
  readonly xUnit?: string;
  readonly yUnit?: string;
  readonly xLabel?: string;
  readonly yLabel?: string;
}

/**
 * A picture: a sketch, a detail, a screenshot of a model.
 *
 * Images were to be either embedded or kept in a sibling folder,
 * chosen by size. Embedded, for now: a `.jc` that is one file survives being
 * emailed, and a sheet whose sketch goes missing because someone moved a
 * folder is worse than a large file. The sibling-folder form can be added
 * later behind the same region.
 *
 * The engine never decodes it. `src` is a `data:` URI and the shell hands it
 * to an `<img>`; nothing here parses image bytes.
 */
export interface ImageRegion extends RegionBase {
  readonly kind: "image";
  /** A `data:` URI. */
  readonly src: string;
  /** Shown when the image cannot be drawn, and read out by screen readers. */
  readonly alt?: string;
}

/**
 * An explicit "start a new page here".
 *
 * A region rather than a page property, because its position is what gives it
 * meaning and positions are already the document's spatial language. It takes
 * part in evaluation order like anything else and computes nothing.
 */
export interface PageBreakRegion extends RegionBase {
  readonly kind: "pagebreak";
}

export type Region =
  | MathRegion
  | TextRegion
  | TableRegion
  | PlotRegion
  | ImageRegion
  | PageBreakRegion;

/**
 * The result of one math region.
 *
 * `blocked` exists because one bad region must never blank
 * the sheet. A region downstream of a failure genuinely cannot compute, but
 * saying *why* — and naming the region at fault — is very different from
 * showing an error of its own.
 */
export type RegionResult =
  | {
      readonly status: "ok";
      readonly defined?: string;
      /** The region defined a function; there is no value to display. */
      readonly isFunction?: boolean;
      /** Statement ended in `=`; the sheet shows the value. */
      readonly showResult?: boolean;
      readonly value: Value;
      readonly displayValue?: number;
      readonly displayUnit?: string;
    }
  | { readonly status: "error"; readonly error: CalcError }
  | {
      readonly status: "blocked";
      /** The upstream region that actually failed. */
      readonly because: RegionId;
      readonly missing: string;
    };

export function humanAuthorship(at: Date = new Date()): Authorship {
  return { author: "human", at: at.toISOString() };
}

export function apiAuthorship(client: string, at: Date = new Date()): Authorship {
  return { author: "api", client, at: at.toISOString() };
}
