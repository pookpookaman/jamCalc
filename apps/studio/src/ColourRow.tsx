/**
 * One row of colour choices on the format bar: the default, a few swatches
 * that print well, and any other colour from the system picker.
 *
 * A math region has two — the equation and its result — so the row carries
 * its own label when there is more than one.
 */

import { useEffect, useRef, type JSX } from "react";

/** Dark enough to read on white paper, and distinct from each other in print. */
export const SWATCHES = ["#1a1a1a", "#1f5fa8", "#b3261e", "#1a7f37", "#8a6d00", "#6b6b6b"] as const;

/** What the system picker opens on: the colour now, if it can show it. */
const seed = (value: string | undefined): string =>
  value && /^#[0-9a-f]{6}$/i.test(value) ? value : "#1a1a1a";

export interface ColourRowProps {
  readonly label?: string;
  /** The colour now, or undefined for the default. */
  readonly value: string | undefined;
  /** A colour, or null to go back to the default. */
  readonly onPick: (colour: string | null) => void;
}

export function ColourRow({ label, value, onPick }: ColourRowProps): JSX.Element {
  const custom = useRef<HTMLInputElement>(null);
  const pick = useRef(onPick);
  pick.current = onPick;
  const isSwatch = value !== undefined && (SWATCHES as readonly string[]).includes(value.toLowerCase());

  // The picker's own `change` fires once, when the choice is made. React's
  // onChange on it fires for every step of a drag through the spectrum, which
  // would be one undo step per shade passed on the way.
  useEffect(() => {
    const input = custom.current;
    if (!input) return;
    const onChange = (): void => pick.current(input.value);
    input.addEventListener("change", onChange);
    return () => input.removeEventListener("change", onChange);
  }, []);

  // Uncontrolled, so a drag through the picker is not fought; kept in step
  // with a colour chosen some other way.
  useEffect(() => {
    if (custom.current) custom.current.value = seed(value);
  }, [value]);

  return (
    // Pressing a swatch must not take focus from highlighted text, or the
    // highlight is gone before the colour can reach it.
    <span className="colour-row" onMouseDown={(e) => e.preventDefault()}>
      {label ? <span className="colour-label">{label}</span> : null}
      <button
        className={`swatch swatch-default ${value === undefined ? "on" : ""}`}
        title="default colour"
        aria-label={`${label ?? "colour"}: default`}
        onClick={() => onPick(null)}
      />
      {SWATCHES.map((c) => (
        <button
          key={c}
          className={`swatch ${value?.toLowerCase() === c ? "on" : ""}`}
          style={{ background: c }}
          aria-label={`${label ?? "colour"}: ${c}`}
          onClick={() => onPick(c)}
        />
      ))}
      <label
        className={`swatch swatch-custom ${value !== undefined && !isSwatch ? "on" : ""}`}
        title="another colour"
        style={value !== undefined && !isSwatch ? { background: value } : undefined}
      >
        <input
          ref={custom}
          type="color"
          aria-label={`${label ?? "colour"}: another colour`}
          defaultValue={seed(value)}
        />
      </label>
    </span>
  );
}
