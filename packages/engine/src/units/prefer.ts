/**
 * Default display units.
 *
 * A quantity with no display unit chosen still has to be shown as something,
 * and coherent SI is the wrong answer for this audience: `35025.4 kg·s^-2` is
 * a correct rendering of 2.4 klf and communicates nothing. Engineers read
 * `2.4 klf`.
 *
 * This is presentation only — it never touches stored magnitudes, and an
 * explicit display unit on a region always wins. A sheet chooses a system and
 * may override any kind of quantity (ADR-0017); a sheet that chooses nothing
 * reads in US units, as every sheet did before the setting existed.
 */

import { Dimension, DIM } from "../dimension.js";
import { parseUnit } from "./parse.js";

/** The kinds of quantity a sheet can choose a unit for, in the order they are offered. */
export const QUANTITIES = [
  { key: "length", label: "Length", dimension: DIM.LENGTH },
  { key: "area", label: "Area", dimension: DIM.AREA },
  { key: "volume", label: "Volume, section modulus", dimension: DIM.VOLUME },
  { key: "inertia", label: "Moment of inertia", dimension: DIM.SECOND_MOMENT_OF_AREA },
  { key: "force", label: "Force", dimension: DIM.FORCE },
  { key: "lineLoad", label: "Line load", dimension: DIM.LINE_LOAD },
  { key: "stress", label: "Stress, pressure", dimension: DIM.STRESS },
  { key: "moment", label: "Moment", dimension: DIM.MOMENT },
  { key: "mass", label: "Mass", dimension: DIM.MASS },
  { key: "time", label: "Time", dimension: DIM.TIME },
  { key: "flow", label: "Flow", dimension: DIM.FLOW },
  { key: "power", label: "Power", dimension: DIM.POWER },
] as const satisfies ReadonlyArray<{ key: string; label: string; dimension: Dimension }>;

export type QuantityKey = (typeof QUANTITIES)[number]["key"];
export type UnitSystem = "us" | "si";

/** A sheet's unit settings: a system, and any kinds of quantity it overrides. */
export type SheetUnits = { readonly system?: UnitSystem } & {
  readonly [K in QuantityKey]?: string;
};

/** The unit each system shows for each kind of quantity. */
export const SYSTEM_UNITS: Readonly<Record<UnitSystem, Readonly<Record<QuantityKey, string>>>> = {
  us: {
    length: "ft", area: "in^2", volume: "in^3", inertia: "in^4", force: "kip", lineLoad: "klf",
    stress: "ksi", moment: "kip*ft", mass: "lbm", time: "s", flow: "gpm", power: "hp",
  },
  si: {
    length: "m", area: "mm^2", volume: "mm^3", inertia: "mm^4", force: "kN", lineLoad: "kN/m",
    stress: "MPa", moment: "kN*m", mass: "kg", time: "s", flow: "m^3/s", power: "kW",
  },
};

/** Whether `unit` is a unit of the kind of quantity `key`. */
export function unitFitsQuantity(key: QuantityKey, unit: string): boolean {
  const q = QUANTITIES.find((x) => x.key === key);
  if (!q) return false;
  try {
    return parseUnit(unit).dimension.equals(q.dimension);
  } catch {
    return false;
  }
}

/**
 * The unit a sheet shows for each kind of quantity: its system's, with its
 * overrides on top. An override that is not a unit of its kind is ignored
 * rather than trusted: a sheet must never show a length in kip.
 */
export function sheetUnitTable(units?: SheetUnits): Readonly<Record<QuantityKey, string>> {
  const table: Record<QuantityKey, string> = { ...SYSTEM_UNITS[units?.system ?? "us"] };
  for (const { key } of QUANTITIES) {
    const u = units?.[key];
    if (u !== undefined && unitFitsQuantity(key, u)) table[key] = u;
  }
  return table;
}

/** The unit to show a quantity in when its region has not chosen one. */
export function preferredUnit(dimension: Dimension, units?: SheetUnits): string | undefined {
  if (dimension.isDimensionless) return undefined;
  const q = QUANTITIES.find((x) => dimension.equals(x.dimension));
  return q ? sheetUnitTable(units)[q.key] : undefined;
}

/** Whether a sheet has chosen any units at all. */
export function hasUnitSettings(units?: SheetUnits): boolean {
  return units !== undefined && Object.keys(units).length > 0;
}
