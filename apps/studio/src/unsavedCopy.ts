/**
 * A copy of each open sheet's unsaved work.
 *
 * Nothing opens by itself when the app starts — a clean start every time was
 * the decision — so this copy is not how a sheet comes back. It is what the
 * home screen offers when a session ended with changes that were never saved:
 * a crash, a closed browser tab, a power cut. It is written while a sheet has
 * unsaved changes and removed the moment the sheet is saved or deliberately
 * discarded.
 *
 * In a browser it lives in local storage. The desktop app keeps it as a file,
 * which survives clearing browser data and which a person can find by hand.
 */

import { useEffect, useState } from "react";
import type { Recovered } from "./useDesktopMenu.js";

export type UnsavedEntry = Recovered;

const PREFIX = "jamcalc.unsaved.";
const DEBOUNCE_MS = 800;

/**
 * A title for a copy whose note did not record one, read from the sheet
 * itself, which always has one.
 */
function titleOf(text: string, recorded: string): string {
  if (recorded) return recorded;
  try {
    const title = (JSON.parse(text) as { title?: unknown }).title;
    if (typeof title === "string" && title) return title;
  } catch {
    /* fall through to the generic title */
  }
  return "Sheet from an earlier version";
}

function webList(): UnsavedEntry[] {
  const found: UnsavedEntry[] = [];
  for (let i = 0; i < window.localStorage.length; i++) {
    const key = window.localStorage.key(i);
    if (!key?.startsWith(PREFIX)) continue;
    try {
      const entry = JSON.parse(window.localStorage.getItem(key) ?? "") as Partial<UnsavedEntry>;
      if (typeof entry.text !== "string") continue;
      found.push({
        id: key.slice(PREFIX.length),
        title: typeof entry.title === "string" && entry.title ? entry.title : "Untitled",
        text: entry.text,
        ...(typeof entry.path === "string" ? { path: entry.path } : {}),
        at: typeof entry.at === "string" ? entry.at : "",
      });
    } catch {
      // A copy this build cannot read is left where it is rather than lost.
    }
  }
  return found.sort((a, b) => b.at.localeCompare(a.at));
}

/** The copies kept in this browser, read at once, for the crash screen. */
export function unsavedInBrowser(): UnsavedEntry[] {
  try {
    return webList();
  } catch {
    return [];
  }
}

/** Unsaved sheets left by earlier sessions, newest first. */
export async function listUnsaved(): Promise<UnsavedEntry[]> {
  try {
    const bridge = window.desktop;
    if (bridge?.recovery) {
      return (await bridge.recovery.list()).map((entry) => ({
        ...entry,
        title: titleOf(entry.text, entry.title),
      }));
    }
    return webList();
  } catch {
    // Storage that cannot be read must not stop the home screen appearing.
    return [];
  }
}

/** Forgets an unsaved copy: it was restored, saved, or deliberately discarded. */
export async function discardUnsaved(id: string): Promise<void> {
  try {
    const bridge = window.desktop;
    if (bridge?.recovery) await bridge.recovery.clear(id);
    else window.localStorage.removeItem(PREFIX + id);
  } catch {
    /* nothing to forget, or nowhere to forget it from */
  }
}

export interface Kept {
  /** When the copy was last written; null while there is nothing unsaved. */
  readonly savedAt: Date | null;
  /** Why no copy is being kept, when one should be. */
  readonly note: string | null;
}

/** Keeps the copy for one open sheet up to date. */
export function useUnsavedCopy({
  docId,
  text,
  dirty,
  title,
  path,
}: {
  docId: string;
  text: string;
  dirty: boolean;
  title: string;
  path: string | null;
}): Kept {
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (!dirty) {
        void discardUnsaved(docId);
        setSavedAt(null);
        return;
      }
      const meta = { title, ...(path ? { path } : {}) };
      try {
        const bridge = window.desktop;
        if (bridge?.recovery) {
          void bridge.recovery.write(docId, text, meta);
        } else {
          window.localStorage.setItem(
            PREFIX + docId,
            JSON.stringify({ ...meta, text, at: new Date().toISOString() }),
          );
        }
        setSavedAt(new Date());
        setNote(null);
      } catch (e) {
        // Quota, private browsing, storage turned off. Say so rather than let
        // someone believe their work is being kept.
        setNote(`No copy of the unsaved work is being kept: ${(e as Error).message}`);
      }
    }, DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [docId, text, dirty, title, path]);

  return { savedAt, note };
}
