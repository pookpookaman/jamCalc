/**
 * Tree-walking evaluator over Quantity.
 *
 * No optimization here on purpose. Region-level incremental recompute
 * happens above this layer, on the dependency graph; making the
 * expression evaluator clever would buy nothing and cost clarity.
 */

import type { CallExpr, Expr, IndexExpr, Statement } from "./ast.js";
import { assertNever, CalcError, type Span } from "./errors.js";
import { Quantity, UnitMismatchError } from "./quantity.js";
import { Dimension } from "./dimension.js";
import { differentiate, findRoot, integrate } from "./solve.js";
import { Rational } from "./rational.js";
import { quantityFrom, valueIn } from "./units/parse.js";
import { MatrixValue } from "./matrix.js";
import * as V from "./value.js";
import type { Value } from "./value.js";

/**
 * A name is bound to either a value or a function — one namespace, as in the
 * sheets this imitates. Two namespaces would let `x` and `x(t)` coexist, and
 * then positional redefinition would have to be explained twice.
 */
export type Binding =
  | { readonly kind: "value"; readonly value: Value }
  | { readonly kind: "function"; readonly fn: UserFunction };

export interface UserFunction {
  readonly params: readonly string[];
  readonly body: Expr;
  /** Names visible where the function was defined. */
  readonly closure: Environment;
}

export type Environment = Map<string, Binding>;

export const valueBinding = (value: Value): Binding => ({ kind: "value", value });

/** Convenience for callers that only deal in values. */
export function setValue(env: Environment, name: string, value: Value): void {
  env.set(name, valueBinding(value));
}

export function getValue(env: Environment, name: string): Value | undefined {
  const b = env.get(name);
  return b?.kind === "value" ? b.value : undefined;
}

/**
 * `phi` and `` `phi `` are different names (ADR-0015), and that is easy to
 * forget one region later. When the other spelling is defined, the message
 * names it rather than leaving the user to work out why a visible definition
 * does not count.
 */
function quoteName(name: string): string {
  return name.includes("`") ? "“" + name + "”" : "`" + name + "`";
}

/** The same name with or without backticks, if one is defined. */
function otherSpelling(name: string, env: Environment): string | undefined {
  const unmarked = (n: string): string => n.split("`").join("");
  for (const other of env.keys()) {
    if (other !== name && unmarked(other) === unmarked(name)) return other;
  }
  return undefined;
}

function withOtherSpelling(message: string, name: string, env: Environment): string {
  const other = otherSpelling(name, env);
  return other === undefined ? message : message + "; did you mean " + quoteName(other) + "?";
}

function undefinedMessage(name: string, env: Environment): string {
  return withOtherSpelling(quoteName(name) + " is not defined", name, env);
}

function notAFunctionMessage(name: string, env: Environment): string {
  return withOtherSpelling(quoteName(name) + " is not a function", name, env);
}

/**
 * Recursion is allowed but bounded. A sheet is a document, and a runaway
 * recursive definition should report itself rather than take down the tab.
 */
const MAX_CALL_DEPTH = 128;

export interface BuiltinFunction {
  readonly arity: number | "variadic";
  readonly apply: (args: readonly Value[], span: Span) => Value;
}

/** Lifts a scalar function so it also applies cell-by-cell to a matrix. */
function elementwise(
  name: string,
  fn: (q: Quantity, span: Span) => Quantity,
): BuiltinFunction {
  return {
    arity: 1,
    apply: (args, span) => {
      const a = args[0] as Value;
      return V.isMatrix(a) ? a.map((q) => fn(q, span)) : fn(a, span);
    },
  };
}

/** Every cell of a matrix, or the single value, as a flat list. */
function cellsOf(v: Value): readonly Quantity[] {
  return V.isMatrix(v) ? v.cells : [v];
}

function requireDimensionless(q: Quantity, name: string, span: Span): number {
  if (!q.dimension.isDimensionless) {
    throw new CalcError(
      "unit_mismatch",
      `\`${name}\` needs a plain number, but this value has units`,
      span,
      undefined,
      `got ${q.dimension.toString()}`,
    );
  }
  return q.si;
}

/** Angles are dimensionless but scaled, so `sin(30 deg)` just works. */
function trig(name: string, fn: (x: number) => number): BuiltinFunction {
  return elementwise(name, (q, span) =>
    Quantity.scalar(fn(requireDimensionless(q, name, span))),
  );
}

