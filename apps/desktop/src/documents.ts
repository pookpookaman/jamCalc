/**
 * Files and windows, on behalf of the sheets open in them.
 *
 * A window holds several sheets, in tabs the renderer
 * owns, so the shell no longer keeps "the" document of a window. It reads and
 * writes files when asked, keeps a recovery copy per sheet, and owns the two
 * things only it can: the file dialogs and the window's title bar. Which sheet
 * a file becomes, which tab it goes in and whether it has unsaved changes are
 * the renderer's to know.
 */

import { app, BrowserWindow, dialog, ipcMain } from "electron";
import { basename, resolve } from "node:path";
import {
  clearSheetRecovery,
  fileFilters,
  isRecoveryId,
  listRecovered,
  listTemplates,
  pruneRecent,
  readText,
  rememberRecent,
  removeTemplate,
  writeAtomically,
  writeSheetRecovery,
  writeTemplate,
} from "./files.js";

interface WindowState {
  /** Whether the renderer has subscribed to documents; one sent before is lost. */
  listening: boolean;
  /** Files handed to the app before the renderer was listening. */
  pending: string[];
  /** Set once the renderer has dealt with unsaved sheets, so the close goes through. */
  closeApproved: boolean;
}

/** Where the app keeps recovery copies and the recent list. */
const dataRoot = (): string => app.getPath("userData");

const states = new WeakMap<BrowserWindow, WindowState>();

const stateFor = (window: BrowserWindow): WindowState => {
  let state = states.get(window);
  if (!state) {
    state = { listening: false, pending: [], closeApproved: false };
    states.set(window, state);
  }
  return state;
};

/**
 * Files the user has pointed the app at.
 *
 * The renderer names the file a sheet is saved to, and the renderer shows
 * documents from outside. So a save goes only to a path the user chose here —
 * in a dialog, on the command line, from the recent list — or one the app was
 * already keeping a copy for. Anything else is refused, and a page that had
 * somehow been turned against the machine could not write where it liked.
 */
const granted = new Set<string>();
const key = (path: string): string =>
  process.platform === "win32" ? resolve(path).toLowerCase() : resolve(path);
const grant = (path: string): void => {
  granted.add(key(path));
};
const isGranted = (path: string): boolean => granted.has(key(path));

let recentChanged: (list: readonly string[]) => void = () => {};

/** Called with the new recent list whenever it changes, to rebuild the menu. */
export function onRecentChanged(listener: (list: readonly string[]) => void): void {
  recentChanged = listener;
}

/** Records a document in our list and in the operating system's. */
async function noteRecent(path: string): Promise<void> {
  const list = await rememberRecent(dataRoot(), path);
  // The jump list on Windows, the Recent Items menu on macOS.
  app.addRecentDocument(path);
  recentChanged(list);
}

/** Reads a file and hands it to the renderer, which decides what it becomes. */
async function deliver(window: BrowserWindow, path: string): Promise<void> {
  let text: string;
  try {
    text = await readText(path);
  } catch (e) {
    await dialog.showMessageBox(window, {
      type: "error",
      message: `${basename(path)} could not be opened.`,
      detail: (e as Error).message,
    });
    return;
  }
  grant(path);
  // The renderer parses it. If the file is not a sheet, it reports that in the
  // language of sheets, which the shell does not speak.
  window.webContents.send("document:opened", { path, text });
  await noteRecent(path);
}

/**
 * Opens a file in the window, as a new tab.
 *
 * The renderer hears about a document only once it has subscribed, some time
 * after the page loads. Sent any earlier, the file would be dropped without a
 * word, so it waits until the renderer says it is listening.
 */
export async function openPath(window: BrowserWindow, path: string): Promise<void> {
  const state = stateFor(window);
  if (!state.listening) {
    state.pending.push(path);
    return;
  }
  await deliver(window, path);
}

/** Shows the open dialog; every file chosen opens in a tab of its own. */
export async function open(window: BrowserWindow): Promise<void> {
  const result = await dialog.showOpenDialog(window, {
    title: "Open sheet",
    filters: fileFilters(app.getName()),
    properties: ["openFile", "multiSelections"],
  });
  if (result.canceled) return;
  for (const path of result.filePaths) await openPath(window, path);
}

/**
 * The title bar names the sheet being worked in, with a marker for unsaved.
 *
 * A leading dot is the convention on Windows and Linux; macOS shows the same
 * thing as a dot in the close button, but the text marker costs nothing and is
 * unambiguous. This is deliberately *not* the staleness warning from
 * ADR-0006 — "not saved" and "not recalculated" are different problems and
 * must not look alike.
 */
function setTitle(window: BrowserWindow, name: string, edited: boolean): void {
  window.setTitle(`${edited ? "• " : ""}${name} — ${app.getName()}`);
  // macOS draws the edited state in the window chrome itself.
  window.setDocumentEdited(edited);
}

/**
 * Wires a window up: its title, and closing only once the renderer has dealt
 * with unsaved sheets.
 */
