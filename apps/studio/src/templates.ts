/**
 * Saved header and footer layouts (docs/headers.md, "Templates").
 *
 * A template is a layout — where things go, what they say, the lines, the
 * logo — and none of a sheet's values. Applying one replaces a sheet's header
 * and footer and keeps its project name, initials and dates, so a sheet can
 * move to the office's new title block without anything being retyped.
 *
 * On desktop each is a plain file in the app's data folder, which an office
 * can copy around; in a browser they live in that browser's storage. Either
 * way a template can be exported to a file and imported from one.
 */

import { readBand, type PageBand } from "@jamcalc/engine";

export interface Template {
  readonly name: string;
  readonly header?: PageBand;
  readonly footer?: PageBand;
}

/** The file format's own marker and version, apart from a sheet's. */
const MARKER = "jamcalcTemplate";
const FORMAT = 1;
const STORE = "jamcalc.templates";
const DEFAULT_KEY = "jamcalc.defaultTemplate";
/** A template holding a logo is still small; anything larger is not one. */
const MAX_TEXT = 4_000_000;

export const cleanName = (name: string): string => name.replace(/\s+/g, " ").trim().slice(0, 60);

export function templateText(t: Template): string {
  return `${JSON.stringify(
    {
      [MARKER]: FORMAT,
      name: t.name,
      ...(t.header ? { header: t.header } : {}),
      ...(t.footer ? { footer: t.footer } : {}),
    },
    null,
    2,
  )}\n`;
}

/**
 * Reads a template, checking every item the way a sheet's bands are checked.
 * A template file comes from anywhere; it is data, and is treated as such.
 */
export function readTemplate(text: string): Template {
  if (text.length > MAX_TEXT) throw new Error("that file is too large to be a template");
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("that file is not a template");
  }
  if (typeof raw !== "object" || raw === null || (raw as Record<string, unknown>)[MARKER] !== FORMAT) {
    throw new Error("that file is not a template");
  }
  const r = raw as Record<string, unknown>;
  const name = typeof r["name"] === "string" ? cleanName(r["name"]) : "";
  if (!name) throw new Error("the template has no name");
  return {
    name,
    ...(r["header"] !== undefined ? { header: readBand(r["header"]) } : {}),
    ...(r["footer"] !== undefined ? { footer: readBand(r["footer"]) } : {}),
  };
}

// --- where they are kept -------------------------------------------------------

function browserStore(): Record<string, string> {
  try {
    const raw = JSON.parse(window.localStorage.getItem(STORE) ?? "{}") as unknown;
    return typeof raw === "object" && raw !== null ? (raw as Record<string, string>) : {};
  } catch {
    return {};
  }
}

/** Every template, by name. One that cannot be read is left out, not fatal. */
export async function listTemplates(): Promise<Template[]> {
  const bridge = window.desktop;
  const texts = bridge?.templates
    ? await bridge.templates.list()
    : Object.values(browserStore());
  const out: Template[] = [];
  for (const text of texts) {
    try {
      out.push(readTemplate(text));
    } catch {
      /* skipped: a broken file must not hide the good ones */
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export async function saveTemplate(t: Template): Promise<void> {
  const text = templateText(t);
  const bridge = window.desktop;
  if (bridge?.templates) {
    await bridge.templates.save(t.name, text);
    return;
  }
  const store = browserStore();
  store[t.name] = text;
  // Quota is the one likely failure, with a large logo; it is left to throw,
  // so saving a template never appears to work when it did not.
  window.localStorage.setItem(STORE, JSON.stringify(store));
}

export async function deleteTemplate(name: string): Promise<void> {
  const bridge = window.desktop;
  if (bridge?.templates) await bridge.templates.remove(name);
  else {
    const store = browserStore();
    delete store[name];
    window.localStorage.setItem(STORE, JSON.stringify(store));
  }
  if (defaultTemplateName() === name) setDefaultTemplate(null);
}

export function defaultTemplateName(): string | null {
  try {
    return window.localStorage.getItem(DEFAULT_KEY);
  } catch {
    return null;
  }
}

export function setDefaultTemplate(name: string | null): void {
  try {
    if (name) window.localStorage.setItem(DEFAULT_KEY, name);
    else window.localStorage.removeItem(DEFAULT_KEY);
  } catch {
    /* storage off: the default simply does not persist */
  }
}

/** The template every new sheet starts with, if one has been chosen. */
export async function defaultTemplate(): Promise<Template | null> {
  const name = defaultTemplateName();
  if (!name) return null;
  try {
    return (await listTemplates()).find((t) => t.name === name) ?? null;
  } catch {
    return null;
  }
}

/** Saves a template as a file the user can hand to someone else. */
export function exportTemplate(t: Template): void {
  const blob = new Blob([templateText(t)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${t.name.replace(/[^\w -]+/g, "_") || "template"}.jctemplate`;
  a.click();
  URL.revokeObjectURL(a.href);
}