/**
 * Reductions accept loose arguments, a matrix, or both — `max(a, b)` and
 * `max(v)` are the same question asked two ways, and a sheet uses each.
 */
function reduction(
  name: string,
  combine: (a: number, b: number) => number,
): BuiltinFunction {
  return {
    arity: "variadic",
    apply: (args, span) => {
      const cells = args.flatMap((a) => [...cellsOf(a)]);
      if (cells.length === 0) {
        throw new CalcError("wrong_arity", `\`${name}\` needs at least one value`, span);
      }
      return cells.reduce((acc, q) => {
        if (!acc.dimension.equals(q.dimension)) {
          throw new CalcError(
            "unit_mismatch",
            `\`${name}\` needs every value in matching units`,
            span,
            undefined,
            `${acc.dimension.toString()} vs ${q.dimension.toString()}`,
          );
        }
        return new Quantity(combine(acc.si, q.si), acc.dimension);
      });
    },
  };
}

export const BUILTINS: Record<string, BuiltinFunction> = {
  sqrt: elementwise("sqrt", (q, span) => {
    if (q.si < 0) throw new CalcError("domain", "sqrt of a negative value", span);
    return q.sqrt();
  }),
  abs: elementwise("abs", (q) => new Quantity(Math.abs(q.si), q.dimension)),
  min: reduction("min", Math.min),
  max: reduction("max", Math.max),
  sum: {
    arity: "variadic",
    apply: (args, span) => {
      const cells = args.flatMap((a) => [...cellsOf(a)]);
      if (cells.length === 0) return Quantity.scalar(0);
      return cells.reduce((acc, q) => {
        try {
          return acc.add(q);
        } catch (e) {
          if (e instanceof UnitMismatchError) {
            throw new CalcError("unit_mismatch", e.message, span, undefined, e.detail);
          }
          throw e;
        }
      });
    },
  },
  mean: {
    arity: "variadic",
    apply: (args, span) => {
      const cells = args.flatMap((a) => [...cellsOf(a)]);
      if (cells.length === 0) {
        throw new CalcError("wrong_arity", "`mean` needs at least one value", span);
      }
      const total = (BUILTINS["sum"] as BuiltinFunction).apply(args, span) as Quantity;
      return total.div(Quantity.scalar(cells.length));
    },
  },
  rows: {
    arity: 1,
    apply: (args) => Quantity.scalar(V.isMatrix(args[0] as Value) ? (args[0] as MatrixValue).rows : 1),
  },
  cols: {
    arity: 1,
    apply: (args) => Quantity.scalar(V.isMatrix(args[0] as Value) ? (args[0] as MatrixValue).cols : 1),
  },
  transpose: {
    arity: 1,
    apply: (args, span) => V.requireMatrix(args[0] as Value, "`transpose`", span).transpose(),
  },
  linterp: {
    arity: 3,
    apply: (args, span) => linterp(args, span),
  },
  sin: trig("sin", Math.sin),
  cos: trig("cos", Math.cos),
  tan: trig("tan", Math.tan),
  asin: trig("asin", Math.asin),
  acos: trig("acos", Math.acos),
  atan: trig("atan", Math.atan),
  ln: trig("ln", Math.log),
  log: trig("log", Math.log10),
  exp: trig("exp", Math.exp),
  floor: { arity: 1, apply: (args) => {
    const a = args[0] as Quantity;
    return new Quantity(Math.floor(a.si), a.dimension);
  } },
  ceil: { arity: 1, apply: (args) => {
    const a = args[0] as Quantity;
    return new Quantity(Math.ceil(a.si), a.dimension);
  } },
};

/**
 * Exponents on a dimensioned base must be exact rationals — the dimension
 * arithmetic has nowhere to put 0.30000000000000004. A dimensionless base is
 * unconstrained, because no dimension is being raised.
 */
