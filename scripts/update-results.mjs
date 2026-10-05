/**
 * Records new pinned results for the example sheets (ADR-0016).
 *
 *     npm run results:update
 *
 * Refuses unless CHANGELOG.md's Unreleased section says which results change
 * and why: a moved number that nobody wrote down is exactly what the pin is
 * there to stop.
 */

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const changelog = readFileSync(join(ROOT, "CHANGELOG.md"), "utf8");

// The Unreleased section, up to the next release heading.
const unreleased = /^## Unreleased\s*$([\s\S]*?)(?=^## )/m.exec(changelog)?.[1] ?? "";
// Its Results that change subsection, up to the next subsection.
const declared = /^### Results that change\s*$([\s\S]*?)(?=^### |(?![\s\S]))/m.exec(unreleased)?.[1] ?? "";
const entries = declared
  .split("\n")
  .map((l) => l.trim())
  .filter((l) => l.startsWith("-") && !/^-\s*none\b/i.test(l));

if (entries.length === 0) {
  console.error(
    [
      "No results changes are declared.",
      "",
      "Add an entry to CHANGELOG.md first, for example:",
      "",
      "  ## Unreleased",
      "",
      "  ### Results that change",
      "",
      "  - Steel beam: φM_n on beam.jc rises from 39.1 to 39.4 kip·ft — the",
      "    inelastic LTB equation used L_r from the wrong section (fix #123).",
      "",
      "then run this again.",
    ].join("\n"),
  );
  process.exit(1);
}

const run = spawnSync("npx", ["vitest", "run", "test/results.test.ts"], {
  cwd: ROOT,
  stdio: "inherit",
  shell: process.platform === "win32",
  env: { ...process.env, JAMCALC_UPDATE_RESULTS: "1" },
});
if (run.status === 0) console.log("Recorded. Review the diff of test/example-results.json before committing.");
process.exit(run.status ?? 1);
