/**
 * Typing, clicking and dragging on one sheet — and the three regressions that
 * reached the user because nothing drove the page like this.
 */

import { addMath, expect, newSheet, openFiles, regions, test, unsavedCopies } from "./fixtures.js";

test.beforeEach(async ({ page }) => {
  await newSheet(page);
});

test("a definition and a result evaluate as they are typed", async ({ page }) => {
  // Typed at full speed and finished at once with Enter. MathLive reports a
  // change after the keystroke, and the region used to close first and keep
  // only part of what was typed, or nothing (found by these tests, 28 Sep).
  await addMath(page, "a:=5");
  await addMath(page, "b:=a*2=");
  await expect(regions(page)).toHaveCount(2);
  await expect(regions(page).nth(1)).toContainText("10");
  await expect(page.locator("table.symbols")).toContainText("b");
});

// 5cfc7a6: capturing the pointer on press swallowed the click that opens a region.
test("clicking a math region opens it for editing", async ({ page }) => {
  await addMath(page, "a:=5");
  await regions(page).first().click();
  await expect(page.locator("math-field")).toBeFocused();
});

// 5cfc7a6, the other half: a press that travels is a drag, not a click.
test("dragging a region moves it and does not open it", async ({ page }) => {
  await addMath(page, "a:=5");
  const region = regions(page).first();
  const before = await region.boundingBox();
  if (!before) throw new Error("region not drawn");
  await page.mouse.move(before.x + 4, before.y + before.height / 2);
  await page.mouse.down();
  await page.mouse.move(before.x + 80, before.y + before.height / 2 + 120, { steps: 8 });
  await page.mouse.up();
  const after = await region.boundingBox();
  expect(after!.y - before.y).toBeGreaterThan(80);
  await expect(page.locator("math-field")).toHaveCount(0);
});

// f010a27: MathLive's empty-slot marker reached the parser as a stray backslash.
test("a half-typed definition reports the maths, not the editor", async ({ page }) => {
  await addMath(page, "a:=");
  await expect(regions(page).first()).toHaveClass(/is-error/);
  await expect(page.locator("body")).not.toContainText("unexpected character \\");
});

// 8f412a3: choosing a font size for selected text threw, and the window went blank.
test("changing the size of selected text keeps the app up", async ({ page }) => {
  await page.keyboard.press("t");
  await page.keyboard.type("hello world");
  await page.keyboard.press("Shift+Home");
  await page.getByTitle("font size").selectOption("16");
  await expect(regions(page).first().locator("[style*='font-size: 16px']").first()).toBeVisible();
});

test("a sheet holding an empty math region opens", async ({ page }) => {
  // Found 27 Sep: an empty region re-rendered until React gave up.
  await addMath(page, "");
  await expect(regions(page)).toHaveCount(1);
  await expect.poll(() => unsavedCopies(page)).toHaveLength(1);
  await page.reload();
  await page.getByRole("button", { name: "Restore" }).first().click();
  await expect(regions(page)).toHaveCount(1);
});

test("the values list follows the search box", async ({ page }) => {
  await openFiles(page, "steel-deck-gravity.jc");
  const rows = page.locator("table.symbols tbody tr");
  const all = await rows.count();
  await page.getByLabel("Search values").fill("DCR");
  await expect(rows).not.toHaveCount(all);
  for (const text of await rows.allInnerTexts()) expect(text).toMatch(/DCR/i);
});

test("undo takes back the typing, then the insert", async ({ page }) => {
  await addMath(page, "a:=5");
  await expect(regions(page)).toHaveCount(1);
  await page.keyboard.press("Control+z");
  await expect(regions(page).first()).toHaveClass(/is-empty/);
  await page.keyboard.press("Control+z");
  await expect(regions(page)).toHaveCount(0);
  await page.keyboard.press("Control+Shift+z");
  await expect(regions(page)).toHaveCount(1);
});
