# ADR-0014 — MathLive edits the notation; the sheet keeps the source

**Status:** Accepted (2026-09-05)
**Implemented in:** `packages/engine/src/latex.ts`, `apps/studio/src/MathLiveField.tsx`

## Decision

MathLive provides 2-D math editing, behind a **toggle**, beside the existing
editor. The document never holds LaTeX: the field is seeded from LaTeX we
generate, and what it hands back is converted to sheet source before anything
is stored.

## Why the document keeps its own source

LaTeX can say vastly more than this language can compute. If LaTeX were the
stored form, every sheet could contain `\int` and `\lim` and the evaluator
would have to either grow to meet them or silently ignore them — a region that
looks like a calculation and produces nothing. The original plan called this out when
it chose MathLive, and the boundary is what keeps the promise.

Keeping our source also means everything already built still works unchanged:
the parser, the projection, the API, the CLI, diffs in git.

## Why the converter is in the engine

`latex.ts` sits beside the parser, not in the shell, because it answers a
language question. What `\frac{a}{b}` means has to be exactly what `a/b` means,
and the only way that holds is if the two live together and are tested
together.

## The round trip is the whole risk

The risk: a lossy round trip corrupts sheets in ways nobody notices
until print. Every edit passes through this converter, so the tests are
round-trip properties over real statements, checked by **parsing both sides and
comparing the trees** — not by comparing text, which would fail on whitespace
and pass on things that matter.

It found the bug it was written for. `(25 ft)^2` came back as `25 ft^2`,
because a united number carried no grouping of its own under an exponent — the
power bound to the unit instead of the quantity, and **187.5 kip·ft became
7.5**. A wrong number that still looks like a calculation is the exact failure
this project exists to prevent, and it survived nothing but a test that
compared meanings.

Two smaller ones came from the same test: `\sin` came back with its backslash
attached, and `phi_M_n` came back as `φ_M,n` because the converter used
`splitName`, which normalises for *display* — it renders `alpha` as α and joins
a nested subscript with a comma. Both right on the page, both wrong here.

## The editor's scaffolding is not content

MathLive marks an empty slot with `\placeholder{}`, and a half-typed
expression is full of them — every unfinished fraction, script and field has
one. Making MathLive the default editor put that in the path of every
keystroke, and one reaching the parser turned the whole region into
"unexpected character `\`": a report about the editor, in a language the
reader never typed. Placeholders are now dropped before conversion.

The same fix found a second leak. A LaTeX command name ends at the first
non-letter, which a word boundary does not capture: between the `e` of `\le`
and a following digit there is no boundary at all, so `a\le5` came through
with its backslash intact while `a\le b` converted fine. Every command match
now ends with a lookahead instead.

What has *not* changed is that an unsupported construct still comes through
visibly. `\int` reaching the parser is a real answer — the language cannot
integrate symbolically — and silently discarding it would be worse.

## Greek round-trips by leaving it alone

`alpha` and `α` are different identifiers to the lexer. So ASCII spellings map
to `\alpha` and back to `alpha`, and a literal α is passed through verbatim.
Neither spelling is silently renamed into the other, which would break every
reference to it.

## MathLive is the editor; the plain one is deprecated

It shipped behind a toggle so the two could be compared on the same sheet,
which was the only way to settle whether the editor felt right. That comparison has been
made and MathLive won.

**It is the editor.** The choice is no longer offered: the toggle has left the
toolbar and survives only in developer mode, as a way to diagnose a sheet the
structured editor mishandles. The plain-text editor will be deleted once
nothing needs it, and the ghost-input path in `RegionBody` goes with it.

Deprecating a thing in a document while leaving its switch in front of the user
is not deprecating it — people go on using what they can see.

## One level of subscript, and no more

`M_u`, `f'_c`, `x^2` — that is what a calc sheet needs. Nesting deeper is
nearly always a slip, and one that is hard to see and harder to climb out of,
so the key toggles: into a script when the caret is outside one, out of it when
inside.

MathLive exposes no way to ask what the caret's parent is, so the editor asks a
different question: what does the text gain when the caret steps out? A script
closes as `_{u}` or `^2`; a fraction closes as `rac{a}{b}`. Only the first
counts, which is why subscripting inside a numerator still works. The predicate
is in `scriptNesting.ts` and tested; the rest was verified against the live
editor, because it depends on how MathLive actually behaves rather than on what
its documentation says.

## A selection you can still read

MathLive's default selection is a solid dark fill, which hides the notation you
selected in order to look at it. A pale wash replaces it.

## Consequences

- The subset is deliberate and incomplete. Anything the converter does not
  recognise is passed through unchanged so the region reports a visible syntax
  error, rather than being quietly dropped.
- MathLive's own menu and virtual-keyboard buttons are hidden: they offer
  operations on LaTeX that the document would discard.
- `mathlive` is the project's first runtime dependency in the shell. The engine
  still has none.
