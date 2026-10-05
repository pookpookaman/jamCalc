/**
 * The desktop shell's main process.
 *
 * ADR-0010: Electron, chosen so that one Chromium prints every sheet the same
 * way on every machine. This file is the window, the menu bar and the start
 * up; files and the sheets open in a window are documents.ts.
 *
 * The rule this file lives under: the main process must
 * not know what a region is. Anything that manipulates a sheet belongs in the
 * engine behind the document operations, reached from the renderer, so the GUI
 * and the API can never disagree (ADR-0011).
 */

import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  shell,
  type MenuItemConstructorOptions,
} from "electron";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { attach, onRecentChanged, open, openPath, registerHandlers } from "./documents.js";
import { pruneRecent } from "./files.js";
import { sheetArgument } from "./launch.js";
import { exportHeadless, exportPdf, print } from "./printing.js";

// CommonJS, not ESM: a sandboxed preload has to be CJS, and having the two
// halves of the shell built the same way is one less thing to get wrong.
const HERE = __dirname;

/*
 * The app's name comes from `productName` in package.json — the one place it
 * is kept. Electron prefers it to the scoped workspace `name`, which would put
 * the user's documents under `AppData/Roaming/@jamcalc/desktop`. The window
 * title, the dialogs, the data folder and the installer all follow it.
 */

/**
 * In development the renderer is Vite's dev server, so an edit to the studio
 * reloads here exactly as it does in a browser. In a packaged build it is the
 * built files on disk. `ELECTRON_RENDERER_URL` is set by `npm run desktop:dev`
 * (scripts/dev.cjs); `npm run dev` alone runs the studio in its own process
 * and cannot set it for this one.
 */
const DEV_URL = process.env["ELECTRON_RENDERER_URL"];

/**
 * Where Help → Documentation goes: `homepage` in apps/desktop/package.json,
 * set when the project has its public address. Until then the item is left
 * out rather than pointing somewhere that is not the documentation.
 */
const DOCS_URL: string = (() => {
  try {
    const pkg = JSON.parse(readFileSync(join(app.getAppPath(), "package.json"), "utf8")) as { homepage?: unknown };
    return typeof pkg.homepage === "string" && /^https:\/\//.test(pkg.homepage) ? pkg.homepage : "";
  } catch {
    return "";
  }
})();

/** The window's own minimum: below this the toolbar wraps into nonsense. */
const MIN_SIZE = { width: 900, height: 600 };

/**
 * One running copy.
 *
 * Double-clicking a sheet while the app is open starts a second process. It
 * hands its file to the window already open and leaves, rather than running a
 * second copy that would share — and fight over — the recovery file. A
 * headless export is exempt: it may run while the app is open.
 */
const headless = process.argv.includes("--export-pdf");
const primary = headless || app.requestSingleInstanceLock();
if (!primary) {
  app.quit();
} else {
  app.on("second-instance", (_event, argv) => {
    const [window] = BrowserWindow.getAllWindows();
    if (!window) return;
    if (window.isMinimized()) window.restore();
    window.focus();
    const path = sheetArgument(argv);
    if (path) void openPath(window, path);
  });
}

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1280,
    height: 900,
    minWidth: MIN_SIZE.width,
    minHeight: MIN_SIZE.height,
    // Nothing is shown until the first paint: a window that appears empty and
    // then fills in reads as a slow start even when it is not.
    show: false,
    backgroundColor: "#f5f4f0",
    title: app.getName(),
    webPreferences: {
      preload: join(HERE, "preload.js"),
      // The renderer gets a named bridge and nothing else:
      // no `require`, no filesystem, no direct access to Electron's internals.
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // A sheet is JSON, never a script. Nothing in a document should be able
      // to reach outside the page, so the defaults stay locked.
      webSecurity: true,
    },
  });

  window.once("ready-to-show", () => window.show());

  // Title, and closing only once unsaved sheets have been dealt with.
  attach(window);

  // A link in a sheet opens in the user's browser, never inside the app: a
  // navigated window would replace the worksheet with a web page and lose the
  // document's chrome.
  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event, url) => {
    const target = new URL(url);
    const here = DEV_URL ? new URL(DEV_URL) : null;
    if (here && target.origin === here.origin) return;
    event.preventDefault();
    void shell.openExternal(url);
  });

  if (DEV_URL) void window.loadURL(DEV_URL);
  else void window.loadFile(join(HERE, "../renderer/index.html"));

  return window;
}

/**
 * Sends a menu command to the focused worksheet.
 *
 * Electron hands a menu click a `BaseWindow`, which has no renderer attached;
 * the focused `BrowserWindow` is the one the user meant.
 */
function toRenderer(channel: string): void {
  BrowserWindow.getFocusedWindow()?.webContents.send(channel);
}

/** Runs a document action against the focused window, if there is one. */
function withWindow(action: (window: BrowserWindow) => unknown): void {
  const window = BrowserWindow.getFocusedWindow();
  if (window) void action(window);
}

/**
 * The menu bar.
 *
 * Open is the shell's: it shows the dialog and hands each file over as a new
 * tab. New, Save, Close Tab and the rest act on the sheet being worked in,
 * which only the renderer knows, so they are sent there.
 */
