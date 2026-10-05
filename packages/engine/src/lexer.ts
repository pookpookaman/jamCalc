/**
 * Tokenizer.
 *
 * Identifiers deliberately allow what engineers actually write: Greek letters
 * (`phi`, `α`), underscores for subscripts (`M_u`), primes (`f'_c`), and a backtick before a
 * word that is to be kept as written (`` `phi ``).
 * Names in a calc sheet are notation, not code identifiers,
 * and forcing ASCII on them is how a tool starts feeling wrong.
 */

import { CalcError, type Span } from "./errors.js";

export type TokenKind =
  | "number"
  | "identifier"
  | "operator"
  | "lparen"
  | "rparen"
  | "lbracket"
  | "rbracket"
  | "comma"
  | "semicolon"
  | "define" // :=
  | "equals" // =  (evaluation marker, never assignment)
  | "eof";

export interface Token {
  readonly kind: TokenKind;
  readonly text: string;
  readonly span: Span;
  /** Present only for `number`. */
  readonly value?: number;
}

const GREEK = "\\u0391-\\u03A9\\u03B1-\\u03C9";
export const IDENT_START = new RegExp("[A-Za-z_`" + GREEK + "]");
export const IDENT_PART = new RegExp("[A-Za-z0-9_'`" + GREEK + "]");
const DIGIT = /[0-9]/;
const LETTER = new RegExp("[A-Za-z" + GREEK + "]");

/**
 * Where a backtick in a name is out of place, or -1 if none is.
 *
 * A backtick keeps the word after it as written, so `` `phi `` is the word
 * "phi" rather than the letter φ (ADR-0015). It marks a whole word, so it
 * belongs at the start of the name or straight after an underscore, and a
 * letter must follow it. Anywhere else it marks nothing, and a name nobody
 * could reliably type twice the same way is refused rather than accepted.
 */
export function misplacedLiteralMark(name: string): number {
  for (let k = 0; k < name.length; k++) {
    if (name[k] !== "`") continue;
    const atWordStart = k === 0 || name[k - 1] === "_";
    if (!atWordStart || !LETTER.test(name[k + 1] ?? "")) return k;
  }
  return -1;
}

/** Multi-character operators must be tried before their single-char prefixes. */
const OPERATORS = ["<=", ">=", "==", "!=", "..", "+", "-", "*", "·", "/", "^", "<", ">"];

export function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  const peek = (offset = 0): string => source[i + offset] ?? "";

  while (i < source.length) {
    const ch = peek();

    if (/\s/.test(ch)) {
      i++;
      continue;
    }

    // --- numbers: 123, 1.5, 2.4e-3 ---
    if (DIGIT.test(ch) || (ch === "." && DIGIT.test(peek(1)))) {
      const start = i;
      while (DIGIT.test(peek())) i++;
      if (peek() === "." && DIGIT.test(peek(1))) {
        i++;
        while (DIGIT.test(peek())) i++;
      }
      if (peek() === "e" || peek() === "E") {
        const save = i;
        i++;
        if (peek() === "+" || peek() === "-") i++;
        if (DIGIT.test(peek())) {
          while (DIGIT.test(peek())) i++;
        } else {
          i = save; // `2e` is the number 2 followed by the identifier `e`
        }
      }
      const text = source.slice(start, i);
      tokens.push({
        kind: "number",
        text,
        span: [start, i],
        value: Number.parseFloat(text),
      });
      continue;
    }

    // --- identifiers ---
    if (IDENT_START.test(ch)) {
      const start = i;
      i++;
      while (i < source.length && IDENT_PART.test(peek())) i++;
      const text = source.slice(start, i);
      const misplaced = misplacedLiteralMark(text);
      if (misplaced >= 0) {
        throw new CalcError(
          "syntax",
          "a backtick goes directly before a word to keep it as written, as in `phi or M_`beta",
          [start + misplaced, start + misplaced + 1],
        );
      }
      tokens.push({
        kind: "identifier",
        text,
        span: [start, i],
      });
      continue;
    }

    // --- := before = ---
    if (ch === ":" && peek(1) === "=") {
      tokens.push({ kind: "define", text: ":=", span: [i, i + 2] });
      i += 2;
      continue;
    }

    if (ch === "(") {
      tokens.push({ kind: "lparen", text: "(", span: [i, i + 1] });
      i++;
      continue;
    }
    if (ch === ")") {
      tokens.push({ kind: "rparen", text: ")", span: [i, i + 1] });
      i++;
      continue;
    }
    if (ch === ",") {
      tokens.push({ kind: "comma", text: ",", span: [i, i + 1] });
      i++;
      continue;
    }
    if (ch === "[") {
      tokens.push({ kind: "lbracket", text: "[", span: [i, i + 1] });
      i++;
      continue;
    }
    if (ch === "]") {
      tokens.push({ kind: "rbracket", text: "]", span: [i, i + 1] });
      i++;
      continue;
    }
    if (ch === ";") {
      tokens.push({ kind: "semicolon", text: ";", span: [i, i + 1] });
      i++;
      continue;
    }

    const op = OPERATORS.find((o) => source.startsWith(o, i));
    if (op) {
      tokens.push({
        kind: "operator",
        // `·` and `*` are the same operator; normalize so the parser sees one.
        text: op === "·" ? "*" : op,
        span: [i, i + op.length],
      });
      i += op.length;
      continue;
    }

    if (ch === "=") {
      tokens.push({ kind: "equals", text: "=", span: [i, i + 1] });
      i++;
      continue;
    }

    throw new CalcError("syntax", `unexpected character \`${ch}\``, [i, i + 1]);
  }

  tokens.push({ kind: "eof", text: "", span: [source.length, source.length] });
  return tokens;
}
