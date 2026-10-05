/**
 * Headers and footers laid out on the page (docs/headers.md).
 */

import type { Page } from "@playwright/test";
import { expect, newSheet, openFiles, test, unsavedCopies } from "./fixtures.js";

const header = (page: Page, n = 0) => page.locator(".page").nth(n).locator(".band-header");
const footer = (page: Page, n = 0) => page.locator(".page").nth(n).locator(".band-footer");

async function editBands(page: Page): Promise<void> {
  await header(page).dblclick({ position: { x: 300, y: 20 } });
  await expect(page.locator(".band-bar")).toBeVisible();
}

async function dragChip(page: Page, name: string, to: "header" | "footer", at: { x: number; y: number }): Promise<void> {
  const fields = page.locator(".band-fields");
  const chip = page.locator(".band-chip", { hasText: new RegExp(`^${name}$`) }).first();
  if (!(await chip.isVisible())) await fields.locator("summary").click();
  await chip.dragTo(to === "header" ? header(page) : footer(page), { targetPosition: at });
}

test.beforeEach(async ({ page }) => {
  await newSheet(page);
});

test("double-clicking the header sets the sheet aside and shows the palette", async ({ page }) => {
  await editBands(page);
  await expect(page.locator(".page").first()).toHaveClass(/is-editing-bands/);
  await expect(page.locator(".format.band-bar")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(".band-bar")).toHaveCount(0);
});

test("a field dragged onto the header shows the sheet's value on every page", async ({ page }) => {
  await editBands(page);
  await dragChip(page, "Title", "header", { x: 100, y: 20 });
  const item = header(page).locator(".band-item.kind-field");
  await expect(item).toHaveCount(1);
  await expect(item).toContainText("Untitled");
});

test("typing a field's value in place sets it for the sheet", async ({ page }) => {
  await editBands(page);
  await dragChip(page, "Project", "header", { x: 100, y: 20 });
  const item = header(page).locator(".band-item.kind-field");
  // Empty, it shows where the value goes — but only while editing.
  await expect(item.locator(".is-placeholder")).toHaveText("Project");
  await item.dblclick();
  await page.getByLabel("Project", { exact: true }).fill("Warehouse Addition");
  await page.keyboard.press("Enter");
  await expect(item).toHaveText("Warehouse Addition");
  // The same value is in the Page panel's title block.
  await page.locator("aside").getByRole("button", { name: "Page", exact: true }).click();
  await expect(page.locator(".page-panel label.field", { hasText: "Project" }).locator("input")).toHaveValue(
    "Warehouse Addition",
  );
});

test("an empty field prints nothing, not its name", async ({ page }) => {
  await editBands(page);
  await dragChip(page, "Job no.", "header", { x: 100, y: 20 });
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await expect(header(page).locator(".band-item")).toHaveText("");
});

test("an item moves, nudges, and is removed with Delete", async ({ page }) => {
  await editBands(page);
  await dragChip(page, "Title", "header", { x: 100, y: 20 });
  const item = header(page).locator(".band-item").first();
  const before = (await item.boundingBox())!;
  await page.mouse.move(before.x + 10, before.y + 5);
  await page.mouse.down();
  await page.mouse.move(before.x + 210, before.y + 15, { steps: 6 });
  await page.mouse.up();
  const moved = (await item.boundingBox())!;
  expect(moved.x - before.x).toBeGreaterThan(150);

  await page.keyboard.press("ArrowRight");
  await expect.poll(async () => (await item.boundingBox())!.x).toBeGreaterThan(moved.x);

  await page.keyboard.press("Delete");
  await expect(header(page).locator(".band-item")).toHaveCount(0);
});

