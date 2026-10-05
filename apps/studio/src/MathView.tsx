/**
 * Renders a parsed statement as notation, with an optional caret drawn INSIDE
 * the notation.
 *
 * The editing model: the source string stays the truth, and a transparent
 * input laid over the region owns the keystrokes and the selection. On every
 * keystroke we re-parse and re-render, placing the caret at the atom whose
 * source span contains the cursor. So typing in a numerator visibly types in
 * the numerator, with no structured-editing model underneath.
 *
 * This is not MathLive. It is the cheapest thing that gives in-place editing
 * on the real rendering, and it stays honest: if the source stops parsing
 * mid-edit the region falls back to plain text rather than pretending to a
 * structure that is not there.
 */

import type { JSX } from "react";
import {
  splitName,
  type Expr,
  type ResultParts,
  type Span,
  type Statement,
} from "@jamcalc/engine";

/** Mirrors the parser's table; used to decide when parentheses are needed. */
const PRECEDENCE: Record<string, number> = {
  "..": 1,
  "==": 2, "!=": 2, "<": 2, ">": 2, "<=": 2, ">=": 2,
  "+": 3, "-": 3,
  "*": 4, "/": 4,
  "^": 5,
};

const OPERATOR_GLYPH: Record<string, string> = {
  "*": "·", "<=": "≤", ">=": "≥", "!=": "≠", "==": "=", "..": "‥",
};

/**
 * Where the caret goes, decided BEFORE rendering.
 *
 * The obvious implementation — a cursor object that marks itself "placed" as
 * atoms render — is broken, and instructively so. React may invoke a component
 * more than once per commit (StrictMode does it in development, concurrent
 * rendering does it in production). The first invocation consumed the
 * placement and the second, which is the one committed, drew nothing. Render
 * has to be pure; mutating shared state during it is a bug even when it
 * appears to work.
 *
 * So the atom order is walked up front, the target is resolved once, and each
 * atom then only compares its own span against an immutable answer.
 */
export interface CaretTarget {
  readonly span: Span | null; // null means "after everything"
  readonly side: "before" | "after";
}

/** Atom spans in the order they are rendered, which is source order. */
function atomSpans(node: Expr, into: Span[]): void {
  switch (node.kind) {
    case "number":
    case "identifier":
      into.push(node.span);
      return;
    case "unary":
      into.push(node.operatorSpan);
      atomSpans(node.operand, into);
      return;
    case "binary":
      atomSpans(node.left, into);
      if (node.operator !== "/" && node.operator !== "^") {
        into.push(node.operatorSpan);
      }
      atomSpans(node.right, into);
      return;
    case "call":
      into.push(node.calleeSpan);
      for (const a of node.args) atomSpans(a, into);
      return;
    case "matrix":
      for (const row of node.rows) for (const cell of row) atomSpans(cell, into);
      return;
    case "index":
      atomSpans(node.target, into);
      for (const i of node.indices) atomSpans(i, into);
      return;
    default:
      return;
  }
}

function statementAtomSpans(statement: Statement): Span[] {
  const spans: Span[] = [];
  if (statement.kind === "definition") {
    spans.push(statement.nameSpan);
    for (const p of statement.params ?? []) spans.push(p.span);
    spans.push(statement.defineSpan);
    atomSpans(statement.value, spans);
    if (statement.showResult && statement.displaySpan) spans.push(statement.displaySpan);
  } else {
    atomSpans(statement.expression, spans);
    if (statement.displaySpan) spans.push(statement.displaySpan);
  }
  return spans;
}

function resolveCaret(statement: Statement, at: number | null): CaretTarget | null {
  if (at === null) return null;
  for (const span of statementAtomSpans(statement)) {
    if (at <= span[0]) return { span, side: "before" };
    if (at <= span[1]) return { span, side: "after" };
  }
  return { span: null, side: "after" };
}

const sameSpan = (a: Span, b: Span): boolean => a[0] === b[0] && a[1] === b[1];

/** Immutable render context. */
interface Ctx {
  readonly target: CaretTarget | null;
  readonly onPick?: ((offset: number) => void) | undefined;
}

function Caret(): JSX.Element {
  return <span className="mv-caret" aria-hidden="true" />;
}

