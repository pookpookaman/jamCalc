/**
 * Sheet settings in the Page panel: the units, numbers and text the whole
 * sheet uses where a region sets nothing itself (ADR-0017).
 *
 * Every control writes through the document operations, like every other
 * edit, so each change is one undo step and the API can do the same.
 */

import type { JSX } from "react";
import {
  DEFAULT_SIZE,
  displayUnitsFor,
  NOTATIONS,
  QUANTITIES,
  SYSTEM_UNITS,
  TEXT_FONTS,
  type Notation,
  type QuantityKey,
  type TextFont,
  type UnitSystem,
} from "@jamcalc/engine";
import type { useSheet } from "./useSheet.js";

const NOTATION_LABELS: Readonly<Record<Notation, string>> = {
  auto: "Auto",
  normal: "Normal",
  scientific: "Scientific",
  engineering: "Engineering",
};

const FONT_LABELS: Readonly<Record<TextFont, string>> = {
  sans: "Sans-serif",
  serif: "Serif",
  mono: "Monospace",
};

const SIZES = [9, 10, 11, 12, 13, 14, 16, 18, 20] as const;

/** The units offered for a kind of quantity, with the system's own always among them. */
function unitOptions(key: QuantityKey, system: UnitSystem): string[] {
  const q = QUANTITIES.find((x) => x.key === key)!;
  const all = displayUnitsFor(q.dimension).map((u) => u.expression);
  const own = SYSTEM_UNITS[system][key];
  return all.includes(own) ? all : [own, ...all];
}

export function SheetSettings({ sheet }: { sheet: ReturnType<typeof useSheet> }): JSX.Element {
  const doc = sheet.sheet;
  const units = doc.units ?? {};
  const system: UnitSystem = units.system ?? "us";
  const format = doc.format ?? {};
  const text = doc.textStyle ?? {};
  // Decimals and significant figures are one choice: a sheet shows one or the other.
  const precision =
    format.decimals !== undefined ? `d${format.decimals}` : format.sig !== undefined ? `s${format.sig}` : "auto";

  return (
    <>
      <div className="group">
        <div className="group-title">Units</div>
        <label className="field setting">
          <span>System</span>
          <select value={system} onChange={(e) => sheet.setSheetUnits({ system: e.target.value as UnitSystem })}>
            <option value="us">US (kip, ft, ksi)</option>
            <option value="si">SI (kN, m, MPa)</option>
          </select>
        </label>
        {QUANTITIES.map(({ key, label }) => (
          <label className="field setting" key={key}>
            <span>{label}</span>
            <select
              value={units[key] ?? ""}
              onChange={(e) => sheet.setSheetUnits({ [key]: e.target.value === "" ? null : e.target.value })}
            >
              <option value="">{SYSTEM_UNITS[system][key]}</option>
              {unitOptions(key, system)
                .filter((u) => u !== SYSTEM_UNITS[system][key])
                .map((u) => (
                  <option key={u} value={u}>{u}</option>
                ))}
            </select>
          </label>
        ))}
      </div>

      <div className="group">
        <div className="group-title">Numbers</div>
        <label className="field setting">
          <span>Precision</span>
          <select
            value={precision}
            onChange={(e) => {
              const v = e.target.value;
              sheet.setSheetFormat(
                v === "auto"
                  ? { decimals: undefined, sig: undefined }
                  : v.startsWith("d")
                    ? { decimals: Number(v.slice(1)), sig: undefined }
                    : { sig: Number(v.slice(1)), decimals: undefined },
              );
            }}
          >
            <option value="auto">Auto (6 figures)</option>
            {[2, 3, 4, 5, 6].map((n) => (
              <option key={`s${n}`} value={`s${n}`}>{n} significant figures</option>
            ))}
            {[0, 1, 2, 3, 4].map((n) => (
              <option key={`d${n}`} value={`d${n}`}>{n} decimal{n === 1 ? "" : "s"}</option>
            ))}
          </select>
        </label>
        <label className="field setting">
          <span>Notation</span>
          <select
            value={format.notation ?? "auto"}
            onChange={(e) => sheet.setSheetFormat({ notation: e.target.value as Notation })}
          >
            {NOTATIONS.map((n) => (
              <option key={n} value={n}>{NOTATION_LABELS[n]}</option>
            ))}
          </select>
        </label>
      </div>

      <div className="group">
        <div className="group-title">Text</div>
        <label className="field setting">
          <span>Maths size</span>
          <select
            value={text.mathSize ?? DEFAULT_SIZE}
            onChange={(e) => sheet.setTextStyle({ mathSize: Number(e.target.value) })}
          >
            {SIZES.map((s) => (
              <option key={s} value={s}>{s} pt</option>
            ))}
          </select>
        </label>
        <label className="field setting">
          <span>Text size</span>
          <select
            value={text.textSize ?? DEFAULT_SIZE}
            onChange={(e) => sheet.setTextStyle({ textSize: Number(e.target.value) })}
          >
            {SIZES.map((s) => (
              <option key={s} value={s}>{s} pt</option>
            ))}
          </select>
        </label>
        <label className="field setting">
          <span>Text font</span>
          <select
            value={text.textFont ?? ""}
            onChange={(e) => sheet.setTextStyle({ textFont: e.target.value === "" ? null : (e.target.value as TextFont) })}
          >
            <option value="">App font</option>
            {TEXT_FONTS.map((f) => (
              <option key={f} value={f}>{FONT_LABELS[f]}</option>
            ))}
          </select>
        </label>
        <label className="field setting check-field">
          <input
            type="checkbox"
            checked={text.textBold ?? true}
            onChange={(e) => sheet.setTextStyle({ textBold: e.target.checked })}
          />
          <span>Text is bold unless set otherwise</span>
        </label>
      </div>
    </>
  );
}
