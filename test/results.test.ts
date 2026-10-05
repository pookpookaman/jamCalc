/**
 * Every result on every example sheet, pinned (ADR-0016, "Results that change").
 *
 * A sheet someone has already submitted must not silently come out different
 * in a later version. So the results of the example sheets — a dozen real
 * calculations across steel, concrete, seismic and fire protection — are
 * recorded here, and any change to any of them fails until it is declared:
 * an entry under "Results that change" in CHANGELOG.md, then
 *
 *     npm run results:update
 *
 * which refuses to record new values without that entry.
 *
 * The example sheets and their pinned results are kept private, so a copy of
 * the repository without them skips this file rather than failing it.
 */

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { listRegions, parseSheet } from "@jamcalc/engine";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const EXAMPLES = join(ROOT, "examples");
const PINNED = join(ROOT, "test", "example-results.json");
const UPDATING = process.env["JAMCALC_UPDATE_RESULTS"] === "1";

type Results = Record<string, Record<string, string>>;

/** One line per computed region: what the sheet shows, or why it shows nothing. */
function resultsOf(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const r of listRegions(parseSheet(text))) {
    if (r.kind !== "math") continue;
    const key = `${r.id}${r.defines ? ` ${r.defines}` : ""}`;
    out[key] =
      r.status === "ok"
        ? (r.result?.display ?? "")
        : `${r.status}${r.error ? `: ${r.error.message}` : ""}`;
  }
  return out;
}

const present = existsSync(EXAMPLES) && (UPDATING || existsSync(PINNED));

const current: Results = !present ? {} : Object.fromEntries(
  readdirSync(EXAMPLES)
    .filter((f) => f.endsWith(".jc"))
    .sort()
    .map((f) => [f, resultsOf(readFileSync(join(EXAMPLES, f), "utf8"))]),
);

describe.skipIf(!present)("results that change are declared", () => {
  if (UPDATING) {
    it("records the current results", () => {
      writeFileSync(PINNED, `${JSON.stringify(current, null, 2)}\n`);
    });
    return;
  }

  const pinned = (present ? JSON.parse(readFileSync(PINNED, "utf8")) : {}) as Results;

  it("covers every example sheet", () => {
    expect(Object.keys(current)).toEqual(Object.keys(pinned));
  });

  for (const [sheet, results] of Object.entries(current)) {
    it(`${sheet} computes what it did`, () => {
      const changed = Object.keys({ ...results, ...pinned[sheet] })
        .filter((k) => results[k] !== pinned[sheet]?.[k])
        .map((k) => `  ${k}: ${pinned[sheet]?.[k] ?? "(none)"} → ${results[k] ?? "(none)"}`);
      expect(
        changed,
        `Results changed on ${sheet}. If that is intended, declare it under "### Results that change" in the Unreleased section of CHANGELOG.md, then run npm run results:update.\n${changed.join("\n")}`,
      ).toEqual([]);
    });
  }
});