function exponentAsRational(q: Quantity, span: Span): Rational {
  if (!q.dimension.isDimensionless) {
    throw new CalcError(
      "dimensioned_exponent",
      "an exponent cannot have units",
      span,
      undefined,
      `got ${q.dimension.toString()}`,
    );
  }
  const v = q.si;
  if (Number.isInteger(v)) return Rational.of(v);

  // Recover a small exact fraction (1/2, 2/3, ...) via continued fractions.
  // Denominators above this are not notation an engineer wrote on purpose.
  const MAX_DEN = 64;
  let bestNum = 0;
  let bestDen = 1;
  let bestErr = Infinity;
  for (let den = 2; den <= MAX_DEN; den++) {
    const num = Math.round(v * den);
    const err = Math.abs(v - num / den);
    if (err < bestErr) {
      bestErr = err;
      bestNum = num;
      bestDen = den;
    }
  }
  if (bestErr > 1e-12) {
    throw new CalcError(
      "non_integer_exponent",
      `cannot raise a dimensioned value to the power ${v} — the exponent must be a simple fraction`,
      span,
      "write the exponent as a fraction, e.g. `x^(1/2)`, or use `sqrt(x)`",
    );
  }
  return Rational.of(bestNum, bestDen);
}

export function evaluateExpr(
  node: Expr,
  env: Environment,
  depth = 0,
): Value {
  switch (node.kind) {
    case "number":
      return node.unit === undefined
        ? Quantity.scalar(node.value)
        : quantityFrom(node.value, node.unit);

    case "identifier": {
      const binding = env.get(node.name);
      if (binding?.kind === "function") {
        throw new CalcError(
          "not_callable",
          `\`${node.name}\` is a function — it needs arguments, as in \`${node.name}(x)\``,
          node.span,
        );
      }
      const v = binding?.value;
      if (v === undefined) {
        throw new CalcError(
          "undefined_name",
          undefinedMessage(node.name, env),
          node.span,
          "a name must be defined in a region above and to the left of this one",
        );
      }
      return v;
    }

    case "matrix": {
      const rows = node.rows.map((row) =>
        row.map((cell) => {
          const v = evaluateExpr(cell, env, depth);
          return V.requireScalar(v, "a matrix cell", cell.span);
        }),
      );
      return MatrixValue.of(rows);
    }

    case "index":
      return evaluateIndex(node, env, depth);

    case "unary": {
      const v = evaluateExpr(node.operand, env, depth);
      return node.operator === "-" ? V.neg(v) : v;
    }

    case "binary": {
      const l = evaluateExpr(node.left, env, depth);
      const r = evaluateExpr(node.right, env, depth);
      // Captured so the default branch can narrow the operator to `never`
      // without also narrowing `node` itself away.
      const op = node.operator;
      const span = node.span;
      try {
        switch (op) {
          case "..": return range(l, r, span);
          case "+": return V.add(l, r, span);
          case "-": return V.sub(l, r, span);
          case "*": return V.mul(l, r, span);
          case "/": return V.div(l, r, span);
          case "^": {
            const base = V.requireScalar(l, "`^`", node.left.span);
            const exp = V.requireScalar(r, "an exponent", node.right.span);
            if (base.dimension.isDimensionless && exp.dimension.isDimensionless) {
              return Quantity.scalar(Math.pow(base.si, exp.si));
            }
            return base.pow(exponentAsRational(exp, node.right.span));
          }
          case "<": return Quantity.scalar(V.compare(l, r, span) < 0 ? 1 : 0);
          case ">": return Quantity.scalar(V.compare(l, r, span) > 0 ? 1 : 0);
          case "<=": return Quantity.scalar(V.compare(l, r, span) <= 0 ? 1 : 0);
          case ">=": return Quantity.scalar(V.compare(l, r, span) >= 0 ? 1 : 0);
          case "==": return Quantity.scalar(V.compare(l, r, span) === 0 ? 1 : 0);
          case "!=": return Quantity.scalar(V.compare(l, r, span) !== 0 ? 1 : 0);
          default: return assertNever(op);
        }
      } catch (e) {
        // Re-raise with the span of the offending subexpression, which is the
        // whole point of carrying spans.
        if (e instanceof UnitMismatchError) {
          throw new CalcError(
            "unit_mismatch",
            e.message,
            node.span,
            undefined,
            e.detail,
          );
        }
        throw e;
      }
    }

    case "call": {
      const bound = env.get(node.callee);

      // `if` is a special form, not a function: only the branch that is taken
      // may be evaluated. Evaluating both would make `if(x>0, sqrt(x), 0)`
      // fail on exactly the inputs the guard exists to exclude.
      if (node.callee === "if" && bound === undefined) {
        return evaluateIf(node, env, depth);
      }
      // `map` takes a function by name, so its first argument must not be
      // evaluated as a value.
      if (node.callee === "map" && bound === undefined) {
        return evaluateMap(node, env, depth);
      }
      // The solvers take a function by name for the same reason `map` does:
      // they call it, repeatedly, at values they choose.
      if (SOLVERS.has(node.callee) && bound === undefined) {
        return evaluateSolver(node, env, depth);
      }
      if (bound?.kind === "function") {
        return callUserFunction(node, bound.fn, env, depth);
      }
      if (bound?.kind === "value") {
        throw new CalcError(
          "not_callable",
          `\`${node.callee}\` is a value, not a function`,
          node.calleeSpan,
        );
      }

      const fn = BUILTINS[node.callee];
      if (!fn) {
        throw new CalcError(
          "not_a_function",
          notAFunctionMessage(node.callee, env),
          node.calleeSpan,
        );
      }
      if (fn.arity !== "variadic" && fn.arity !== node.args.length) {
        throw new CalcError(
          "wrong_arity",
          `\`${node.callee}\` takes ${fn.arity} argument(s), got ${node.args.length}`,
          node.span,
        );
      }
      const args = node.args.map((a) => evaluateExpr(a, env, depth));
      return fn.apply(args, node.span);
    }

    default:
      return assertNever(node);
  }
}

