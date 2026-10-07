/**
 * How a number is written down.
 *
 * A calc sheet reporting `0.524109` where it means `0.52` reads as unfinished,
 * and one reporting `0.5` where the check is marginal hides the margin. So
 * this is per region, with a sheet-wide default, rather than a single global
 * rule.
 *
 * Presentation only: the stored value never changes, and a rounded display is
 * never fed back into a calculation. Rounding that propagates is how a sheet
 * ends up disagreeing with itself.
 */

/**
 * When a number is written with an exponent (ADR-0017).
 *
 * - `auto`: only when very large or very small, so a page is not zeroes.
 * - `normal`: never.
 * - `scientific`: always, one digit before the point.
 * - `engineering`: always, with an exponent that is a multiple of 3.
 */
export type Notation = "auto" | "normal" | "scientific" | "engineering";
export const NOTATIONS: readonly Notation[] = ["auto", "normal", "scientific", "engineering"];

export interface NumberFormat {
  /** Fixed decimal places. Wins over `sig` when both are set. */
  readonly decimals?: number;
  /** Significant figures. */
  readonly sig?: number;
  /** When to use an exponent. Absent means `auto`. */
  readonly notation?: Notation;
}

/** No format chosen: enough digits to be honest, without inventing precision. */
const AUTO_SIG = 6;

/** `-0.00` reads as a sign nobody intended. */
const unsignedZero = (out: string): string => (/^-0(\.0*)?$/.test(out) ? out.slice(1) : out);

/** A mantissa and exponent, the mantissa to `digits` significant figures or `decimals` places. */
function withExponent(n: number, step: 1 | 3, format?: NumberFormat): string {
  if (n === 0) return format?.decimals !== undefined ? (0).toFixed(Math.min(12, format.decimals)) : "0";
  let exp = Math.floor(Math.log10(Math.abs(n)));
  exp -= ((exp % step) + step) % step;
  const mantissa = n / 10 ** exp;
  let m: string;
  if (format?.decimals !== undefined) {
    m = mantissa.toFixed(Math.max(0, Math.min(12, format.decimals)));
  } else {
    const digits = Math.max(1, Math.min(15, format?.sig ?? AUTO_SIG));
    m = String(Number.parseFloat(mantissa.toPrecision(digits)));
  }
  // Rounding can carry the mantissa to the next power: 9.9999 to 2 figures is 10.
  if (Math.abs(Number.parseFloat(m)) >= 10 ** step) return withExponent(Number.parseFloat(m) * 10 ** exp, step, format);
  // Written as `toExponential` writes it, so every exponent on a sheet looks alike.
  return `${unsignedZero(m)}e${exp < 0 ? "-" : "+"}${Math.abs(exp)}`;
}

export function formatNumber(n: number, format?: NumberFormat): string {
  if (!Number.isFinite(n)) return String(n);
  const notation = format?.notation ?? "auto";

  if (notation === "scientific") return withExponent(n, 1, format);
  if (notation === "engineering") return withExponent(n, 3, format);

  if (format?.decimals !== undefined) {
    return unsignedZero(n.toFixed(Math.max(0, Math.min(12, format.decimals))));
  }

  const digits = Math.max(1, Math.min(15, format?.sig ?? AUTO_SIG));

  // Very large or very small numbers get exponent form unless the sheet says
  // never; a page of zeroes is not a report.
  if (notation === "auto" && n !== 0 && (Math.abs(n) >= 1e6 || Math.abs(n) < 1e-4)) {
    return n.toExponential(Math.max(0, digits - 1));
  }
  const rounded = Number.parseFloat(n.toPrecision(digits));
  if (notation === "normal" && rounded !== 0) {
    // Plain digits however big or small: as many places as the figures need,
    // without the trailing zeroes `toFixed` pads with.
    const places = Math.max(0, digits - 1 - Math.floor(Math.log10(Math.abs(rounded))));
    const fixed = rounded.toFixed(Math.min(100, places));
    return unsignedZero(fixed.includes(".") ? fixed.replace(/\.?0+$/, "") : fixed);
  }
  return String(rounded);
}

/**
 * A change to a format, where `undefined` means "clear this field".
 *
 * `NumberFormat` itself cannot express that: under
 * `exactOptionalPropertyTypes`, an absent key and an explicit `undefined` are
 * different, and "leave it alone" and "go back to automatic" are different
 * intentions that a UI has to be able to say apart.
 */
export interface NumberFormatPatch {
  readonly decimals?: number | undefined;
  readonly sig?: number | undefined;
  readonly notation?: Notation | undefined;
}

const FORMAT_KEYS = ["decimals", "sig", "notation"] as const;

export function applyFormatPatch(
  base: NumberFormat | undefined,
  patch: NumberFormatPatch,
): NumberFormat | undefined {
  const next: { decimals?: number; sig?: number; notation?: Notation } = { ...base };
  for (const key of FORMAT_KEYS) {
    if (!(key in patch)) continue;
    const v = patch[key];
    if (v === undefined || (key === "notation" && v === "auto")) delete next[key];
    else (next as Record<string, unknown>)[key] = v;
  }
  return Object.keys(next).length === 0 ? undefined : next;
}

/** A format read from a file or a patch: only fields that mean something survive. */
export function readNumberFormat(raw: unknown): NumberFormat | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const o = raw as Record<string, unknown>;
  const whole = (v: unknown, lo: number, hi: number): v is number =>
    typeof v === "number" && Number.isInteger(v) && v >= lo && v <= hi;
  const out: { decimals?: number; sig?: number; notation?: Notation } = {};
  if (whole(o["decimals"], 0, 12)) out.decimals = o["decimals"];
  if (whole(o["sig"], 1, 15)) out.sig = o["sig"];
  if (NOTATIONS.includes(o["notation"] as Notation) && o["notation"] !== "auto") out.notation = o["notation"] as Notation;
  return Object.keys(out).length > 0 ? out : undefined;
}

/** Region format falls back to the sheet default, field by field. */
export function resolveFormat(
  region: NumberFormat | undefined,
  sheet: NumberFormat | undefined,
): NumberFormat | undefined {
  if (!region && !sheet) return undefined;
  const out: { decimals?: number; sig?: number; notation?: Notation } = {};
  for (const key of FORMAT_KEYS) {
    const v = region?.[key] ?? sheet?.[key];
    if (v !== undefined) (out as Record<string, unknown>)[key] = v;
  }
  return out;
}
