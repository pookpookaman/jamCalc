/**
 * The values panel: each value in a unit worth reading, and the unit choosable.
 */

import type { Page } from "@playwright/test";
import { expect, openFiles, test, unsavedCopies } from "./fixtures.js";

const row = (page: Page, name: string) =>
  page.locator("table.symbols tbody tr").filter({ has: page.locator("td.name", { hasText: new RegExp(`^${name}$`) }) });
const shown = (page: Page, name: string) => row(page, name).locator("td.val");

test.beforeEach(async ({ page }) => {
  await openFiles(page, "steel-beam-gravity.jc");
});

test("values are listed in the units they were written in", async ({ page }) => {
  // Once listed as 0.000451389 ksi and 1.475 ft.
  await expect(shown(page, "q_D")).toHaveText("65 psf");
  await expect(shown(page, "d")).toHaveText("17.7 in");
  await expect(shown(page, "t_f")).toHaveText("0.425 in");
  await expect(shown(page, "I_x")).toHaveText("510 in^4");
  await expect(shown(page, "F_y")).toHaveText("50 ksi");
});

test("a computed value is listed in a unit that suits its size", async ({ page }) => {
  // w_D := q_D*s_trib + w_sw has no unit written: klf suits it.
  await expect(shown(page, "w_D")).toHaveText(/ klf$/);
  await expect(shown(page, "M_u")).toHaveText(/ kip\*ft$/);
});

test("a value's unit can be chosen in the list, and is kept with the sheet", async ({ page }) => {
  await shown(page, "L").getByRole("button").click();
  await page.locator(".unit-picker").getByRole("button", { name: "in", exact: true }).click();
  await expect(shown(page, "L")).toHaveText("360 in");
  // The sheet itself is not touched: L is still written as feet on the page.
  await expect(page.locator(".region", { hasText: "30" }).first()).toContainText("ft");

  await expect.poll(async () => {
    const [key] = await unsavedCopies(page);
    return key ? page.evaluate((k) => (JSON.parse(localStorage.getItem(k) ?? "{}") as { text?: string }).text ?? "", key) : "";
  }).toContain('"L": "in"');

  await shown(page, "L").getByRole("button").click();
  await page.locator(".unit-picker").getByRole("button", { name: "Default" }).click();
  await expect(shown(page, "L")).toHaveText("30 ft");
});

test("choosing a unit in the list does not jump to the definition", async ({ page }) => {
  const canvas = page.locator(".canvas:not([hidden])");
  const before = await canvas.evaluate((c) => c.scrollTop);
  await shown(page, "M_u").getByRole("button").click();
  await expect(page.locator(".unit-picker")).toBeVisible();
  expect(await canvas.evaluate((c) => c.scrollTop)).toBe(before);
  await page.keyboard.press("Escape");
  await expect(page.locator(".unit-picker")).toHaveCount(0);
});
