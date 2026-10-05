/**
 * Rich text as a flat list of styled runs.
 *
 * Flat, not a tree: a calc sheet's prose needs a word coloured or a phrase
 * bolded, not nested structure. A flat run list makes every operation a
 * splice, keeps the format diffable, and makes the range operations below
 * pure functions that can be tested without a DOM.
 *
 * Invariants, restored by `normalize` after every edit:
 *   - no empty runs
 *   - no two adjacent runs with equal style
 * Without them, typing one character at a time would grow an unbounded list
 * of single-character runs.
 */

import { mergeStyle, type RegionStyle, type StylePatch } from "./region.js";

export interface TextRun {
  readonly text: string;
  readonly style?: RegionStyle;
  /**
   * A name from the sheet, whose value is shown here.
   *
   * Values update inside prose. "The governing moment is 187.5
   * kip*ft" should not be a number someone retyped and will forget to change.
   * `text` holds what was last rendered, so the sentence still reads if the
   * name goes away — with a marker on the region saying so.
   */
  readonly ref?: string;
}

/** Written `{name}` in the text; `{{` and `}}` are literal braces. */
const REFERENCE = /\{\{|\}\}|\{([^{}]+)\}/g;

/** A reference is its own run and merges with nothing. */
const mergeable = (a: TextRun, b: TextRun): boolean =>
  a.ref === undefined && b.ref === undefined && sameStyle(a.style, b.style);

function sameStyle(a?: RegionStyle, b?: RegionStyle): boolean {
  const x = a ?? {};
  const y = b ?? {};
  return (
    x.fontSize === y.fontSize &&
    x.color === y.color &&
    (x.bold ?? false) === (y.bold ?? false) &&
    (x.italic ?? false) === (y.italic ?? false)
  );
}

function isEmptyStyle(s?: RegionStyle): boolean {
  if (!s) return true;
  return (
    s.fontSize === undefined &&
    s.color === undefined &&
    (s.bold === undefined || s.bold === false) &&
    (s.italic === undefined || s.italic === false)
  );
}

export function normalize(runs: readonly TextRun[]): TextRun[] {
  const out: TextRun[] = [];
  for (const run of runs) {
    // A reference with empty text is still a reference; only plain runs are
    // dropped for being empty.
    if (run.text === "" && run.ref === undefined) continue;
    const style = isEmptyStyle(run.style) ? undefined : run.style;
    const next: TextRun = {
      text: run.text,
      ...(style ? { style } : {}),
      ...(run.ref !== undefined ? { ref: run.ref } : {}),
    };
    const last = out[out.length - 1];
    if (last && mergeable(last, next)) {
      out[out.length - 1] = { text: last.text + next.text, ...(style ? { style } : {}) };
    } else {
      out.push(next);
    }
  }
  return out;
}

/**
 * The text as it would be written down.
 *
 * A reference comes back as `{name}` rather than the number it happens to be
 * showing, because that is what it *is*. Handing a caller the rendered value
 * would invite them to write it back as literal text, quietly severing the
 * link the reference existed to keep.
 */
export function plainText(runs: readonly TextRun[]): string {
  return runs
    .map((r) =>
      r.ref !== undefined
        ? `{${r.ref}}`
        : r.text.replace(/\{/g, "{{").replace(/\}/g, "}}"),
    )
    .join("");
}

/** The text as the reader sees it, with each reference already rendered. */
export function renderedText(runs: readonly TextRun[]): string {
  return runs.map((r) => r.text).join("");
}

export function runsFromText(text: string, style?: RegionStyle): TextRun[] {
  if (text === "") return [];
  const runs: TextRun[] = [];
  let at = 0;
  REFERENCE.lastIndex = 0;
  for (let m = REFERENCE.exec(text); m; m = REFERENCE.exec(text)) {
    if (m.index > at) {
      runs.push({ text: text.slice(at, m.index), ...(style ? { style } : {}) });
    }
    if (m[0] === "{{" || m[0] === "}}") {
      runs.push({ text: m[0][0] as string, ...(style ? { style } : {}) });
    } else {
      const name = (m[1] as string).trim();
      // The value is filled in when the sheet is computed; until then the run
      // shows its own source so the sentence is never blank.
      runs.push({ text: `{${name}}`, ref: name, ...(style ? { style } : {}) });
    }
    at = m.index + m[0].length;
  }
  if (at < text.length) {
    runs.push({ text: text.slice(at), ...(style ? { style } : {}) });
  }
  return normalize(runs);
}

/** Names a text region reads, for the dependency graph. */
export function textReads(runs: readonly TextRun[]): ReadonlySet<string> {
  const names = new Set<string>();
  for (const run of runs) if (run.ref !== undefined) names.add(run.ref);
  return names;
}

