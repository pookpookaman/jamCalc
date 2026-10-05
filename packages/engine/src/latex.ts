/**
 * LaTeX in and out, for a structured math editor.
 *
 * MathLive was chosen for 2-D editing, with its output serialized
 * into our AST rather than adopting LaTeX as the source of truth. This module
 * is that boundary, and the reason it lives in the engine rather than the
 * shell is that it is a language question: what the text means is the parser's
 * business, and this has to agree with it exactly.
 *
 * The subset is deliberate. Our grammar is small — numbers with units, names,
 * six arithmetic operators, comparisons, calls, matrices, indexing — and this
 * covers that and refuses the rest. LaTeX can say vastly more than a calc
 * sheet can compute, and quietly accepting `\int` would produce a region that
 * looks right and evaluates to nothing.
 */

import type {
  Expr,
  Statement,
} from "./ast.js";
import { CalcError } from "./errors.js";
import { parseStatement } from "./parser.js";
import { splitName } from "./notation.js";

/**
 * Greek spelled in ASCII, and its LaTeX command.
 *
 * Keyed by the ASCII spelling because that is what the *source* holds, and a
 * round trip must return the same identifier. A source that uses the literal
 * letter keeps the literal letter: LaTeX takes it verbatim, so both spellings
 * survive unchanged rather than one being silently renamed into the other.
 */
const GREEK_COMMAND: Record<string, string> = {
  alpha: "\\alpha", beta: "\\beta", gamma: "\\gamma", delta: "\\delta",
  epsilon: "\\epsilon", zeta: "\\zeta", eta: "\\eta", theta: "\\theta",
  iota: "\\iota", kappa: "\\kappa", lambda: "\\lambda", mu: "\\mu",
  nu: "\\nu", xi: "\\xi", pi: "\\pi", rho: "\\rho", sigma: "\\sigma",
  tau: "\\tau", upsilon: "\\upsilon", phi: "\\phi", chi: "\\chi",
  psi: "\\psi", omega: "\\omega",
  Gamma: "\\Gamma", Delta: "\\Delta", Theta: "\\Theta", Lambda: "\\Lambda",
  Xi: "\\Xi", Pi: "\\Pi", Sigma: "\\Sigma", Phi: "\\Phi",
  Psi: "\\Psi", Omega: "\\Omega",
};

/** Functions LaTeX renders upright by convention. */
const UPRIGHT = new Set([
  "sin", "cos", "tan", "ln", "log", "exp", "min", "max",
]);

// --- our source -> LaTeX ---------------------------------------------------

/**
 * A name, with its subscript and primes as LaTeX.
 *
 * The split is done here rather than through `splitName`, which normalises for
 * *display*: it turns `alpha` into α and joins a nested subscript with a comma.
 * Both are right on the page and wrong here — `phi_M_n` came back as
 * `φ_M,n`, which is not a name at all.
 */
function nameToLatex(name: string): string {
  const cut = name.indexOf("_");
  const head = cut < 0 ? name : name.slice(0, cut);
  const subscript = cut < 0 ? "" : name.slice(cut + 1);

  const primes = /'*$/.exec(head)?.[0] ?? "";
  const base = head.slice(0, head.length - primes.length);

  const drawn =
    GREEK_COMMAND[base] ?? (base.length > 1 ? `\\mathit{${base}}` : base);
  return subscript === ""
    ? `${drawn}${primes}`
    : `${drawn}${primes}_{${subscript}}`;
}

function numberToLatex(value: number, unit: string | undefined): string {
  // A unit is upright and spaced, which is the convention every engineering
  // document already follows and the only way `2 m` does not read as `2·m`.
  return unit === undefined ? String(value) : `${value}\\,\\mathrm{${unit}}`;
}

/** Precedence, so parentheses are emitted only where they change meaning. */
const PRECEDENCE: Record<string, number> = {
  "..": 1,
  "==": 2, "!=": 2, "<": 2, ">": 2, "<=": 2, ">=": 2,
  "+": 3, "-": 3,
  "*": 4, "/": 4,
  "^": 5,
};