function buildMenu(recent: readonly string[] = []): void {
  const isMac = process.platform === "darwin";

  const template: MenuItemConstructorOptions[] = [
    ...(isMac
      ? ([{ role: "appMenu" }] satisfies MenuItemConstructorOptions[])
      : []),
    {
      label: "&File",
      submenu: [
        {
          label: "New",
          accelerator: "CmdOrCtrl+N",
          click: () => toRenderer("menu:new"),
        },
        {
          label: "Open…",
          accelerator: "CmdOrCtrl+O",
          click: () => withWindow(open),
        },
        {
          label: "Open Recent",
          submenu:
            recent.length === 0
              ? [{ label: "Nothing yet", enabled: false }]
              : recent.map((path) => ({
                  label: path,
                  click: () => withWindow((window) => openPath(window, path)),
                })),
        },
        { type: "separator" },
        {
          label: "Save",
          accelerator: "CmdOrCtrl+S",
          click: () => toRenderer("menu:save"),
        },
        {
          label: "Save As…",
          accelerator: "CmdOrCtrl+Shift+S",
          click: () => toRenderer("menu:saveAs"),
        },
        { type: "separator" },
        {
          label: "Print…",
          accelerator: "CmdOrCtrl+P",
          click: () => {
            // The renderer owns the decision: it has to confirm stale values
            // first (ADR-0006), and only it knows whether any are stale. It
            // calls back into the shell to do the printing.
            toRenderer("menu:print");
          },
        },
        {
          label: "Export PDF…",
          accelerator: "CmdOrCtrl+Shift+E",
          click: () => toRenderer("menu:exportPdf"),
        },
        { type: "separator" },
        {
          label: "Close Tab",
          accelerator: "CmdOrCtrl+W",
          click: () => toRenderer("menu:closeTab"),
        },
        isMac
          ? { role: "close", accelerator: "CmdOrCtrl+Shift+W" }
          : { role: "quit" },
      ],
    },
    {
      label: "&Edit",
      submenu: [
        // Undo and redo are the sheet's, not the text field's, so they are
        // sent to the renderer rather than using Electron's editing roles.
        {
          label: "Undo",
          accelerator: "CmdOrCtrl+Z",
          click: () => toRenderer("menu:undo"),
        },
        {
          label: "Redo",
          accelerator: "CmdOrCtrl+Shift+Z",
          click: () => toRenderer("menu:redo"),
        },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
      ],
    },
    {
      label: "&View",
      submenu: [
        {
          label: "Recalculate",
          accelerator: "F9",
          click: () => toRenderer("menu:recalculate"),
        },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
        // Developer tools are present but not on a plain key: a user who hits
        // F12 by accident should not be looking at a debugger.
        ...(DEV_URL
          ? ([
              { type: "separator" },
              { role: "reload" },
              { role: "toggleDevTools" },
            ] satisfies MenuItemConstructorOptions[])
          : ([
              {
                label: "Developer Tools",
                accelerator: "CmdOrCtrl+Shift+I",
                click: () => BrowserWindow.getFocusedWindow()?.webContents.toggleDevTools(),
              },
            ] satisfies MenuItemConstructorOptions[])),
      ],
    },
    {
      label: "&Help",
      submenu: [
        // Only once there is somewhere to send people: a menu item that opens
        // a placeholder is worse than none.
        ...(DOCS_URL
          ? ([
              {
                label: "Documentation",
                click: () => {
                  void shell.openExternal(DOCS_URL);
                },
              },
              { type: "separator" },
            ] satisfies MenuItemConstructorOptions[])
          : []),
        {
          label: `About ${app.getName()}`,
          click: () => {
            const window = BrowserWindow.getFocusedWindow();
            const about = {
              type: "info" as const,
              title: `About ${app.getName()}`,
              message: `${app.getName()} ${app.getVersion()}`,
              detail: [
                "Unit-aware engineering calculation sheets.",
                `Electron ${process.versions.electron} · Chromium ${process.versions.chrome}`,
                "Released under the MIT licence.",
                "Includes third-party software; its licences are in THIRD-PARTY.md in the install folder.",
              ].join("\n"),
              buttons: ["OK"],
            };
            void (window ? dialog.showMessageBox(window, about) : dialog.showMessageBox(about));
          },
        },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

/** Printing and PDF, once the renderer has done its own checks. */
function registerPrinting(): void {
  ipcMain.handle("print:now", async (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    return window ? print(window) : false;
  });
  ipcMain.handle("print:pdf", async (event, documentPath: unknown) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    // Only used to suggest where the PDF goes; the user still chooses.
    return window
      ? exportPdf(window, typeof documentPath === "string" ? documentPath : null)
      : null;
  });
}

app.whenReady().then(async () => {
  if (!primary) return;
  registerHandlers();
  registerPrinting();

  // `--export-pdf <in> <out>`: render a sheet and quit, with no window and no
  // dialogs. Batch export, and the only way to check print output without
  // asking a person to look at it.
  const flag = process.argv.indexOf("--export-pdf");
  if (flag >= 0) {
    const [input, output] = process.argv.slice(flag + 1, flag + 3);
    if (!input || !output) {
      console.error("usage: --export-pdf <sheet.jc> <out.pdf>");
      app.exit(2);
      return;
    }
    try {
      await exportHeadless(
        DEV_URL ?? `file://${join(HERE, "../renderer/index.html")}`,
        join(HERE, "preload.js"),
        input,
        output,
      );
      console.log(`wrote ${output}`);
      app.exit(0);
    } catch (e) {
      console.error(`export failed: ${(e as Error).message}`);
      app.exit(1);
    }
    return;
  }
  // Entries whose file has been moved or deleted are dropped rather than
  // offered: a Recent menu that fails when clicked is worse than a short one.
  buildMenu(await pruneRecent(app.getPath("userData")));
  onRecentChanged(buildMenu);
  const window = createWindow();
  // A double-clicked sheet arrives on the command line.
  const initial = sheetArgument(process.argv);
  if (initial) void openPath(window, initial);

  // macOS keeps the app alive with no windows; clicking the dock icon reopens.
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