/**
 * Fills every reference with the value it names.
 *
 * `resolve` returns the formatted value, or undefined when the name is not
 * defined at this point in the sheet. An unresolved reference keeps its
 * `{name}` form: a sentence that silently loses a number is worse than one
 * that visibly still wants it.
 */
export function resolveReferences(
  runs: readonly TextRun[],
  resolve: (name: string) => string | undefined,
): TextRun[] {
  let changed = false;
  const out = runs.map((run) => {
    if (run.ref === undefined) return run;
    const shown = resolve(run.ref) ?? `{${run.ref}}`;
    if (shown === run.text) return run;
    changed = true;
    return { ...run, text: shown };
  });
  return changed ? out : (runs as TextRun[]);
}

export function textLength(runs: readonly TextRun[]): number {
  return runs.reduce((n, r) => n + r.text.length, 0);
}

/**
 * Merges `patch` into the style of characters in `[start, end)`.
 *
 * Merge, not replace: setting a colour on a range that is already bold must
 * leave it bold. Runs are split at the boundaries and the result renormalized.
 */
export function applyStyleToRange(
  runs: readonly TextRun[],
  start: number,
  end: number,
  patch: StylePatch,
): TextRun[] {
  const from = Math.max(0, Math.min(start, end));
  const to = Math.min(textLength(runs), Math.max(start, end));
  if (from >= to) return normalize(runs);

  const out: TextRun[] = [];
  let at = 0;

  for (const run of runs) {
    const runStart = at;
    const runEnd = at + run.text.length;
    at = runEnd;

    if (runEnd <= from || runStart >= to) {
      out.push(run);
      continue;
    }

    const headLen = Math.max(0, from - runStart);
    const tailStart = Math.max(0, to - runStart);

    if (headLen > 0) {
      out.push({ text: run.text.slice(0, headLen), ...(run.style ? { style: run.style } : {}) });
    }

    const middle = run.text.slice(headLen, tailStart);
    if (middle !== "") {
      const merged = mergeStyle(run.style, patch);
      out.push({ text: middle, ...(isEmptyStyle(merged) ? {} : { style: merged }) });
    }

    if (tailStart < run.text.length) {
      out.push({ text: run.text.slice(tailStart), ...(run.style ? { style: run.style } : {}) });
    }
  }

  return normalize(out);
}

/** The style shared by every character in a range, for showing toolbar state. */
export function styleOfRange(
  runs: readonly TextRun[],
  start: number,
  end: number,
): RegionStyle {
  const from = Math.max(0, Math.min(start, end));
  const to = Math.max(start, end);
  let common: RegionStyle | undefined;
  let at = 0;
  let seen = false;

  for (const run of runs) {
    const runStart = at;
    const runEnd = at + run.text.length;
    at = runEnd;
    if (runEnd <= from || runStart >= to) continue;

    const s = run.style ?? {};
    if (!seen) {
      common = { ...s };
      seen = true;
      continue;
    }
    const c = common ?? {};
    common = {
      ...(c.fontSize === s.fontSize && c.fontSize !== undefined ? { fontSize: c.fontSize } : {}),
      ...(c.color === s.color && c.color !== undefined ? { color: c.color } : {}),
      ...((c.bold ?? false) === (s.bold ?? false) && c.bold ? { bold: true } : {}),
      ...((c.italic ?? false) === (s.italic ?? false) && c.italic ? { italic: true } : {}),
    };
  }
  return common ?? {};
}

/** Replaces `[start, end)` with `text`, inheriting the style at the boundary. */
export function replaceRange(
  runs: readonly TextRun[],
  start: number,
  end: number,
  text: string,
): TextRun[] {
  const from = Math.max(0, Math.min(start, end));
  const to = Math.max(start, end);
  const whole = plainText(runs);
  const before = whole.slice(0, from);
  const after = whole.slice(to);

  // Style carried by the character just before the insertion point, which is
  // what every text editor does — typing at the end of a bold word stays bold.
  const inherited = from > 0 ? styleOfRange(runs, from - 1, from) : styleOfRange(runs, 0, 1);

  const head = sliceRuns(runs, 0, from);
  const tail = sliceRuns(runs, to, textLength(runs));
  const middle: TextRun[] =
    text === "" ? [] : [{ text, ...(isEmptyStyle(inherited) ? {} : { style: inherited })}];

  void before;
  void after;
  return normalize([...head, ...middle, ...tail]);
}

export function sliceRuns(
  runs: readonly TextRun[],
  start: number,
  end: number,
): TextRun[] {
  const out: TextRun[] = [];
  let at = 0;
  for (const run of runs) {
    const runStart = at;
    const runEnd = at + run.text.length;
    at = runEnd;
    if (runEnd <= start || runStart >= end) continue;
    const slice = run.text.slice(
      Math.max(0, start - runStart),
      Math.min(run.text.length, end - runStart),
    );
    if (slice !== "") out.push({ text: slice, ...(run.style ? { style: run.style } : {}) });
  }
  return normalize(out);
}
