/**
 * Rich text region: styled runs, edited in place with a real selection.
 *
 * contentEditable rather than a textarea, because a textarea cannot show two
 * colours. The DOM is treated as a rendering of the runs, never as the truth:
 * on input we read it back into runs, and the caret is tracked as *character
 * offsets* into the plain text, which survive re-rendering when the DOM nodes
 * do not.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, type JSX } from "react";
import { plainText, type RegionStyle, type TextRun } from "@jamcalc/engine";

export interface TextSelection {
  readonly start: number;
  readonly end: number;
}

/** Character offset of a DOM point within `root`. */
function offsetOf(root: HTMLElement, node: Node, nodeOffset: number): number {
  let total = 0;
  const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let current = walk.nextNode();
  while (current) {
    if (current === node) return total + nodeOffset;
    total += (current.textContent ?? "").length;
    current = walk.nextNode();
  }
  // A point on an element node (an empty region, or the very end) lands here.
  return total;
}

/** Inverse: place a DOM range at a character offset. */
function pointAt(root: HTMLElement, offset: number): { node: Node; offset: number } {
  let remaining = offset;
  const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let current = walk.nextNode();
  let last: Node = root;
  while (current) {
    const len = (current.textContent ?? "").length;
    if (remaining <= len) return { node: current, offset: remaining };
    remaining -= len;
    last = current;
    current = walk.nextNode();
  }
  return { node: last, offset: (last.textContent ?? "").length };
}

function styleToCss(style: RegionStyle | undefined): React.CSSProperties {
  if (!style) return {};
  return {
    ...(style.fontSize !== undefined ? { fontSize: `${style.fontSize}px` } : {}),
    ...(style.color !== undefined ? { color: style.color } : {}),
    ...(style.bold ? { fontWeight: 700 } : {}),
    ...(style.italic ? { fontStyle: "italic" } : {}),
  };
}

/** Reads the DOM back into runs, using the inline styles we rendered. */
function readRuns(root: HTMLElement): TextRun[] {
  const runs: TextRun[] = [];
  const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node = walk.nextNode();
  while (node) {
    const text = node.textContent ?? "";
    if (text !== "") {
      const el = node.parentElement;
      const cs = el && el !== root ? el.style : undefined;
      const style: RegionStyle = {
        ...(cs?.fontSize ? { fontSize: Number.parseFloat(cs.fontSize) } : {}),
        ...(cs?.color ? { color: rgbToHex(cs.color) } : {}),
        ...(cs?.fontWeight === "700" || cs?.fontWeight === "bold" ? { bold: true } : {}),
        ...(cs?.fontStyle === "italic" ? { italic: true } : {}),
      };
      runs.push({ text, ...(Object.keys(style).length > 0 ? { style } : {}) });
    }
    node = walk.nextNode();
  }
  return runs;
}

function rgbToHex(value: string): string {
  const m = /^rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(value);
  if (!m) return value;
  const hex = (n: string) => Number(n).toString(16).padStart(2, "0");
  return `#${hex(m[1] as string)}${hex(m[2] as string)}${hex(m[3] as string)}`;
}