export function attach(window: BrowserWindow): void {
  const state = stateFor(window);
  setTitle(window, "Home", false);

  // The shell owns the title bar. Left alone, the page's own <title> replaces
  // it on every load, and the sheet name and unsaved marker disappear until
  // something happens to set them again.
  window.on("page-title-updated", (event) => event.preventDefault());

  window.on("close", (event) => {
    // A page that never came up, or has since died, has nothing to ask about
    // and cannot answer: holding the window open would leave no way out.
    if (state.closeApproved || !state.listening || window.webContents.isCrashed()) return;
    // Only the renderer knows which of its sheets are unsaved. It asks, and
    // approves the close once the user has answered.
    event.preventDefault();
    window.webContents.send("window:closeRequested");
  });

  // A reload starts a new page, which has to subscribe again before anything
  // can be handed to it.
  window.webContents.on("did-start-navigation", (_event, _url, isInPlace, isMainFrame) => {
    if (isMainFrame && !isInPlace) state.listening = false;
  });
}

const senderWindow = (event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent) =>
  BrowserWindow.fromWebContents(event.sender);

export function registerHandlers(): void {
  /** The renderer is subscribed: anything waiting to be opened can be sent. */
  ipcMain.on("document:listening", (event) => {
    const window = senderWindow(event);
    if (!window) return;
    const state = stateFor(window);
    state.listening = true;
    const waiting = state.pending.splice(0);
    void (async () => {
      for (const path of waiting) await deliver(window, path);
    })();
  });

  ipcMain.handle("document:open", async (event) => {
    const window = senderWindow(event);
    if (window) await open(window);
  });

  /** Opens a file from the recent list. */
  ipcMain.handle("document:openPath", async (event, path: unknown) => {
    const window = senderWindow(event);
    if (!window || typeof path !== "string") return;
    // Only a file the app itself listed: the renderer offers these, and it
    // must not be able to read whatever it names.
    const recent = await pruneRecent(dataRoot());
    if (!recent.some((p) => key(p) === key(path))) return;
    await openPath(window, path);
  });

  /** Writes a sheet to the file it already belongs to. */
  ipcMain.handle("files:save", async (_event, path: unknown, text: unknown) => {
    if (typeof path !== "string" || typeof text !== "string") return false;
    if (!isGranted(path)) return false;
    await writeAtomically(path, text);
    await noteRecent(path);
    return true;
  });

  /** Asks where, then writes; the path chosen, or null for Cancel. */
  ipcMain.handle("files:saveAs", async (event, suggested: unknown, text: unknown) => {
    const window = senderWindow(event);
    if (!window || typeof text !== "string") return null;
    const name =
      typeof suggested === "string" && suggested.trim() ? basename(suggested) : "Untitled.jc";
    const result = await dialog.showSaveDialog(window, {
      title: "Save sheet",
      defaultPath: name,
      filters: fileFilters(app.getName()),
      properties: ["createDirectory", "showOverwriteConfirmation"],
    });
    if (result.canceled || !result.filePath) return null;
    grant(result.filePath);
    await writeAtomically(result.filePath, text);
    await noteRecent(result.filePath);
    return result.filePath;
  });

  /** The recent list, with files that have since gone dropped. */
  ipcMain.handle("files:recent", async () => pruneRecent(dataRoot()));

  // --- the unsaved copy of each open sheet ----------------------------------

  ipcMain.handle(
    "recovery:write",
    async (_event, id: unknown, text: unknown, meta: unknown) => {
      if (!isRecoveryId(id) || typeof text !== "string") return;
      const m = (meta ?? {}) as { title?: unknown; path?: unknown };
      await writeSheetRecovery(dataRoot(), id, text, {
        ...(typeof m.title === "string" ? { title: m.title } : {}),
        // A path is kept only if the app gave it out: a copy must not become
        // a way to be granted a file.
        ...(typeof m.path === "string" && isGranted(m.path) ? { path: m.path } : {}),
      });
    },
  );

  ipcMain.handle("recovery:clear", async (_event, id: unknown) => {
    if (isRecoveryId(id)) await clearSheetRecovery(dataRoot(), id);
  });

  ipcMain.handle("recovery:list", async () => {
    const found = await listRecovered(dataRoot());
    // A restored sheet saves back to the file it came from, which it may do
    // without the user choosing it again.
    for (const entry of found) if (entry.path) grant(entry.path);
    return found;
  });

  // --- header and footer templates --------------------------------------------

  ipcMain.handle("templates:list", async () => listTemplates(dataRoot()));

  ipcMain.handle("templates:save", async (_event, name: unknown, text: unknown) => {
    if (typeof name !== "string" || typeof text !== "string") return;
    await writeTemplate(dataRoot(), name, text);
  });

  ipcMain.handle("templates:remove", async (_event, name: unknown) => {
    if (typeof name === "string") await removeTemplate(dataRoot(), name);
  });

  // --- the window -------------------------------------------------------------

  ipcMain.on("window:title", (event, name: unknown, edited: unknown) => {
    const window = senderWindow(event);
    if (!window || typeof name !== "string") return;
    setTitle(window, name.slice(0, 200) || "Untitled", edited === true);
  });

  ipcMain.on("window:closeApproved", (event) => {
    const window = senderWindow(event);
    if (!window) return;
    stateFor(window).closeApproved = true;
    window.close();
  });
}
