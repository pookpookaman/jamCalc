/**
 * Sheet settings: the units, numbers and text a whole document uses by default
 * (ADR-0017). Presentation only — none of them changes a computed value.
 *
 * Read defensively, like everything else in a sheet: a setting that does not
 * mean something is dropped, not trusted.
 */

import { QUANTITIES, unitFitsQuantity, type SheetUnits, type UnitSystem } from "../units/prefer.js";

/** Text fonts a sheet may name: families, so every machine has one to give. */
export type TextFont = "sans" | "serif" | "mono";
export const TEXT_FONTS: readonly TextFont[] = ["sans", "serif", "mono"];

/** The CSS a font family is drawn with. */
export const FONT_STACKS: Readonly<Record<TextFont, string>> = {
  sans: 'Arial, Helvetica, "Liberation Sans", sans-serif',
  serif: '"Times New Roman", Times, "Liberation Serif", serif',
  mono: '"Courier New", Courier, "Liberation Mono", monospace',
};

/** Defaults for regions that do not set their own size, weight or font. */
export interface SheetTextStyle {
  /** Size of maths, in px; 13 when absent. */
  readonly mathSize?: number;
  /** Size of text, in px; 13 when absent. */
  readonly textSize?: number;
  /** Whether text is bold unless set otherwise; true when absent, as it always was. */
  readonly textBold?: boolean;
  /** Absent means the app's own interface font. */
  readonly textFont?: TextFont;
}

export const DEFAULT_SIZE = 13;
const SIZE_RANGE = [6, 72] as const;

const isSize = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v) && v >= SIZE_RANGE[0] && v <= SIZE_RANGE[1];

export function readSheetUnits(raw: unknown): SheetUnits | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const o = raw as Record<string, unknown>;
  const out: Record<string, string> = {};
  if (o["system"] === "us" || o["system"] === "si") out["system"] = o["system"] satisfies UnitSystem;
  for (const { key } of QUANTITIES) {
    const u = o[key];
    if (typeof u === "string" && unitFitsQuantity(key, u)) out[key] = u;
  }
  return Object.keys(out).length > 0 ? (out as SheetUnits) : undefined;
}

export function readSheetTextStyle(raw: unknown): SheetTextStyle | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const o = raw as Record<string, unknown>;
  const out: { mathSize?: number; textSize?: number; textBold?: boolean; textFont?: TextFont } = {};
  if (isSize(o["mathSize"])) out.mathSize = o["mathSize"];
  if (isSize(o["textSize"])) out.textSize = o["textSize"];
  if (typeof o["textBold"] === "boolean") out.textBold = o["textBold"];
  if (TEXT_FONTS.includes(o["textFont"] as TextFont)) out.textFont = o["textFont"] as TextFont;
  return Object.keys(out).length > 0 ? out : undefined;
}

/** In a fixed key order, so a saved file diffs cleanly. */
export function sortedSheetUnits(units: SheetUnits): SheetUnits {
  const out: Record<string, string> = {};
  if (units.system) out["system"] = units.system;
  for (const { key } of QUANTITIES) if (units[key] !== undefined) out[key] = units[key];
  return out as SheetUnits;
}

export function sortedTextStyle(style: SheetTextStyle): SheetTextStyle {
  return {
    ...(style.mathSize !== undefined ? { mathSize: style.mathSize } : {}),
    ...(style.textSize !== undefined ? { textSize: style.textSize } : {}),
    ...(style.textBold !== undefined ? { textBold: style.textBold } : {}),
    ...(style.textFont !== undefined ? { textFont: style.textFont } : {}),
  };
}
