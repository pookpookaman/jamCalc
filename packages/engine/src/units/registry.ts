/**
 * Unit registry.
 *
 * A unit is a name bound to (scale factor -> SI, dimension). Nothing here
 * affects arithmetic; units exist to convert literals in and format results
 * out. See ADR-0002 for the `lb`-is-force decision.
 */

import { Dimension, DIM } from "../dimension.js";

export interface Unit {
  readonly name: string;
  /** Multiply by this to get coherent SI. */
  readonly scale: number;
  readonly dimension: Dimension;
  /** Additive offset applied AFTER scale, for affine units only (degC, degF). */
  readonly offset?: number;
}

function u(
  name: string,
  scale: number,
  dimension: Dimension,
  offset?: number,
): Unit {
  return offset === undefined
    ? { name, scale, dimension }
    : { name, scale, dimension, offset };
}

// --- Exact conversion constants (do not "simplify" these) -------------------
/** International yard/pound agreement of 1959, exact by definition. */
export const M_PER_INCH = 0.0254;
export const KG_PER_LBM = 0.45359237;
/** Standard gravity, exact by definition (CGPM 1901). */
export const STANDARD_GRAVITY = 9.80665;
/** Newtons per pound-force, exact: 0.45359237 * 9.80665. */
export const N_PER_LBF = KG_PER_LBM * STANDARD_GRAVITY;

const M_PER_FT = M_PER_INCH * 12;
const PA_PER_PSI = N_PER_LBF / (M_PER_INCH * M_PER_INCH);
/** US gallon: 231 cubic inches, exact by definition. */
const M3_PER_GAL = 231 * M_PER_INCH * M_PER_INCH * M_PER_INCH;
/** Mechanical horsepower: 550 ft·lbf/s, exact by definition. */
const W_PER_HP = 550 * M_PER_FT * N_PER_LBF;

const UNITS: Unit[] = [
  // --- SI base -------------------------------------------------------------
  u("m", 1, DIM.LENGTH),
  u("kg", 1, DIM.MASS),
  u("s", 1, DIM.TIME),
  u("K", 1, DIM.TEMPERATURE),

  // --- SI derived ----------------------------------------------------------
  u("N", 1, DIM.FORCE),
  u("Pa", 1, DIM.STRESS),
  u("J", 1, DIM.MOMENT),

  // --- Length --------------------------------------------------------------
  u("mm", 1e-3, DIM.LENGTH),
  u("cm", 1e-2, DIM.LENGTH),
  u("km", 1e3, DIM.LENGTH),
  u("in", M_PER_INCH, DIM.LENGTH),
  u("ft", M_PER_FT, DIM.LENGTH),
  u("yd", M_PER_FT * 3, DIM.LENGTH),
  u("mi", M_PER_FT * 5280, DIM.LENGTH),

  // --- Force ---------------------------------------------------------------
  // ADR-0002: bare `lb` is FORCE. Mass is `lbm`, and never spelled `lb`.
  u("lb", N_PER_LBF, DIM.FORCE),
  u("lbf", N_PER_LBF, DIM.FORCE),
  u("kip", N_PER_LBF * 1000, DIM.FORCE),
  u("kN", 1e3, DIM.FORCE),
  u("MN", 1e6, DIM.FORCE),
  u("kgf", STANDARD_GRAVITY, DIM.FORCE),
  u("tonf", N_PER_LBF * 2000, DIM.FORCE),

  // --- Mass ----------------------------------------------------------------
  u("lbm", KG_PER_LBM, DIM.MASS),
  u("slug", KG_PER_LBM * 32.17404855643044, DIM.MASS),
  u("g", 1e-3, DIM.MASS),
  u("tonne", 1e3, DIM.MASS),

  // --- Stress / pressure ---------------------------------------------------
  u("psi", PA_PER_PSI, DIM.STRESS),
  u("ksi", PA_PER_PSI * 1000, DIM.STRESS),
  u("kPa", 1e3, DIM.STRESS),
  u("MPa", 1e6, DIM.STRESS),
  u("GPa", 1e9, DIM.STRESS),
  // Area loads share the stress dimension; the distinction is display only.
  u("psf", N_PER_LBF / (M_PER_FT * M_PER_FT), DIM.STRESS),
  u("ksf", (N_PER_LBF * 1000) / (M_PER_FT * M_PER_FT), DIM.STRESS),

  // --- Line loads ----------------------------------------------------------
  u("pli", N_PER_LBF / M_PER_INCH, DIM.LINE_LOAD),
  u("plf", N_PER_LBF / M_PER_FT, DIM.LINE_LOAD),
  u("klf", (N_PER_LBF * 1000) / M_PER_FT, DIM.LINE_LOAD),
  u("kN_m", 1e3, DIM.LINE_LOAD),

  // --- Volume and flow -----------------------------------------------------
  // Fire protection and plumbing are sized in gallons per minute, and a sheet
  // that has to spell a pump's rating as 66.8 ft^3/min is not one anyone signs.
  u("gal", M3_PER_GAL, DIM.VOLUME),
  u("gpm", M3_PER_GAL / 60, DIM.FLOW),

  // --- Power -----------------------------------------------------------------
  u("W", 1, DIM.POWER),
  u("kW", 1e3, DIM.POWER),
  u("hp", W_PER_HP, DIM.POWER),

  // --- Angle (dimensionless, but the scale matters) ------------------------
  u("rad", 1, DIM.DIMENSIONLESS),
  u("deg", Math.PI / 180, DIM.DIMENSIONLESS),

  // --- Time ----------------------------------------------------------------
  u("min", 60, DIM.TIME),
  u("hr", 3600, DIM.TIME),
  u("day", 86400, DIM.TIME),

  // --- Temperature ---------------------------------------------------------
  // Affine units. `degC` as an absolute temperature is NOT the same as a
  // temperature *difference* of 1 degC. Structural work almost always wants
  // the difference (thermal expansion), which is why delta units are named.
  u("degC", 1, DIM.TEMPERATURE, 273.15),
  u("degF", 5 / 9, DIM.TEMPERATURE, 255.372222222222222),
  u("delta_degC", 1, DIM.TEMPERATURE),
  u("delta_degF", 5 / 9, DIM.TEMPERATURE),
];

const BY_NAME = new Map<string, Unit>(UNITS.map((x) => [x.name, x]));

export function lookupUnit(name: string): Unit | undefined {
  return BY_NAME.get(name);
}

export function allUnits(): readonly Unit[] {
  return UNITS;
}

/**
 * Every unit a value of this dimension could be displayed in, largest first.
 *
 * Ordered by scale so a picker reads kip, lbf, kN, N rather than alphabetical
 * order, which puts the units nobody wants at the top. Affine units are
 * excluded: they cannot express a difference and a display unit must.
 */
export function unitsForDimension(dimension: Dimension): Unit[] {
  return UNITS.filter(
    (u) => u.offset === undefined && u.dimension.equals(dimension),
  ).sort((a, b) => b.scale - a.scale);
}

/** Names that mean force but are commonly mistaken for mass, and vice versa. */
export const AMBIGUITY_HINTS: Record<string, string> = {
  lb: "`lb` is pound-FORCE here. Use `lbm` for pound-mass.",
  kg: "`kg` is mass. Use `kgf` for kilogram-force.",
  degC: "`degC` is an absolute temperature. Use `delta_degC` for a change in temperature.",
  degF: "`degF` is an absolute temperature. Use `delta_degF` for a change in temperature.",
};
