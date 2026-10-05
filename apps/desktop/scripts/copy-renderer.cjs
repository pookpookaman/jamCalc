/**
 * Copies the studio's build into renderer/, which is where the packaged main
 * process loads the page from (main.ts: "../renderer/index.html").
 *
 * Run after the studio has been built. Removes the old copy first, so a file
 * dropped from the studio does not linger in the package.
 */

const { cpSync, existsSync, rmSync } = require("node:fs");
const { join } = require("node:path");

const from = join(__dirname, "../../studio/dist");
const to = join(__dirname, "../renderer");

if (!existsSync(join(from, "index.html"))) {
  console.error(`no studio build at ${from} — build the studio first`);
  process.exit(1);
}

rmSync(to, { recursive: true, force: true });
cpSync(from, to, { recursive: true });
console.log(`copied ${from} -> ${to}`);
