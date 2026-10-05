# ADR-0013 — A plot names values; it does not hold them

**Status:** Accepted (2026-09-05)
**Implemented in:** `packages/engine/src/document/plot.ts`, `apps/studio/src/PlotRegionBody.tsx`

## Decision

A plot region is 2-D X-Y with unit-aware axes. It carries **no data of its
own** — each trace names two vectors already on the sheet:

```
  ~ plot load vs span
```

Anything that produces a column vector can be drawn: a table column, a range,
the result of `map`.

## Why it holds no data

A plot that carried its own numbers would be a second place for the truth to
live. The copy on the page would go stale when the sheet changed, and it would
not say so — which is the failure this project exists to avoid. Naming the
values makes a stale plot impossible: the plot is downstream of its data in the
dependency graph, so it redraws when the data changes and reports **blocked,
naming the region at fault**, when the data fails.

## The engine computes the model; the shell only draws

Axis ranges, tick positions, tick labels and point coordinates come out of
`buildPlot`. The shell turns them into SVG and nothing else.

Same rule as pagination ([layout.ts](../../packages/engine/src/document/layout.ts)):
the screen, the print path and a future PDF exporter must agree, and they only
can if the geometry has one source. A plot laid out separately for print is a
plot that prints differently from the one that was checked.

## Ticks are 1-2-5, not equal divisions

Dividing a range into five equal parts puts ticks on values like 3.7143.
Nobody reads that off a calc sheet. Steps are 1, 2 or 5 times a power of ten,
and the axis extends to the round values either side of the data.

Tick values are *counted* from the first (`first + i * step`) rather than
accumulated, because repeated addition of 0.1 drifts and the drift ends up in
printed labels.

## SVG, not canvas

It prints at the printer's resolution rather than the screen's. For a document
that exists to be printed, that decides it.

## Not errors

- **A plot just inserted.** It arrives with one empty trace so the two name
  boxes are on screen rather than behind a control the user has to find, and a
  half-named trace stays "not drawn yet" for as long as it takes to type.
- **An empty unit override.** Clearing the axis unit box means "no unit", not a
  unit named `""`. Without that rule it produced ``cannot be drawn on an axis
  in ` ` ``, which explains nothing. A table column already worked this way.

## Consequences

- A plot is the mirror image of a table in the dependency graph: a table binds
  names and reads none, a plot reads names and binds none. Both needed
  `buildGraph` to stop assuming only math regions take part
  ([ADR-0012](0012-data-tables.md) added `provides`; this added `reads`).
- Like a table, a good plot has **no result** — there is nothing to display but
  the picture — so its result slot carries only an error or a blocked marker.
- The projection emits `~ plot y vs x`. The numbers are already on the sheet;
  what a reader needs from the plot line is what is drawn against what.
- Deliberately deferred: log axes, bar and scatter styles, secondary axes,
  manual axis limits. All are additive.
