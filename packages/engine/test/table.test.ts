/**
 * Data tables.
 *
 * The point of the feature is that a code table becomes
 * usable by `linterp` without new language, so most of these tests are about
 * a table feeding real arithmetic rather than about the grid itself.
 */

import { describe, expect, it } from "vitest";
import { Worksheet } from "../src/document/worksheet.js";
import { evaluateTable } from "../src/document/table.js";
import { humanAuthorship, type Region, type TableRegion } from "../src/document/region.js";
import { emptySheet, parseSheet, serializeSheet, type Sheet } from "../src/document/sheet.js";
import { project, roundTrips, tableLines } from "../src/document/projection.js";
import { getRegion, listSymbols } from "../src/api/operations.js";
import { CalcError } from "../src/errors.js";
import { MatrixValue } from "../src/matrix.js";

const AT = new Date("2026-09-05T00:00:00Z");

const table = (
  id: string,
  y: number,
  columns: TableRegion["columns"],
  cells: TableRegion["cells"],
): TableRegion => ({
  kind: "table", id, position: { x: 48, y }, columns, cells, origin: humanAuthorship(AT),
});

const math = (id: string, y: number, source: string): Region => ({
  kind: "math", id, position: { x: 48, y }, source, origin: humanAuthorship(AT),
});

/** A span/load table of the kind a real sheet carries. */
const SPANS = table(
  "t_01",
  0,
  [{ name: "span", unit: "ft" }, { name: "load", unit: "klf" }],
  [[10, 2.4], [20, 1.8], [30, 1.2]],
);

describe("evaluating a table", () => {
  it("binds one column vector per column", () => {
    const { values, provides } = evaluateTable(SPANS);
    expect(provides).toEqual(["span", "load"]);
    const span = values.get("span") as MatrixValue;
    expect(span.rows).toBe(3);
    expect(span.cols).toBe(1);
  });

  it("carries the column's unit into every cell", () => {
    const { values } = evaluateTable(SPANS);
    const span = values.get("span") as MatrixValue;
    // 10 ft stored in coherent SI, like every other quantity in the engine.
    expect(span.cells[0]!.si).toBeCloseTo(3.048, 6);
  });

  it("treats a column with no unit as a plain number", () => {
    const t = table("t", 0, [{ name: "n" }], [[1], [2]]);
    const { values } = evaluateTable(t);
    expect((values.get("n") as MatrixValue).cells[0]!.si).toBe(1);
  });

  it("ignores blank rows at the bottom", () => {
    // A grid being typed into has an empty row under the data; erroring on it
    // would make the table flash red through every edit.
    const t = table("t", 0, [{ name: "n" }], [[1], [2], [null], [null]]);
    expect((evaluateTable(t).values.get("n") as MatrixValue).rows).toBe(2);
  });
});

describe("what a table refuses", () => {
  const boom = (t: TableRegion) => {
    try {
      evaluateTable(t);
    } catch (e) {
      return e as CalcError;
    }
    throw new Error("expected an error");
  };

  it("names the row and column of an empty cell", () => {
    const t = table("t", 0, [{ name: "a" }, { name: "b" }], [[1, 2], [3, null], [5, 6]]);
    expect(boom(t).message).toMatch(/row 2 of column `b` is empty/);
  });

  it("rejects a name the language could not read", () => {
    expect(boom(table("t", 0, [{ name: "2span" }], [[1]])).message).toMatch(/not a usable name/);
    expect(boom(table("t", 0, [{ name: "" }], [[1]])).message).toMatch(/column 1 has no name/);
  });

  it("rejects two columns claiming one name", () => {
    // Otherwise the sheet's value would depend on column order.
    const t = table("t", 0, [{ name: "a" }, { name: "a" }], [[1, 2]]);
    expect(boom(t).message).toMatch(/names two columns/);
  });

  it("names the column whose unit is not a unit", () => {
    const t = table("t", 0, [{ name: "a", unit: "wombats" }], [[1]]);
    const err = boom(t);
    expect(err.code).toBe("unknown_unit");
    expect(err.message).toMatch(/column `a`/);
  });

  it("says a table has no rows rather than producing an empty vector", () => {
    expect(boom(table("t", 0, [{ name: "a" }], [])).message).toMatch(/no rows yet/);
  });
});

