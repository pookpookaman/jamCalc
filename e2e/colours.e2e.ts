/**
 * Colours on a math region: the equation and the result, separately.
 */

import type { Locator } from "@playwright/test";
import { addMath, expect, newSheet, regions, test, unsavedCopies } from "./fixtures.js";

const colourOf = (l: Locator): Promise<string> => l.evaluate((el) => getComputedStyle(el).color);
const RED = "rgb(179, 38, 30)";
const GREEN = "rgb(26, 127, 55)";

test.beforeEach(async ({ page }) => {
  await newSheet(page);
  await addMath(page, "L:=12ft=in");
  // Finishing an edit leaves the region selected, so the format bar is up.
  await expect(page.locator(".format")).toBeVisible();
});

test("the result and the equation take their own colours", async ({ page }) => {
  const region = regions(page).first();
  const result = region.locator(".mv-result");
  const name = region.locator(".mv-name i").first();
  const defaultResult = await colourOf(result);
  const defaultName = await colourOf(name);

  await page.getByLabel("Result: #b3261e").click();
  await expect.poll(() => colourOf(result)).toBe(RED);
  await expect.poll(() => colourOf(result.locator(".mv-unit"))).toBe(RED);
  // The equation is left as it was.
  expect(await colourOf(name)).toBe(defaultName);

  await page.getByLabel("Equation: #1a7f37").click();
  await expect.poll(() => colourOf(name)).toBe(GREEN);
  // …and the result keeps its own.
  expect(await colourOf(result)).toBe(RED);

  await page.getByLabel("Result: default").click();
  await expect.poll(() => colourOf(result)).toBe(defaultResult);
  expect(await colourOf(name)).toBe(GREEN);
});

test("colours are kept in the sheet and undo like any change", async ({ page }) => {
  const result = regions(page).first().locator(".mv-result");
  const before = await colourOf(result);
  await page.getByLabel("Result: #1a7f37").click();
  await expect.poll(() => colourOf(result)).toBe(GREEN);

  await expect.poll(async () => {
    const [key] = await unsavedCopies(page);
    // The copy is the sheet's text inside a note, so it is unwrapped once.
    return key
      ? page.evaluate((k) => (JSON.parse(localStorage.getItem(k) ?? "{}") as { text?: string }).text ?? "", key)
      : "";
  }).toContain('"resultColor": "#1a7f37"');

  await page.keyboard.press("Control+z");
  await expect.poll(() => colourOf(result)).toBe(before);
});