/**
 * `if(condition, value)`, or a chain `if(c1, v1, c2, v2, fallback)` where a
 * trailing odd argument is the fallback.
 *
 * Branches may have different dimensions, since only one is evaluated. That is
 * deliberate: a provision returning a moment in one case and zero in another
 * is ordinary, and rejecting it would make the feature useless.
 */
/**
 * `a..b` builds a column vector. Both ends are dimensionless integers: a range
 * is a set of positions, and a position with units is a mistake.
 */
function range(from: Value, to: Value, span: Span): MatrixValue {
  const a = V.requireScalar(from, "a range", span);
  const b = V.requireScalar(to, "a range", span);
  if (!a.dimension.isDimensionless || !b.dimension.isDimensionless) {
    throw new CalcError("unit_mismatch", "a range cannot have units", span);
  }
  if (!Number.isInteger(a.si) || !Number.isInteger(b.si)) {
    throw new CalcError("domain", "a range needs whole numbers", span);
  }
  const step = b.si >= a.si ? 1 : -1;
  const count = Math.abs(b.si - a.si) + 1;
  if (count > 100000) {
    throw new CalcError("domain", "that range is too large", span);
  }
  return MatrixValue.column(
    Array.from({ length: count }, (_, i) => Quantity.scalar(a.si + i * step)),
  );
}

/** 1-based, because a sheet is read by people who count rows from one. */
function evaluateIndex(node: IndexExpr, env: Environment, depth: number): Value {
  const target = evaluateExpr(node.target, env, depth);
  const matrix = V.requireMatrix(target, "indexing", node.target.span);

  const asIndex = (e: Expr): number => {
    const q = V.requireScalar(evaluateExpr(e, env, depth), "an index", e.span);
    if (!q.dimension.isDimensionless) {
      throw new CalcError("unit_mismatch", "an index cannot have units", e.span);
    }
    if (!Number.isInteger(q.si)) {
      throw new CalcError("domain", "an index must be a whole number", e.span);
    }
    return q.si;
  };

  const bad = (what: string, got: number, max: number, e: Expr): never => {
    throw new CalcError(
      "index_out_of_range",
      `${what} ${got} is outside 1..${max}`,
      e.span,
      "indexes start at 1",
    );
  };

  if (node.indices.length === 1) {
    const first = node.indices[0] as Expr;
    const i = asIndex(first);
    if (matrix.isVector) {
      if (i < 1 || i > matrix.size) bad("index", i, matrix.size, first);
      return matrix.cells[i - 1] as Quantity;
    }
    // One index into a 2-D matrix selects a row.
    if (i < 1 || i > matrix.rows) bad("row", i, matrix.rows, first);
    return MatrixValue.of([matrix.row(i - 1)]);
  }

  if (node.indices.length === 2) {
    const rowExpr = node.indices[0] as Expr;
    const colExpr = node.indices[1] as Expr;
    const r = asIndex(rowExpr);
    const c = asIndex(colExpr);
    if (r < 1 || r > matrix.rows) bad("row", r, matrix.rows, rowExpr);
    if (c < 1 || c > matrix.cols) bad("column", c, matrix.cols, colExpr);
    return matrix.at(r - 1, c - 1);
  }

  throw new CalcError(
    "wrong_arity",
    "an index takes one or two positions",
    node.span,
  );
}