export function TextRegionBody({
  runs,
  editing,
  onChange,
  onSelectionChange,
  onDone,
  onStartEdit,
  align,
}: {
  runs: readonly TextRun[];
  editing: boolean;
  /** How the block sits in its box. Absent means left. */
  align?: "left" | "center" | "right";
  onChange: (runs: TextRun[]) => void;
  onSelectionChange: (sel: TextSelection | null) => void;
  onDone: () => void;
  onStartEdit: () => void;
}): JSX.Element {
  const ref = useRef<HTMLDivElement | null>(null);
  /** What we last rendered, so an echo of our own edit does not reset the caret. */
  const rendered = useRef<string>("");

  const readSelection = useCallback((): TextSelection | null => {
    const root = ref.current;
    const sel = window.getSelection();
    if (!root || !sel || sel.rangeCount === 0) return null;
    const range = sel.getRangeAt(0);
    if (!root.contains(range.startContainer)) return null;
    const start = offsetOf(root, range.startContainer, range.startOffset);
    const end = offsetOf(root, range.endContainer, range.endOffset);
    return { start: Math.min(start, end), end: Math.max(start, end) };
  }, []);

  const emitSelection = useCallback(() => {
    onSelectionChange(readSelection());
  }, [onSelectionChange, readSelection]);

  // Re-render the DOM only when the runs changed from OUTSIDE this editor —
  // i.e. a format action. Rewriting innerHTML on every keystroke would drop
  // the caret to the start of the region on every character typed.
  useLayoutEffect(() => {
    const root = ref.current;
    if (!root || !editing) return;
    const signature = JSON.stringify(runs);
    if (signature === rendered.current) return;

    const sel = readSelection();
    root.innerHTML = "";
    for (const run of runs) {
      const span = document.createElement("span");
      Object.assign(span.style, styleToCss(run.style) as Record<string, string>);
      span.textContent = run.text;
      root.appendChild(span);
    }
    rendered.current = signature;

    if (sel) {
      const range = document.createRange();
      const a = pointAt(root, sel.start);
      const b = pointAt(root, sel.end);
      range.setStart(a.node, a.offset);
      range.setEnd(b.node, b.offset);
      const s = window.getSelection();
      s?.removeAllRanges();
      s?.addRange(range);
    }
  }, [runs, editing, readSelection]);

  /**
   * contentEditable does not emit a reliable `select` event — React's onSelect
   * is an input/textarea affordance. `selectionchange` on the document is the
   * only signal that fires for every way a caret can move here.
   */
  useEffect(() => {
    if (!editing) return;
    const onSelectionChangeEvent = () => emitSelection();
    document.addEventListener("selectionchange", onSelectionChangeEvent);
    return () => document.removeEventListener("selectionchange", onSelectionChangeEvent);
  }, [editing, emitSelection]);

  useEffect(() => {
    if (!editing) {
      rendered.current = "";
      onSelectionChange(null);
      return;
    }
    const root = ref.current;
    if (!root) return;
    root.focus();
    const range = document.createRange();
    range.selectNodeContents(root);
    range.collapse(false);
    const s = window.getSelection();
    s?.removeAllRanges();
    s?.addRange(range);
    emitSelection();
  }, [editing, emitSelection, onSelectionChange]);

  if (!editing) {
    return (
      <span
        className="text"
        onClick={onStartEdit}
        {...(align ? { style: { textAlign: align, display: "block" } } : {})}
      >
        {runs.length === 0 ? (
          <span className="placeholder">text…</span>
        ) : (
          runs.map((run, i) => (
            <span key={i} style={styleToCss(run.style)}>
              {run.text}
            </span>
          ))
        )}
      </span>
    );
  }

  return (
    <div
      ref={ref}
      className="text text-edit"
      {...(align ? { style: { textAlign: align } } : {})}
      contentEditable
      suppressContentEditableWarning
      spellCheck={false}
      onInput={() => {
        const root = ref.current;
        if (!root) return;
        const next = readRuns(root);
        rendered.current = JSON.stringify(next);
        onChange(next);
        emitSelection();
      }}
      onKeyUp={emitSelection}
      onMouseUp={emitSelection}
      onSelect={emitSelection}
      onBlur={(e) => {
        // Moving into the format bar is not leaving the text.
        //
        // A `<select>` cannot decline focus the way the colour swatches and
        // the B and I buttons do — cancelling mousedown would stop its
        // dropdown opening — so it takes focus, which ended the editing
        // session before its own change handler ran. The size then applied to
        // the whole region, which is precisely the bug that range formatting
        // was built to fix.
        const to = e.relatedTarget;
        if (to instanceof HTMLElement && to.closest(".format")) {
          // The highlight is gone from the DOM either way; App remembers where
          // it was for exactly this moment.
          onSelectionChange(null);
          return;
        }
        onSelectionChange(null);
        onDone();
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          // A line inside the box, with or without Shift. A text region is a
          // block of prose; Enter belongs to the prose, and Escape or clicking
          // away is how you leave.
          //
          // The newline is inserted as a character rather than left to the
          // browser, which would build divs or `<br>`s that the run reader
          // does not understand — the paragraph would come back as one line.
          e.preventDefault();
          const inserted = document.execCommand("insertText", false, "\n");
          if (!inserted) {
            // execCommand is deprecated and may be refused; do it by hand and
            // tell React ourselves, since no input event will fire.
            const sel = window.getSelection();
            const range = sel?.rangeCount ? sel.getRangeAt(0) : null;
            const root = ref.current;
            if (range && root) {
              range.deleteContents();
              const node = document.createTextNode("\n");
              range.insertNode(node);
              range.setStartAfter(node);
              range.collapse(true);
              sel?.removeAllRanges();
              sel?.addRange(range);
              const next = readRuns(root);
              rendered.current = JSON.stringify(next);
              onChange(next);
            }
          }
          emitSelection();
          return;
        }
        if (e.key === "Escape") {
          e.preventDefault();
          onDone();
        }
        // Enter ends the edit; Shift+Enter would need block structure the run
        // model deliberately does not have.
        if (e.key === "Enter") {
          e.preventDefault();
          onDone();
        }
      }}
    />
  );
}

export { plainText };
