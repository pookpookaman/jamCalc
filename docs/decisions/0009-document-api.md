# ADR-0009 — The document API, and the CLI over it

**Status:** Accepted (2026-09-05)
**Implemented in:** `packages/engine/src/api/`, `packages/cli/`

## Decision

The document API exists as pure functions over a `Sheet`:

| Read | Write |
|---|---|
| `getSheet` — the text projection and counts | `applyPatch` — insert / update / delete / move, atomically |
| `getRegion`, `listRegions` | `setInputs` — set named inputs and return the new sheet |
| `listSymbols` — how a caller orients itself | |
| `trace` — what feeds a value | |
| `evaluate` — a dry run, optionally with overrides | |
| `exportSheet` — text, JSON or CSV | |

The CLI (`calc`) is a wrapper with argument parsing either side. If a command
needs logic the operations do not have, that logic belongs in the engine: the
CLI, the GUI and any future server must not be able to disagree about what an
operation means.

## Operations are stateless

Each takes a `Sheet` and returns a value or a new `Sheet`; it builds a
`Worksheet`, reads what it needs, and throws it away. No sessions, no handles,
no server-side document that a caller believed it owned.

The cost is recomputing a sheet per call. At the sizes this tool targets that
is microseconds, and it buys the property that two callers can never disagree
about state. If it ever matters, a cache is an optimisation behind an
unchanged interface — the reverse would not be true.

## A patch is all-or-nothing

Every operation is validated against a working copy before anything is
returned, and a failure names **which operation index** failed. A partially
applied batch leaves a state the caller cannot reason about or undo, which is
worse than a rejected one.

## Insert positions are semantic

`{ op: "insert", after: "r_04" }` means "immediately after that region in
evaluation order", never a coordinate. Because evaluation order is positional,
the operation has to translate that intent into geometry — it
slots into the gap below the anchor when there is one, and only shifts the
regions below when there is not. Shifting on every insert would turn a
one-region change into a diff touching the whole file.

## Two error types, deliberately

`CalcError` says the *calculation* is wrong and points at a span.
`ApiError` says the *request* is wrong and points at an operation index. A
caller fixing its own patch has to tell those apart without reading prose, and
a CLI has no span to show anyway — which is why the CLI prints `ApiError` as
JSON on stderr and exits 1.

## `setInputs` rewrites the source

Rather than storing an override beside the region. A sheet is a document that
says what it computed; a hidden override would make the printed sheet a lie.
The existing display unit is preserved, and a value that does not parse is
rejected before anything is written.

## Provenance is automatic

Every write records `origin: { author: "api", client }` on the touched region
and appends a `changeLog` entry with before and after. That is the record-keeping
half of reviewable outside edits, and it is now exercised: `calc patch --client agent` marks
exactly the regions it changed.

## Exit codes

`calc eval` and `calc regions` exit 1 when the sheet has errors. Without that
there is no way to run a firm's sheet library in CI, which is the first
non-agent reason the API exists.

## Bug this uncovered

`UnitParseError` extended `Error`, not `CalcError`, so a bad display unit
escaped every `instanceof CalcError` guard and propagated out of `recompute` —
one wrong unit took down an entire sheet instead of marking one region. It now
extends `CalcError`. Anything a region can do wrong must arrive as a
`CalcError`; the CLI found this in an afternoon because it exercises paths the
GUI happens not to.

## Not yet built

A local JSON-RPC server. The operations are the hard part
and they exist; the server is a transport over them. Still deliberately absent:
the MCP/agent layer and the review gate it requires (§5.4, §5.6).
