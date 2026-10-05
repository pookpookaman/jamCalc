/**
 * Choose the unit a result is displayed in.
 *
 * Only units of the result's own dimension are offered, so the list cannot
 * produce a mismatch — a picker that lets you ask for a moment in `ksi` and
 * then reports an error has wasted the user's time on a question it could have
 * answered itself.
 */

import { useEffect, useRef, type JSX } from "react";
import { displayUnitsFor, isMatrix, type Dimension, type RegionResult } from "@jamcalc/engine";

/** The dimension a result can be shown in units of, if it has one. */
export function dimensionOf(result: RegionResult | undefined): Dimension | null {
  if (!result || result.status !== "ok" || result.isFunction) return null;
  const value = result.value;
  return (isMatrix(value) ? value.commonDimension() : value.dimension) ?? null;
}

export function UnitPicker({
  dimension,
  chosen,
  anchor,
  onPick,
  onClose,
}: {
  dimension: Dimension | null;
  /** The unit chosen now, marked in the list; undefined for the default. */
  chosen: string | undefined;
  anchor: HTMLElement | null;
  onPick: (unit: string | null) => void;
  onClose: () => void;
}): JSX.Element | null {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    window.addEventListener("keydown", onKey);
    // A frame's delay, or the click that opened this closes it again.
    const id = window.setTimeout(() => window.addEventListener("mousedown", onDown), 0);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onDown);
      window.clearTimeout(id);
    };
  }, [onClose]);

  if (!dimension) return null;
  const options = displayUnitsFor(dimension);

  const box = anchor?.getBoundingClientRect();
  // Kept on screen: a value at the right edge of the panel opens it leftwards.
  const style = box
    ? {
        left: Math.round(Math.max(8, Math.min(box.left, window.innerWidth - 260))),
        top: Math.round(box.bottom + 4),
      }
    : { left: 120, top: 120 };
  return (
    <div className="unit-picker" ref={ref} style={style}>
      <div className="head">
        {dimension.isDimensionless ? "Dimensionless" : dimension.toString()}
      </div>
      {options.length === 0 ? (
        <div className="empty">No named unit for this dimension</div>
      ) : (
        <div className="options">
          {options.map((u) => (
            <button
              key={u.expression}
              className={chosen === u.expression ? "on" : ""}
              onClick={() => onPick(u.expression)}
            >
              {u.expression}
            </button>
          ))}
        </div>
      )}
      <button className="clear" onClick={() => onPick(null)}>
        Default
      </button>
    </div>
  );
}
