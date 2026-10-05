/**
 * Pratt (precedence-climbing) parser.
 *
 * ADR-0003: there is no implicit multiplication. Juxtaposition is a syntax
 * error, with one exception that is not multiplication at all — a unit suffix
 * on a numeric literal (`2 kip`), parsed by `parseUnitSuffix` below.
 */

import type {
  BinaryOperator,
  Expr,
  Parameter,
  Statement,
  UnaryOperator,
} from "./ast.js";
import { CalcError, type Span } from "./errors.js";
import { tokenize, type Token } from "./lexer.js";
import { lookupUnit } from "./units/registry.js";
import { parseUnit } from "./units/parse.js";

/**
 * Higher binds tighter. `^` is right-associative; everything else is left.
 *
 * `..` sits at the bottom so `1..n+1` reads as `1..(n+1)`, which is what
 * anyone writing a range means.
 */
const PRECEDENCE: Record<string, number> = {
  "..": 1,
  "==": 2,
  "!=": 2,
  "<": 2,
  ">": 2,
  "<=": 2,
  ">=": 2,
  "+": 3,
  "-": 3,
  "*": 4,
  "/": 4,
  "^": 5,
};
const RIGHT_ASSOCIATIVE = new Set(["^"]);

class Parser {
  private pos = 0;

  constructor(
    private readonly tokens: readonly Token[],
    private readonly source: string,
  ) {}

  private peek(offset = 0): Token {
    const t = this.tokens[this.pos + offset];
    if (t) return t;
    // The token array always ends with eof, so this is unreachable in practice.
    return this.tokens[this.tokens.length - 1] as Token;
  }

  private next(): Token {
    const t = this.peek();
    if (t.kind !== "eof") this.pos++;
    return t;
  }

