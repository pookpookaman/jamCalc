# The sheet language

Everything a region can contain. This is a reference, not a tutorial — the
reasoning behind each choice is in the ADR it links to.

The engine is general: it knows units, arithmetic, branching and matrices. It
contains **no design-code content** — no AISC, no ACI, no built-in provisions —
and is not meant to. Those belong in sheets you write.

---

## Statements

A math region holds exactly one statement.

```
a := 1 + 2                  define
a := 1 + 2 =                define and show the value
M := w*L^2/8 = kip*ft       define and show it in a chosen unit
M =                         show a value on its own
M = kN*m                    show it in a chosen unit
f(x, y) := x*y              define a function
```

`:=` defines, `=` displays. One statement may do both, which is
[ADR-0004](decisions/0004-inline-result.md); the alternative is a second region
for every value you want to see, and sheets full of paired regions.

`=` with no unit shows the value in the sheet's unit for its kind of quantity
([ADR-0017](decisions/0017-sheet-settings.md)): kip·ft for a moment in a US
sheet, kN·m in an SI one, or whatever the sheet's settings choose. The number
is written as the sheet's settings say: significant figures or decimals, in normal, scientific or engineering
notation. Neither changes a computed value, only how it is shown.

## Solvers

Three functions take a function of one variable and work on it numerically.
Each carries units through:

```
  gap(d) := d^2*1 kip/ft^2 - 9 kip
  d := root(gap, 0 ft, 10 ft) = ft        ⇒ 3 ft

  w(x) := 2 klf/ft*x
  W := integral(w, 0 ft, 10 ft) = kip     ⇒ 100 kip

  M(x) := 5 kip*x
  V := deriv(M, 2 ft) = kip               ⇒ 5 kip
```

| | |
|---|---|
| `root(f, a, b)` | where `f` crosses zero between `a` and `b`. Units of the range. |
| `integral(f, a, b)` | the area under `f` from `a` to `b`. Units of `f` × units of `x`. |
| `deriv(f, x)` | the slope of `f` at `x`. Units of `f` ÷ units of `x`. |

`root` needs a range whose ends give `f` opposite signs, and says so when they
do not — searching wider would risk silently returning the wrong root of
several. `f` must return the same kind of quantity throughout; one that is a
force here and a length there is not something a solver can reason about.

These sample the function; there is no symbolic algebra.

## Data tables

A table region is a grid of numbers with named, united columns. **Each column
binds its own name** as a column vector, so the language you already have can
use it:

```
  span (ft) | load (klf)
         10 |        2.4
         20 |        1.8
         30 |        1.2

  w := linterp(span, load, 22 ft) = klf     ⇒ 1.68 klf
```

Column names follow the same rules as any other name, and two columns may not
claim the same one. A column with no unit holds plain numbers. Blank rows at
the bottom are ignored, and a table nobody has typed in yet is not an error;
anything else — an empty cell above the last used row, an unreadable unit — is
reported against the cell or column at fault. A region *above* the table cannot
see its columns, exactly as with any other definition.

Cells hold numbers, not expressions ([ADR-0012](decisions/0012-data-tables.md)).

A table too tall for a page breaks between its rows when printed, and each page
repeats the heading.

## Text regions

A text region holds prose. **Enter** starts a new line inside it, with or
without Shift; **Escape**, or clicking away, finishes editing. Resize it and
the text fills the box, so clicking anywhere inside starts editing rather than
only on the words themselves.

## Text alignment

A text region can be left, centred or right aligned. Alignment belongs to the
block, not to the characters in it — there is no aligning three words in the
middle of a sentence — so it is a property of the region rather than of a run,
and left is the absence of the property rather than a stored value.

## Values inside prose

A text region may quote a value from the sheet by name, written `{name}`:

```
  The governing moment is {M_u} at midspan.
```

It shows the sheet's own value and follows it when the sheet changes, so a
number in a sentence can never drift from the number in the calculation. The
same positional rule applies — prose above a definition cannot see it — and a
name the sheet does not define leaves `{name}` visible with a marker on the
region, rather than a silent gap.

