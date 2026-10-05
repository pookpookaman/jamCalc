/**
 * Telling a subscript from everything else it might be inside.
 *
 * One level of subscript or superscript is all a calc sheet needs — `M_u`,
 * `f'_c`, `x^2`. Deeper is nearly always a slip, and a slip that is hard to
 * see and harder to climb out of. So the key toggles: in when you are out, out
 * when you are in.
 *
 * MathLive offers no way to ask what the caret's parent is, so the editor asks
 * a different question — what changes in the text when the caret steps out of
 * it? A script closes as `_{u}` or `^2`; a fraction closes as `\frac{a}{b}`.
 * That difference is this predicate, kept apart from the component so it can
 * be tested without a browser.
 */

/**
 * True when `prefix` ends with a completed subscript or superscript.
 *
 * MathLive drops the braces around a single character, so both `M_{u}` and
 * `x^2` have to count.
 */
export function endsInScript(prefix: string): boolean {
  return /[_^](\{[^{}]*\}|\\?[A-Za-z0-9]+)$/.test(prefix);
}
