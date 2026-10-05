# Architecture

A map of the code, and the invariants that hold it together. Read this before
adding to the engine; the ADRs explain *why* each decision was made, this
explains *where* things live.

## Layers

Text becomes a number through four stages, each a separate module. Nothing
skips a layer.

```
  source text
      │  lexer.ts          characters → tokens
      ▼
   tokens
      │  parser.ts         tokens → AST, with a span on every node
      ▼
    AST  (ast.ts)
      │  eval.ts           AST → Value, in an Environment
      ▼
  Value  (value.ts = Quantity | MatrixValue)
```

Above that sits the document:

```
  document/region.ts    a region: stable id, position, content, authorship
  document/order.ts     evaluation order from position
  document/graph.ts     which region provides which name; dependencies
  document/worksheet.ts regions + cached results + incremental recompute
  document/sheet.ts     the .jc document, canonical serialization
```

And above that, the API:

```
  api/patch.ts          atomic region edits
  api/operations.ts     the callable surface (docs/api.md)
```

Shells consume the API:

```
  packages/cli          calc — a terminal over the operations
  apps/studio           the browser prototype (React)
```

## What each file is for

| File | |
|---|---|
| `rational.ts` | exact fractions; exist only to hold unit dimension exponents |
| `dimension.ts` | 7 SI base dimensions with rational exponents; force is *derived* |
| `quantity.ts` | a number with a dimension, stored in coherent SI |
| `matrix.ts` | a grid of `Quantity`; a vector is n×1 |
| `value.ts` | `Quantity \| MatrixValue`, plus the arithmetic that dispatches over it |
| `units/registry.ts` | name → (scale, dimension). Exact conversion constants |
| `units/parse.ts` | the tiny grammar for `kip*ft`, `in^4` |
| `units/prefer.ts` | the default unit to show a dimension in |
| `units/display.ts` | candidate display units, including compounds, for the picker |
| `notation.ts` | splits `M_u` into base/subscript/primes for rendering |
| `solve.ts` | root-finding, integration and differentiation, in plain numbers |
| `errors.ts` | `CalcError`, `assertNever` |
| `document/text.ts` | rich text as styled runs, the range operations, and `{name}` references |
| `document/format.ts` | number formatting, region over sheet |
| `document/layout.ts` | pagination, and placing a bare point (the cursor) by the same rules; pure, so screen and print agree |
| `document/schema.ts` | the format version and its error type; separate so `sheet` and `migrate` can both use them |
| `document/migrate.ts` | carries an older `.jc` forward before it is parsed |
| `document/table.ts` | a data table's columns as named, united column vectors |
| `document/plot.ts` | a plot's drawable model: points in display units, axis ranges, ticks |
| `latex.ts` | source <-> LaTeX, for the 2-D editor; the document never stores LaTeX |
| `document/projection.ts` | the linear text form, and result formatting |
| `document/source.ts` | edits to a region's source the UI makes on the user's behalf |

## Invariants

These are not style preferences. Each one has a bug behind it.

**The engine imports nothing from the browser or Node.** No DOM, no `fs`, no
framework. That is what keeps [ADR-0001](decisions/0001-typescript-core.md)
reversible — a later port to Rust stays a contained rewrite behind an unchanged
interface.

**Magnitudes are stored in coherent SI.** Display units are a separate,
per-result concern. This is why `1 kip + 1 kN` needs no special case.

**Unit conversion constants are exact definitions, never typed decimals.**
`N_PER_LBF` is derived from the 1959 agreement and standard gravity, not
pasted.

**Every AST `switch` ends in `assertNever`.** TypeScript will not check
exhaustiveness for you. When matrices were added, these guards named the exact
three sites that needed updating.

**Render is pure.** No mutating shared state while rendering — React may invoke
a component more than once per commit, and it will. The caret placement bug in
`MathView` was exactly this.

