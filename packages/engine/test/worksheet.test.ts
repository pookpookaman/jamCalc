import { describe, expect, it } from "vitest";
import { asScalar, type Value } from "../src/value.js";
import { Worksheet } from "../src/document/worksheet.js";
import { buildGraph } from "../src/document/graph.js";
import { evaluationOrder } from "../src/document/order.js";
import { humanAuthorship, type MathRegion, type Region } from "../src/document/region.js";
import { valueIn } from "../src/units/parse.js";
import type { Quantity } from "../src/quantity.js";

const AT = new Date("2026-09-04T00:00:00Z");

function math(id: string, x: number, y: number, source: string): MathRegion {
  return {
    kind: "math",
    id,
    position: { x, y },
    source,
    origin: humanAuthorship(AT),
  };
}

/** The running beam example, laid out as two columns on one page. */
function beamSheet(): Region[] {
  return [
    math("r_01", 40, 100, "w_u := 2.4 klf"),
    math("r_02", 40, 140, "L := 25 ft"),
    math("r_03", 40, 180, "M_u := w_u*L^2/8"),
    math("r_04", 320, 100, "Z_x := 95.4 in^3"),
    math("r_05", 320, 140, "F_y := 50 ksi"),
    math("r_06", 40, 220, "phi_M_n := 0.9*Z_x*F_y"),
    math("r_07", 40, 260, "DCR := M_u/phi_M_n"),
  ];
}

const ok = (ws: Worksheet, id: string): Quantity => {
  const r = ws.getResult(id);
  if (r?.status !== "ok") throw new Error(`${id} is ${r?.status ?? "missing"}`);
  return asScalar(r.value);
};

describe("evaluation order follows position, not insertion", () => {
  it("orders top-to-bottom then left-to-right", () => {
    const regions = [
      math("c", 300, 100, "x := 1"),
      math("a", 40, 100, "y := 2"),
      math("b", 40, 200, "z := 3"),
    ];
    expect(evaluationOrder(regions).map((r) => r.id)).toEqual(["a", "c", "b"]);
  });

  it("quantizes bands so the comparator stays transitive", () => {
    // y = 0, 6, 12 with a 12px band: the naive "within tolerance" rule is
    // non-transitive here and produces sort-order-dependent results.
    const regions = [
      math("z", 300, 0, "a := 1"),
      math("y", 200, 6, "b := 2"),
      math("x", 100, 12, "c := 3"),
    ];
    const forward = evaluationOrder(regions).map((r) => r.id);
    const reversed = evaluationOrder([...regions].reverse()).map((r) => r.id);
    expect(forward).toEqual(reversed);
    expect(forward).toEqual(["y", "z", "x"]);
  });

  it("is stable for regions at identical positions", () => {
    const regions = [
      math("b", 40, 40, "x := 1"),
      math("a", 40, 40, "y := 2"),
    ];
    expect(evaluationOrder(regions).map((r) => r.id)).toEqual(["a", "b"]);
  });
});

describe("dependency graph", () => {
  it("resolves references to the nearest preceding definition", () => {
    const g = buildGraph(beamSheet());
    expect([...(g.analyses.get("r_03")?.dependsOn ?? [])].sort()).toEqual(["r_01", "r_02"]);
    expect([...(g.analyses.get("r_07")?.dependsOn ?? [])].sort()).toEqual(["r_03", "r_06"]);
  });

  it("binds a redefinition only for regions below it", () => {
    const regions = [
      math("r_01", 40, 100, "L := 25 ft"),
      math("r_02", 40, 140, "a := L"),
      math("r_03", 40, 180, "L := 30 ft"),
      math("r_04", 40, 220, "b := L"),
    ];
    const g = buildGraph(regions);
    expect(g.analyses.get("r_02")?.dependsOn).toEqual(["r_01"]);
    expect(g.analyses.get("r_04")?.dependsOn).toEqual(["r_03"]);

    const ws = new Worksheet(regions);
    ws.recompute();
    expect(valueIn(ok(ws, "r_02"), "ft")).toBeCloseTo(25, 9);
    expect(valueIn(ok(ws, "r_04"), "ft")).toBeCloseTo(30, 9);
  });

  it("reads the previous binding in a self-referential definition", () => {
    const ws = new Worksheet([
      math("r_01", 40, 100, "n := 1"),
      math("r_02", 40, 140, "n := n + 1"),
      math("r_03", 40, 180, "n ="),
    ]);
    ws.recompute();
    expect(asScalar(ok(ws, "r_03")).si).toBe(2);
  });

  it("reports a name with no preceding definition as unresolved", () => {
    const g = buildGraph([math("r_01", 40, 100, "x := F_y*2")]);
    expect(g.analyses.get("r_01")?.unresolved).toEqual(["F_y"]);
  });
});

describe("the beam sheet computes", () => {
  it("produces the same numbers as the direct evaluation", () => {
    const ws = new Worksheet(beamSheet());
    ws.recompute();
    expect(valueIn(ok(ws, "r_03"), "kip*ft")).toBeCloseTo(187.5, 9);
    expect(valueIn(ok(ws, "r_06"), "kip*ft")).toBeCloseTo(357.75, 6);
    expect(asScalar(ok(ws, "r_07")).si).toBeCloseTo(0.5241, 4);
  });

  it("lists every symbol with its defining region", () => {
    const ws = new Worksheet(beamSheet());
    ws.recompute();
    const names = ws.listSymbols().map((s) => s.name);
    expect(names).toContain("M_u");
    expect(names).toContain("phi_M_n");
    expect(ws.listSymbols().find((s) => s.name === "M_u")?.definedIn).toBe("r_03");
  });

  it("traces what feeds a value", () => {
    const ws = new Worksheet(beamSheet());
    ws.recompute();
    expect(ws.trace("r_07")).toEqual([
      "r_01",
      "r_04",
      "r_02",
      "r_05",
      "r_03",
      "r_06",
    ]);
  });
});

