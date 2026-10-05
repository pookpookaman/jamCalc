# ADR-0012 — Data tables bind one name per column

**Status:** Accepted (2026-09-05)
**Implemented in:** `packages/engine/src/document/table.ts`, `apps/studio/src/TableRegionBody.tsx`

## Decision

A table region is a grid of numbers whose columns have names and units. Each
column binds **its own name** on the sheet, as a column vector.

```
  span (ft) | load (klf)
         10 |        2.4
         20 |        1.8
         30 |        1.2

  w := linterp(span, load, 22 ft) = klf     ⇒ 1.68 klf
```

## Why per-column, not one name for the grid

`linterp(xs, ys, x)` already takes two column vectors, and so do `sum`, `max`
and `map`. Binding each column separately means a table is immediately usable
by the language that already exists — the example above needed no new syntax at
all.

Binding the whole grid to one name would have required slicing (`T[.,1]`), and
ADR-0008 deferred slicing deliberately. Adding a feature whose first
requirement is a deferred feature is how scope escapes.

## Cells are numbers, not expressions

A table is data. Allowing formulas in cells would create a second, weaker
evaluator beside the real one, with its own scoping and error rules, and the
sheet already has somewhere to put arithmetic.

## Errors name the cell

"Row 2 of column `load` is empty" is actionable; "invalid table" is not. The
grid is the thing the reader is looking at, so an error about it should give
coordinates into what they can see.

Two cases are deliberately *not* errors:

- **Trailing blank rows.** An empty row under the data is what a grid looks
  like while someone is typing into it. Erroring would make the table flash red
  through every edit.
- **A table with nothing in it at all.** A table just inserted is not a broken
  table, in exactly the way an empty math region is not a syntax error
  (`worksheet.ts`). The first version of this shipped a red marker on every new
  table; that was found by inserting one and looking at it.

## A good table has no result

`RegionResult`'s `ok` shape carries one value, and a table produces several. It
could have grown a variant, but a table has nothing to *display* — the grid is
its own output. So column values live beside the results in `Worksheet`, and a
table's result is either absent (fine) or an error.

This turned out to give the right behaviour for free: a region reading a column
of a failed table finds the name missing from the environment, and the existing
machinery reports it as **blocked, naming the table** rather than as an
undefined name.

## Splitting across pages

A table that fits nowhere breaks between its rows, and each piece repeats the
heading. Only a table taller than a whole page is split: one that would fit on
a fresh page is pushed whole, because a table broken for no reason is harder to
read than one that starts lower down.

The split lives in `layout.ts` with the rest of the geometry, so the screen and
the printer cannot disagree about where the break falls. It needs per-row
heights, which only the renderer knows — and once a table is split no single
element holds all its rows, so the measuring pass reads every piece and unions
them. Measuring one piece would shrink the table, which would change the split,
which would change the measurement.

## Consequences

- `RegionAnalysis` gained `provides: string[]`. A math region binds at most one
  name; a table binds one per column, and the binding pass now walks that list.
  `defines` stays the single-name form the language uses.
- The projection emits one line per row, prefixed `|`, each carrying the region
  id — so a caller reading a sheet sees the data a lookup uses instead of a
  summary. `:` already marked text and `|` cannot start a statement, so neither
  can be confused with math.
- Positional binding applies unchanged: a region above the table cannot see its
  columns.
- Editing sends the whole grid as one `update`. Tables are small, and a
  cell-level protocol would be one only this component speaks.