function exprToLatex(node: Expr, parentPrec = 0): string {
  switch (node.kind) {
    case "number": {
      const drawn = numberToLatex(node.value, node.unit);
      // A united number needs its own brackets under an exponent or a unary.
      // Without them `(25 ft)^2` came back as `25 ft^2` — the power binding to
      // the unit instead of the quantity, turning 187.5 kip*ft into 7.5. A
      // wrong number that looks right is the failure this project exists to
      // avoid, and it is exactly what the round-trip test is for.
      return node.unit !== undefined && parentPrec >= 5
        ? `\\left(${drawn}\\right)`
        : drawn;
    }
    case "identifier":
      return nameToLatex(node.name);
    case "unary":
      return `${node.operator}${exprToLatex(node.operand, 6)}`;
    case "binary": {
      const prec = PRECEDENCE[node.operator] ?? 0;
      // A fraction carries its own grouping, so its parts never need brackets.
      if (node.operator === "/") {
        const frac = `\\frac{${exprToLatex(node.left, 0)}}{${exprToLatex(node.right, 0)}}`;
        return parentPrec > 4 ? `\\left(${frac}\\right)` : frac;
      }
      if (node.operator === "^") {
        return `${exprToLatex(node.left, 6)}^{${exprToLatex(node.right, 0)}}`;
      }
      const op =
        node.operator === "*" ? " \\cdot " :
        node.operator === "<=" ? " \\le " :
        node.operator === ">=" ? " \\ge " :
        node.operator === "!=" ? " \\ne " :
        node.operator === "==" ? " = " :
        node.operator === ".." ? " .. " :
        ` ${node.operator} `;
      const body = `${exprToLatex(node.left, prec)}${op}${exprToLatex(node.right, prec + 1)}`;
      return parentPrec > prec ? `\\left(${body}\\right)` : body;
    }
    case "call": {
      if (node.callee === "sqrt" && node.args.length === 1) {
        return `\\sqrt{${exprToLatex(node.args[0] as Expr, 0)}}`;
      }
      const name = UPRIGHT.has(node.callee)
        ? `\\${node.callee}`
        : `\\mathrm{${node.callee}}`;
      const args = node.args.map((a) => exprToLatex(a, 0)).join(", ");
      return `${name}\\left(${args}\\right)`;
    }
    case "matrix": {
      const rows = node.rows
        .map((row) => row.map((c) => exprToLatex(c, 0)).join(" & "))
        .join(" \\\\ ");
      return `\\begin{bmatrix}${rows}\\end{bmatrix}`;
    }
    case "index": {
      const indices = node.indices.map((i) => exprToLatex(i, 0)).join(", ");
      return `${exprToLatex(node.target, 6)}\\left[${indices}\\right]`;
    }
    default: {
      const bad = node as { kind: string };
      throw new CalcError("syntax", `cannot draw \`${bad.kind}\``, [0, 0]);
    }
  }
}

/** Renders a parsed statement as LaTeX for the editor. */
export function statementToLatex(statement: Statement): string {
  if (statement.kind === "definition") {
    const params = statement.params
      ? `\\left(${statement.params.map((p) => nameToLatex(p.name)).join(", ")}\\right)`
      : "";
    const head = `${nameToLatex(statement.name)}${params} := ${exprToLatex(statement.value)}`;
    if (!statement.showResult) return head;
    return statement.displayUnit
      ? `${head} = \\mathrm{${statement.displayUnit}}`
      : `${head} =`;
  }
  const body = exprToLatex(statement.expression);
  return statement.displayUnit
    ? `${body} = \\mathrm{${statement.displayUnit}}`
    : `${body} =`;
}

/** Renders a region's source as LaTeX, or throws if it does not parse. */
export function sourceToLatex(source: string): string {
  return statementToLatex(parseStatement(source));
}

// --- LaTeX -> our source ---------------------------------------------------

/**
 * Turns editor LaTeX back into sheet source.
 *
 * A rewriter, not a parser: the structure is already ours, because the editor
 * was seeded from our own output. The job is to undo the notation — fractions
 * back to `/`, `\cdot` back to `*`, upright units back to bare text — and to
 * leave anything it does not recognise alone so the region reports a syntax
 * error the user can see, rather than silently losing what they typed.
 */
