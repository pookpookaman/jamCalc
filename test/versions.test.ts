/**
 * One product version (ADR-0016): every package jamCalc ships carries the
 * root's number, so a version names exactly what was shipped together. Set it
 * with `npm run release:version -- <x.y.z>`, which writes all of them.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const versionOf = (file: string): string =>
  (JSON.parse(readFileSync(join(ROOT, file), "utf8")) as { version: string }).version;

describe("the product version", () => {
  const root = versionOf("package.json");

  it("is a release number", () => {
    expect(root).toMatch(/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/);
  });

  it.each([
    "packages/engine/package.json",
    "packages/cli/package.json",
    "apps/studio/package.json",
    "apps/desktop/package.json",
  ])("is the same in %s", (file) => {
    expect(versionOf(file)).toBe(root);
  });

  it("has a changelog entry", () => {
    const changelog = readFileSync(join(ROOT, "CHANGELOG.md"), "utf8");
    expect(changelog).toContain(`## ${root}`);
  });
});
