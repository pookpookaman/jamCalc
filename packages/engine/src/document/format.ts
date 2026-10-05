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

export interface NumberFormat {
  /** Fixed decimal places. Wins over `sig` when both are set. */
  readonly decimals?: number;
  /** Significant figures. */
  readonly sig?: number;
}

/** No format chosen: enough digits to be honest, without inventing precision. */
const AUTO_SIG = 6;

export function formatNumber(n: number, format?: NumberFormat): string {
  if (!Number.isFinite(n)) return String(n);

  if (format?.decimals !== undefined) {
    const d = Math.max(0, Math.min(12, format.decimals));
    // `toFixed` on a value that rounds to zero can produce "-0.00", which
    // reads as a sign nobody intended.
    const out = n.toFixed(d);
    return out === `-${(0).toFixed(d)}` ? (0).toFixed(d) : out;
  }

  const digits = Math.max(1, Math.min(15, format?.sig ?? AUTO_SIG));

  // Very large or very small numbers get exponent form regardless; a page of
  // zeroes is not a report.
  if (n !== 0 && (Math.abs(n) >= 1e6 || Math.abs(n) < 1e-4)) {
    return n.toExponential(Math.max(0, digits - 1));
  }
  return String(Number.parseFloat(n.toPrecision(digits)));
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
}

export function applyFormatPatch(
  base: NumberFormat | undefined,
  patch: NumberFormatPatch,
): NumberFormat | undefined {
  const next: { decimals?: number; sig?: number } = { ...base };
  for (const key of ["decimals", "sig"] as const) {
    if (!(key in patch)) continue;
    const v = patch[key];
    if (v === undefined) delete next[key];
    else next[key] = v;
  }
  return Object.keys(next).length === 0 ? undefined : next;
}

/** Region format falls back to the sheet default, field by field. */
export function resolveFormat(
  region: NumberFormat | undefined,
  sheet: NumberFormat | undefined,
): NumberFormat | undefined {
  if (!region && !sheet) return undefined;
  return {
    ...(region?.decimals !== undefined
      ? { decimals: region.decimals }
      : sheet?.decimals !== undefined
        ? { decimals: sheet.decimals }
        : {}),
    ...(region?.sig !== undefined
      ? { sig: region.sig }
      : sheet?.sig !== undefined
        ? { sig: sheet.sig }
        : {}),
  };
}
