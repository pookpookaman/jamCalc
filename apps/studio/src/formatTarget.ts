/**
 * What the format bar acts on.
 *
 * Pulled out of the component because it is a decision, not a rendering: given
 * which region is being edited, what is highlighted, and what was highlighted a
 * moment ago, which text does a format action change?
 *
 * It is here because getting it wrong is invisible and expensive. A control
 * that takes focus — a `<select>` can do nothing else — collapses the
 * highlight before its own handler runs, and the answer silently became "the
 * whole region". The user sees the size of an entire paragraph change when
 * they had three words selected.
 */

export interface TextSpan {
  readonly start: number;
  readonly end: number;
}

export interface TextTarget<Id> extends TextSpan {
  readonly id: Id;
}

/**
 * The range to remember, given what is highlighted now.
 *
 * A highlight is worth keeping only while its region is still being edited:
 * its offsets describe text that must still be in front of the user.
 */
export function rememberRange<Id>(
  editing: Id | null,
  selection: TextSpan | null,
  current: TextTarget<Id> | null,
): TextTarget<Id> | null {
  if (editing !== null && selection !== null && selection.end > selection.start) {
    return { id: editing, start: selection.start, end: selection.end };
  }
  if (editing === null) return null;
  return current?.id === editing ? current : null;
}

/**
 * The range a format action applies to: the live highlight, or the one that
 * was live a moment ago in the region still being edited.
 *
 * `null` means there is no text target, and the caller should fall back to
 * styling whole selected regions.
 */
export function formatTarget<Id>(
  editing: Id | null,
  selection: TextSpan | null,
  remembered: TextTarget<Id> | null,
): TextTarget<Id> | null {
  if (editing !== null && selection !== null && selection.end > selection.start) {
    return { id: editing, start: selection.start, end: selection.end };
  }
  return remembered !== null && remembered.id === editing ? remembered : null;
}
