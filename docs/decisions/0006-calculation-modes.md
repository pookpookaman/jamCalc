# ADR-0006 — Manual calculation is allowed, but stale values must be unmistakable

**Status:** Accepted (2026-09-04)
**Implemented in:** `packages/engine/src/document/worksheet.ts` (`pending`), `apps/studio`

## Decision

Calculation is automatic by default. A **Manual** mode defers evaluation until
F9. In manual mode:

- Out-of-date **values** are dimmed and dotted-underlined; the formula beside
  them stays crisp, because the formula is current and the value is not.
- Affected regions carry an amber edge.
- The status bar counts them and offers to recalculate.
- Printing with stale values **asks for confirmation first**.
- Switching back to Automatic flushes the backlog immediately.

## Context

Recompute-per-keystroke stops feeling instant on a large sheet, and any tool
that recalculates on edit ends up offering a manual mode for exactly that
reason.

The feature is easy; the hazard is not. Deferred calculation manufactures the
single worst output this program can produce — **a number that is wrong and
looks right**, sitting beside the formula that no longer produces it. On a
sealed and submitted calculation that is a professional liability, and the fact
that the output is neatly typeset makes it worse, not better.

So the mode is not "turn off calculation"; it is "defer calculation *and say
so, everywhere the stale number appears*." The visual treatment is not polish
to be trimmed — it is the feature.

## Consequences

- `Worksheet` exposes `pending` and `isUpToDate`. Nothing else could tell the
  UI what is stale, since results are cached inside the worksheet.
- `pending` is **conservative after a structural change** and reports every
  math region. Inserting, deleting or moving a region can rebind any later
  reference, and computing the true answer means rebuilding the
  dependency graph — which is the work being deferred. So dragging a region in
  manual mode greys the whole sheet. Honest, possibly heavy; revisit if it
  irritates in practice.
- The print confirmation is the same reasoning as the planned review gate
  for outside edits, arriving earlier than expected and for a different cause.
  When that gate is built, the two should share one implementation.