describe("a table on a sheet", () => {
  it("feeds linterp without any new language", () => {
    const ws = new Worksheet([
      SPANS,
      math("r_02", 40, "L := 22 ft"),
      math("r_03", 80, "w := linterp(span, load, L) = klf"),
    ]);
    ws.recompute();
    const r = ws.getResult("r_03");
    expect(r?.status).toBe("ok");
    // Between 20 ft (1.8) and 30 ft (1.2): 1.8 - 0.2*0.6 = 1.68 klf
    if (r?.status === "ok") expect(r.displayValue).toBeCloseTo(1.68, 6);
  });

  it("has no result of its own when it is fine", () => {
    const ws = new Worksheet([SPANS]);
    ws.recompute();
    // Nothing to display: the grid is the output. A result here would put a
    // value badge on a region that has none.
    expect(ws.getResult("t_01")).toBeUndefined();
  });

  it("reports its own error and blocks its readers, naming it", () => {
    const bad = table("t_01", 0, [{ name: "span", unit: "ft" }], [[10], [null], [30]]);
    const ws = new Worksheet([bad, math("r_02", 40, "n := rows(span) =")]);
    ws.recompute();
    expect(ws.getResult("t_01")?.status).toBe("error");
    const dependent = ws.getResult("r_02");
    expect(dependent?.status).toBe("blocked");
    if (dependent?.status === "blocked") expect(dependent.because).toBe("t_01");
  });

  it("obeys positional binding like any other definition", () => {
    // A math region above the table must not see the column.
    const ws = new Worksheet([
      math("r_01", 0, "early := rows(span) ="),
      table("t_02", 40, [{ name: "span", unit: "ft" }], [[10], [20]]),
      math("r_03", 80, "late := rows(span) ="),
    ]);
    ws.recompute();
    expect(ws.getResult("r_01")?.status).toBe("error");
    expect(ws.getResult("r_03")?.status).toBe("ok");
  });

  it("recomputes its readers when the grid changes", () => {
    const ws = new Worksheet([SPANS, math("r_02", 40, "n := sum(load) = klf")]);
    ws.recompute();
    const before = ws.getResult("r_02");
    ws.remove("t_01");
    ws.insert(table("t_01", 0, SPANS.columns, [[10, 1], [20, 1], [30, 1]]));
    ws.recompute();
    const after = ws.getResult("r_02");
    expect(before?.status).toBe("ok");
    if (before?.status === "ok" && after?.status === "ok") {
      expect(before.displayValue).toBeCloseTo(5.4, 6);
      expect(after.displayValue).toBeCloseTo(3, 6);
    }
  });

  it("lists its columns as symbols", () => {
    const sheet: Sheet = { ...emptySheet("S"), regions: [SPANS] };
    expect(listSymbols(sheet).map((s) => s.name)).toEqual(["span", "load"]);
  });
});

describe("the document format", () => {
  const sheet: Sheet = { ...emptySheet("S"), regions: [SPANS] };

  it("round-trips a table through save and open", () => {
    const back = parseSheet(serializeSheet(sheet));
    expect(back.regions[0]).toEqual(SPANS);
  });

  it("carries the grid in the projection rather than summarising it", () => {
    // A caller reading a sheet has to be able to see the data a lookup uses.
    const lines = tableLines(SPANS);
    expect(lines[0]).toBe("| span (ft) | load (klf)");
    expect(lines[1]).toBe("| 10 | 2.4");
    expect(project(sheet, ["t_01"], new Map())).toContain("[t_01] | 10 | 2.4");
  });

  it("survives a projection round trip", () => {
    expect(roundTrips(sheet, ["t_01"], new Map())).toBe(true);
  });

  it("describes columns and rows through the API", () => {
    const report = getRegion(sheet, "t_01");
    expect(report.kind).toBe("table");
    expect(report.rows).toBe(3);
    expect(report.columns).toEqual([
      { name: "span", unit: "ft" },
      { name: "load", unit: "klf" },
    ]);
    expect(report.defines).toBe("span, load");
  });
});
