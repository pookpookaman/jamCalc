/**
 * Files, on behalf of the worksheet.
 *
 * This module moves text. It never parses a sheet, never looks inside one, and
 * has no idea what a region is — that lives in the engine behind the document
 * operations. Main-process code that knows what a region
 * is would be a second definition of the document, and the first thing to
 * drift.
 *
 * It also knows nothing about Electron. Where things are kept is passed in as
 * a directory, so the code whose failure mode is losing someone's work can be
 * tested against a temporary folder rather than only by running the app.
 */

import { constants, promises as fs } from "node:fs";
import { dirname, join } from "node:path";

/** What a `.jc` is called in the open and save dialogs, given the product's name. */
export function fileFilters(product: string): { name: string; extensions: string[] }[] {
  return [
    { name: `${product} sheet`, extensions: ["jc"] },
    { name: "All files", extensions: ["*"] },
  ];
}

/**
 * Writes a file so that a crash cannot leave a half-written one.
 *
 * Temp file, flush to the platter, rename. A rename within a directory is
 * atomic, so the document on disk is either entirely the old one or entirely
 * the new one. Writing in place is the failure that loses the document *and*
 * the backup someone would otherwise have recovered from.
 */
export async function writeAtomically(
  path: string,
  data: string | Uint8Array,
): Promise<void> {
  // Unique per write, not only per process: two writes to one file can be in
  // flight at once — a recovery copy written again before the last one landed
  // — and a shared temp file would let one write's bytes into the other's.
  const temporary = `${path}.${process.pid}.${(writes += 1)}.tmp`;
  const handle = await fs.open(temporary, "w");
  try {
    // Text is UTF-8; a PDF is bytes and must not be re-encoded.
    if (typeof data === "string") await handle.writeFile(data, "utf8");
    else await handle.writeFile(data);
    // Without the flush, the rename can land before the bytes do, and a power
    // cut then leaves an empty file where the document was.
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await renameWithRetry(temporary, path);
  } catch (e) {
    // The old file is untouched; the new bytes must not linger beside it.
    await fs.rm(temporary, { force: true });
    throw e;
  }
}

let writes = 0;

/**
 * How long a replace keeps trying on Windows before giving up: a virus scan
 * of the file just written is typically over in a few milliseconds.
 */
const RENAME_TRIES = [10, 20, 40, 80, 160, 320, 640];

/**
 * A rename that survives Windows briefly holding the target open.
 *
 * Replacing a file by rename fails with EPERM, EACCES or EBUSY while anything
 * — most often a virus scanner looking at what was just written — has it
 * open. It was seen here as an intermittent test failure
 * and is the same failure a quick second save or a recovery copy would hit.
 * Retrying for up to about a second is what the platform expects; any other
 * error, or one that outlasts that, is real and is thrown.
 */
async function renameWithRetry(from: string, to: string): Promise<void> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await fs.rename(from, to);
      return;
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      const transient = code === "EPERM" || code === "EACCES" || code === "EBUSY";
      const wait = RENAME_TRIES[attempt];
      if (!transient || wait === undefined || process.platform !== "win32") throw e;
      await new Promise((r) => setTimeout(r, wait));
    }
  }
}

export async function readText(path: string): Promise<string> {
  return fs.readFile(path, "utf8");
}

