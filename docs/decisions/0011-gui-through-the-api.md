# ADR-0011 — The GUI is an API caller

**Status:** Accepted (2026-09-05)
**Implemented in:** `packages/engine/src/api/patch.ts`, `apps/studio/src/useSheet.ts`
**Extends:** [ADR-0009](0009-document-api.md)

## Decision

Every mutation the shell makes goes through `applyPatch`. `useSheet` no longer
builds a new `Sheet` by hand or calls `Worksheet` mutators directly; it builds
operations and applies them, exactly as the CLI does.

The plan always said this: *if the GUI can do something the API can't, that
is a bug, not a roadmap item.* It was true as an intention and false in the
code — the GUI had fifteen mutators and the API could express four of them.

## What the API could not say

Auditing the shell's mutators against the operation set found the gap:

| The GUI could | The API could |
|---|---|
| edit a math source | ✅ `update { source }` |
| replace text | ✅ `update { text }` (plain only) |
| insert, delete | ✅ |
| **style a region** | ✗ |
| **resize a region** | ✗ |
| **set a display unit** | ✗ |
| **set number format** (region or sheet) | ✗ |
| **write styled runs** | ✗ |
| **move to a coordinate** | ✗ |
| **title, title block, page setup, bands** | ✗ |

Every one of those was a place the GUI and a script would disagree about what
the document could be — the API falling behind the GUI, arriving quietly rather than as a
decision.

`update` now also carries `runs`, `style`, `format`, `unit` and `size`, and a
new `configure` operation covers everything that is not a region.

## Coordinates are the exception the rule needed

ADR-0009 made positions semantic: `after: "r_04"`, never a coordinate, because
a caller describing intent should not have to know the geometry.

A direct-manipulation surface is the case that rule does not fit. Dragging a
box *is* a coordinate. Making the GUI invent an anchor for a drag would be a
fiction, and it would reorder the sheet in ways the user did not ask for —
evaluation order is positional, so a wrong anchor changes what the sheet
computes.

So `move` takes exactly one of `after` (semantic, for callers with intent) or
`to` (explicit, for callers with a mouse). Requiring exactly one, rather than
preferring one, means a caller cannot half-say it.

## Two things the shell must pass, and why

**`author: "human"`.** Provenance defaults to `api`, and a machine-authored
region gets a visible marker on the sheet. Routing the GUI through the same
operations without this would have marked every region the user typed,
turning a warning that matters into decoration.

**`record: false`.** The change log records mutations arriving from outside.
One entry per keystroke would bury those and grow the file
without bound.

Both are shell-only concessions in the *context*, not in the operations. What
an operation means is identical either way.

## Statelessness, without recomputing the world

The operations are stateless by design (ADR-0009): each takes a `Sheet` and
returns a new one. A shell cannot rebuild its evaluator on every keystroke, so
`PatchResult` now reports `changed` — every region touched, including ones
shifted to make room and ones deleted — and `configured`.

The shell replays only those into its live `Worksheet`: a source edit takes
the cheap `edit` path, a pure position change takes `move`, and anything else
is replaced. So the operation layer stays the single definition of *what* an
edit means while the incremental evaluator keeps its work proportional to the
edit.

Without `changed` there were only two options, and both were bad: rebuild the
worksheet per keystroke, or let the GUI keep its own mutation paths.

## Consequences

- A rejected patch changes nothing, so the shell needs no rollback. It
  swallows `ApiError` — the request was refused — and rethrows anything else,
  because a fault that is not the operations declining must not be hidden.
- Adding a feature to the GUI now starts by asking what operation expresses
  it. That is the point.
- `configure` writes a change-log entry with an empty region id. That is
  honest — nothing about it belongs to a region — but it means a reader of the
  log has to allow for it.
