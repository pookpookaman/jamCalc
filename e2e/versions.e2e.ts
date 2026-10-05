/**
 * The product version, as a user meets it (ADR-0016).
 */

import { readFileSync } from "node:fs";
import { addMath, expect, fixture, newSheet, test } from "./fixtures.js";

const VERSION = (JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string }).version;

test("the home screen shows the version", async ({ page }) => {
  await expect(page.locator(".home-version")).toContainText(VERSION);
});

test("a saved sheet records the version that saved it, and is not then unsaved", async ({ page }) => {
  await newSheet(page);
  await addMath(page, "a:=1");
  await expect(page.locator(".tab.is-dirty")).toHaveCount(1);
  const download = page.waitForEvent("download");
  await page.keyboard.press("Control+s");
  const file = await (await download).path();
  const saved = JSON.parse(readFileSync(file, "utf8")) as { savedWith?: string };
  expect(saved.savedWith).toBe(VERSION);
  // Recording the version is not a change to the sheet.
  await expect(page.locator(".tab.is-dirty")).toHaveCount(0);
});

test("a sheet from a newer version says so, once", async ({ page }) => {
  const text = readFileSync(fixture("format-v1-beam.jc"), "utf8").replace(
    '"title":',
    '"savedWith": "99.0.0",\n  "title":',
  );
  await page.locator("input[type=file][multiple]").setInputFiles({
    name: "newer.jc",
    mimeType: "application/json",
    buffer: Buffer.from(text),
  });
  const notice = page.locator(".sheet-notice");
  await expect(notice).toContainText("99.0.0");
  await expect(notice).toContainText(VERSION);
  await notice.getByRole("button", { name: "OK" }).click();
  await expect(notice).toHaveCount(0);
});