describe("incremental recompute", () => {
  it("re-evaluates only the edited region and what depends on it", () => {
    const ws = new Worksheet(beamSheet());
    expect(ws.recompute()).toEqual({ evaluated: 7, reused: 0 });

    // Change the span. M_u, phi_M_n's peer chain and DCR are downstream;
    // Z_x and F_y are not.
    ws.edit("r_02", "L := 30 ft");
    const stats = ws.recompute();
    expect(stats.evaluated).toBe(3); // r_02, r_03 (M_u), r_07 (DCR)
    expect(stats.reused).toBe(4);

    expect(valueIn(ok(ws, "r_03"), "kip*ft")).toBeCloseTo(270, 9);
    expect(asScalar(ok(ws, "r_07")).si).toBeCloseTo(0.7547, 4);
    // Untouched branch kept its value.
    expect(valueIn(ok(ws, "r_06"), "kip*ft")).toBeCloseTo(357.75, 6);
  });

  it("rebuilds the graph when an edit changes which name is defined", () => {
    const ws = new Worksheet(beamSheet());
    ws.recompute();
    ws.edit("r_02", "L_span := 25 ft");
    const stats = ws.recompute();
    expect(stats.evaluated).toBe(7); // conservative full rebuild
    expect(ws.getResult("r_03")?.status).toBe("error"); // L is gone
  });

  it("rebuilds when a region moves, since order determines binding", () => {
    const ws = new Worksheet(beamSheet());
    ws.recompute();
    ws.move("r_02", { x: 40, y: 600 }); // L now defined below its use
    ws.recompute();
    expect(ws.getResult("r_03")?.status).toBe("error");
  });
});

describe("one bad region does not blank the sheet", () => {
  it("marks downstream regions blocked and names the region at fault", () => {
    const ws = new Worksheet([
      math("r_01", 40, 100, "w := 2.4 klf"),
      math("r_02", 40, 140, "L := 25 ft + 3 kip"), // unit mismatch
      math("r_03", 40, 180, "M := w*L^2/8"),
      math("r_04", 40, 220, "unrelated := 4 in^3"),
    ]);
    ws.recompute();

    const bad = ws.getResult("r_02");
    expect(bad?.status).toBe("error");
    expect(bad?.status === "error" && bad.error.code).toBe("unit_mismatch");

    const downstream = ws.getResult("r_03");
    expect(downstream?.status).toBe("blocked");
    expect(downstream?.status === "blocked" && downstream.because).toBe("r_02");
    expect(downstream?.status === "blocked" && downstream.missing).toBe("L");

    // Independent region is unaffected — the whole point.
    expect(ws.getResult("r_04")?.status).toBe("ok");
  });

  it("keeps a syntax error local", () => {
    const ws = new Worksheet([
      math("r_01", 40, 100, "x := 2 kip +"),
      math("r_02", 40, 140, "y := 5 ft"),
    ]);
    ws.recompute();
    expect(ws.getResult("r_01")?.status).toBe("error");
    expect(ws.getResult("r_02")?.status).toBe("ok");
  });
});

describe("regions carry authorship", () => {
  it("records author and timestamp for the review gate that comes later", () => {
    const ws = new Worksheet(beamSheet());
    expect(ws.getRegion("r_01")?.origin.author).toBe("human");
    expect(ws.getRegion("r_01")?.origin.at).toBe("2026-09-04T00:00:00.000Z");
  });
});

describe("deferred calculation", () => {
  it("reports pending regions until recompute runs", () => {
    const ws = new Worksheet(beamSheet());
    // Nothing has run yet, so everything is pending.
    expect(ws.pending.length).toBe(7);
    expect(ws.isUpToDate).toBe(false);

    ws.recompute();
    expect(ws.isUpToDate).toBe(true);

    ws.edit("r_02", "L := 30 ft");
    // The edited region and everything downstream of it.
    expect([...ws.pending].sort()).toEqual(["r_02", "r_03", "r_07"]);
    expect(ws.isUpToDate).toBe(false);

    ws.recompute();
    expect(ws.isUpToDate).toBe(true);
  });

  it("holds stale values until told to recompute", () => {
    const ws = new Worksheet(beamSheet());
    ws.recompute();
    ws.edit("r_02", "L := 30 ft");

    // Deliberately NOT recomputing: the old value is still what is cached.
    expect(valueIn(ok(ws, "r_03"), "kip*ft")).toBeCloseTo(187.5, 9);
    expect(ws.pending).toContain("r_03");

    ws.recompute();
    expect(valueIn(ok(ws, "r_03"), "kip*ft")).toBeCloseTo(270, 9);
  });

  it("treats a structural change as invalidating everything", () => {
    const ws = new Worksheet(beamSheet());
    ws.recompute();
    ws.move("r_02", { x: 40, y: 600 });
    // Moving a region can rebind every reference below it, so nothing is
    // known to be safe without rebuilding the graph.
    expect(ws.pending.length).toBe(7);
  });
});
