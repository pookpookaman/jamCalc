# ADR-0005 — Errors carry a plain message and a separate technical detail

**Status:** Accepted (2026-09-04)
**Implemented in:** `packages/engine/src/errors.ts`, `quantity.ts`, `eval.ts`, `units/parse.ts`

## Decision

Every engine error carries two strings:

| Field | Audience | Example |
|---|---|---|
| `message` | the person writing the calculation | `units do not match — cannot add these quantities` |
| `detail` | developer surfaces and API callers | `add: kg·m^2·s^-2 vs kg·m·s^-2` |

`message` never contains dimensional algebra. `detail` is optional, is shown
only in developer mode, and travels in `toJSON()`.

## Context

The unit-mismatch message used to read:

```
cannot add m and kg·m·s^-2
```

Correct, and close to useless. Those are coherent SI base units — a notation
the engineer never typed and does not think in. Reading them back is a
restatement of the problem, not a route to fixing it.

What is actually actionable is *that* there is a clash and *where* it is. The
error already carries a span pointing at the offending subexpression
(ADR-0003), so the "where" is solved. Naming the two
dimensions adds nothing a reader can act on.

An earlier draft went the other way — resolving dimensions to names, so the
message could read *"cannot add a length to a force."* That reads better, but
it needs a dimension→name table that is wrong as often as it is right: `kip/ft`
is a line load, `psi` and `psf` share a dimension while meaning different
things in practice, and `sqrt(f'c)` has no name at all. A table that is
sometimes confidently wrong is worse than no table.

## One is shown; the rest are a click away

The status bar has room for a single message, and it shows the one belonging to
the selected region, or the first. Saying "and four more" without a way to see
them is worse than saying nothing: the reader knows something is wrong and has
to go hunting for it.

The `+n more` chip opens the full list, in evaluation order — the order the
sheet is read in, not the order regions happen to sit in the file. Each row
carries its own marker, because a region that is *blocked* is waiting on
another rather than broken itself, and the two want telling apart at a glance.
Each also carries a snippet of its source: two regions can fail with the same
sentence, and ``L` is not defined` twice over says nothing about which line to
go and look at.

## Consequences

- The engine cannot be used as a dimensional-analysis teaching tool from its
  messages alone. Acceptable; that is not the product.
- API callers keep the specifics: a CI job has no span to look at, so `detail`
  is the only diagnostic it gets. This is why `detail` is in `toJSON()` rather
  than being a UI-side string.
- Messages that legitimately name a thing still do: `\`F_y\` is not defined`
  names the symbol, because the symbol is what the reader must go and define.
  The rule is about restating *dimensions*, not about being terse everywhere.

## Applies to

`unit_mismatch` (arithmetic, comparisons, min/max), `dimensioned_exponent`,
and display-unit mismatches. Syntax and undefined-name errors were already
written in the reader's terms and are unchanged.
