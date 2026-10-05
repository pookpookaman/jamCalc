/**
 * One region's content: rendered notation, and an invisible input over it that
 * owns the keyboard while editing.
 *
 * The input is transparent rather than hidden. It has to be a real focused
 * element so the browser gives us selection, arrow keys, undo, and IME for
 * free; making it invisible instead of absent means the caret we draw is the
 * only one visible, and it sits in the rendered math rather than under it.
 */

import { useCallback, useEffect, useRef, useState, type JSX } from "react";
import {
  parseStatement,
  type MathRegion,
  type ResultParts,
  type Statement,
} from "@jamcalc/engine";
import { StatementView } from "./MathView.js";

export function RegionBody({
  region,
  resultParts,
  showResult,
  problemText,
  editing,
  onEdit,
  onDone,
  onStartEdit,
  onPickUnit,
}: {
  region: MathRegion;
  resultParts: ResultParts;
  showResult: boolean;
  problemText: string;
  editing: boolean;
  onEdit: (v: string) => void;
  onDone: () => void;
  onStartEdit: () => void;
  /** Clicking a displayed result asks which unit it should be shown in. */
  onPickUnit?: (() => void) | undefined;
}): JSX.Element {
  const value = region.source;
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [caret, setCaret] = useState<number | null>(null);

  /**
   * Read the caret from the element the event came from, NOT from the ref.
   *
   * `autoFocus` fires focus while the DOM node is attached, which happens
   * before React assigns the ref — so a ref-based handler saw null and the
   * caret was never set. The symptom was an editor with no visible cursor.
   */
  const readCaret = useCallback((el: HTMLInputElement) => {
    setCaret(el.selectionStart);
  }, []);

  useEffect(() => {
    if (!editing) {
      setCaret(null);
      return;
    }
    // Entering an edit puts the caret at the end and shows it immediately,
    // rather than waiting for the first keystroke to reveal where you are.
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    const end = el.value.length;
    el.setSelectionRange(end, end);
    setCaret(end);
  }, [editing]);

  /**
   * Place the caret from a click on the rendered notation.
   *
   * The hidden input's own layout is linear monospace text, which does not
   * correspond to the rendered math at all — a click at the numerator would
   * land wherever that x happened to fall in the source string. Mapping the
   * click through the atom that was actually clicked is exact, and it is only
   * possible because every atom carries its source span.
   */
  const pickCaret = useCallback((offset: number) => {
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(offset, offset);
    setCaret(offset);
  }, []);

  // --- math regions ---------------------------------------------------------
  if (region.source === "" && !editing) {
    // A box that has never been typed in: a target to click, not an error.
    return (
      <span className="rendered" onClick={onStartEdit}>
        <span className="placeholder">a := b…</span>
      </span>
    );
  }

  let statement: Statement | undefined;
  try {
    statement = parseStatement(region.source);
  } catch {
    statement = undefined;
  }

  const rendered =
    statement !== undefined ? (
      <StatementView
        statement={statement}
        {...(showResult ? { result: resultParts } : {})}
        caret={editing ? caret : null}
        {...(editing ? { onPick: pickCaret } : {})}
      />
    ) : (
      // Unparseable mid-edit: raw source, no invented structure — but still
      // show where the caret is, because losing the cursor exactly when a
      // formula is half-typed is when you need it most.
      <span className="source raw">
        {editing && caret !== null ? (
          <>
            {region.source.slice(0, caret)}
            <span className="mv-caret" />
            {region.source.slice(caret)}
          </>
        ) : (
          region.source
        )}
      </span>
    );

  return (
    <span
      className={`rendered ${editing ? "is-editing" : ""}`}
      onClick={() => {
        // Straight into editing. Dragging now lives on the grip alone, so a
        // click in the box can only ever mean "put the caret here".
        if (editing) inputRef.current?.focus();
        else onStartEdit();
      }}
    >
      {rendered}
      {showResult && !editing && onPickUnit ? (
        <span
          className="unit-hit"
          title="choose units"
          onClick={(e) => {
            e.stopPropagation();
            onPickUnit();
          }}
        />
      ) : null}
      {problemText ? <span className="result problem">{problemText}</span> : null}

      {editing ? (
        <input
          ref={inputRef}
          className="ghost-input"
          autoFocus
          value={value}
          spellCheck={false}
          onChange={(e) => {
            onEdit(e.target.value);
            readCaret(e.target);
          }}
          onSelect={(e) => readCaret(e.currentTarget)}
          onKeyUp={(e) => readCaret(e.currentTarget)}
          onFocus={(e) => readCaret(e.currentTarget)}
          onBlur={onDone}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === "Escape") onDone();
          }}
        />
      ) : null}
    </span>
  );
}
