# ADR-0015 — A backtick keeps a word as written

**Status:** Accepted (2026-09-10)
**Implemented in:** `packages/engine/src/lexer.ts`, `packages/engine/src/notation.ts`, `packages/engine/src/eval.ts`

## Decision

A backtick directly before a word in a name keeps that word as written instead
of drawing it as a symbol. `phi` prints as φ; `` `phi `` prints as "phi". It
marks one word, the base or one part of the subscript, so `` M_`beta `` is M
with the subscript "beta".

The backtick is **part of the name**. `phi` and `` `phi `` are different names.

## Why a notation at all

Greek names print as letters because a calc sheet that prints "phi" reads as
code (see `notation.ts`). That rule has no way out: a label that happens to be
spelled like a Greek letter cannot be printed as the word. The escape has to be
something the author writes, since only they know which they meant.

## Why a backtick

It had to be a character the language does not already use, and one the math
editor passes through untouched. Tried in the editor itself: a typed backtick
arrives unchanged, while `$`, `#` and `~` are escaped into LaTeX commands, and
a quote mark is the obvious character to reserve for text should the language
ever need it. A backtick is also the ordinary way of saying "exactly as typed".

## Why part of the name, not only of its drawing

The alternative makes the backtick a display hint on one occurrence, with
`phi` and `` `phi `` the same variable. Then one variable can print as φ in its
definition and as "phi" three lines later, on a page someone is checking
against the definition. A name that always looks the same wherever it appears
is worth more than saving the second spelling.

The cost is a new way to get "not defined" for something visibly defined above.
That is paid for in the error message, which names the spelling that does
exist.

## Where a backtick may go

At the start of the name or straight after an underscore, followed by a letter.
Anywhere else it marks nothing, so it is a syntax error rather than a
character silently folded into a name that could not be typed the same way
twice.
