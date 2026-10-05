# ADR-0003 — No implicit multiplication in the grammar; the editor inserts it

**Status:** Accepted (2026-09-04)
**Implemented in:** `packages/engine/src/parser.ts`

## Decision (proposed)

The expression grammar has **no implicit multiplication**. Juxtaposition is not
an operator; `*` is always required in the stored source.

The *editor* auto-inserts `*` when the user types juxtaposition, so typing
`2L` produces the source `2*L` and displays as `2·L`. The feel is implicit;
the grammar is not.

## Context

The original plan called for deciding this early, because ambiguity here is a
permanent source of bug reports. The problem is that implicit multiplication
collides with three things this language already has:

1. **Function calls.** With user-defined functions, `a(b+c)` is either a call
   or a multiplication, and no amount of cleverness makes that unambiguous.
   Worksheet tools that allow implicit multiplication elsewhere still demand an
   explicit multiply here, for exactly this reason.
2. **Multi-character identifiers.** Engineers name things `Mu`, `fc`, `Zx`.
   Under implicit multiplication `Mu` is ambiguous with `M*u`. Restricting
   identifiers to one character (the usual escape hatch) is unacceptable here.
3. **Units.** `2 kip` reads as an implicit product, and unit application has
   different precedence than multiplication — folding them together makes
   `2 kip^2` ambiguous.

## Consequences

- The stored source and the text projection are unambiguous and
  re-parseable, which is a precondition for lossless round-trip.
- An API or agent caller writing `2L` gets a parse error with a span, not a
  silent misinterpretation. Preferable: a wrong answer that looks right is the
  worst outcome this software can produce.
- Cost: the editor must do the insertion well, and paste-from-elsewhere needs a
  normalization pass. That work is real but it is UI work, recoverable at any
  time — unlike an ambiguous grammar.

## Alternative rejected

Implicit multiplication with juxtaposition binding tighter than division
(so `1/2x` = `1/(2x)`). Common in CAS front-ends, and it is the source of the
`1/2x` arguments that never end. Not worth it for a tool whose output gets
stamped.

## Resolution of the unit position

Units are the one exception, and they are exempt because they are **not
multiplication at all**. A unit suffix is its own grammar production:

```
quantity_literal := number unit_expression?
```

The suffix attaches to a **numeric literal and nothing else**. `2 kip` is a
single literal. `A_g * 0.85 ksi` still needs its `*`, because the left operand
is a variable — `0.85 ksi` is the literal there.

This is stronger than treating `2 kip` as sugar for `2*kip`:

- No `*` appears between a number and its unit anywhere — not in the editor,
  not in storage, not in the text projection. What you type is what is stored.
- The `Mu` vs `M*u` ambiguity cannot arise, because unit resolution only ever
  happens in the suffix position after a number, never against a bare
  identifier.
- `2 kip^2` is unambiguous: `kip^2` is parsed by the unit sub-grammar, so it
  means 2·(kip²) and cannot be read as (2 kip)².
- The suffix consumes `*`, `/` and `^` **only while every term is a known
  unit**. `2 kip/L` stops at `L` and hands `/L` back to the expression parser.

### Known sharp edge

Because the suffix binds tightest, `1/2 kip` parses as `1/(2 kip)` —
dimension 1/force — not `0.5 kip`. This is consistent, but it will surprise
someone reading linear source.

It is largely defused in practice: in the 2D editor `/` builds a real fraction
box, so the user *sees* `2 kip` sitting in the denominator. The ambiguity only
bites callers writing linear source through the API, where an explicit
`(1/2) kip` or `0.5 kip` is the fix. Worth a lint warning on
`number / number unit`.
