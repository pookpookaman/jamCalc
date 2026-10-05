/**
 * Expression AST.
 *
 * Every node carries a span, because errors must point
 * at a subexpression rather than a whole region. Spans are indices into the
 * source string the node was parsed from.
 */

import type { Span } from "./errors.js";

export interface NodeBase {
  readonly span: Span;
}

/**
 * A number with an optional unit suffix. ADR-0003: the suffix is part of the
 * literal, not a multiplication — `unit` holds the source text of the unit
 * expression (`"kip*ft"`), so it re-serializes exactly as written.
 */
export interface NumberLiteral extends NodeBase {
  readonly kind: "number";
  readonly value: number;
  readonly unit?: string;
}

export interface Identifier extends NodeBase {
  readonly kind: "identifier";
  readonly name: string;
}

export type UnaryOperator = "-" | "+";

export interface UnaryExpr extends NodeBase {
  readonly kind: "unary";
  readonly operator: UnaryOperator;
  readonly operatorSpan: Span;
  readonly operand: Expr;
}

export type BinaryOperator =
  | ".."
  | "+"
  | "-"
  | "*"
  | "/"
  | "^"
  | "<"
  | ">"
  | "<="
  | ">="
  | "=="
  | "!=";

export interface BinaryExpr extends NodeBase {
  readonly kind: "binary";
  readonly operator: BinaryOperator;
  /**
   * Where the operator sits in the source.
   *
   * Needed so an editor can map a caret offset onto the rendered notation —
   * without it, a cursor between `a` and `+` lands in a gap that belongs to no
   * node, and the caret cannot be drawn.
   */
  readonly operatorSpan: Span;
  readonly left: Expr;
  readonly right: Expr;
}

export interface CallExpr extends NodeBase {
  readonly kind: "call";
  readonly callee: string;
  readonly args: readonly Expr[];
  /** Span of the callee name alone, for "unknown function" errors. */
  readonly calleeSpan: Span;
}

/** `[1, 2; 3, 4]` — rows separated by `;`, cells by `,`. */
export interface MatrixLiteral extends NodeBase {
  readonly kind: "matrix";
  readonly rows: readonly (readonly Expr[])[];
}

/**
 * `v[2]` or `M[2, 3]`.
 *
 * Brackets rather than a subscript, because a subscript is already part of a
 * name (`M_u`) and ADR-0003 keeps those unambiguous.
 */
export interface IndexExpr extends NodeBase {
  readonly kind: "index";
  readonly target: Expr;
  readonly indices: readonly Expr[];
}

export type Expr =
  | NumberLiteral
  | Identifier
  | UnaryExpr
  | BinaryExpr
  | CallExpr
  | MatrixLiteral
  | IndexExpr;

/**
 * A statement is what one math region holds.
 *
 * `:=` defines, `=` evaluates and displays. This distinction
 * is the ergonomic core of the whole tool, so it is modelled at the top of the
 * AST rather than inferred later.
 */
/** One formal parameter of a user-defined function. */
export interface Parameter {
  readonly name: string;
  readonly span: Span;
}

export interface Definition extends NodeBase {
  readonly kind: "definition";
  readonly name: string;
  readonly nameSpan: Span;
  /**
   * Present when the definition is a function: `f(x, y) := ...`.
   *
   * Modelled as an optional part of a definition rather than a separate
   * statement kind, because that is what it is — a name bound to something —
   * and it keeps one rule for how names resolve positionally.
   */
  readonly params?: readonly Parameter[];
  readonly value: Expr;
  /** Where `:=` sits, for caret mapping. */
  readonly defineSpan: Span;
  /**
   * `M_u := w*L^2/8 = kip*ft` — define and show the result on one line.
   *
   * The conventional worksheet model forces a second region to see what you
   * just defined, which is why real sheets are full of paired regions. Folding
   * the display into the definition is the single highest-value departure.
   */
  readonly showResult?: boolean;
  /** Display unit chosen by the user, e.g. `kip*ft`. Presentation only. */
  readonly displayUnit?: string;
  /** Where the trailing `=` and its unit sit. */
  readonly displaySpan?: Span;
}

export interface Evaluation extends NodeBase {
  readonly kind: "evaluation";
  readonly expression: Expr;
  readonly displayUnit?: string;
  readonly displaySpan?: Span;
}

export type Statement = Definition | Evaluation;