**Anything a region can do wrong arrives as a `CalcError`.** `UnitParseError`
once extended `Error`, so a bad display unit escaped every `instanceof
CalcError` guard and took down the whole sheet instead of marking one region.

**Anything that could show a wrong number as if it were right gets a visible
marker.** Stale values under manual calculation, machine-authored regions,
blocked regions. The whole product rests on output people seal and submit.

**Pagination knows how tall things are, and the renderer tells it.** Height is
a rendering fact, and pagination is pure so the screen and the printer cannot
disagree — so the shell measures and passes sizes in, and the engine still
decides. A region that does not fit is pushed by an implicit break, never by
rewriting its coordinate.

**The canvas is larger than the paper, and the paper decides what prints.**
A region parked past the right edge still computes, still binds names and still
takes its turn in evaluation order — it simply does not appear on paper, and
says so on screen. `Placement.printable` is computed in the engine for the same
reason pagination is: screen and print must not disagree about what is on the
sheet.

**Identity is the region id; position is layout.** No caller addresses a region
by where it sits. Insert positions are semantic (`after: "r_04"`) and the
engine translates them into geometry.

**A position is a document coordinate, never a page coordinate.** The
worksheet cursor is stored the same way a region is, and `placePoint` /
`pointAt` convert between the two. Storing it as "page 2, 40px down" would
strand it the moment a page break was inserted above it.

**The GUI mutates only through the API operations.** No component builds a
`Sheet` by hand or calls a `Worksheet` mutator. When the shell needs something
the operations cannot say, the fix is a new operation
([ADR-0011](decisions/0011-gui-through-the-api.md)) — the alternative is two
definitions of what an edit means, which is how a GUI and its API drift apart.

**A reader never rejects a document it could carry forward.** `parseSheet`
migrates before it parses. Refusing an unrecognised version is fine while the
only files are in this repo and fatal the day after the first installer ships.

**Nothing that must happen is left to `requestAnimationFrame`.** rAF does not
run in a hidden or occluded window. The cursor's step over a newly inserted
region was written that way, silently did not happen while the app was in the
background, and the next insert landed on top of the last one. Measure in a
layout effect.

## Recompute

`Worksheet` keeps results per region and a dirty set.

- Editing a region's source takes the **cheap path** only if the defined name
  *and* the set of names read are unchanged; then the region and its transitive
  dependents are invalidated.
- Anything else — insert, delete, move, or a changed read set — rebuilds the
  dependency graph, because a name elsewhere may now resolve to a different
  region.
- Clean definitions contribute their cached value to the environment without
  re-running, so the environment stays correct while the expensive part is
  skipped.
- `pending` reports what is out of date, which is what makes manual calculation
  mode honest.

Functions need one extra piece: a cached `RegionResult` holds a `Quantity` and
cannot represent a function, so `Worksheet` keeps function bindings per region
and restores them when a clean function region is reused.

## Performance

The target is sub-100 ms recompute on a 500-region sheet after one edit.
Measured (`test/performance.test.ts`, chained regions — each reading the one
before, the worst case for invalidation):

| regions | cold | edit at end | edit at start | insert |
|---|---|---|---|---|
| 500 | 5.8 ms | 0.33 ms | 2.4 ms | 4.1 ms |
| 1 000 | 8.4 ms | 0.25 ms | 4.9 ms | 7.5 ms |
| 2 000 | 15.8 ms | 0.35 ms | 5.8 ms | 11.9 ms |
| 5 000 | 42.5 ms | 0.83 ms | 7.2 ms | 24.6 ms |
| 10 000 | 71.5 ms | 1.65 ms | 16.1 ms | 46.4 ms |

Everything is linear; there is no cliff inside the range a calc sheet will ever
reach. The target is met at twenty times the target size.

Two numbers are worth understanding rather than just passing:

- **Edit at the start** re-evaluates everything downstream, because everything
  downstream genuinely changed. That is correct work, not waste.