const SOLVERS = new Set(["root", "integral", "deriv"]);

/**
 * `root(f, a, b)`, `integral(f, a, b)`, `deriv(f, x)`.
 *
 * The numerics live in `solve.ts` and work in plain numbers. This is the part
 * that makes them mean something on a calc sheet: it holds the units together,
 * which is the whole difference between a solver and a spreadsheet.
 *
 *   - a root has the units of the range it was sought in
 *   - an integral has the units of `f` times the units of `x`
 *   - a derivative has the units of `f` divided by the units of `x`
 */
function evaluateSolver(node: CallExpr, env: Environment, depth: number): Value {
  const name = node.callee;
  const wanted = name === "deriv" ? 2 : 3;
  const [fnExpr, ...rest] = node.args;
  if (node.args.length !== wanted || !fnExpr) {
    throw new CalcError(
      "wrong_arity",
      name === "deriv"
        ? "`deriv` takes a function and a point"
        : `\`${name}\` takes a function and two ends of a range`,
      node.span,
    );
  }
  if (fnExpr.kind !== "identifier") {
    throw new CalcError(
      "not_a_function",
      `\`${name}\` needs the name of a function as its first argument`,
      fnExpr.span,
    );
  }

  const bound = env.get(fnExpr.name);
  if (bound === undefined) {
    throw new CalcError("undefined_name", undefinedMessage(fnExpr.name, env), fnExpr.span);
  }
  if (bound.kind !== "function") {
    throw new CalcError(
      "not_a_function",
      `\`${fnExpr.name}\` is a value, not a function`,
      fnExpr.span,
    );
  }
  if (bound.fn.params.length !== 1) {
    throw new CalcError(
      "wrong_arity",
      `\`${fnExpr.name}\` takes ${bound.fn.params.length} arguments; \`${name}\` calls it with one`,
      fnExpr.span,
    );
  }

  const points = rest.map((a) => {
    const v = evaluateExpr(a, env, depth);
    return V.requireScalar(v, `\`${name}\``, a.span);
  });
  const first = points[0] as Quantity;
  const second = points[1];
  if (second && !first.dimension.equals(second.dimension)) {
    throw new CalcError(
      "unit_mismatch",
      `the two ends of the range given to \`${name}\` are not the same kind of quantity`,
      node.span,
      undefined,
      `${first.dimension.toString()} vs ${second.dimension.toString()}`,
    );
  }

  /**
   * The function as plain numbers.
   *
   * The dimension of the result is taken from the first call and every later
   * one is checked against it. A function that returns force here and length
   * there is not one the solver can reason about, and finding out at the end
   * would mean reporting a number that means nothing.
   */
  let outDimension: Dimension | undefined;
  const sampled = (x: number): number => {
    const local: Environment = new Map(bound.fn.closure);
    local.set(bound.fn.params[0] as string, valueBinding(new Quantity(x, first.dimension)));
    const out = V.requireScalar(
      evaluateExpr(bound.fn.body, local, depth + 1),
      `\`${fnExpr.name}\``,
      node.span,
    );
    if (outDimension === undefined) outDimension = out.dimension;
    else if (!outDimension.equals(out.dimension)) {
      throw new CalcError(
        "unit_mismatch",
        `\`${fnExpr.name}\` does not always return the same kind of quantity`,
        node.span,
        undefined,
        `${outDimension.toString()} vs ${out.dimension.toString()}`,
      );
    }
    return out.si;
  };

  if (name === "deriv") {
    const at = differentiate(sampled, first.si, node.span);
    return new Quantity(at, (outDimension ?? Dimension.DIMENSIONLESS).div(first.dimension));
  }

  const b = second as Quantity;
  if (name === "root") {
    const x = findRoot(sampled, first.si, b.si, node.span);
    // A root is a value of x, so it carries x's units — never the function's.
    return new Quantity(x, first.dimension);
  }

  const area = integrate(sampled, first.si, b.si, node.span);
  return new Quantity(
    area,
    (outDimension ?? Dimension.DIMENSIONLESS).mul(first.dimension),
  );
}

