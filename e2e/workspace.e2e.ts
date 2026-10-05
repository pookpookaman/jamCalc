/**
 * The home screen, tabs and side-by-side panes, and the unsaved copies that
 * come back after a reload.
 */

import type { Page } from "@playwright/test";
import {
  addMath,
  expect,
  newSheet,
  openFiles,
  regions,
  tabTitles,
  test,
  unsavedCopies,
} from "./fixtures.js";

const DECK = "Steel Roof Deck — Gravity";
const TBEAM = "Concrete T-Beam — Flexure";

/** Drags a tab by its title onto a pane body, at a fraction of its width. */
async function dragTab(page: Page, title: string, pane: number, across: number): Promise<void> {
  const tab = page.locator(".tab", { hasText: title });
  const body = page.locator(".pane-body").nth(pane);
  const box = await body.boundingBox();
  if (!box) throw new Error("pane not drawn");
  await tab.dragTo(body, { targetPosition: { x: box.width * across, y: 200 } });
}

test("starts on the home screen with nothing open", async ({ page }) => {
  await expect(page.locator(".home")).toBeVisible();
  await expect(page.locator(".tab")).toHaveCount(0);
  await expect(page).toHaveTitle(/^Home/);
});

test("opened files each get a tab, and the last comes to the front", async ({ page }) => {
  await openFiles(page, "steel-deck-gravity.jc", "concrete-tbeam-flexure.jc");
  expect(await tabTitles(page)).toEqual([[DECK, TBEAM]]);
  await expect(page.locator(".tab.is-active")).toContainText(TBEAM);
  await expect(page).toHaveTitle(new RegExp(`^${TBEAM}`));
  // Freshly opened is not unsaved.
  await expect(page.locator(".tab.is-dirty")).toHaveCount(0);
});

// 27 Sep: a field left editing in a sheet sent behind another tab left
// MathLive's focus note stale, and the next field to take focus crashed the app.
test("switching tabs mid-edit, then editing the other sheet", async ({ page }) => {
  await newSheet(page);
  await page.keyboard.press("m");
  await expect(page.locator("math-field")).toBeFocused();
  await page.keyboard.type("x:=1");
  await openFiles(page, "steel-deck-gravity.jc");
  await expect(regions(page)).toHaveCount(42);
  await addMath(page, "y:=2");
  await expect(regions(page)).toHaveCount(43);
  // What was typed before the switch was kept, not lost with the field.
  await page.locator(".tab", { hasText: "Untitled" }).click();
  await expect(regions(page).first()).toContainText("x");
});

test("closing a tab with unsaved changes asks first", async ({ page }) => {
  await newSheet(page);
  await addMath(page, "a:=1");
  await expect(page.locator(".tab.is-dirty")).toHaveCount(1);
  await expect.poll(() => unsavedCopies(page)).toHaveLength(1);

  page.once("dialog", (d) => void d.dismiss());
  await page.locator(".tab .tab-close").click();
  await expect(page.locator(".tab")).toHaveCount(1);

  page.once("dialog", (d) => void d.accept());
  await page.locator(".tab .tab-close").click();
  await expect(page.locator(".home")).toBeVisible();
  // Closed on purpose: the copy goes too.
  await expect.poll(() => unsavedCopies(page)).toHaveLength(0);
});

test("unsaved work comes back from the home screen, still unsaved", async ({ page }) => {
  await openFiles(page, "steel-deck-gravity.jc");
  await addMath(page, "extra:=1");
  await expect.poll(() => unsavedCopies(page)).toHaveLength(1);

  await page.reload();
  await expect(page.locator(".home")).toBeVisible();
  await expect(page.locator(".tab")).toHaveCount(0);
  const offered = page.locator(".home-unsaved li", { hasText: DECK });
  await expect(offered).toBeVisible();
  await offered.getByRole("button", { name: "Restore" }).click();

  await expect(regions(page)).toHaveCount(43);
  await expect(page.locator(".tab.is-dirty")).toHaveCount(1);
});

test("discarding unsaved work from the home screen", async ({ page }) => {
  await newSheet(page);
  await addMath(page, "a:=1");
  await expect.poll(() => unsavedCopies(page)).toHaveLength(1);
  await page.reload();
  page.once("dialog", (d) => void d.accept());
  await page.getByRole("button", { name: "Discard" }).click();
  await expect(page.locator(".home-unsaved")).toHaveCount(0);
  expect(await unsavedCopies(page)).toHaveLength(0);
});

test("split side by side, then drag the tab back", async ({ page }) => {
  await openFiles(page, "steel-deck-gravity.jc", "concrete-tbeam-flexure.jc");
  await page.locator(".tabbar-split").click();
  expect(await tabTitles(page)).toEqual([[DECK], [TBEAM]]);
  await expect(page.locator(".pane .canvas:not([hidden])")).toHaveCount(2);

  // An edit in the moved sheet must survive the move back: the sheet is
  // moved, not rebuilt.
  await addMath(page, "moved:=1");
  const count = await regions(page).count();
  await dragTab(page, TBEAM, 0, 0.5);
  expect(await tabTitles(page)).toEqual([[DECK, TBEAM]]);
  await expect(regions(page)).toHaveCount(count);
  await expect(page.locator(".tab.is-dirty")).toContainText(TBEAM);
});

test("dragging a tab onto a pane's edge splits it there", async ({ page }) => {
  await openFiles(page, "steel-deck-gravity.jc", "concrete-tbeam-flexure.jc");
  await dragTab(page, DECK, 0, 0.95);
  expect(await tabTitles(page)).toEqual([[TBEAM], [DECK]]);
});

test("a page wider than its pane can be scrolled to its left edge", async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 800 });
  await openFiles(page, "steel-deck-gravity.jc", "concrete-tbeam-flexure.jc");
  await page.locator(".tabbar-split").click();
  for (const canvas of await page.locator(".canvas:not([hidden])").all()) {
    const left = await canvas.evaluate((c) => {
      const p = c.querySelector(".page") as HTMLElement;
      return p.getBoundingClientRect().left - c.getBoundingClientRect().left + c.scrollLeft;
    });
    expect(left).toBeGreaterThanOrEqual(0);
  }
});

test("the toolbar follows the pane being worked in", async ({ page }) => {
  await openFiles(page, "steel-deck-gravity.jc", "concrete-tbeam-flexure.jc");
  await page.locator(".tabbar-split").click();
  await page.locator(".pane").first().locator(".page").first().click({ position: { x: 20, y: 400 } });
  await expect(page.locator(".pane").first()).toHaveClass(/is-focused/);
  await expect(page).toHaveTitle(new RegExp(`^${DECK}`));
  await expect(page.locator("table.symbols")).toContainText("DCR_max");
});

