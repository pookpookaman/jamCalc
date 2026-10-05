# ADR-0008 — Matrices, vectors and ranges

**Status:** Accepted (2026-09-04)
**Implemented in:** `packages/engine/src/matrix.ts`, `value.ts`, `parser.ts`, `eval.ts`

## Decision

```
m := [1, 2; 3, 4]          rows separated by ";", cells by ","
v := [12 kip; 8 kip]       a vector is an n×1 matrix
i := 1..5                  a range builds a column of whole numbers

v[2]        m[2, 1]        indexing, 1-BASED
m[2]                       one index into a 2-D matrix selects a row

sum  mean  max  min        reductions, over a matrix or loose arguments
rows  cols  transpose
map(f, v)                  apply a function to every cell
linterp(xs, ys, x)         interpolate through a tabulated curve
```

## A cell holds a `Quantity`, not the matrix

The matrix does not carry one dimension for all of its cells. That is the
difference between a value model that can hold a **tabulated lookup** — a
column of heights beside a column of coefficients — and one that can only hold
homogeneous arrays. Operations that need homogeneity (adding, reducing) check
for it; the container does not impose it.

## `Value` is a union, not a 1×1 matrix

`Quantity` stays scalar and a `Value = Quantity | MatrixValue` union sits above
it. Making every quantity secretly a 1×1 matrix would have been less code and
worse: the common case is a single number with a dimension, and matrix
handling should be visible where it happens rather than hidden inside every
arithmetic operator.

The cost is real — every site that produced or consumed a `Quantity` had to
say which it now means — and the exhaustiveness checks from ADR-0001 found all
of them.

## Indexing is 1-based

A configurable index origin — 0 by default, changeable per sheet — is a
recurring source of off-by-one errors in sheets that get checked by someone
other than their author. A sheet is read by people who count rows from one, so `v[1]` is the
first value and `v[0]` is an error that says so. Out-of-range errors name the
valid range and state that indexes start at 1.

## `*` is matrix multiplication, never elementwise

Elementwise multiplication of two matrices is a different operation with a
different meaning. Silently choosing it would produce plausible wrong answers,
which is the failure this project exists to avoid. `*` between two matrices is
the mathematical product, a scalar on either side scales, and elementwise work
goes through `map`.

`+` and `-` are elementwise, which is unambiguous, and a scalar broadcasts.

## `linterp` clamps outside the table

Tabulated data in engineering is defined over a stated range. Extrapolating
past it produces a confident number with no basis, so values below the first
point return the first, and above the last return the last. The lookup column
must be increasing, and its units must match the value looked up.

## Ranges

`a..b` builds a column vector of whole numbers, counting down if `b < a`. It
binds looser than arithmetic so `1..n+1` reaches `n+1`, which is what anyone
writing that means. A range with units is an error: a range is a set of
positions, and a position with units is a mistake.

This is *not* an implicit-iteration range variable, where a range
appearing in an expression silently repeats the whole statement. That is
powerful and famously hard to reason about. Building a vector and reducing it
with `sum`/`max`, or applying a function with `map`, says the same thing
explicitly.

## Deliberately deferred

Determinant, inverse, linear solve, slicing, augment/stack, and an elementwise
multiplication operator. None are needed for tabulated lookups or combination
sweeps, which is what the feature was added for, and each has dimensional
questions worth answering separately — a determinant of a matrix with mixed
units, for instance, has no single dimension.