/** `map(f, v)` applies a function to every cell. */
function evaluateMap(node: CallExpr, env: Environment, depth: number): Value {
  const [fnExpr, dataExpr] = node.args;
  if (node.args.length !== 2 || !fnExpr || !dataExpr) {
    throw new CalcError("wrong_arity", "`map` takes a function and a matrix", node.span);
  }
  if (fnExpr.kind !== "identifier") {
    throw new CalcError(
      "not_a_function",
      "`map` needs the name of a function as its first argument",
      fnExpr.span,
    );
  }
  const bound = env.get(fnExpr.name);
  const data = evaluateExpr(dataExpr, env, depth);
  const cells = cellsOf(data);

  const applyOne = (q: Quantity): Quantity => {
    let out: Value;
    if (bound?.kind === "function") {
      if (bound.fn.params.length !== 1) {
        throw new CalcError(
          "wrong_arity",
          `\`${fnExpr.name}\` takes ${bound.fn.params.length} arguments; \`map\` calls it with one`,
          node.span,
        );
      }
      const local: Environment = new Map(bound.fn.closure);
      local.set(bound.fn.params[0] as string, valueBinding(q));
      out = evaluateExpr(bound.fn.body, local, depth + 1);
    } else {
      const builtin = BUILTINS[fnExpr.name];
      if (!builtin) {
        throw new CalcError("not_a_function", notAFunctionMessage(fnExpr.name, env), fnExpr.span);
      }
      out = builtin.apply([q], node.span);
    }
    return V.requireScalar(out, "`map`", node.span);
  };

  const mapped = cells.map(applyOne);
  return V.isMatrix(data)
    ? MatrixValue.fromCells(data.rows, data.cols, mapped)
    : (mapped[0] as Quantity);
}

/**
 * `linterp(xs, ys, x)` — linear interpolation through a tabulated curve.
 *
 * Outside the table it CLAMPS to the end value rather than extrapolating.
 * Tabulated data in this field is usually defined only over its stated range,
 * and silently extrapolating past it produces a confident number with no basis.
 */
function linterp(args: readonly Value[], span: Span): Quantity {
  const xs = V.requireMatrix(args[0] as Value, "`linterp`", span);
  const ys = V.requireMatrix(args[1] as Value, "`linterp`", span);
  const x = V.requireScalar(args[2] as Value, "`linterp`", span);

  if (xs.size !== ys.size) {
    throw new CalcError(
      "shape_mismatch",
      `\`linterp\` needs matching table columns, got ${xs.size} and ${ys.size}`,
      span,
    );
  }
  if (xs.size < 2) {
    throw new CalcError("domain", "`linterp` needs at least two points", span);
  }

  const xa = xs.cells;
  const ya = ys.cells;
  for (let i = 1; i < xa.length; i++) {
    if ((xa[i] as Quantity).si <= (xa[i - 1] as Quantity).si) {
      throw new CalcError(
        "domain",
        "`linterp` needs its first column in increasing order",
        span,
      );
    }
  }

  const first = xa[0] as Quantity;
  if (!x.dimension.equals(first.dimension)) {
    throw new CalcError(
      "unit_mismatch",
      "the value looked up does not match the units of the table",
      span,
      undefined,
      `${x.dimension.toString()} vs ${first.dimension.toString()}`,
    );
  }

  if (x.si <= first.si) return ya[0] as Quantity;
  const last = xa[xa.length - 1] as Quantity;
  if (x.si >= last.si) return ya[ya.length - 1] as Quantity;

  for (let i = 1; i < xa.length; i++) {
    const hi = xa[i] as Quantity;
    if (x.si <= hi.si) {
      const lo = xa[i - 1] as Quantity;
      const t = (x.si - lo.si) / (hi.si - lo.si);
      const yLo = ya[i - 1] as Quantity;
      const yHi = ya[i] as Quantity;
      return yLo.add(yHi.sub(yLo).mul(Quantity.scalar(t)));
    }
  }
  return ya[ya.length - 1] as Quantity;
}

