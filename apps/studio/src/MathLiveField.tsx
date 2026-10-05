/**
 * The MathLive editor for one math region.
 *
 * MathLive was chosen because building a 2-D editor with correct caret
 * navigation is a project of its own, and that editing experience is the
 * most likely reason a tool like this feels bad.
 *
 * The sheet's source stays the source of truth. This component seeds the field
 * from our LaTeX and converts back on the way out (`engine/latex.ts`), so the
 * document never holds LaTeX and the language never grows to meet it.
 */

import { useEffect, useLayoutEffect, useRef } from "react";
import { latexToSource, sourceToLatex } from "@jamcalc/engine";
import { endsInScript } from "./scriptNesting.js";
import "mathlive";
import "mathlive/static.css";

export interface MathLiveFieldProps {
  readonly source: string;
  readonly onChange: (source: string) => void;
  readonly onDone: () => void;
  readonly fontSize?: number;
}

/** The custom element MathLive registers. */
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace JSX {
    interface IntrinsicElements {
      "math-field": React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement>,
        HTMLElement
      > & { class?: string };
    }
  }
}

interface MathfieldLike extends HTMLElement {
  value: string;
  menuItems: unknown[];
  position: number;
  executeCommand: (command: string) => boolean;
  getValue: (start: number, end: number, format: string) => string;
  hasFocus?: () => boolean;
}


/**
 * Whether pressing `_` or `^` here would nest one script inside another, and
 * if so, leaves the script instead.
 *
 * One level is all a calc sheet needs: `M_u`, `f'_c`, `x^2`. Deeper is almost
 * always a slip, and a slip that is hard to see and harder to get out of. So
 * the key toggles — in when you are outside, out when you are in.
 *
 * MathLive exposes no way to ask what the caret's parent *is*, so this asks
 * what changes when it steps out: if the text up to the caret gains a closed
 * script, the parent was a script. A fraction gains `rac{...}{...}`, which
 * does not match, so subscripting inside a numerator still works.
 */
function leftScriptIfInside(field: MathfieldLike): boolean {
  const before = field.position;
  let prefixBefore: string;
  try {
    prefixBefore = field.getValue(0, before, "latex");
  } catch {
    return false;
  }
  if (!field.executeCommand("moveAfterParent")) return false;
  const after = field.position;
  if (after === before) return false;

  let prefixAfter: string;
  try {
    prefixAfter = field.getValue(0, after, "latex");
  } catch {
    field.position = before;
    return false;
  }
  if (prefixAfter.length > prefixBefore.length && endsInScript(prefixAfter)) {
    return true;
  }
  // Some other kind of group — a fraction, a root. Put the caret back and let
  // the keystroke do what it normally does.
  field.position = before;
  return false;
}

export function MathLiveField({ source, onChange, onDone, fontSize }: MathLiveFieldProps) {
  const ref = useRef<MathfieldLike | null>(null);
  /** The source we last sent out, so an echo does not fight the user's caret. */
  const lastSent = useRef(source);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  /**
   * Sends whatever the field holds now, if it has not been sent.
   *
   * MathLive's `input` event can trail the keystroke that caused it. Typed
   * quickly and finished with Enter, the region closed and the field was
   * removed — listener and all — before the last event arrived, and the
   * region kept only part of what was typed, or none of it. So the field is
   * read directly whenever it finishes or goes away, rather than trusting
   * that the last event has been heard.
   */
  const flush = useRef(() => {
    const field = ref.current;
    if (!field) return;
    let next: string;
    try {
      next = latexToSource(field.value);
    } catch {
      return;
    }
    if (next === lastSent.current) return;
    lastSent.current = next;
    onChangeRef.current(next);
  }).current;

  useEffect(() => {
    const field = ref.current;
    if (!field) return;

    // Seed from our own LaTeX. A source that does not parse yet — someone is
    // still typing it — is handed over verbatim rather than thrown away.
    let latex: string;
    try {
      latex = sourceToLatex(source);
    } catch {
      latex = source;
    }
    field.value = latex;
    lastSent.current = source;

    // No context menu: its items act on LaTeX the document does not keep.
    field.menuItems = [];
    try {
      field.focus();
    } catch {
      // MathLive blurs the field it last saw focused before focusing this one,
      // and throws if that field has since been torn down. The failed blur
      // clears MathLive's note on its way, so a second attempt succeeds.
      // Without this, one stale note would stop every field taking focus.
      field.focus();
    }
    // Only on mount: re-seeding on every keystroke would move the caret back
    // to the start while the user is typing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Blur on the way out, while still on the page.
   *
   * MathLive keeps one global note of the field with focus, and when another
   * field takes focus it blurs that one first. A field taken off the page
   * while focused never hears its own blur — removing an element does not
   * fire one — so the note is left on a field that no longer exists, and the
   * next field to take focus throws trying to blur it. With sheets in
   * background tabs that took the whole app down.
   *
   * A layout effect, because its cleanup runs before React removes the
   * element; a plain effect's runs after, when it is too late to blur.
   */
  useLayoutEffect(
    () => () => {
      const field = ref.current;
      if (!field) return;
      // Anything typed but not yet reported is kept, however the field went.
      flush();
      try {
        field.blur();
        // MathLive takes focus at once but hands the browser's focus to its
        // keyboard sink a moment later. Removed in between, the sink never had
        // focus to lose, so give it focus and take it away again.
        if (field.hasFocus?.()) {
          const sink = field.shadowRoot?.querySelector<HTMLElement>(".ML__keyboard-sink");
          sink?.focus();
          sink?.blur();
        }
      } catch {
        // Already torn down: there is nothing left to blur.
      }
    },
    [],
  );

  useEffect(() => {
    const field = ref.current;
    if (!field) return;

    const handleInput = () => flush();
    const handleKey = (e: KeyboardEvent) => {
      if ((e.key === "_" || e.key === "^") && leftScriptIfInside(field)) {
        // Already in a script: this keystroke takes us out rather than deeper.
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      if (e.key === "Enter" || e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        flush();
        onDone();
      }
    };

    field.addEventListener("input", handleInput);
    field.addEventListener("keydown", handleKey);
    return () => {
      field.removeEventListener("input", handleInput);
      field.removeEventListener("keydown", handleKey);
    };
  }, [flush, onDone]);

  return (
    <math-field
      ref={ref as React.Ref<HTMLElement>}
      class="mathlive-field"
      style={fontSize ? { fontSize: `${fontSize}px` } : undefined}
    />
  );
}
