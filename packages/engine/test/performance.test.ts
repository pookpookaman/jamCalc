/**
 * The recompute budget.
 *
 * The target: sub-100 ms recompute on a 500-region sheet after
 * a single edit. It had never been measured — the incremental machinery was
 * built and believed. This measures it.
 *
 * Timing in a test suite is a compromise. The thresholds here are deliberately
 * several times the observed figures, because a test that fails when a laptop
 * is busy teaches people to ignore failures. What it is really guarding is a
 * change of *shape* — an edit going from proportional-to-the-edit back to
 * proportional-to-the-sheet, which is the regression that matters and which
 * shows up as orders of magnitude, not percentages.
 */

import { describe, expect, it } from "vitest";
import { Worksheet } from "../src/document/worksheet.js";
import { humanAuthorship, type Region } from "../src/document/region.js";

const AT = new Date("2026-09-05T00:00:00Z");

/**
 * A sheet shaped like a real one: a few inputs, then a long chain of regions
 * each reading the one before, which is the worst case for invalidation.
 */
function chain(n: number): Region[] {
  const regions: Region[] = [
    { kind: "math", id: "r_0000", position: { x: 48, y: 0 }, source: "x_0 := 1 kip", origin: humanAuthorship(AT) },
  ];
  for (let i = 1; i < n; i += 1) {
    regions.push({
      kind: "math",
      id: `r_${String(i).padStart(4, "0")}`,
      position: { x: 48, y: i * 36 },
      source: `x_${i} := x_${i - 1} + 1 kip`,
      origin: humanAuthorship(AT),
    });
  }
  return regions;
}

/** Wide rather than deep: independent columns, the best case for reuse. */
function independent(n: number): Region[] {
  return Array.from({ length: n }, (_, i) => ({
    kind: "math" as const,
    id: `r_${String(i).padStart(4, "0")}`,
    position: { x: 48, y: i * 36 },
    source: `y_${i} := ${i} * 2 kip`,
    origin: humanAuthorship(AT),
  }));
}

const time = (fn: () => void): number => {
  const t0 = performance.now();
  fn();
  return performance.now() - t0;
};

/** Median of several runs: one run measures the machine's mood. */
function median(runs: number, fn: () => void): number {
  const times = Array.from({ length: runs }, () => time(fn));
  times.sort((a, b) => a - b);
  return times[Math.floor(times.length / 2)] as number;
}

describe("recompute on a 500-region sheet", () => {
  const N = 500;

  it("evaluates a cold sheet", () => {
    const ws = new Worksheet(chain(N));
    const ms = time(() => ws.recompute());
    // Cold evaluation is every region by definition; this is the baseline the
    // incremental numbers below are worth comparing against.
    console.log(`  cold recompute, ${N} chained regions: ${ms.toFixed(1)} ms`);
    expect(ms).toBeLessThan(2000);
  });

  it("meets the §4 budget for an edit at the END of a long chain", () => {
    const ws = new Worksheet(chain(N));
    ws.recompute();
    let stats = { evaluated: 0, reused: 0 };
    const ms = median(5, () => {
      ws.edit(`r_0499`, `x_499 := x_498 + 2 kip`);
      stats = ws.recompute();
    });
    console.log(
      `  edit at the end: ${ms.toFixed(1)} ms (evaluated ${stats.evaluated}, reused ${stats.reused})`,
    );
    // Nothing downstream, so this is the cheap path doing almost nothing.
    expect(stats.evaluated).toBeLessThan(5);
    expect(ms).toBeLessThan(100);
  });

  it("meets the §4 budget for an edit at the START of a long chain", () => {
    const ws = new Worksheet(chain(N));
    ws.recompute();
    let stats = { evaluated: 0, reused: 0 };
    const ms = median(5, () => {
      ws.edit("r_0000", `x_0 := 2 kip`);
      stats = ws.recompute();
    });
    console.log(
      `  edit at the start: ${ms.toFixed(1)} ms (evaluated ${stats.evaluated}, reused ${stats.reused})`,
    );
    // The worst case the design admits: everything downstream really has
    // changed, so re-evaluating it is correct work, not waste.
    expect(ms).toBeLessThan(100);
  });

  it("touches almost nothing when regions are independent", () => {
    const ws = new Worksheet(independent(N));
    ws.recompute();
    let stats = { evaluated: 0, reused: 0 };
    const ms = median(5, () => {
      ws.edit("r_0250", "y_250 := 7 * 2 kip");
      stats = ws.recompute();
    });
    console.log(
      `  edit among independents: ${ms.toFixed(1)} ms (evaluated ${stats.evaluated}, reused ${stats.reused})`,
    );
    // This is the claim the dependency graph exists to make: one edit, one
    // region evaluated, the other 499 reused.
    expect(stats.evaluated).toBe(1);
    expect(stats.reused).toBe(N - 1);
    expect(ms).toBeLessThan(50);
  });

  it("rebuilds the graph when a region is inserted, and still fits", () => {
    const ws = new Worksheet(chain(N));
    ws.recompute();
    const ms = time(() => {
      ws.insert({
        kind: "math",
        id: "r_new",
        position: { x: 300, y: 10 },
        source: "extra := 1 kip",
        origin: humanAuthorship(AT),
      });
      ws.recompute();
    });
    console.log(`  insert (full graph rebuild): ${ms.toFixed(1)} ms`);
    // An insert can change what every later name binds to, so this is a full
    // rebuild by design. It is the number that decides whether a structural
    // edit feels instant.
    expect(ms).toBeLessThan(500);
  });
});