/** Wraps one atom, drawing the caret on whichever side the cursor falls. */
function Atom({
  span,
  cursor,
  children,
}: {
  span: Span;
  cursor: Ctx;
  children: JSX.Element | string;
}): JSX.Element {
  const t = cursor.target;
  const side = t && t.span && sameSpan(t.span, span) ? t.side : null;
  const pick = cursor.onPick;
  return (
    <span
      className="mv-atom"
      onMouseDown={
        pick === undefined
          ? undefined
          : (e) => {
              // preventDefault keeps focus on the hidden input; without it the
              // click blurs the editor and the edit ends on every click.
              e.preventDefault();
              e.stopPropagation();
              const box = (e.currentTarget as HTMLElement).getBoundingClientRect();
              const nearStart = e.clientX - box.left < box.width / 2;
              pick(nearStart ? span[0] : span[1]);
            }
      }
    >
      {side === "before" ? <Caret /> : null}
      {children}
      {side === "after" ? <Caret /> : null}
    </span>
  );
}

/** Whether an index can be drawn as a subscript without being misread. */
function indexAsSubscript(target: Expr): boolean {
  return target.kind === "identifier" && splitName(target.name).subscript === undefined;
}

export function Name({ name }: { name: string }): JSX.Element {
  const { base, primes, subscript } = splitName(name);
  return (
    <span className="mv-name">
      <i>{base}</i>
      {primes ? <span className="mv-prime">{"′".repeat(primes.length)}</span> : null}
      {subscript !== undefined ? <sub>{subscript}</sub> : null}
    </span>
  );
}

/** `kip*ft` -> kip·ft, `in^3` -> in with a superscript 3. */
export function Unit({ unit }: { unit: string }): JSX.Element {
  const parts = unit.split(/([*/·])/);
  return (
    <span className="mv-unit">
      {parts.map((part, i) => {
        if (part === "*" || part === "·") return <span key={i}>{"·"}</span>;
        if (part === "/") return <span key={i}>/</span>;
        const [name, exp] = part.split("^");
        return (
          <span key={i}>
            {name}
            {exp ? <sup>{exp}</sup> : null}
          </span>
        );
      })}
    </span>
  );
}

/**
 * Whether an expression draws taller than a line of text.
 *
 * A superscript or a bracket sized for text looks right beside `x` and wrong
 * beside a fraction, where text height is only the bottom half of what it
 * belongs to. So powers and brackets lay themselves out by what they wrap.
 * An exponent does not make its base tall: it is drawn small.
 */
export function isTall(node: Expr): boolean {
  switch (node.kind) {
    case "binary":
      if (node.operator === "/") return true;
      if (node.operator === "^") return isTall(node.left);
      return isTall(node.left) || isTall(node.right);
    case "unary":
      return isTall(node.operand);
    case "call":
      return node.args.some(isTall);
    case "matrix":
      return node.rows.length > 1 || node.rows.some((row) => row.some(isTall));
    case "index":
      return isTall(node.target);
    default:
      return false;
  }
}

function needsParens(node: Expr, parentPrecedence: number, powerBase: boolean): boolean {
  if (node.kind !== "binary") return false;
  // A fraction draws its own grouping — except as the base of a power, where
  // without brackets the exponent reads as belonging to part of it.
  if (node.operator === "/") return powerBase;
  return (PRECEDENCE[node.operator] ?? 99) < parentPrecedence;
}

/** One half of a bracket, drawn the way the radical is. */
function StretchyParen({ side }: { side: "left" | "right" }): JSX.Element {
  return (
    <span className="mv-stretch" aria-hidden="true">
      <svg viewBox="0 0 6 24" preserveAspectRatio="none">
        <path
          d={side === "left" ? "M5,0.5 Q0.5,12 5,23.5" : "M1,0.5 Q5.5,12 1,23.5"}
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    </span>
  );
}

function Wrapped({
  node,
  parentPrecedence,
  cursor,
  powerBase = false,
}: {
  node: Expr;
  parentPrecedence: number;
  cursor: Ctx;
  powerBase?: boolean;
}): JSX.Element {
  const inner = <ExprView node={node} cursor={cursor} />;
  return needsParens(node, parentPrecedence, powerBase) ? <Parens>{inner}</Parens> : inner;
}

