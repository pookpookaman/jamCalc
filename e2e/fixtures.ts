/**
 * What every browser test shares.
 *
 * The one rule: a test fails if the page throws or shows the crash screen,
 * whatever it was checking. Several of the bugs these exist for did their
 * damage one step after the thing being tested, so waiting for a test to
 * notice by itself is not enough.
 */

import { expect, test as base, type Locator, type Page } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { existsSync } from "node:fs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
/** One of the maintainer's example sheets, which are kept private. */
export const example = (name: string): string => join(ROOT, "examples", name);

/** A sheet kept as test data, public with the code. */
export const fixture = (name: string): string =>
  join(ROOT, "packages", "engine", "test", "fixtures", name);

export const test = base.extend<{ page: Page }>({
  page: async ({ page }, use) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => {
      if (m.type() === "error" && /stopped rendering|Maximum update depth/.test(m.text())) {
        errors.push(m.text());
      }
    });
    await page.goto("/");
    await use(page);
    expect(errors, "the page threw").toEqual([]);
    await expect(page.locator(".crash"), "the crash screen appeared").toHaveCount(0);
  },
});

export { expect };

/** Regions of the sheet in front of the focused pane. */
export const regions = (page: Page): Locator =>
  page.locator(".pane.is-focused .canvas:not([hidden]) .region");

/** Every tab title, pane by pane. */
export const tabTitles = (page: Page): Promise<string[][]> =>
  page.locator(".pane").evaluateAll((panes) =>
    panes.map((p) =>
      [...p.querySelectorAll(".tab-title")].map((t) => (t as HTMLElement).innerText),
    ),
  );

export async function newSheet(page: Page): Promise<void> {
  await page.getByRole("button", { name: /New sheet/ }).click();
  await expect(page.locator(".tab")).toHaveCount(1);
}

/** Opens example sheets through the page's own file input, as Open… does; skips the
 * test where they are not present. */
export async function openFiles(page: Page, ...names: string[]): Promise<void> {
  const missing = names.filter((n) => !existsSync(example(n)));
  test.skip(missing.length > 0, `needs the private example sheets: ${missing.join(", ")}`);
  const before = await page.locator(".tab").count();
  await page.locator("input[type=file][multiple]").setInputFiles(names.map(example));
  await expect(page.locator(".tab")).toHaveCount(before + names.length);
}

/** Types into the math field being edited, once it has focus, and finishes with Enter. */
export async function typeMath(page: Page, text: string): Promise<void> {
  const field = page.locator("math-field");
  await expect(field).toBeFocused();
  await page.keyboard.type(text);
  await page.keyboard.press("Enter");
  await expect(field).toHaveCount(0);
}

/** A new math region at the cursor, with `text` typed into it. */
export async function addMath(page: Page, text: string): Promise<void> {
  await page.keyboard.press("m");
  await typeMath(page, text);
}

/** The ids of the unsaved copies kept in this browser. */
export const unsavedCopies = (page: Page): Promise<string[]> =>
  page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("jamcalc.unsaved.")));
