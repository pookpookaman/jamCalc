import { describe, expect, it } from "vitest";
import { Worksheet } from "../src/document/worksheet.js";
import {
  parseProjection,
  project,
  roundTrips,
} from "../src/document/projection.js";
import {
  emptySheet,
  nextRegionId,
  parseSheet,
  serializeSheet,
  SheetFormatError,
  type Sheet,
} from "../src/document/sheet.js";
import { humanAuthorship, type MathRegion, type Region } from "../src/document/region.js";

const AT = new Date("2026-09-04T00:00:00Z");

function math(id: string, x: number, y: number, source: string): MathRegion {
  return { kind: "math", id, position: { x, y }, source, origin: humanAuthorship(AT) };
}

function beamSheet(): Sheet {
  const regions: Region[] = [
    math("r_01", 40, 100, "w_u := 2.4 klf"),
    math("r_02", 40, 140, "L := 25 ft"),
    math("r_03", 40, 180, "M_u := w_u*L^2/8"),
    math("r_04", 40, 220, "M_u = kip*ft"),
    {
      kind: "text",
      id: "r_05",
      position: { x: 40, y: 60 },
      runs: [{ text: "Simply supported beam, uniform load" }],
      origin: humanAuthorship(AT),
    },
  ];
  return { ...emptySheet("W21x44 Beam Check"), regions };
}

function computed(sheet: Sheet) {
  const ws = new Worksheet(sheet.regions);
  ws.recompute();
  const results = new Map(
    sheet.regions
      .map((r) => [r.id, ws.getResult(r.id)] as const)
      .filter((e): e is [string, NonNullable<typeof e[1]>] => e[1] !== undefined),
  );
  return { ws, results };
}

describe("text projection", () => {
  it("reads like the calculation, with values and units", () => {
    const sheet = beamSheet();
    const { ws, results } = computed(sheet);
    const text = project(sheet, ws.order, results);

    expect(text).toContain("# W21x44 Beam Check");
    expect(text).toContain("[r_05] : Simply supported beam, uniform load");
    expect(text).toContain("[r_02] L := 25 ft");
    expect(text).toMatch(/\[r_04\] M_u = kip\*ft\s+⇒ 187\.5 kip\*ft/);
  });

  it("shows an error inline instead of hiding the region", () => {
    const sheet: Sheet = {
      ...emptySheet("Broken"),
      regions: [math("r_01", 40, 100, "L := 25 ft + 3 kip")],
    };
    const { ws, results } = computed(sheet);
    expect(project(sheet, ws.order, results)).toContain("!! unit_mismatch");
  });

  it("names the culprit for a blocked region", () => {
    const sheet: Sheet = {
      ...emptySheet("Blocked"),
      regions: [
        math("r_01", 40, 100, "L := 25 ft + 3 kip"),
        math("r_02", 40, 140, "x := L*2"),
      ],
    };
    const { ws, results } = computed(sheet);
    const text = project(sheet, ws.order, results);
    expect(text).toContain("-- blocked: `L` unavailable from r_01");
  });

  it("renders in evaluation order, not storage order", () => {
    const sheet: Sheet = {
      ...emptySheet("Ordered"),
      regions: [
        math("r_09", 40, 300, "c := 3"),
        math("r_01", 40, 100, "a := 1"),
        math("r_05", 40, 200, "b := 2"),
      ],
    };
    const { ws, results } = computed(sheet);
    const lines = project(sheet, ws.order, results)
      .split("\n")
      .filter((l) => l.startsWith("["));
    expect(lines.map((l) => l.slice(1, 5))).toEqual(["r_01", "r_05", "r_09"]);
  });
});

describe("round trip", () => {
  it("preserves ids and sources through project -> parse", () => {
    const sheet = beamSheet();
    const { ws, results } = computed(sheet);
    expect(roundTrips(sheet, ws.order, results)).toBe(true);
  });

  it("ignores the result column, so a caller can return what it was given", () => {
    const sheet = beamSheet();
    const { ws, results } = computed(sheet);
    const text = project(sheet, ws.order, results);
    const back = parseProjection(text);

    const r03 = back.entries.find((e) => e.id === "r_03");
    expect(r03?.source).toBe("M_u := w_u*L^2/8");
    expect(r03?.source).not.toContain("⇒");
  });

  it("treats an id-less line as a new region", () => {
    const back = parseProjection(
      ["# Sheet", "[r_01] a := 1", "b := a + 1"].join("\n"),
    );
    expect(back.entries[1]?.id).toBeUndefined();
    expect(back.entries[1]?.source).toBe("b := a + 1");
  });

  it("keeps := distinct from a text line", () => {
    const back = parseProjection(["[r_01] : a note", "[r_02] x := 1"].join("\n"));
    expect(back.entries[0]?.kind).toBe("text");
    expect(back.entries[1]?.kind).toBe("math");
  });
});

describe(".jc format", () => {
  it("serializes deterministically, ordered by id not position", () => {
    const sheet = beamSheet();
    const shuffled: Sheet = { ...sheet, regions: [...sheet.regions].reverse() };
    expect(serializeSheet(sheet)).toBe(serializeSheet(shuffled));
    expect(serializeSheet(sheet)).toBe(serializeSheet(parseSheet(serializeSheet(sheet))));
  });

  it("produces a one-line diff when a region moves", () => {
    const sheet = beamSheet();
    const moved: Sheet = {
      ...sheet,
      regions: sheet.regions.map((r) =>
        r.id === "r_02" ? { ...r, position: { x: 40, y: 999 } } : r,
      ),
    };
    const before = serializeSheet(sheet).split("\n");
    const after = serializeSheet(moved).split("\n");
    const changed = before.filter((l, i) => l !== after[i]);
    expect(changed).toHaveLength(1);
    expect(changed[0]).toContain("140");
  });

  it("allocates the next free region id", () => {
    expect(nextRegionId(["r_01", "r_09"])).toBe("r_10");
    expect(nextRegionId([])).toBe("r_01");
  });
});

describe("region style", () => {
  it("round-trips through the format and never affects a value", () => {
    const sheet = beamSheet();
    const styled: Sheet = {
      ...sheet,
      regions: sheet.regions.map((r) =>
        r.id === "r_02" ? { ...r, style: { fontSize: 18, color: "#b3261e", bold: true } } : r,
      ),
    };
    const back = parseSheet(serializeSheet(styled));
    expect(back.regions.find((r) => r.id === "r_02")?.style).toEqual({
      fontSize: 18,
      color: "#b3261e",
      bold: true,
    });

    const plain = computed(sheet);
    const fancy = computed(styled);
    expect(fancy.ws.getResult("r_03")).toEqual(plain.ws.getResult("r_03"));
  });

  it("omits an empty style from the serialized form", () => {
    expect(serializeSheet(beamSheet())).not.toContain('"style"');
  });
});