export async function exists(path: string): Promise<boolean> {
  try {
    await fs.access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

// --- crash recovery --------------------------------------------------------

/**
 * Where unsaved sheets are kept between saves.
 *
 * Plain `.jc` files beside small notes, not a database: the recovery path is
 * the one that runs on the worst day, and on that day the user must be able to
 * find the file and open it by hand.
 *
 * `root` is the application's data directory, supplied by the caller.
 */
const recoveryDirectory = (root: string): string => join(root, "recovery");

// --- one copy per open sheet -------------------------------------------------

/**
 * Several sheets can be open, and each keeps its own copy under the id the
 * renderer gave it: `<id>.jc` beside `<id>.json`.
 */

/**
 * Whether an id is safe to use as a file name.
 *
 * The id comes from the renderer, and the renderer displays documents from
 * outside. Letters, digits, `-` and `_` only, so no id can climb out of the
 * recovery folder or name something that is not a copy.
 */
export const isRecoveryId = (id: unknown): id is string =>
  typeof id === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(id);

export interface RecoveredSheet {
  readonly id: string;
  /** The sheet's title when the copy was made; empty when it was not recorded. */
  readonly title: string;
  readonly text: string;
  readonly path?: string;
  /** When the copy was made, as an ISO timestamp; empty when unknown. */
  readonly at: string;
}

export async function writeSheetRecovery(
  root: string,
  id: string,
  text: string,
  meta: { title?: string; path?: string },
): Promise<void> {
  if (!isRecoveryId(id)) throw new Error(`not a recovery id: ${String(id)}`);
  const dir = recoveryDirectory(root);
  await fs.mkdir(dir, { recursive: true });
  await writeAtomically(join(dir, `${id}.jc`), text);
  await writeAtomically(
    join(dir, `${id}.json`),
    JSON.stringify(
      {
        at: new Date().toISOString(),
        ...(typeof meta.title === "string" ? { title: meta.title } : {}),
        ...(typeof meta.path === "string" ? { path: meta.path } : {}),
      },
      null,
      2,
    ),
  );
}

/** Forgets one sheet's copy: it was saved, restored or deliberately discarded. */
export async function clearSheetRecovery(root: string, id: string): Promise<void> {
  if (!isRecoveryId(id)) return;
  const dir = recoveryDirectory(root);
  await fs.rm(join(dir, `${id}.jc`), { force: true });
  await fs.rm(join(dir, `${id}.json`), { force: true });
}

/**
 * Every copy left in the folder, newest first.
 *
 * A note that cannot be read costs only the title
 * and the time, and a copy that cannot be read is skipped rather than
 * stopping the others being offered.
 */
export async function listRecovered(root: string): Promise<RecoveredSheet[]> {
  const dir = recoveryDirectory(root);
  let names: string[];
  try {
    names = await fs.readdir(dir);
  } catch {
    return [];
  }

  const found: RecoveredSheet[] = [];
  for (const name of names) {
    if (!name.endsWith(".jc")) continue;
    const id = name.slice(0, -".jc".length);
    if (!isRecoveryId(id)) continue;
    let text: string;
    try {
      text = await readText(join(dir, name));
    } catch {
      continue;
    }
    let meta: { at?: unknown; title?: unknown; path?: unknown } = {};
    try {
      meta = JSON.parse(await readText(join(dir, `${id}.json`))) as typeof meta;
    } catch {
      meta = {};
    }
    found.push({
      id,
      text,
      title: typeof meta.title === "string" ? meta.title : "",
      at: typeof meta.at === "string" ? meta.at : "",
      ...(typeof meta.path === "string" ? { path: meta.path } : {}),
    });
  }

  return found.sort((a, b) => b.at.localeCompare(a.at));
}

// --- recent documents ------------------------------------------------------

const RECENT_LIMIT = 8;
const recentFile = (root: string): string => join(root, "recent.json");

export async function readRecent(root: string): Promise<string[]> {
  try {
    const raw = await readText(recentFile(root));
    const list = JSON.parse(raw) as unknown;
    return Array.isArray(list) ? list.filter((p): p is string => typeof p === "string") : [];
  } catch {
    return [];
  }
}

export async function rememberRecent(root: string, path: string): Promise<string[]> {
  const list = [path, ...(await readRecent(root)).filter((p) => p !== path)].slice(
    0,
    RECENT_LIMIT,
  );
  await fs.mkdir(dirname(recentFile(root)), { recursive: true });
  await writeAtomically(recentFile(root), JSON.stringify(list, null, 2));
  return list;
}

/** Drops entries whose file has since been moved or deleted. */
export async function pruneRecent(root: string): Promise<string[]> {
  const list = await readRecent(root);
  const alive: string[] = [];
  for (const path of list) if (await exists(path)) alive.push(path);
  if (alive.length !== list.length) {
    await writeAtomically(recentFile(root), JSON.stringify(alive, null, 2));
  }
  return alive;
}

// --- header and footer templates ---------------------------------------------

/**
 * One plain file per template, in `templates/` under the data folder: an
 * office can copy them between machines by hand. The file's name comes from
 * the template's; its contents are the renderer's and are not looked into
 * here beyond a size limit.
 */
const templatesDirectory = (root: string): string => join(root, "templates");
const TEMPLATE_EXT = ".jctemplate";
export const MAX_TEMPLATE = 4_000_000;

/**
 * A file name for a template's name. Letters, digits, spaces, `-` and `_`
 * only, so no name can climb out of the folder or name a device.
 */
export function templateFileName(name: string): string | null {
  const safe = name.replace(/[^A-Za-z0-9 _-]+/g, "_").replace(/\s+/g, " ").trim().slice(0, 60);
  if (!safe || /^[ ._]+$/.test(safe) || /^(con|prn|aux|nul|com\d|lpt\d)$/i.test(safe)) return null;
  return `${safe}${TEMPLATE_EXT}`;
}

export async function listTemplates(root: string): Promise<string[]> {
  let names: string[];
  try {
    names = await fs.readdir(templatesDirectory(root));
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const name of names.sort()) {
    if (!name.endsWith(TEMPLATE_EXT)) continue;
    try {
      const text = await readText(join(templatesDirectory(root), name));
      if (text.length <= MAX_TEMPLATE) out.push(text);
    } catch {
      /* unreadable: left out, the others still offered */
    }
  }
  return out;
}

export async function writeTemplate(root: string, name: string, text: string): Promise<void> {
  const file = templateFileName(name);
  if (!file) throw new Error(`not a usable template name: ${JSON.stringify(name)}`);
  if (text.length > MAX_TEMPLATE) throw new Error("template too large");
  await fs.mkdir(templatesDirectory(root), { recursive: true });
  await writeAtomically(join(templatesDirectory(root), file), text);
}

export async function removeTemplate(root: string, name: string): Promise<void> {
  const file = templateFileName(name);
  if (!file) return;
  await fs.rm(join(templatesDirectory(root), file), { force: true });
}