- **Insert** is a full graph rebuild by design: adding a region can change
  which definition every later reference binds to, and only a rebuild knows.
  It is the number that decides whether a structural edit feels instant.

The committed test asserts thresholds several times these figures. A timing
test that fails when the machine is busy teaches people to ignore failures;
what it is guarding is a change of *shape* — an edit going from
proportional-to-the-edit back to proportional-to-the-sheet — which shows up as
orders of magnitude, not percentages.

## Testing

Two runners. `npm test` (Vitest) covers the engine, the CLI, the desktop's
file handling and the decisions pulled out of the studio as plain functions.
`npm run test:ui` (Playwright, `e2e/`) drives the studio in a real browser:
typing into MathLive, clicking and dragging regions, the format bar, tabs,
panes and the unsaved copies. Every browser test fails if the page throws or
shows the crash screen, whatever it was checking.

Tests are written against behaviour that matters rather than implementation:
the ACI concrete-modulus case pins rational exponents, the beam check pins
unit propagation end to end, and the atomic-patch tests pin that a rejected
batch changed nothing. When a test and the code disagree, work out which is
wrong before changing either — twice now the test was right and the code was
not.

## What is not tested

Worth knowing before trusting a green run. The 506 tests cover the engine and
the CLI thoroughly — every engine module but three is exercised directly, and
those three (`lexer`, `rational`, `units/prefer`) are covered through their
callers — plus the desktop's file handling.

**A drag owns the pointer for as long as it runs — but only once it is really
a drag.** Capturing on the press retargets the click that follows to the
capturing element, so a region's own "start editing" never fires and a math box
cannot be opened at all. An edge takes the pointer at once; a press on the body
waits until it has travelled. The element that owns a drag captures the
pointer, so moves are delivered to it rather than to whatever the
cursor happens to be over, and leaving the page no longer cancels it. Selection
is suppressed for the duration, because otherwise the browser reads the same
movement as a text sweep and lights up prose in every box the pointer crosses.
The editor keeps `user-select: text`, so a drag can never steal an editing
session.

**A property control appears only when it would do something.** The rules are
in `formatControls.ts`, tested, and stated in terms of what each region kind
actually *honours* when drawn rather than what the model permits — a plot draws
its labels from the stylesheet, so offering a font size for one would be a lie.

**`apps/studio` is tested from two sides.** Decisions that can be pulled out
of a component are, and are tested as plain functions — `formatTarget.ts` was
the first, `workspace.ts` (tabs and panes) the largest. The wiring between
them and the page — keys, clicks, drags, focus — is covered by the browser
tests in `e2e/`, 20 cases (28 Sep) including each of the regressions that
reached the user: the format-bar crash, the click that stopped opening a
region, the editor's placeholders reaching the parser, the stale focus when
switching tabs mid-edit, and the empty region that re-rendered forever.

Writing them found two more on the first run: a region closed with Enter
straight after typing kept only part of what was typed, and several files
opened at once came out in whatever order they finished reading.

Still not covered: printing (the browser's dialog, and the desktop's print
path — the PDF export is exercised by hand with `--export-pdf`), the desktop
window itself (driven by a script over the DevTools protocol, not in the
suite), the plots' drawing, and the unit picker.

There is also no coverage tooling, so "every module but three" is a structural
count rather than a line count.

## Adding something

| To add | Touch |
|---|---|
| a unit | `units/registry.ts`, and `units/display.ts` if it is worth offering |
| a builtin function | `eval.ts` `BUILTINS` |
| syntax | `lexer.ts`, `ast.ts`, `parser.ts`, `eval.ts`, and `MathView.tsx` to draw it |
| a region kind | `document/region.ts`, `sheet.ts` serialization, `projection.ts`, `SheetEditor.tsx` |
| an API operation | `api/operations.ts`, then the CLI, then `docs/api.md` |

A new value kind is the expensive one: it touches `value.ts`, every arithmetic
site, the projection, and the renderer. The exhaustiveness guards will find
them for you.
