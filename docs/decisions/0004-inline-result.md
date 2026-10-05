# ADR-0004 — A definition may display its own result

**Status:** Accepted (2026-09-04)
**Implemented in:** `packages/engine/src/parser.ts`, `ast.ts`, `eval.ts`

## Decision

A definition may end with `=` and an optional display unit:

```
M_u := w_u*L^2/8 = kip*ft        ->  M_u := (w_u·L²)/8 = 187.5 kip·ft
a := 1+2 =                       ->  a := 3
```

Grammar:

```
statement := ident ':=' expr display?
           | expr display
display   := '=' unit_expression?
```

The trailing `=` is a *display marker*, not an operator and not an equality
test. Both statement forms share one tail parser.

## Context

The conventional worksheet model requires a second region to see what you just
defined, which is why real sheets are full of paired regions: one to compute,
one to show. That doubles the region count, doubles what has to be dragged
around when a sheet is reorganized, and puts a definition and its value in two
places that can drift apart on the page.

Folding the display into the definition is the highest-value single departure
from that model, and it costs nothing: the definition still defines, so nothing
downstream changes.

## Consequences

- `RegionResult` carries `showResult`, so the UI no longer guesses from the
  source text whether a region displays a value. It previously used a regex,
  which was wrong for `a := b = kip` and unmaintainable.
- The starter sheet dropped from 12 regions to 9 by merging every display
  region into its definition. That ratio is roughly what a real sheet sees.
- `=` remains available as a standalone evaluation (`M_u = kip*ft`), because
  showing a value away from where it was defined is still legitimate — a
  summary block at the end of a sheet, for instance.

## Note

`==` is the comparison operator and is unaffected. A trailing `=` is
unambiguous because it is followed either by nothing or by a unit expression,
never by a value.
