import { describe, expect, it } from "vitest";
import {
  applyPatch,
  evaluate,
  exportSheet,
  getRegion,
  getSheet,
  listRegions,
  setInputs,
  trace,
  type PatchOperation,
} from "../src/api/operations.js";
import { listSymbols } from "../src/api/operations.js";
import { ApiError } from "../src/api/errors.js";
import { emptySheet, type Sheet } from "../src/document/sheet.js";
import { humanAuthorship, type Region } from "../src/document/region.js";
import { evaluationOrder } from "../src/document/order.js";

const AT = new Date("2026-09-05T00:00:00Z");
const CTX = { client: "test", now: () => AT };

const math = (id: string, y: number, source: string): Region => ({
  kind: "math",
  id,
  position: { x: 48, y },
  source,
  origin: humanAuthorship(AT),
});

function beamSheet(): Sheet {
  return {
    ...emptySheet("Beam"),
    regions: [
      math("r_01", 0, "w := 2.4 klf"),
      math("r_02", 40, "L := 25 ft"),
      math("r_03", 80, "M := w*L^2/8 = kip*ft"),
      math("r_04", 120, "DCR := M/(300 kip*ft) ="),
    ],
  };
}

const order = (s: Sheet): string[] => evaluationOrder(s.regions).map((r) => r.id);