/**
 * Brackets that grow with what they hold.
 *
 * Drawn rather than typed, because a typed `(` is one size whatever it wraps:
 * beside a fraction it covers half of what it is meant to enclose, which is
 * the same reason the fraction bar is drawn rather than typed. Every bracket
 * on a sheet comes from here — grouping, and the arguments of a call.
 */
function Parens({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <span className="mv-group">
      <StretchyParen side="left" />
      <span className="mv-group-body">{children}</span>
      <StretchyParen side="right" />
    </span>
  );
}

export function ExprView({
  node,
  cursor,
}: {
  node: Expr;
  cursor: Ctx;
}): JSX.Element {
  switch (node.kind) {
    case "number":
      return (
        <Atom span={node.span} cursor={cursor}>
          <span className="mv-num">
            {String(node.value)}
            {node.unit !== undefined ? (
              <>
                <span className="mv-thin"> </span>
                <Unit unit={node.unit} />
              </>
            ) : null}
          </span>
        </Atom>
      );

    case "identifier":
      return (
        <Atom span={node.span} cursor={cursor}>
          <Name name={node.name} />
        </Atom>
      );

    case "unary":
      return (
        <span>
          <Atom span={node.operatorSpan} cursor={cursor}>
            {node.operator === "-" ? "−" : "+"}
          </Atom>
          <Wrapped
            node={node.operand}
            parentPrecedence={PRECEDENCE["^"] as number}
            cursor={cursor}
          />
        </span>
      );

    case "binary": {
      if (node.operator === "/") {
        // A real fraction. The single biggest visual difference between
        // "looks like a calc sheet" and "looks like a REPL".
        return (
          <span className="mv-frac">
            <span className="mv-num-part">
              <ExprView node={node.left} cursor={cursor} />
            </span>
            <span className="mv-den-part">
              <ExprView node={node.right} cursor={cursor} />
            </span>
          </span>
        );
      }
      if (node.operator === "^") {
        const exponent = (
          <sup className="mv-exp">
            <ExprView node={node.right} cursor={cursor} />
          </sup>
        );
        if (!isTall(node.left)) {
          return (
            <span>
              <Wrapped node={node.left} parentPrecedence={5} cursor={cursor} powerBase />
              {exponent}
            </span>
          );
        }
        // Beside something taller than a line, the exponent goes to its top.
        // At text height it would sit beside the denominator and read as
        // belonging to it.
        return (
          <span className="mv-pow-tall">
            <span className="mv-pow-base">
              <Wrapped node={node.left} parentPrecedence={5} cursor={cursor} powerBase />
            </span>
            {exponent}
          </span>
        );
      }
      const prec = PRECEDENCE[node.operator] as number;
      const glyph = OPERATOR_GLYPH[node.operator] ?? node.operator;
      return (
        <span>
          <Wrapped node={node.left} parentPrecedence={prec} cursor={cursor} />
          <Atom span={node.operatorSpan} cursor={cursor}>
            <span className={prec <= 2 ? "mv-op" : "mv-op-tight"}>{glyph}</span>
          </Atom>
          {/* right side binds one tighter so `a-(b-c)` keeps its parens */}
          <Wrapped node={node.right} parentPrecedence={prec + 1} cursor={cursor} />
        </span>
      );
    }

    case "matrix":
      // Drawn with real brackets that grow with the content — a matrix
      // written as `[1, 2; 3, 4]` on paper is not a matrix, it is source.
      return (
        <span className="mv-matrix">
          <span className="mv-bracket mv-bracket-l" />
          <span className="mv-grid">
            {node.rows.map((row, r) => (
              <span className="mv-row" key={r}>
                {row.map((cell, c) => (
                  <span className="mv-cell" key={c}>
                    <ExprView node={cell} cursor={cursor} />
                  </span>
                ))}
              </span>
            ))}
          </span>
          <span className="mv-bracket mv-bracket-r" />
        </span>
      );

    case "index": {
      const indices = node.indices.map((i, n) => (
        <span key={n}>
          {n > 0 ? <span className="mv-op-tight">,</span> : null}
          <ExprView node={i} cursor={cursor} />
        </span>
      ));
      // `x[i]` reads naturally as x with subscript i. `w_t[row]` does not: the
      // index ran on from the name's own subscript and printed as w with
      // subscript "trow", which a checker cannot tell from a name. Once the
      // target has a subscript of its own — or is not a plain name at all —
      // the index keeps the brackets it was typed with.
      return indexAsSubscript(node.target) ? (
        <span>
          <ExprView node={node.target} cursor={cursor} />
          <sub className="mv-index">{indices}</sub>
        </span>
      ) : (
        <span>
          <ExprView node={node.target} cursor={cursor} />
          <span className="mv-index-bracket">[</span>
          {indices}
          <span className="mv-index-bracket">]</span>
        </span>
      );
    }

    case "call":
      if (node.callee === "sqrt" && node.args.length === 1) {
        // A radical rather than a function name. The bar over the radicand is
        // what shows how much of the expression sits under the root, so it is
        // the top border of the radicand itself and always spans all of it.
        return (
          <span className="mv-sqrt">
            <Atom span={node.calleeSpan} cursor={cursor}>
              <svg
                className="mv-radical"
                viewBox="0 0 10 20"
                preserveAspectRatio="none"
                role="img"
                aria-label="square root"
              >
                <polyline points="0,12 2.5,10.5 5.5,19.5 10,0.5" vectorEffect="non-scaling-stroke" />
              </svg>
            </Atom>
            <span className="mv-radicand">
              <ExprView node={node.args[0] as Expr} cursor={cursor} />
            </span>
          </span>
        );
      }
      return (
        <span className="mv-call">
          <Atom span={node.calleeSpan} cursor={cursor}>
            <span className="mv-fn">{node.callee}</span>
          </Atom>
          <Parens>
            {node.args.map((a, i) => (
              <span key={i}>
                {i > 0 ? <span className="mv-op">,</span> : null}
                <ExprView node={a} cursor={cursor} />
              </span>
            ))}
          </Parens>
        </span>
      );

    default:
      return <span />;
  }
}