Doubled braces are literal: `{{` prints as `{`.

## Off the sheet

The canvas is wider than the page. A region moved past the right edge is still
part of the sheet — it computes, it binds names, and a value defined out there
can be used on the page — but it is not printed, and the app says how many
regions that applies to before you print rather than after.

## Images

An image region holds a picture embedded in the document, so a `.jc` stays one
file. Remote URLs are refused: a sheet that fetches its own illustration
depends on a network it may not have when printed.

## Plots

A plot region draws named vectors against each other, with unit-aware axes:

```
  ~ plot load vs span
```

It holds no data of its own, so it cannot disagree with the sheet: it redraws
when its values change, and reports which region is at fault when they fail.
Anything that produces a column will do — a table column, a range, the result
of `map` ([ADR-0013](decisions/0013-plots.md)).

## Names

Letters, digits, `_`, `'` and Greek. The first `_` starts a subscript when the
name is rendered, so `M_u` prints as *M* with subscript *u*, `f'_c` as *f′* with
subscript *c*, and `phi` as *φ*.

### Keeping a word as written

A Greek letter's name prints as the letter. When the word itself is meant, put
a backtick directly before it:

```
phi := 0.9           prints as  φ
`phi := 0.9          prints as  phi
M_`beta := 1         prints as  M with subscript "beta"
```

The backtick marks one word, either the name or one part of its subscript, and
goes directly before that word. It is **part of the name**: `phi` and `` `phi ``
are two different names, and each prints the same way everywhere it is used.
Using one where only the other is defined is an error that names the spelling
that does exist. In the math editor, type the backtick like any other key
([ADR-0015](decisions/0015-literal-names.md)).

A name is a value **or** a function, never both.

## Numbers and units

A unit follows a number directly. This is not multiplication — it is part of
the literal ([ADR-0003](decisions/0003-implicit-multiplication.md)):

```
25 ft        2.4 klf        95.4 in^3        50 ksi
```

**There is no implicit multiplication anywhere else.** Write `2*L`, not `2L`.
`f(x)` is a call; only a trailing `:=` makes it a definition.

Because the unit suffix binds tightest, `1/2 kip` is `1/(2 kip)`. In the 2-D
editor you see `2 kip` sitting in the denominator, so this only bites when
writing linear source.

### Unit expressions

`kip*ft`, `lbf/in^2`, `in^4`, `kip/ft^2`. `·` is accepted for `*`.

| | |
|---|---|
| Length | `m mm cm km in ft yd mi` |
| Force | `N kN MN lb lbf kip kgf tonf` |
| Mass | `kg g tonne lbm slug` |
| Stress / pressure | `Pa kPa MPa GPa psi ksi psf ksf` |
| Line load | `pli plf klf kN_m` |
| Volume / flow | `gal gpm` (compound: `ft^3/min`, `gal/min`, …) |
| Power | `W kW hp` |
| Moment / energy | `J` (compound: `kip*ft`, `kN*m`, …) |
| Angle | `rad deg` |
| Time | `s min hr day` |
| Temperature | `K degC degF delta_degC delta_degF` |

**`lb` is force**; mass is `lbm` or `slug`
([ADR-0002](decisions/0002-pound-is-force.md)). `kg` is mass; `kgf` is force.

`degC` is an *absolute* temperature. A temperature **change** is
`delta_degC` — thermal expansion wants the second, and an affine unit cannot
appear inside a compound unit.

Dimension exponents are exact rationals, so `sqrt(f_c)` works: its dimension is
`force^(1/2)/length`, which integer-exponent unit systems cannot represent.

## Operators

Loosest to tightest:

| | |
|---|---|
| `..` | range |
| `< > <= >= == !=` | comparison, giving 1 or 0 |
| `+ -` | |
| `* /` | |
| `^` | right-associative |
| `x[i]` | indexing, tightest |

`-x^2` is `-(x^2)`. `1..n+1` reaches `n+1`.

## Branching

```
if(condition, value, otherwise)
if(c1, v1, c2, v2, fallback)        chained; the trailing odd argument is the fallback
```

Only the branch taken is evaluated, so `if(x >= 0, sqrt(x), 0)` is safe for
negative `x`, and **branches may have different units**. A condition carrying
units is an error, and a chain that matches nothing with no fallback is an
error rather than a silent zero ([ADR-0007](decisions/0007-functions-and-if.md)).

## Functions

```
area(w, h) := w*h
A := area(3 ft, 4 ft) = ft^2
```

Arguments are evaluated in the caller's scope; the body runs in the scope where
the function was defined, plus its parameters. Recursion works and is bounded
at 128 frames.

## Matrices, vectors and ranges

```
m := [1, 2; 3, 4]           rows separated by ";", cells by ","
v := [12 kip; 8 kip]        a vector is an n×1 matrix
i := 1..5                   a range builds a column of whole numbers

