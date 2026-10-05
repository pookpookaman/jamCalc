/**
 * Recently opened sheets, for the home screen.
 *
 * On desktop these are files, and the list is the shell's own — the one its
 * File menu shows. A browser cannot reopen a file from disk by its path, so
 * there the list keeps a copy of each sheet as it was last opened or saved,
 * and says so: reopening one opens that copy, not whatever is on disk now.
 */

const KEY = "jamcalc.recent";
const LIMIT = 8;
/** A sheet with large pictures in it is not worth a slot in browser storage. */
const MAX_TEXT = 1_500_000;

export interface RecentEntry {
  /** A path on desktop; a stored copy's key in a browser. */
  readonly key: string;
  readonly title: string;
  /** Desktop only. */
  readonly path?: string;
  /** Browser only: the copy to reopen. */
  readonly text?: string;
  /** Browser only: when the copy was taken. */
  readonly at?: string;
}

const baseName = (path: string): string => path.split(/[\\/]/).pop() ?? path;

function webRead(): RecentEntry[] {
  try {
    const raw = JSON.parse(window.localStorage.getItem(KEY) ?? "[]") as unknown;
    return Array.isArray(raw) ? (raw as RecentEntry[]).filter((e) => typeof e?.text === "string") : [];
  } catch {
    return [];
  }
}

/** Records a sheet opened or saved in a browser. On desktop the shell does this. */
export function rememberRecent(title: string, text: string): void {
  if (window.desktop?.present || text.length > MAX_TEXT) return;
  const entry: RecentEntry = { key: `${Date.now()}`, title: title || "Untitled", text, at: new Date().toISOString() };
  // One entry per title: saving the same sheet again replaces its copy.
  const list = [entry, ...webRead().filter((e) => e.title !== entry.title)].slice(0, LIMIT);
  try {
    window.localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    // Out of room: the recent list is a convenience, never worth an error.
  }
}

export async function listRecent(): Promise<RecentEntry[]> {
  const bridge = window.desktop;
  if (bridge?.present) {
    try {
      const paths = (await bridge.recent?.()) ?? [];
      return paths.map((path) => ({ key: path, title: baseName(path), path }));
    } catch {
      return [];
    }
  }
  return webRead();
}