describe("reading a sheet", () => {
  it("returns the projection and a region count", () => {
    const report = getSheet(beamSheet());
    expect(report.title).toBe("Beam");
    expect(report.regions).toBe(4);
    expect(report.projection).toContain("[r_03] M := w*L^2/8 = kip*ft");
    expect(report.projection).toContain("187.5 kip*ft");
  });

  it("describes one region with its value, units and dependencies", () => {
    const r = getRegion(beamSheet(), "r_03");
    expect(r.defines).toBe("M");
    expect(r.status).toBe("ok");
    expect(r.result?.unit).toBe("kip*ft");
    expect(r.result?.value).toBeCloseTo(187.5, 6);
    // SI travels too, for a caller doing its own arithmetic.
    expect(r.result?.si).toBeCloseTo(254216, 0);
    expect(r.dependsOn).toEqual(["r_01", "r_02"]);
  });

  it("lists regions in evaluation order, not storage order", () => {
    const sheet: Sheet = {
      ...emptySheet("Ordered"),
      regions: [math("r_09", 300, "c := 3"), math("r_01", 100, "a := 1")],
    };
    expect(listRegions(sheet).map((r) => r.id)).toEqual(["r_01", "r_09"]);
  });

  it("orients a caller with the symbol table", () => {
    const names = listSymbols(beamSheet()).map((s) => s.name);
    expect(names).toEqual(["w", "L", "M", "DCR"]);
    expect(listSymbols(beamSheet()).find((s) => s.name === "M")?.definedIn).toBe("r_03");
  });

  it("traces what feeds a value", () => {
    expect(trace(beamSheet(), "r_03").map((r) => r.id)).toEqual(["r_01", "r_02"]);
  });

  it("reports an unknown region as a request error, not a calculation error", () => {
    try {
      getRegion(beamSheet(), "r_99");
      expect.unreachable("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(ApiError);
      expect((e as ApiError).code).toBe("unknown_region");
      expect((e as ApiError).toJSON().region).toBe("r_99");
    }
  });

  it("distinguishes an error from a region blocked by one", () => {
    const sheet: Sheet = {
      ...emptySheet("Broken"),
      regions: [math("r_01", 0, "L := 1 ft + 1 kip"), math("r_02", 40, "x := L*2")],
    };
    const [bad, downstream] = listRegions(sheet);
    expect(bad?.status).toBe("error");
    expect(bad?.error?.code).toBe("unit_mismatch");
    expect(downstream?.status).toBe("blocked");
    expect(downstream?.blockedBy).toBe("r_01");
  });
});

describe("patching", () => {
  it("inserts after a named region, in evaluation order", () => {
    const { sheet, inserted } = applyPatch(
      beamSheet(),
      [{ op: "insert", kind: "math", after: "r_02", source: "phi := 0.9" }],
      CTX,
    );
    expect(inserted).toHaveLength(1);
    expect(order(sheet)).toEqual(["r_01", "r_02", inserted[0], "r_03", "r_04"]);
  });

  it("slots into an existing gap without moving anything else", () => {
    const before = beamSheet();
    const { sheet } = applyPatch(
      before,
      [{ op: "insert", kind: "math", after: "r_01", source: "k := 1" }],
      CTX,
    );
    // Shifting every region on each insert would turn a one-line change into
    // a diff touching the whole file.
    for (const original of before.regions) {
      const now = sheet.regions.find((r) => r.id === original.id);
      expect(now?.position.y).toBe(original.position.y);
    }
  });

  it("makes room when there is no gap", () => {
    const tight: Sheet = {
      ...emptySheet("Tight"),
      regions: [math("r_01", 0, "a := 1"), math("r_02", 8, "b := 2")],
    };
    const { sheet, inserted } = applyPatch(
      tight,
      [{ op: "insert", kind: "math", after: "r_01", source: "c := 3" }],
      CTX,
    );
    expect(order(sheet)).toEqual(["r_01", inserted[0], "r_02"]);
  });

  it("applies several operations as one batch", () => {
    const ops: PatchOperation[] = [
      { op: "update", id: "r_02", source: "L := 30 ft" },
      { op: "insert", kind: "text", after: "r_02", text: "revised span" },
      { op: "delete", id: "r_04" },
    ];
    const { sheet } = applyPatch(beamSheet(), ops, CTX);
    expect(sheet.regions.find((r) => r.id === "r_02")).toMatchObject({ source: "L := 30 ft" });
    expect(sheet.regions.find((r) => r.id === "r_04")).toBeUndefined();
    expect(getRegion(sheet, "r_03").result?.value).toBeCloseTo(270, 6);
  });

  it("changes nothing when any operation fails", () => {
    const before = beamSheet();
    const ops: PatchOperation[] = [
      { op: "update", id: "r_02", source: "L := 30 ft" },
      { op: "delete", id: "r_99" },
    ];
    expect(() => applyPatch(before, ops, CTX)).toThrow(ApiError);
    // The first operation must not have landed: a half-applied batch is the
    // state a caller cannot recover from.
    expect(getRegion(before, "r_02").source).toBe("L := 25 ft");
    expect(getRegion(before, "r_02").source).toBe("L := 25 ft");
  });

  it("reports which operation failed", () => {
    try {
      applyPatch(beamSheet(), [{ op: "update", id: "r_01", source: "a := 1" }, { op: "delete", id: "nope" }], CTX);
      expect.unreachable("should have thrown");
    } catch (e) {
      expect((e as ApiError).operation).toBe(1);
    }
  });

  it("refuses to update a text region with `source`", () => {
    const sheet: Sheet = {
      ...emptySheet("T"),
      regions: [
        { kind: "text", id: "r_01", position: { x: 0, y: 0 }, runs: [], origin: humanAuthorship(AT) },
      ],
    };
    expect(() =>
      applyPatch(sheet, [{ op: "update", id: "r_01", source: "a := 1" }], CTX),
    ).toThrow(ApiError);
  });

  it("rejects an id that already exists", () => {
    expect(() =>
      applyPatch(beamSheet(), [{ op: "insert", kind: "math", id: "r_01" }], CTX),
    ).toThrow(ApiError);
  });

  it("moves a region to a new place in the order", () => {
    const { sheet } = applyPatch(beamSheet(), [{ op: "move", id: "r_01", after: "r_03" }], CTX);
    expect(order(sheet).indexOf("r_01")).toBeGreaterThan(order(sheet).indexOf("r_03"));
  });

  it("records authorship and a change log for every write", () => {
    const { sheet, inserted } = applyPatch(
      beamSheet(),
      [{ op: "insert", kind: "math", after: "r_01", source: "k := 1" }],
      CTX,
    );
    const region = sheet.regions.find((r) => r.id === inserted[0]);
    // A machine-authored region has to be distinguishable.
    expect(region?.origin.author).toBe("api");
    expect(region?.origin.client).toBe("test");
    expect(sheet.changeLog).toHaveLength(1);
    expect(sheet.changeLog[0]).toMatchObject({ operation: "insert", client: "test" });
  });

  it("keeps a before and after in the log for an update", () => {
    const { sheet } = applyPatch(beamSheet(), [{ op: "update", id: "r_02", source: "L := 30 ft" }], CTX);
    expect(sheet.changeLog[0]).toMatchObject({ before: "L := 25 ft", after: "L := 30 ft" });
  });
});

describe("inputs and dry runs", () => {
  it("sets an input by name and recomputes", () => {
    const sheet = setInputs(beamSheet(), { L: "30 ft" }, CTX);
    expect(getRegion(sheet, "r_02").source).toBe("L := 30 ft");
    expect(getRegion(sheet, "r_03").result?.value).toBeCloseTo(270, 6);
  });

  it("keeps the display unit the region already had", () => {
    const sheet = setInputs(beamSheet(), { M: "1 kip*ft" }, CTX);
    // Rewriting the source must not silently drop `= kip*ft`.
    expect(getRegion(sheet, "r_03").source).toContain("= kip*ft");
  });

  it("rejects an unknown name", () => {
    expect(() => setInputs(beamSheet(), { nope: "1" }, CTX)).toThrow(ApiError);
  });

  it("rejects a value that does not parse, before touching the sheet", () => {
    try {
      setInputs(beamSheet(), { L: "25 furlongs" }, CTX);
      expect.unreachable("should have thrown");
    } catch (e) {
      expect((e as ApiError).code).toBe("invalid_value");
    }
  });

  it("evaluates with overrides without persisting them", () => {
    const sheet = beamSheet();
    const run = evaluate(sheet, { set: { L: "40 ft" } });
    expect(run.regions.find((r) => r.id === "r_03")?.result?.value).toBeCloseTo(480, 6);
    expect(run.errors).toBe(0);
    // The dry run must leave the document alone.
    expect(getRegion(sheet, "r_02").source).toBe("L := 25 ft");
  });

  it("counts problems in a run", () => {
    const sheet: Sheet = {
      ...emptySheet("Broken"),
      regions: [math("r_01", 0, "L := 1 ft + 1 kip"), math("r_02", 40, "x := L*2")],
    };
    expect(evaluate(sheet).errors).toBe(2);
  });
});

describe("export", () => {
  it("writes CSV with one row per math region", () => {
    const csv = exportSheet(beamSheet(), "csv");
    const lines = csv.trim().split("\n");
    expect(lines[0]).toBe("id,defines,source,value,unit,status");
    expect(lines).toHaveLength(5);
    expect(lines[3]).toContain("kip*ft");
  });

  it("quotes a source containing a comma", () => {
    const sheet: Sheet = {
      ...emptySheet("C"),
      regions: [math("r_01", 0, "m := max(1, 2)")],
    };
    expect(exportSheet(sheet, "csv")).toContain('"m := max(1, 2)"');
  });

  it("writes JSON carrying the title block", () => {
    const sheet: Sheet = { ...beamSheet(), titleBlock: { project: "P", by: "JD", rev: "A" } };
    const parsed = JSON.parse(exportSheet(sheet, "json")) as {
      titleBlock: { project: string };
      regions: unknown[];
    };
    expect(parsed.titleBlock.project).toBe("P");
    expect(parsed.regions).toHaveLength(4);
  });

  it("writes the text projection", () => {
    expect(exportSheet(beamSheet(), "text")).toContain("[r_01] w := 2.4 klf");
  });
});

describe("a bad display unit marks one region, not the sheet", () => {
  it("reports it as a region error rather than throwing out of recompute", () => {
    // UnitParseError used to be a bare Error, so it escaped every
    // `instanceof CalcError` guard and one wrong unit took down the whole
    // sheet instead of marking the region that carried it.
    const sheet: Sheet = {
      ...emptySheet("Bad unit"),
      regions: [
        math("r_01", 0, "L := 25 kip"),
        math("r_02", 40, "M := L = kip*ft"),
        math("r_03", 80, "fine := 2 ft"),
      ],
    };
    const rows = listRegions(sheet);
    expect(rows.find((r) => r.id === "r_02")?.status).toBe("error");
    expect(rows.find((r) => r.id === "r_02")?.error?.code).toBe("unit_mismatch");
    // Independent regions still compute — one bad region must never blank the sheet.
    expect(rows.find((r) => r.id === "r_03")?.status).toBe("ok");
  });
});

describe("region colours", () => {
  const styleOf = (s: Sheet, id: string) => s.regions.find((r) => r.id === id)?.style;

  it("keeps the result's colour apart from the equation's", () => {
    const { sheet } = applyPatch(
      beamSheet(),
      [{ op: "update", id: "r_03", style: { color: "#1f5fa8", resultColor: "#b3261e" } }],
      CTX,
    );
    expect(styleOf(sheet, "r_03")).toEqual({ color: "#1f5fa8", resultColor: "#b3261e" });
  });

  it("goes back to the default when given null", () => {
    let { sheet } = applyPatch(
      beamSheet(),
      [{ op: "update", id: "r_03", style: { color: "#1f5fa8", resultColor: "#b3261e" } }],
      CTX,
    );
    ({ sheet } = applyPatch(sheet, [{ op: "update", id: "r_03", style: { resultColor: null } }], CTX));
    expect(styleOf(sheet, "r_03")).toEqual({ color: "#1f5fa8" });
  });

  it("leaves no empty style behind once everything is back to default", () => {
    let { sheet } = applyPatch(beamSheet(), [{ op: "update", id: "r_03", style: { color: "#1f5fa8" } }], CTX);
    ({ sheet } = applyPatch(sheet, [{ op: "update", id: "r_03", style: { color: null } }], CTX));
    expect(sheet.regions.find((r) => r.id === "r_03")).not.toHaveProperty("style");
  });

});