function evaluateIf(node: CallExpr, env: Environment, depth: number): Value {
  const args = node.args;
  if (args.length < 2) {
    throw new CalcError(
      "wrong_arity",
      "`if` needs at least a condition and a value",
      node.span,
      "if(condition, value_when_true, value_otherwise)",
    );
  }

  for (let i = 0; i + 1 < args.length; i += 2) {
    const test = args[i] as Expr;
    const condition = V.requireScalar(
      evaluateExpr(test, env, depth),
      "a condition",
      test.span,
    );
    if (!condition.dimension.isDimensionless) {
      throw new CalcError(
        "unit_mismatch",
        "a condition cannot have units",
        test.span,
        undefined,
        `got ${condition.dimension.toString()}`,
      );
    }
    if (condition.si !== 0) return evaluateExpr(args[i + 1] as Expr, env, depth);
  }

  if (args.length % 2 === 1) {
    return evaluateExpr(args[args.length - 1] as Expr, env, depth);
  }
  throw new CalcError(
    "domain",
    "no condition was true, and there is no final value to fall back on",
    node.span,
    "add a last argument to use when nothing matches",
  );
}

function callUserFunction(
  node: CallExpr,
  fn: UserFunction,
  env: Environment,
  depth: number,
): Value {
  if (depth >= MAX_CALL_DEPTH) {
    throw new CalcError(
      "call_depth",
      `\`${node.callee}\` called itself too many times`,
      node.span,
      "a recursive definition needs a case that stops",
    );
  }
  if (fn.params.length !== node.args.length) {
    throw new CalcError(
      "wrong_arity",
      `\`${node.callee}\` takes ${fn.params.length} argument(s), got ${node.args.length}`,
      node.span,
    );
  }

  // Arguments are evaluated in the CALLER's scope; the body runs in the scope
  // the function was defined in, plus its parameters. Anything else lets a
  // caller's local name capture a name inside the body.
  const local: Environment = new Map(fn.closure);
  fn.params.forEach((name, i) => {
    local.set(name, valueBinding(evaluateExpr(node.args[i] as Expr, env, depth)));
  });
  return evaluateExpr(fn.body, local, depth + 1);
}

export interface StatementResult {
  /** Defined name, for a `:=` statement. */
  readonly defined?: string;
  /** The definition bound a function rather than a value. */
  readonly isFunction?: boolean;
  /** The statement ends in `=`, so the sheet should show the value. */
  readonly showResult?: boolean;
  readonly value: Value;
  /** Magnitude in the display unit, when the statement chose one. */
  readonly displayValue?: number;
  readonly displayUnit?: string;
}

/** Evaluates one statement, mutating `env` for a definition. */
export function evaluateStatement(
  stmt: Statement,
  env: Environment,
): StatementResult {
  switch (stmt.kind) {
    case "definition": {
      if (stmt.params) {
        // A function is bound, not evaluated. Its body runs at call time, so a
        // body naming something defined further down the sheet fails at the
        // call rather than here — which is how the sheet reads.
        const closure: Environment = new Map(env);
        const binding: Binding = {
          kind: "function",
          fn: {
            params: stmt.params.map((p) => p.name),
            body: stmt.value,
            closure,
          },
        };
        // The function must be visible inside its own closure, or recursion
        // cannot resolve its own name. Adding it after construction is the
        // only way to tie that knot.
        closure.set(stmt.name, binding);
        env.set(stmt.name, binding);
        return { defined: stmt.name, isFunction: true, value: Quantity.scalar(Number.NaN) };
      }
      const value = evaluateExpr(stmt.value, env);
      setValue(env, stmt.name, value);
      if (stmt.showResult !== true) return { defined: stmt.name, value };
      if (stmt.displayUnit === undefined) {
        return { defined: stmt.name, value, showResult: true };
      }
      return {
        defined: stmt.name,
        value,
        showResult: true,
        displayValue: valueIn(V.requireScalar(value, "a display unit", stmt.span), stmt.displayUnit),
        displayUnit: stmt.displayUnit,
      };
    }
    case "evaluation": {
      const value = evaluateExpr(stmt.expression, env);
      if (stmt.displayUnit === undefined) return { value, showResult: true };
      return {
        value,
        showResult: true,
        displayValue: valueIn(V.requireScalar(value, "a display unit", stmt.span), stmt.displayUnit),
        displayUnit: stmt.displayUnit,
      };
    }
    default:
      return assertNever(stmt);
  }
}
