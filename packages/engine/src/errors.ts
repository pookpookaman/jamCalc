/**
 * Every engine error is structured: a stable code, a source span, and
 * optionally a hint.
 *
 * This shape is not for humans first. Errors must be ones a machine
 * can act on — a CI log, and later an agent that has to fix its own mistake in
 * one turn. `{code, span, expected, found}` does that; a sentence does not.
 * The human-readable message is derived from the structure, never the reverse.
 */

export type ErrorCode =
  | "syntax"
  | "unknown_unit"
  | "unit_mismatch"
  | "undefined_name"
  | "not_a_function"
  | "wrong_arity"
  | "domain"
  | "non_integer_exponent"
  | "dimensioned_exponent"
  | "call_depth"
  | "not_callable"
  | "shape_mismatch"
  | "index_out_of_range";

export type Span = readonly [start: number, end: number];

export class CalcError extends Error {
  /**
   * @param message  What went wrong, in the reader's terms. Short.
   * @param detail   The technical specifics — dimensional algebra and the
   *                 like. Kept OUT of `message` on purpose: telling an
   *                 engineer that `m` and `kg·m·s^-2` do not add is a
   *                 restatement of the problem in a notation they did not
   *                 write. Knowing there is a clash, and where, is the whole
   *                 actionable content. Developer surfaces can show this.
   */
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly span: Span,
    readonly hint?: string,
    readonly detail?: string,
  ) {
    super(message);
    this.name = "CalcError";
  }

  /** Serialized form crossing the API boundary. */
  toJSON(): {
    code: ErrorCode;
    message: string;
    span: Span;
    hint?: string;
    detail?: string;
  } {
    return {
      code: this.code,
      message: this.message,
      span: this.span,
      ...(this.hint !== undefined ? { hint: this.hint } : {}),
      ...(this.detail !== undefined ? { detail: this.detail } : {}),
    };
  }
}

/**
 * Compile-time exhaustiveness guard.
 *
 * ADR-0001: TypeScript will not check `switch` exhaustiveness over the AST for
 * free. Every switch over a discriminated union in this package ends with
 * `default: return assertNever(node)`. A missing one is a review defect.
 */
export function assertNever(x: never): never {
  throw new Error(`unhandled variant: ${JSON.stringify(x)}`);
}
