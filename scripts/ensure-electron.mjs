/**
 * Makes sure Electron's binary is actually there after `npm install`.
 *
 * Electron's package downloads the binary in its own install step, and more
 * than once that step has not run, or has reported success while fetching
 * nothing — leaving a package with no `electron.exe` and a desktop app that
 * will not start. This runs from the root, whose own
 * install steps always run, and fetches the binary only if it is missing.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = join(root, "node_modules", "electron");

if (!existsSync(join(pkg, "package.json"))) process.exit(0); // not installed: nothing to fix
// Asked not to: the automated checks build the web app and never run Electron.
if (process.env["ELECTRON_SKIP_BINARY_DOWNLOAD"]) process.exit(0);

const binary = (() => {
  try {
    return join(pkg, "dist", readFileSync(join(pkg, "path.txt"), "utf8").trim());
  } catch {
    return null;
  }
})();

if (binary && existsSync(binary)) process.exit(0);

console.log("Electron's binary is missing; fetching it.");
const run = spawnSync(process.execPath, ["install.js"], { cwd: pkg, stdio: "inherit" });
process.exit(run.status ?? 1);