  private expect(kind: Token["kind"], what: string): Token {
    const t = this.peek();
    if (t.kind !== kind) {
      throw new CalcError(
        "syntax",
        `expected ${what}, found ${t.kind === "eof" ? "end of expression" : `\`${t.text}\``}`,
        t.span,
      );
    }
    return this.next();
  }

  // --- statements ---------------------------------------------------------

  parseStatement(): Statement {
    // `f(x, y) := expr` — a function definition. Detected by scanning ahead
    // for the whole shape, because `f(x)` on its own is a call and only the
    // trailing `:=` distinguishes the two.
    const params = this.tryParameterList();
    if (params) {
      const value = this.parseExpr(0);
      const display = this.parseDisplayMarker();
      this.expectEnd();
      return {
        kind: "definition",
        name: params.name,
        nameSpan: params.nameSpan,
        params: params.params,
        defineSpan: params.defineSpan,
        value,
        ...(display ? { showResult: true, displaySpan: display.span } : {}),
        ...(display?.unit !== undefined ? { displayUnit: display.unit } : {}),
        span: [params.nameSpan[0], display?.end ?? value.span[1]],
      };
    }

    // `name := expr`, optionally followed by `= unit?` to display inline.
    if (this.peek().kind === "identifier" && this.peek(1).kind === "define") {
      const nameTok = this.next();
      const defineTok = this.next(); // :=
      const value = this.parseExpr(0);
      const display = this.parseDisplayMarker();
      this.expectEnd();
      const end = display?.end ?? value.span[1];
      return {
        kind: "definition",
        name: nameTok.text,
        nameSpan: nameTok.span,
        defineSpan: defineTok.span,
        value,
        ...(display ? { showResult: true, displaySpan: display.span } : {}),
        ...(display?.unit !== undefined ? { displayUnit: display.unit } : {}),
        span: [nameTok.span[0], end],
      };
    }

    const expression = this.parseExpr(0);
    const display = this.parseDisplayMarker();
    this.expectEnd();

    const end = display?.end ?? expression.span[1];
    return {
      kind: "evaluation",
      expression,
      ...(display?.unit !== undefined ? { displayUnit: display.unit } : {}),
      ...(display ? { displaySpan: display.span } : {}),
      span: [expression.span[0], end],
    };
  }

  /**
   * Consumes `f(a, b) :=` if that is what comes next, otherwise consumes
   * nothing. Parameters must be plain names — a pattern like `f(2x)` is not a
   * definition, and treating it as one would silently swallow a typo.
   */
  private tryParameterList():
    | { name: string; nameSpan: Span; params: Parameter[]; defineSpan: Span }
    | undefined {
    const start = this.pos;
    const nameTok = this.peek();
    if (nameTok.kind !== "identifier" || this.peek(1).kind !== "lparen") return undefined;

    this.next(); // name
    this.next(); // (
    const params: Parameter[] = [];
    if (this.peek().kind !== "rparen") {
      for (;;) {
        const p = this.peek();
        if (p.kind !== "identifier") {
          this.pos = start;
          return undefined;
        }
        this.next();
        params.push({ name: p.text, span: p.span });
        if (this.peek().kind === "comma") {
          this.next();
          continue;
        }
        break;
      }
    }
    if (this.peek().kind !== "rparen") {
      this.pos = start;
      return undefined;
    }
    this.next(); // )
    if (this.peek().kind !== "define") {
      this.pos = start;
      return undefined;
    }
    const defineTok = this.next();
    return { name: nameTok.text, nameSpan: nameTok.span, params, defineSpan: defineTok.span };
  }

  /** Trailing `=` with an optional display unit. Shared by both statement
   * forms, so `a := 1+2 = ` and `a+b = kip` parse the same tail. */
  private parseDisplayMarker():
    | { end: number; span: Span; unit?: string }
    | undefined {
    if (this.peek().kind !== "equals") return undefined;
    const eq = this.next();
    const end: number = eq.span[1];

    if (this.peek().kind === "identifier") {
      const unitStart = this.peek().span[0];
      this.consumeUnitTerms();
      const consumedEnd = this.tokens[this.pos - 1]?.span[1];
      if (consumedEnd !== undefined && consumedEnd > unitStart) {
        const unit = this.source.slice(unitStart, consumedEnd);
        parseUnit(unit); // validate now, so the error carries a real span
        return { end: consumedEnd, span: [eq.span[0], consumedEnd], unit };
      }
    }
    return { end, span: eq.span };
  }

  /** Parses one expression and requires it to consume the whole source. */
  parseCompleteExpression(): Expr {
    const expr = this.parseExpr(0);
    this.expectEnd();
    return expr;
  }

  private expectEnd(): void {
    const t = this.peek();
    if (t.kind !== "eof") {
      throw new CalcError(
        "syntax",
        `unexpected \`${t.text}\` after end of expression`,
        t.span,
        t.kind === "identifier"
          ? "there is no implicit multiplication — write `*` explicitly (ADR-0003)"
          : undefined,
      );
    }
  }

  // --- expressions --------------------------------------------------------

  parseExpr(minPrecedence: number): Expr {
    let left = this.parseUnary();

    for (;;) {
      const t = this.peek();
      if (t.kind !== "operator") break;
      const prec = PRECEDENCE[t.text];
      if (prec === undefined || prec < minPrecedence) break;

      this.next();
      const nextMin = RIGHT_ASSOCIATIVE.has(t.text) ? prec : prec + 1;
      const right = this.parseExpr(nextMin);
      left = {
        kind: "binary",
        operator: t.text as BinaryOperator,
        operatorSpan: t.span,
        left,
        right,
        span: [left.span[0], right.span[1]],
      };
    }

    return left;
  }

  private parseUnary(): Expr {
    const t = this.peek();
    if (t.kind === "operator" && (t.text === "-" || t.text === "+")) {
      this.next();
      // Unary binds tighter than binary +/- but looser than ^: -x^2 = -(x^2).
      const operand = this.parseExpr(PRECEDENCE["^"] as number);
      return {
        kind: "unary",
        operator: t.text as UnaryOperator,
        operatorSpan: t.span,
        operand,
        span: [t.span[0], operand.span[1]],
      };
    }
    return this.parsePrimary();
  }

  private parsePrimary(): Expr {
    return this.parseIndexed(this.parseAtom());
  }

  /** Postfix `[...]` binds tighter than anything else. */
  private parseIndexed(target: Expr): Expr {
    let out = target;
    while (this.peek().kind === "lbracket") {
      this.next();
      const indices: Expr[] = [this.parseExpr(0)];
      while (this.peek().kind === "comma") {
        this.next();
        indices.push(this.parseExpr(0));
      }
      const close = this.expect("rbracket", "`]`");
      out = { kind: "index", target: out, indices, span: [out.span[0], close.span[1]] };
    }
    return out;
  }

  private parseAtom(): Expr {
    const t = this.peek();

    // A `[` here starts a literal; after a value it would be an index, which
    // parseIndexed handles.
    if (t.kind === "lbracket") {
      this.next();
      const rows: Expr[][] = [];
      let row: Expr[] = [];
      if (this.peek().kind !== "rbracket") {
        for (;;) {
          row.push(this.parseExpr(0));
          if (this.peek().kind === "comma") {
            this.next();
            continue;
          }
          if (this.peek().kind === "semicolon") {
            this.next();
            rows.push(row);
            row = [];
            continue;
          }
          break;
        }
        rows.push(row);
      }
      const close = this.expect("rbracket", "`]`");
      const width = rows[0]?.length ?? 0;
      if (rows.some((r) => r.length !== width)) {
        throw new CalcError(
          "syntax",
          "every row of a matrix must have the same number of values",
          [t.span[0], close.span[1]],
        );
      }
      return { kind: "matrix", rows, span: [t.span[0], close.span[1]] };
    }

    if (t.kind === "number") {
      this.next();
      const unit = this.parseUnitSuffix();
      const end = unit === undefined ? t.span[1] : unit.span[1];
      return unit === undefined
        ? { kind: "number", value: t.value as number, span: [t.span[0], end] }
        : {
            kind: "number",
            value: t.value as number,
            unit: unit.text,
            span: [t.span[0], end],
          };
    }

    if (t.kind === "identifier") {
      this.next();
      if (this.peek().kind === "lparen") {
        this.next();
        const args: Expr[] = [];
        if (this.peek().kind !== "rparen") {
          args.push(this.parseExpr(0));
          while (this.peek().kind === "comma") {
            this.next();
            args.push(this.parseExpr(0));
          }
        }
        const close = this.expect("rparen", "`)`");
        return {
          kind: "call",
          callee: t.text,
          calleeSpan: t.span,
          args,
          span: [t.span[0], close.span[1]],
        };
      }
      return { kind: "identifier", name: t.text, span: t.span };
    }

    if (t.kind === "lparen") {
      this.next();
      const inner = this.parseExpr(0);
      this.expect("rparen", "`)`");
      return inner;
    }

    throw new CalcError(
      "syntax",
      `expected a value, found ${t.kind === "eof" ? "end of expression" : `\`${t.text}\``}`,
      t.span,
    );
  }

  /**
   * ADR-0003: a unit suffix binds to a numeric literal and nothing else.
   *
   * Consumes terms greedily but ONLY while every term is a known unit, so
   * `2 kip/L` stops at `L` and hands `/L` back to the expression parser.
   * That lookahead is why this cannot simply call `parseUnit` on a slice.
   */
  private parseUnitSuffix(): { text: string; span: Span } | undefined {
    const first = this.peek();
    if (first.kind !== "identifier" || !lookupUnit(first.text)) return undefined;

    const start = first.span[0];
    this.consumeUnitTerms();
    const end = this.tokens[this.pos - 1]?.span[1] ?? start;
    const text = this.source.slice(start, end);
    parseUnit(text); // rejects affine units and bad exponents, with a real span
    return { text, span: [start, end] };
  }

  /** Shared by unit suffixes and display units after `=`. */
  private consumeUnitTerms(): void {
    for (;;) {
      const name = this.peek();
      if (name.kind !== "identifier" || !lookupUnit(name.text)) return;
      this.next();

      if (this.peek().kind === "operator" && this.peek().text === "^") {
        // `kip^2` — but only if an integer follows; otherwise leave the `^`.
        const exponent = this.peek(1);
        const signed =
          exponent.kind === "operator" &&
          (exponent.text === "-" || exponent.text === "+");
        const numTok = signed ? this.peek(2) : exponent;
        if (numTok.kind !== "number" || !Number.isInteger(numTok.value)) return;
        this.next(); // ^
        if (signed) this.next();
        this.next(); // number
      }

      const op = this.peek();
      const following = this.peek(1);
      const continues =
        op.kind === "operator" &&
        (op.text === "*" || op.text === "/") &&
        following.kind === "identifier" &&
        lookupUnit(following.text) !== undefined;
      if (!continues) return;
      this.next(); // * or /
    }
  }
}

export function parseExpression(source: string): Expr {
  return new Parser(tokenize(source), source).parseCompleteExpression();
}

export function parseStatement(source: string): Statement {
  return new Parser(tokenize(source), source).parseStatement();
}
