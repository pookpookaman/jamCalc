/**
 * The desktop shell, from the renderer's side.
 *
 * The shell asks; the sheet decides. Printing has to confirm stale values
 * first (ADR-0006) and only the renderer knows whether any are stale, so the
 * menu sends intent rather than doing the work. Files are the other way
 * round: the shell reads and writes them, and the renderer decides which
 * sheet a file becomes and which tab it goes in.
 *
 * Absent in a browser: `window.desktop` is only defined by the Electron
 * preload, so the same studio runs in both places unchanged. Every member
 * past `present` is optional, so a renderer newer than its shell degrades
 * rather than throws.
 */

import { useEffect } from "react";

export type Channel =
  | "print"
  | "exportPdf"
  | "undo"
  | "redo"
  | "recalculate"
  | "new"
  | "save"
  | "saveAs"
  | "closeTab";

/** An unsaved sheet the shell kept from an earlier session. */
export interface Recovered {
  readonly id: string;
  readonly title: string;
  readonly text: string;
  readonly path?: string;
  readonly at: string;
}

export interface DesktopBridge {
  readonly present: true;
  readonly onMenu: (channel: Channel, handler: () => void) => () => void;
  /** Print through Chromium, after the caller's own checks. */
  readonly print?: () => Promise<boolean>;
  readonly exportPdf?: (documentPath: string | null) => Promise<string | null>;
  readonly rendered?: () => void;
  /** The page is ready to be handed documents. */
  readonly listening?: () => void;
  /** Shows the open dialog; each chosen file arrives as an "opened" document. */
  readonly open?: () => Promise<void>;
  /** Reads a file; it arrives as an "opened" document. */
  readonly openPath?: (path: string) => Promise<void>;
  /** Writes a sheet to a file it already has. */
  readonly save?: (path: string, text: string) => Promise<boolean>;
  /** Asks where, then writes; the chosen path, or null if cancelled. */
  readonly saveAs?: (suggestedName: string, text: string) => Promise<string | null>;
  readonly recent?: () => Promise<string[]>;
  readonly recovery?: {
    readonly write: (id: string, text: string, meta: { title: string; path?: string }) => Promise<void>;
    readonly clear: (id: string) => Promise<void>;
    readonly list: () => Promise<Recovered[]>;
  };
  /** Header and footer templates, one plain file each in the app's data folder. */
  readonly templates?: {
    /** The text of every template file. */
    readonly list: () => Promise<string[]>;
    readonly save: (name: string, text: string) => Promise<void>;
    readonly remove: (name: string) => Promise<void>;
  };
  readonly setTitle?: (title: string, edited: boolean) => void;
  /** The window may close now; everything unsaved has been dealt with. */
  readonly approveClose?: () => void;
  readonly onCloseRequest?: (handler: () => void) => () => void;
  readonly onDocument?: (
    event: "opened",
    handler: (payload: { path?: string; text?: string }) => void,
  ) => () => void;
}

declare global {
  interface Window {
    readonly desktop?: DesktopBridge;
  }
}

/** True when running inside the desktop shell. */
export const inDesktop = (): boolean => window.desktop?.present === true;

/**
 * Subscribes to menu commands while `enabled`.
 *
 * With several sheets open only the focused one may answer: every open sheet
 * listening to Print would print them all.
 */
export function useDesktopMenu(
  handlers: Partial<Record<Channel, () => void>>,
  enabled = true,
): void {
  const { print, exportPdf, undo, redo, recalculate, new: newSheet, save, saveAs, closeTab } =
    handlers;

  useEffect(() => {
    const bridge = window.desktop;
    if (!bridge || !enabled) return;
    const wanted: [Channel, (() => void) | undefined][] = [
      ["print", print],
      ["exportPdf", exportPdf],
      ["undo", undo],
      ["redo", redo],
      ["recalculate", recalculate],
      ["new", newSheet],
      ["save", save],
      ["saveAs", saveAs],
      ["closeTab", closeTab],
    ];
    const off = wanted.flatMap(([channel, handler]) =>
      handler ? [bridge.onMenu(channel, handler)] : [],
    );
    return () => {
      for (const stop of off) stop();
    };
  }, [enabled, print, exportPdf, undo, redo, recalculate, newSheet, save, saveAs, closeTab]);
}

/**
 * Prints through the shell when there is one, and through the page otherwise.
 *
 * Chromium's own print path takes the page size from the document and adds no
 * header or footer of its own; a browser tab cannot promise either.
 */
export const printThroughHost = (): void => {
  const bridge = window.desktop;
  if (bridge?.print) void bridge.print();
  else window.print();
};

export const exportPdfThroughHost = (
  documentPath: string | null,
): Promise<string | null> | undefined => window.desktop?.exportPdf?.(documentPath);

/** Tells a headless export that the sheet is drawn. Harmless in a browser. */
export const signalRendered = (): void => window.desktop?.rendered?.();
