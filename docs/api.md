# The document API

Read and write a sheet without the app. This is the heart
of the project: everything the GUI does must be expressible here.

Two ways in — the library and the `calc` command. Both are the same
operations; the CLI parses arguments and formats output, nothing more.

```ts
import { getSheet, applyPatch, evaluate, parseSheet } from "@jamcalc/engine";

const sheet = parseSheet(await readFile("beam.jc", "utf8"));
console.log(getSheet(sheet).projection);
```

Operations are **stateless**: each takes a `Sheet`, builds a worksheet, reads
what it needs and discards it. There is no session to open and no server-side
document two callers could disagree about.

**Stability.** Through 0.x, nothing here is promised to stay as it is: names,
fields and the shape of results may change between minor versions. What *is*
promised is that you will be told — every change to an operation, a field or
the file format is listed in [CHANGELOG.md](../CHANGELOG.md), and a sheet is
never silently read differently: older files are carried forward on open, and
one from a newer format is refused with the version it needs
([ADR-0016](decisions/0016-versions.md)). From 1.0 the operations and the
format follow the version scheme: anything that breaks a caller is a major
release.

---

## Reading

### `getSheet(sheet): SheetReport`

```ts
{ title, pages, regions, projection, upToDate }
```

`projection` is the linear text form — the shape to read a sheet in, and the
one to hand a machine. It carries id, source and computed value per line:

```
# Simply Supported Beam

[r_02] w := 2.4 klf                         ⇒ 2.4 klf
[r_03] L := 25 ft                           ⇒ 25 ft
[r_04] M := w*L^2/8 = kip*ft                ⇒ 187.5 kip*ft
```

### `getRegion(sheet, id): RegionReport` · `listRegions(sheet): RegionReport[]`

`listRegions` returns **evaluation order**, not storage order.

```ts
{
  id, kind, source?, text?, defines?,
  status: "ok" | "error" | "blocked" | "empty",
  result?: { value?, unit?, display, si?, dimension? },
  error?: { code, message, span, hint?, detail? },
  blockedBy?, dependsOn?, author: "human" | "api"
}
```

`result.display` is exactly what the sheet shows. `value`/`unit` are the same
number in a named unit, and `si`/`dimension` are there for a caller doing its
own arithmetic — a script has no page to read, so it gets all three. A pure
number (a ratio, a DCR, a flag) has a `value` and no `unit`.

### `listSymbols(sheet): SymbolReport[]`

Every defined name, its value and the region that defines it. This is how a
caller orients itself in an unfamiliar sheet.

### `trace(sheet, id): RegionReport[]`

Everything that feeds a region, in evaluation order. "What feeds this value?"
is the single most useful question when checking someone else's calc.

### `evaluate(sheet, { set? }): EvaluateReport`

A **dry run**. Optional `set` applies input overrides for this run only; the
sheet is not modified. `errors` counts regions that failed or were blocked.

### `exportSheet(sheet, "text" | "json" | "csv"): string`

CSV is one row per math region: `id,defines,source,value,unit,status`.

---

## Writing

### `applyPatch(sheet, operations, { client }): { sheet, inserted }`

**Atomic.** Every operation is validated against a working copy first; if any
fails, nothing is applied and the error names the failing index. A
half-applied batch is the state a caller cannot recover from.

```ts
[
  { op: "insert", kind: "math", after: "r_04", source: "phi := 0.9" },
  { op: "insert", kind: "text", after: "r_04", text: "note" },
  { op: "insert", kind: "pagebreak", after: "r_09" },
  { op: "update", id: "r_03", source: "L := 30 ft" },
  { op: "update", id: "r_01", text: "revised heading" },
  { op: "update", id: "r_01", runs: [{ text: "bold", style: { bold: true } }] },
  { op: "update", id: "r_04", style: { fontSize: 16, color: "#b3261e" } },
  { op: "update", id: "r_04", style: { resultColor: "#1a7f37" } },
  { op: "update", id: "r_04", style: { color: null } },
  { op: "update", id: "r_04", unit: "kN*m" },
  { op: "update", id: "r_04", format: { decimals: 3 } },
  { op: "update", id: "r_06", size: { width: 240 } },
  { op: "delete", id: "r_07" },
  { op: "move",   id: "r_02", after: "r_05" },
  { op: "move",   id: "r_02", to: { x: 300, y: 120 } },
  { op: "configure", title: "Footing F-1", page: { orientation: "landscape" } }
]
```

`configure` sets document-level settings. `header` and `footer` replace a band
whole — `{ height?, enabled?, items: [...] }`, each item a `field`, `text`,
`line`, `box` or `image` with `x`, `y`, `width`, `height` in px from the band's
top-left ([headers.md](headers.md)) — and `null` empties one. `titleBlock`
replaces the title block (`project`, `job`, `subject`, `client`, `by`, `date`,
`checkedBy`, `checkedDate`, `rev`); `page` takes `firstSheet` and
`totalSheets` for numbering within a larger set. `valueUnits` sets the unit a
name is listed in by the values panel — `{ "q_D": "psf" }`, merged, with
`null` putting a name back to its default; it changes nothing on the sheet.

