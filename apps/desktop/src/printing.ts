/**
 * Print and PDF.
 *
 * ADR-0010 chose Electron for exactly this: one Chromium, so a sheet prints
 * the same on every machine and the same as the browser build it was checked
 * in. This is where that promise is kept or broken.
 *
 * Two things the browser could not do are done here. The page size comes from
 * the *document* rather than the printer, and nothing injects a URL, a date or
 * a page number of its own — the sheet's own header and footer are the only
 * furniture on the paper.
 */

import { BrowserWindow, dialog, type WebContents } from "electron";
import { basename, extname, join } from "node:path";
import { promises as fs } from "node:fs";
import { writeAtomically } from "./files.js";

/**
 * Options shared by printing and PDF export.
 *
 * `preferCSSPageSize` is the important one: the studio emits
 * `@page { size: <paper> <orientation>; margin: 0 }` from the sheet's own page
 * setup, and this makes Chromium obey it instead of the printer's idea of a
 * page. Without it the output is scaled to fit and every measured coordinate
 * in the engine is a lie.
 *
 * Margins are none because the sheet already draws its own: the `.page`
 * element is the full sheet of paper and the content box inside it carries the
 * user's margins. Letting Chromium add more would inset the paper within the
 * paper.
 */
const SHARED = {
  printBackground: true,
  margins: { marginType: "none" as const },
  preferCSSPageSize: true,
};

/** Renders the current window to PDF bytes. */
async function render(contents: WebContents): Promise<Buffer> {
  return contents.printToPDF({
    ...SHARED,
    // Chromium's own header and footer are off. A calc sheet that goes out
    // with a URL printed across the top is not a submittable document.
    headerFooter: undefined,
    generateTaggedPDF: false,
  } as Parameters<WebContents["printToPDF"]>[0]);
}

/** A default filename beside the document, or in the user's documents. */
function suggestedName(path: string | null): string {
  if (!path) return "Untitled.pdf";
  const base = basename(path, extname(path));
  return join(path, "..", `${base}.pdf`);
}

/**
 * Exports to PDF, asking where to put it.
 *
 * The stale-value confirmation happens in the renderer before this is called
 * (ADR-0006). A PDF is more likely to be emailed than a print is, so it gets
 * the same guard rather than a weaker one.
 */
export async function exportPdf(
  window: BrowserWindow,
  documentPath: string | null,
): Promise<string | null> {
  const result = await dialog.showSaveDialog(window, {
    title: "Export PDF",
    defaultPath: suggestedName(documentPath),
    filters: [{ name: "PDF", extensions: ["pdf"] }],
    properties: ["createDirectory", "showOverwriteConfirmation"],
  });
  if (result.canceled || !result.filePath) return null;

  const pdf = await render(window.webContents);
  await writeAtomically(result.filePath, pdf);
  return result.filePath;
}

/**
 * Sends the sheet to a printer, showing the system dialog.
 *
 * `silent: false` so the user picks the printer, but the page geometry is
 * ours: what they choose is where it prints, not how it is laid out.
 */
export async function print(window: BrowserWindow): Promise<boolean> {
  return new Promise((resolve) => {
    window.webContents.print({ ...SHARED, silent: false }, (success) => {
      resolve(success);
    });
  });
}

/**
 * Renders a sheet to PDF with no window shown and no dialogs.
 *
 * This is not a test hook: a PDF produced without a
 * printer dialogue is what makes batch export and CI-rendered sheets possible,
 * and it is the only way to check print output automatically rather than by
 * asking someone to look.
 *
 *     electron . --export-pdf sheet.jc out.pdf
 */
export async function exportHeadless(
  rendererUrl: string,
  preload: string,
  input: string,
  output: string,
): Promise<void> {
  const text = await fs.readFile(input, "utf8");

  const window = new BrowserWindow({
    width: 1280,
    height: 900,
    show: false,
    webPreferences: { preload, contextIsolation: true, nodeIntegration: false, sandbox: true },
  });

  // The page subscribes to documents some time after it loads; a sheet sent
  // before then is dropped. Listen before loading so the signal is not missed.
  const listening = new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, 10_000);
    window.webContents.ipc.once("document:listening", () => {
      clearTimeout(timer);
      resolve();
    });
  });
  await window.loadURL(rendererUrl);
  await listening;

  // Hand the sheet over and wait for the renderer to say it has drawn it.
  // A fixed delay would be a race that passes on this machine and fails on a
  // slower one.
  const drawn = new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, 10_000);
    window.webContents.ipc.once("document:rendered", () => {
      clearTimeout(timer);
      resolve();
    });
  });
  window.webContents.send("document:opened", { path: input, text });
  await drawn;

  const pdf = await render(window.webContents);
  await writeAtomically(output, pdf);
  window.destroy();
}
