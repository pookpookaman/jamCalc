/**
 * The bridge between the shell and the worksheet.
 *
 * The renderer gets named operations and nothing else. No
 * `require`, no filesystem, no Electron internals — so a sheet, which is data
 * from outside, can never reach the machine even if something in the renderer
 * were tricked into trying.
 *
 * Menu items are *notifications of intent*. The shell asks; the renderer
 * decides. Printing with stale values has to be confirmed first (ADR-0006) and
 * only the renderer knows whether any are stale; saving needs the sheet in the
 * tab being worked in, which only the renderer knows.
 *
 * The shape here is `DesktopBridge` in the studio's useDesktopMenu.ts.
 */

import { contextBridge, ipcRenderer } from "electron";

/** Menu events the renderer may subscribe to. */
const CHANNELS = [
  "print",
  "exportPdf",
  "undo",
  "redo",
  "recalculate",
  "new",
  "save",
  "saveAs",
  "closeTab",
] as const;
type Channel = (typeof CHANNELS)[number];

contextBridge.exposeInMainWorld("desktop", {
  /** True when running inside the shell rather than a browser tab. */
  present: true,

  /**
   * Prints through Chromium rather than the page's own `window.print()`,
   * so the page size comes from the document and nothing injects a URL or
   * a date of its own. Call only after the stale-value check.
   */
  print: (): Promise<boolean> => ipcRenderer.invoke("print:now"),
  /** The sheet's own file, if it has one, is where the PDF is suggested. */
  exportPdf: (documentPath: string | null): Promise<string | null> =>
    ipcRenderer.invoke("print:pdf", documentPath),

  /** Tells a headless export that the sheet is on screen and settled. */
  rendered: (): void => {
    ipcRenderer.send("document:rendered");
  },

  /**
   * Tells the shell the page is now listening for documents. A file handed to
   * the app at launch waits for this: one sent any earlier would be lost.
   */
  listening: (): void => {
    ipcRenderer.send("document:listening");
  },

  /** Shows the open dialog; each file chosen arrives as an "opened" document. */
  open: (): Promise<void> => ipcRenderer.invoke("document:open"),
  /** Opens a file from the recent list; it arrives as an "opened" document. */
  openPath: (path: string): Promise<void> => ipcRenderer.invoke("document:openPath", path),

  /** Writes a sheet to the file it came from; false if that was refused. */
  save: (path: string, text: string): Promise<boolean> =>
    ipcRenderer.invoke("files:save", path, text),
  /** Asks where, then writes. The path chosen, or null for Cancel. */
  saveAs: (suggestedName: string, text: string): Promise<string | null> =>
    ipcRenderer.invoke("files:saveAs", suggestedName, text),
  recent: (): Promise<string[]> => ipcRenderer.invoke("files:recent"),

  /** The unsaved copy of each open sheet, for a crash or a close between saves. */
  recovery: {
    write: (id: string, text: string, meta: { title: string; path?: string }): Promise<void> =>
      ipcRenderer.invoke("recovery:write", id, text, meta),
    clear: (id: string): Promise<void> => ipcRenderer.invoke("recovery:clear", id),
    list: (): Promise<
      { id: string; title: string; text: string; path?: string; at: string }[]
    > => ipcRenderer.invoke("recovery:list"),
  },

  /** Header and footer templates, one file each in the app's data folder. */
  templates: {
    list: (): Promise<string[]> => ipcRenderer.invoke("templates:list"),
    save: (name: string, text: string): Promise<void> => ipcRenderer.invoke("templates:save", name, text),
    remove: (name: string): Promise<void> => ipcRenderer.invoke("templates:remove", name),
  },

  /** Names the sheet being worked in, for the title bar. */
  setTitle: (title: string, edited: boolean): void => {
    ipcRenderer.send("window:title", title, edited);
  },

  /** Everything unsaved has been dealt with; the window may close. */
  approveClose: (): void => {
    ipcRenderer.send("window:closeApproved");
  },

  /** The window was asked to close; the renderer decides whether it may. */
  onCloseRequest(handler: () => void): () => void {
    const listener = (): void => handler();
    ipcRenderer.on("window:closeRequested", listener);
    return () => ipcRenderer.removeListener("window:closeRequested", listener);
  },

  /** A file the shell has read, to open in a tab. */
  onDocument(
    event: "opened",
    handler: (payload: { path?: string; text?: string }) => void,
  ): () => void {
    if (event !== "opened") throw new Error(`unknown document event: ${String(event)}`);
    const listener = (_e: unknown, payload: { path?: string; text?: string }): void =>
      handler(payload ?? {});
    ipcRenderer.on("document:opened", listener);
    return () => ipcRenderer.removeListener("document:opened", listener);
  },

  /**
   * Subscribes to a menu command. Returns an unsubscribe function, because a
   * React effect that cannot clean up leaks a listener per remount.
   */
  onMenu(channel: Channel, handler: () => void): () => void {
    if (!CHANNELS.includes(channel)) {
      throw new Error(`unknown menu channel: ${String(channel)}`);
    }
    const listener = (): void => handler();
    ipcRenderer.on(`menu:${channel}`, listener);
    return () => ipcRenderer.removeListener(`menu:${channel}`, listener);
  },
});