function Result({ parts }: { parts: ResultParts | undefined }): JSX.Element | null {
  if (!parts || parts.text === "") return null;
  return (
    <span className="mv-result">
      {parts.text}
      {parts.unit !== undefined ? (
        <>
          <span className="mv-thin"> </span>
          <Unit unit={parts.unit} />
        </>
      ) : null}
    </span>
  );
}

export function StatementView({
  statement,
  result,
  caret = null,
  onPick,
}: {
  statement: Statement;
  result?: ResultParts | undefined;
  /** Cursor offset into the region source, or null when not editing. */
  caret?: number | null;
  onPick?: ((offset: number) => void) | undefined;
}): JSX.Element {
  const cursor: Ctx = { target: resolveCaret(statement, caret), onPick };

  const tail = (
    <>
      {statement.displaySpan !== undefined ? (
        <Atom span={statement.displaySpan} cursor={cursor}>
          <span className="mv-op">=</span>
        </Atom>
      ) : null}
      <Result parts={result} />
    </>
  );

  if (statement.kind === "definition") {
    return (
      <span className="mv">
        <Atom span={statement.nameSpan} cursor={cursor}>
          <Name name={statement.name} />
        </Atom>
        {statement.params ? (
          <span className="mv-params">
            <Parens>
              {statement.params.map((p, i) => (
                <span key={p.name}>
                  {i > 0 ? <span className="mv-op">,</span> : null}
                  <Atom span={p.span} cursor={cursor}>
                    <Name name={p.name} />
                  </Atom>
                </span>
              ))}
            </Parens>
          </span>
        ) : null}
        <Atom span={statement.defineSpan} cursor={cursor}>
          <span className="mv-assign">:=</span>
        </Atom>
        <ExprView node={statement.value} cursor={cursor} />
        {statement.showResult ? tail : null}
        <TrailingCaret cursor={cursor} />
      </span>
    );
  }
  return (
    <span className="mv">
      <ExprView node={statement.expression} cursor={cursor} />
      {tail}
      <TrailingCaret cursor={cursor} />
    </span>
  );
}

/** Catches a caret past the last atom — typing at the end of the line. */
function TrailingCaret({ cursor }: { cursor: Ctx }): JSX.Element | null {
  return cursor.target && cursor.target.span === null ? <Caret /> : null;
}