test("sheet numbers start where the calc sits in a package", async ({ page }) => {
  await editBands(page);
  await page.locator(".band-bar .band-chip", { hasText: /^Text$/ }).click();
  const text = header(page).locator(".band-item.kind-text");
  await text.dblclick();
  await page.getByLabel("Text", { exact: true }).fill("Sheet {sheet} of {sheets}");
  await page.keyboard.press("Enter");
  await expect(text).toHaveText("Sheet 1 of 1");
  await page.getByRole("button", { name: "Done" }).click();

  await page.locator("aside").getByRole("button", { name: "Page", exact: true }).click();
  await page.getByTitle("the number printed on this file's first page").locator("input").fill("12");
  await page.getByTitle(/the package's total/).locator("input").fill("40");
  await expect(text).toHaveText("Sheet 12 of 40");
});

test("the header and footer are kept with the sheet", async ({ page }) => {
  await editBands(page);
  await dragChip(page, "Title", "footer", { x: 60, y: 20 });
  await page.getByRole("button", { name: "Done" }).click();
  await expect.poll(async () => {
    const [key] = await unsavedCopies(page);
    return key ? page.evaluate((k) => (JSON.parse(localStorage.getItem(k) ?? "{}") as { text?: string }).text ?? "", key) : "";
  }).toContain('"field": "title"');
  await page.reload();
  await page.getByRole("button", { name: "Restore" }).first().click();
  await expect(footer(page).locator(".band-item.kind-field")).toHaveText("Untitled");
});

test("an older sheet keeps its header, in the same place", async ({ page }) => {
  await page.locator(".tab .tab-close").click();
  await openFiles(page, "steel-deck-gravity.jc");
  const texts = header(page).locator(".band-item.kind-text");
  await expect(texts).toHaveCount(3);
  await expect(texts.nth(2)).toHaveText("Sheet 1 of 2");
  await expect(header(page, 1).locator(".band-item.kind-text").nth(2)).toHaveText("Sheet 2 of 2");
  // Opening it is not a change.
  await expect(page.locator(".tab.is-dirty")).toHaveCount(0);
});

test("a logo is added, scaled down, and kept in the sheet", async ({ page }) => {
  await editBands(page);
  // A 1200×400 picture: larger than a header logo ever needs to be stored.
  const png = await page.evaluate(async () => {
    const c = document.createElement("canvas");
    c.width = 1200;
    c.height = 400;
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = "#1f5fa8";
    ctx.fillRect(0, 0, 1200, 400);
    return c.toDataURL("image/png").split(",")[1] as string;
  });
  await page.locator(".band-bar input[type=file][accept^='image']").setInputFiles({
    name: "logo.png",
    mimeType: "image/png",
    buffer: Buffer.from(png, "base64"),
  });
  const logo = header(page).locator(".band-item.kind-image img");
  await expect(logo).toHaveCount(1);
  const stored = await logo.evaluate((img: HTMLImageElement) =>
    new Promise<number[]>((r) => {
      const i = new Image();
      i.onload = () => r([i.naturalWidth, i.naturalHeight]);
      i.src = img.src;
    }),
  );
  expect(stored[0]).toBeLessThanOrEqual(600);
  expect(stored[1]).toBeLessThanOrEqual(240);
});

test("a template is saved, applied to another sheet, and keeps that sheet's values", async ({ page }) => {
  await editBands(page);
  await dragChip(page, "Project", "header", { x: 100, y: 20 });
  page.once("dialog", (d) => void d.accept("Office standard"));
  await page.getByRole("button", { name: "Templates" }).click();
  await page.getByRole("button", { name: "Save as template…" }).click();
  await page.getByRole("button", { name: "Done" }).click();

  // A second sheet, with a project name of its own and no header.
  page.once("dialog", (d) => void d.accept());
  await page.locator(".tab .tab-close").click();
  await expect(page.locator(".home")).toBeVisible();
  await page.getByRole("button", { name: /New sheet/ }).click();
  await page.locator("aside").getByRole("button", { name: "Page", exact: true }).click();
  await page.locator(".page-panel label.field", { hasText: "Project" }).locator("input").fill("Bridge 7");
  await expect(header(page).locator(".band-item")).toHaveCount(0);

  await editBands(page);
  await page.getByRole("button", { name: "Templates" }).click();
  await page.getByRole("button", { name: "Office standard", exact: true }).click();
  await expect(header(page).locator(".band-item.kind-field")).toHaveText("Bridge 7");

  // One undo takes the whole template back.
  await page.keyboard.press("Control+z");
  await expect(header(page).locator(".band-item")).toHaveCount(0);
});

test("a default template starts every new sheet", async ({ page }) => {
  await editBands(page);
  await page.locator(".band-bar .band-chip", { hasText: /^Box$/ }).click();
  page.once("dialog", (d) => void d.accept("House"));
  await page.getByRole("button", { name: "Templates" }).click();
  await page.getByRole("button", { name: "Save as template…" }).click();
  await page.getByRole("button", { name: "Templates" }).click();
  await page.getByLabel("House: default for new sheets").click();
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "File" }).click();
  await page.getByRole("button", { name: "New sheet" }).click();
  await expect(page.locator(".tab")).toHaveCount(2);
  await expect(header(page).locator(".band-item.kind-box")).toHaveCount(1);
  // Starting from the template is not a change.
  await expect(page.locator(".tab.is-active")).not.toHaveClass(/is-dirty/);
});
