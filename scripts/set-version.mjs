/**
 * Sets jamCalc's version everywhere it is written (ADR-0016).
 *
 *     npm run release:version -- 0.2.0
 *
 * One product version: the root package.json is where it is kept, and every
 * workspace package carries the same number so that "0.4.2 gave me this"
 * names exactly the engine, studio, CLI and desktop app that were shipped
 * together. A test (`test/versions.test.ts`) fails if they ever disagree.
 */

import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const PACKAGES = [
  "package.json",
  "packages/engine/package.json",
  "packages/cli/package.json",
  "apps/studio/package.json",
  "apps/desktop/package.json",
];

const version = process.argv[2];
if (!version || !/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version)) {
  console.error("usage: npm run release:version -- <major.minor.patch>");
  process.exit(2);
}

for (const file of PACKAGES) {
  const path = join(ROOT, file);
  const text = readFileSync(path, "utf8");
  // Rewrites the one field in place, so the rest of the file — its order,
  // its formatting — is untouched and the diff is one line.
  const next = text.replace(/("version":\s*")[^"]*(")/, `$1${version}$2`);
  if (next === text && !text.includes(`"version": "${version}"`)) {
    console.error(`no version field in ${file}`);
    process.exit(1);
  }
  writeFileSync(path, next);
  console.log(`${file}: ${version}`);
}

// The lock file records each workspace's version too.
const lock = spawnSync("npm", ["install", "--package-lock-only", "--ignore-scripts"], {
  cwd: ROOT,
  stdio: "inherit",
  shell: process.platform === "win32",
});
process.exit(lock.status ?? 1);