v[2]        m[2, 1]         indexing is 1-BASED
m[2]                        one index into a 2-D matrix selects a row
```

Each cell holds its own unit, so a tabulated lookup can mix them.

On the sheet, `v[2]` is drawn as v with subscript 2. An index on a name that
already has a subscript keeps its brackets — `w_t[row]` prints as w<sub>t</sub>[row]
— because run into the name's own subscript it would read as a different name.

`+` and `-` are elementwise and a scalar broadcasts. **`*` between two matrices
is the matrix product, never elementwise** — elementwise is a different
operation and silently choosing it would give plausible wrong answers. Use
`map` for elementwise work ([ADR-0008](decisions/0008-matrices.md)).

## Built-in functions

| | |
|---|---|
| Arithmetic | `sqrt abs floor ceil` |
| Trigonometry | `sin cos tan asin acos atan` — arguments must be dimensionless; `deg` works because angles are scaled dimensionless |
| Logs | `ln log exp` |
| Reductions | `min max sum mean` — over loose arguments, a matrix, or both |
| Matrices | `rows cols transpose` |
| Tables | `linterp(xs, ys, x)` |
| Special forms | `if(...)`, `map(f, v)` |

`sqrt`, `abs`, `floor`, `ceil` and the trigonometric functions apply
cell-by-cell to a matrix.

`linterp` interpolates linearly through a tabulated curve. Its first column
must increase, its units must match the value looked up, and **outside the
table it clamps to the end value rather than extrapolating** — tabulated data
is defined over a stated range, and extrapolating past it produces a confident
number with no basis.

## Errors

Every error carries a code, a source span, a plain message and — for developer
surfaces — a technical `detail`. The message states the problem and stops;
restating a unit clash as SI dimensions is a notation nobody wrote
([ADR-0005](decisions/0005-error-messages.md)).

| Code | Means |
|---|---|
| `syntax` | the text does not parse |
| `unknown_unit` | no such unit, or an affine unit in a compound |
| `unit_mismatch` | units do not combine, or a display unit does not match |
| `undefined_name` | a name no preceding region defines |
| `not_a_function` | called something that is not a function |
| `not_callable` | used a function as a value, or called a value |
| `wrong_arity` | wrong number of arguments |
| `domain` | mathematically undefined, e.g. `sqrt` of a negative |
| `non_integer_exponent` | a dimensioned base raised to a power that is not a simple fraction |
| `dimensioned_exponent` | an exponent carrying units |
| `call_depth` | recursion that does not stop |
| `shape_mismatch` | matrix shapes do not fit the operation |
| `index_out_of_range` | an index outside `1..n` |

One bad region never blanks the sheet. A region downstream of a failure is
reported as **blocked**, naming the region actually at fault, which is a
different thing from having an error of its own.

## Evaluation order

Top to bottom, then left to right by **position on the page**, not order in the
file. A reference resolves to the nearest *preceding* definition, so
redefinition works the way engineers use it:

```
L := 25 ft      trial value
... calcs ...
L := 30 ft      revised; everything below re-runs, nothing above does
```

Ties in vertical position are resolved by quantizing into 12 px bands, so the
comparator stays transitive and the sheet cannot reorder itself after an
unrelated edit.
