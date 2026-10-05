# ADR-0007 — User-defined functions, and `if` as a special form

**Status:** Accepted (2026-09-04)
**Implemented in:** `packages/engine/src/parser.ts`, `eval.ts`, `document/graph.ts`

## Decision

Two language features, both general-purpose. Neither carries any design-code
content: the engine gains the *ability* to express a branching provision, and
knows nothing about AISC, ACI or any other standard.

```
f(x, y) := x*y                     a function definition
r := f(3 ft, 4 ft)                 a call

if(condition, value, otherwise)    two-branch
if(c1, v1, c2, v2, fallback)       chained; trailing odd argument is the fallback
```

## Functions

- Modelled as a `Definition` with an optional parameter list, not a separate
  statement kind. A function is a name bound to something, and one rule for how
  names resolve positionally is worth more than a tidier AST.
- **One namespace.** A name is a value or a function, never both. Two
  namespaces would let `x` and `x(t)` coexist and force positional redefinition
  to be explained twice.
- **Arguments evaluate in the caller's scope; the body runs in the scope where
  the function was defined**, plus its parameters. Anything else lets a
  caller's local name capture a name inside the body — the classic dynamic
  scoping bug, and impossible to debug on a sheet.
- Parameters are local. The graph removes them from the region's reads, or
  `f(x) := 2*x` would report `x` as undefined.
- **Recursion is allowed and bounded** at 128 frames. A function must appear in
  its own closure for recursion to resolve — the binding is added to the
  closure after construction to tie that knot. The depth cap exists because a
  document should report a runaway definition, not take the tab down with it.
- Detecting a definition needs lookahead: `f(x)` is a call, and only a trailing
  `:=` makes it a definition. The parser scans the whole shape and rewinds if
  it does not match. A parameter list must be plain names — `f(2) := 3` is a
  typo, and binding a function nobody meant to write would be worse than an
  error.

## `if` is a special form, not a builtin

Builtins receive evaluated arguments. `if` cannot: only the branch that is
taken may be evaluated. Otherwise

```
r := if(x >= 0, sqrt(x), 0)
```

fails on exactly the inputs the guard exists to exclude — which is the entire
purpose of writing it.

Consequences:
- **Branches may have different dimensions.** Only one is evaluated, so a
  provision returning a moment in one case and zero in another is fine.
  Requiring both branches to agree dimensionally would make the feature
  useless for its main purpose.
- A condition carrying units is an error. `if(2 kip, ...)` is a mistake, not a
  truthiness question.
- A chain that matches nothing and has no fallback is an error rather than a
  silent zero. A calculation that quietly produces nothing is the failure mode
  this project exists to avoid.
- `if` can be shadowed by a user definition, like any other name, because the
  environment is consulted before the special form.

## Consequences elsewhere

- `Environment` changed from `Map<string, Quantity>` to a map of bindings.
  Helpers `setValue` / `getValue` keep value-only callers readable.
- The dependency graph now tracks **calls separately from reads**. An
  unresolved *call* may be a builtin and therefore fine; an unresolved
  *variable* never is. Lumping them together made every `sqrt(x)` look like a
  reference to an undefined name.
- `Worksheet` keeps function bindings per region. A cached `RegionResult` holds
  a `Quantity`, which cannot represent a function, so reusing a clean function
  region used to rebind the name to a meaningless value and every caller
  reported "not a function".
- A function region displays no value; there is nothing to show, and `NaN`
  would be a lie.