export function latexToSource(latex: string): string {
  let out = latex;

  // \frac{a}{b} -> (a)/(b). Innermost first, so nested fractions unwind.
  for (let guard = 0; guard < 50; guard += 1) {
    const next = replaceFrac(out);
    if (next === out) break;
    out = next;
  }

  // An empty slot in something half-typed. It is the editor's scaffolding,
  // never anything the user wrote, and it must not reach the language: it
  // arrives as `\placeholder{}` in every unfinished fraction, script and
  // field, and a stray backslash makes the whole region unreadable.
  out = replaceCommand(out, "\\placeholder", () => "");
  out = out.replace(/\\placeholder(?![a-zA-Z])/g, "");

  // \sqrt{x} -> sqrt(x)
  out = replaceCommand(out, "\\sqrt", (arg) => `sqrt(${arg})`);
  // \mathrm{name} and \mathit{name} are notation, not content.
  out = replaceCommand(out, "\\mathrm", (arg) => arg);
  out = replaceCommand(out, "\\mathit", (arg) => arg);
  out = replaceCommand(out, "\\operatorname", (arg) => arg);
  // A subscript is part of the name it belongs to, so the braces just go.
  out = replaceCommand(out, "_", (arg) => `_${arg}`);
  // An exponent is not: `a^{2}` is `a^2`, but `a^{b+1}` still needs grouping.
  out = replaceCommand(out, "^", (arg) =>
    /^[A-Za-z0-9._']+$/.test(arg) ? `^${arg}` : `^(${arg})`,
  );

  out = out
    .replace(/\\begin\{[bp]matrix\}/g, "[")
    .replace(/\\end\{[bp]matrix\}/g, "]")
    .replace(/\s*\\\\\s*/g, "; ")
    .replace(/\s*&\s*/g, ", ")
    .replace(/\\left\s*/g, "")
    .replace(/\\right\s*/g, "")
    .replace(/\\cdot|\\times/g, "*")
    .replace(/\\div/g, "/")
    // A command name ends at the first non-letter, which `\b` does not
    // capture: between the `e` of `\le` and a following `5` there is no word
    // boundary, so `a\le5` came through with the backslash intact.
    .replace(/\\le(?![a-zA-Z])/g, "<=")
    .replace(/\\ge(?![a-zA-Z])/g, ">=")
    .replace(/\\ne(?![a-zA-Z])/g, "!=")
    .replace(/\\(?:coloneqq|coloneq|Coloneq|colonequals)(?![a-zA-Z])/g, ":=")
    // Presentation the editor adds and the language has no use for.
    .replace(/\\(?:displaystyle|textstyle|scriptstyle|limits|nolimits)(?![a-zA-Z])/g, "")
    .replace(/\\,|\\;|\\:|\\!|~/g, " ")
    .replace(/\\quad|\\qquad/g, " ");

  // Longest first, so `\Theta` is not eaten by `\Th`... and `\epsilon` is not
  // matched as `\eta` inside it.
  const commands = Object.entries(GREEK_COMMAND).sort(
    (a, b) => b[1].length - a[1].length,
  );
  for (const [ascii, tex] of commands) {
    out = out.split(`${tex} `).join(`${ascii} `);
    out = out.split(tex).join(ascii);
  }

  // `\sin` is how LaTeX draws it; `sin` is what the sheet calls it.
  for (const fn of UPRIGHT) out = out.split(`\\${fn}`).join(fn);

  // Braces that survived carried grouping, which parentheses carry in source.
  out = out.replace(/\{/g, "(").replace(/\}/g, ")");

  return out.replace(/\s+/g, " ").trim();
}

/** `\frac{a}{b}` -> `(a)/(b)`, one innermost occurrence. */
function replaceFrac(input: string): string {
  const at = input.lastIndexOf("\\frac");
  if (at < 0) return input;
  const first = readGroup(input, at + 5);
  if (!first) return input;
  const second = readGroup(input, first.end);
  if (!second) return input;
  return (
    input.slice(0, at) +
    `(${first.body})/(${second.body})` +
    input.slice(second.end)
  );
}

/**
 * Applies `f` to the braced argument of every occurrence of `command`.
 *
 * Scans left to right with a cursor rather than repeatedly rewriting the whole
 * string: an occurrence with no braced argument has to be stepped over and
 * left alone, and doing that by substitution needs a sentinel that then has to
 * be undone — which is exactly where this corrupted ordinary spaces the first
 * time it was written.
 */
function replaceCommand(
  input: string,
  command: string,
  f: (arg: string) => string,
): string {
  let out = "";
  let i = 0;
  while (i < input.length) {
    const at = input.indexOf(command, i);
    if (at < 0) {
      out += input.slice(i);
      break;
    }
    out += input.slice(i, at);
    const group = readGroup(input, at + command.length);
    if (!group) {
      // No argument to transform. Keep it verbatim; if it is not something the
      // sheet language understands, the region will say so.
      out += command;
      i = at + command.length;
      continue;
    }
    out += f(group.body);
    i = group.end;
  }
  return out;
}

/** Reads a `{...}` group starting at or after `from`, honouring nesting. */
function readGroup(
  input: string,
  from: number,
): { body: string; end: number } | null {
  let i = from;
  while (i < input.length && /\s/.test(input[i] as string)) i += 1;
  if (input[i] !== "{") return null;
  let depth = 0;
  for (let k = i; k < input.length; k += 1) {
    if (input[k] === "{") depth += 1;
    else if (input[k] === "}") {
      depth -= 1;
      if (depth === 0) return { body: input.slice(i + 1, k), end: k + 1 };
    }
  }
  return null;
}