`update` fields other than `source`/`text`/`runs` are cosmetic or
presentational: `style` merges rather than replaces, and a style property set
to `null` goes back to its default (a style left with nothing in it is
removed). In a math region `color` is the equation, its units included, and
`resultColor` is the computed result and its unit. `format` clears a field
set to `undefined`, `size: null` removes an explicit size. `unit` rewrites the
region's source rather than storing an override beside it, for the same reason
`setInputs` does.

`configure` covers everything that is not a region — `title`, `titleBlock`,
`page`, `header`, `footer`, `format` — in the same atomic batch as region
edits.

**A move takes exactly one of `after` and `to`.** `after` is semantic and is
what a caller with intent should use. `to` is explicit coordinates, for a
direct-manipulation surface where the drag *is* a coordinate
([ADR-0011](decisions/0011-gui-through-the-api.md)).

**Positions are semantic.** `after: "r_04"` means "immediately after that
region in evaluation order", never a coordinate. Because order is positional,
the operation translates that into geometry: it slots into the gap below the
anchor when there is one, and only shifts the regions below when there is not.

`insert` may carry an `id`; otherwise one is allocated and returned in
`inserted`.

The result also reports **`changed`** — every region the patch touched,
including ones shifted to make room and ones deleted — and **`configured`**.
A caller holding an incremental evaluator replays only those instead of
rebuilding; it is what lets the GUI be a caller without recomputing the sheet
on every keystroke.

`PatchContext` carries `client`, and optionally `author` (`"human"` or the
default `"api"`) and `record` (whether to append to the change log). The GUI
passes `author: "human"` and `record: false`; both are explained in
[ADR-0011](decisions/0011-gui-through-the-api.md).

### `setInputs(sheet, { name: "value" }, { client }): Sheet`

Sets named inputs and returns the new sheet. It **rewrites the defining
region's source** rather than storing an override beside it — a sheet is a
document that says what it computed, and a hidden override would make the
printed sheet a lie. Any display unit already on the region is preserved, and
a value that does not parse is rejected before anything is written.

### Provenance

Every write records `origin: { author: "api", client, at }` on the regions it
touches, and appends a `changeLog` entry with before and after. This is the
record-keeping half of reviewable outside edits; the review gate that must accompany a future
agent layer is not built yet, and is a prerequisite for it.

---

## Errors

Two types, deliberately.

**`CalcError`** — the *calculation* is wrong. Carries a source span. Codes are
listed in [the language reference](language.md#errors).

**`ApiError`** — the *request* is wrong. Carries the operation index.

| Code | Means |
|---|---|
| `unknown_region` | no region with that id |
| `unknown_name` | no such name on the sheet |
| `invalid_patch` | the operation is not well formed |
| `duplicate_id` | an insert named an id that already exists |
| `wrong_kind` | e.g. updating a text region with `source` |
| `invalid_value` | a `setInputs` value that does not parse |

A caller fixing its own patch has to tell those apart without reading prose.

---

## The `calc` command

`calc` is not packaged on its own yet: in 0.1 it runs from a copy of the
repository, after a build —

```bash
npm run build
node packages/cli/dist/bin.js --version
```

| | |
|---|---|
| `calc show <file>` | the sheet as text |
| `calc regions <file>` | one line per region, in evaluation order |
| `calc symbols <file>` | every defined name and its value |
| `calc region <file> <id>` | one region as JSON |
| `calc trace <file> <id>` | what feeds a region |
| `calc eval <file>` | run it |
| `calc set <file> --set n=v` | set inputs and save |
| `calc patch <file> <ops.json>` | apply operations atomically and save |
| `calc export <file> --as csv\|json\|text` | |

| Option | |
|---|---|
| `--set name=value` | input override, repeatable. Every command that reads a sheet — `show`, `regions`, `symbols`, `region`, `trace`, `eval`, `export` — applies it in memory and never saves it; only `set` saves. `patch` refuses it. |
| `-o, --out <file>` | write here instead of stdout |
| `--client <name>` | recorded as the author of any change |
| `--dry-run` | print what would be written, change nothing |
| `--version` | print the version of jamCalc it is |

Everything `calc` saves records its version in the file, the same as the app
(`savedWith`).

**Exit codes:** `0` success, `1` the sheet has errors or the request was
rejected, `2` bad usage. `eval` and `regions` returning non-zero on a failing
sheet is what makes a firm's sheet library runnable in CI.

An `ApiError` is printed as JSON on stderr, because a script has no span to
look at:

```
$ calc patch beam.jc ops.json
{"code":"unknown_region","message":"no region `r_99`","operation":2,"region":"r_99"}
$ echo $?
1
```

### Worked example

```bash
$ calc eval beam.jc --set "L=40 ft"
r_02   w := 2.4 klf                       2.4 klf
r_03   L := 40 ft                         40 ft
r_04   M := w*L^2/8 = kip*ft              480 kip*ft
r_09   DCR := M/cap =                     1.34172
```

The file is untouched — that is what makes `eval` safe to run in a loop.

---

## Not built yet

A local JSON-RPC server. The operations are the hard part
and they exist; a server is transport over them, and is worth building when
there is a second caller for it.

Deliberately absent: the MCP/agent layer (§5.6) and the review gate it requires
(§5.4). The API is *designed for* an AI consumer — that is why the projection,
the stable ids, the structured errors and the provenance fields exist — but
shipping the agent layer is a separate project with its own prerequisites.
