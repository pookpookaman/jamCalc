/**
 * Plots.
 *
 * A plot holds no data — it names vectors the sheet
 * computes — so most of what matters here is that it stays in step with them
 * and reports clearly when it cannot be drawn.
 */

import { describe, expect, it } from "vitest";
import { Worksheet } from "../src/document/worksheet.js";
import { buildPlot } from "../src/document/plot.js";
import { humanAuthorship, type PlotRegion, type Region, type TableRegion } from "../src/document/region.js";
import { emptySheet, parseSheet, serializeSheet, type Sheet } from "../src/document/sheet.js";
import { project, roundTrips } from "../src/document/projection.js";
import { getRegion } from "../src/api/operations.js";
import { MatrixValue } from "../src/matrix.js";
import { Quantity } from "../src/quantity.js";
import { Dimension } from "../src/dimension.js";
import type { Value } from "../src/value.js";

const AT = new Date("2026-09-05T00:00:00Z");

const table = (id: string, y: number): TableRegion => ({
  kind: "table", id, position: { x: 48, y },
  columns: [{ name: "span", unit: "ft" }, { name: "load", unit: "klf" }],
  cells: [[10, 2.4], [20, 1.8], [30, 1.2]],
  origin: humanAuthorship(AT),
});

const plot = (id: string, y: number, over: Partial<PlotRegion> = {}): PlotRegion => ({
  kind: "plot", id, position: { x: 48, y },
  series: [{ x: "span", y: "load" }],
  origin: humanAuthorship(AT),
  ...over,
});

const math = (id: string, y: number, source: string): Region => ({
  kind: "math", id, position: { x: 48, y }, source, origin: humanAuthorship(AT),
});

const LENGTH = Dimension.of({ length: 1 });

const vector = (values: number[], dim = Dimension.DIMENSIONLESS): Value =>
  MatrixValue.fromCells(values.length, 1, values.map((v) => new Quantity(v, dim)));

describe("building a plot model", () => {
  const lookup = (m: Record<string, Value>) => (n: string) => m[n];

  it("puts points in the axis's display unit, not SI", () => {
    const model = buildPlot(plot("p", 0, { series: [{ x: "a", y: "b" }], xUnit: "ft", yUnit: "" }), lookup({
      a: vector([3.048, 6.096], LENGTH),
      b: vector([1, 2]),
    }));
    // 3.048 m is 10 ft — what the reader sees on the axis.
    expect(model.traces[0]!.points[0]!.x).toBeCloseTo(10, 6);
  });

  it("chooses round tick values rather than dividing the range", () => {
    const model = buildPlot(plot("p", 0, { series: [{ x: "a", y: "b" }] }), lookup({
      a: vector([0, 7]),
      b: vector([0, 26]),
    }));
    // Nobody reads 3.7143 off a calc sheet.
    for (const t of model.x.ticks) expect(Number(t.label)).toBeCloseTo(t.value, 9);
    const steps = model.y.ticks.slice(1).map((t, i) => t.value - model.y.ticks[i]!.value);
    for (const s of steps) expect(s).toBeCloseTo(steps[0] as number, 9);
  });

  it("gives a flat series a readable axis instead of a zero-width one", () => {
    const model = buildPlot(plot("p", 0, { series: [{ x: "a", y: "b" }] }), lookup({
      a: vector([1, 2]),
      b: vector([5, 5]),
    }));
    expect(model.y.max).toBeGreaterThan(model.y.min);
  });

  it("colours traces differently without being told", () => {
    const model = buildPlot(
      plot("p", 0, { series: [{ x: "a", y: "b" }, { x: "a", y: "c" }] }),
      lookup({ a: vector([1, 2]), b: vector([1, 2]), c: vector([2, 3]) }),
    );
    expect(model.traces[0]!.color).not.toBe(model.traces[1]!.color);
  });

  it("refuses a single value where a column belongs", () => {
    expect(() =>
      buildPlot(plot("p", 0, { series: [{ x: "a", y: "b" }] }), lookup({
        a: new Quantity(1),
        b: vector([1, 2]),
      })),
    ).toThrow(/needs a column/);
  });

  it("says which two columns disagree in length", () => {
    expect(() =>
      buildPlot(plot("p", 0, { series: [{ x: "a", y: "b" }] }), lookup({
        a: vector([1, 2, 3]),
        b: vector([1, 2]),
      })),
    ).toThrow(/`a` has 3 values and `b` has 2/);
  });

  it("names the value that will not go on the axis", () => {
    expect(() =>
      buildPlot(plot("p", 0, { series: [{ x: "a", y: "b" }], xUnit: "kip" }), lookup({
        a: vector([1, 2], LENGTH),
        b: vector([1, 2]),
      })),
    ).toThrow(/`a` cannot be drawn on an axis in `kip`/);
  });
});

describe("a plot on a sheet", () => {
  it("draws a table's columns", () => {
    const ws = new Worksheet([table("t_01", 0), plot("p_02", 200)]);
    ws.recompute();
    const model = ws.getPlot("p_02");
    expect(model?.traces[0]?.points).toEqual([
      { x: 10, y: 2.4 },
      { x: 20, y: 1.8 },
      { x: 30, y: 1.2 },
    ]);
    expect(model?.x.unit).toBe("ft");
  });

  it("has no result of its own when it draws", () => {
    const ws = new Worksheet([table("t_01", 0), plot("p_02", 200)]);
    ws.recompute();
    expect(ws.getResult("p_02")).toBeUndefined();
  });

  it("redraws when the data underneath changes", () => {
    const ws = new Worksheet([table("t_01", 0), plot("p_02", 200)]);
    ws.recompute();
    ws.remove("t_01");
    ws.insert({ ...table("t_01", 0), cells: [[10, 5], [20, 6], [30, 7]] });
    ws.recompute();
    expect(ws.getPlot("p_02")?.traces[0]?.points[0]).toEqual({ x: 10, y: 5 });
  });

  it("is blocked, naming the region at fault, when its data fails", () => {
    const broken: TableRegion = { ...table("t_01", 0), cells: [[10, 2.4], [null, 1.8]] };
    const ws = new Worksheet([broken, plot("p_02", 200)]);
    ws.recompute();
    const r = ws.getResult("p_02");
    expect(r?.status).toBe("blocked");
    if (r?.status === "blocked") expect(r.because).toBe("t_01");
  });

  it("obeys positional order: a plot above its data cannot draw it", () => {
    const ws = new Worksheet([plot("p_01", 0), table("t_02", 200)]);
    ws.recompute();
    expect(ws.getResult("p_01")?.status).toBe("error");
    expect(ws.getPlot("p_01")).toBeUndefined();
  });

  it("is not an error before any series is named", () => {
    // A plot just inserted is not a broken plot.
    const ws = new Worksheet([plot("p_01", 0, { series: [] })]);
    ws.recompute();
    expect(ws.getResult("p_01")).toBeUndefined();
  });

  it("draws a range against a computed vector", () => {
    const ws = new Worksheet([
      math("r_01", 0, "i := 1..5"),
      math("r_02", 40, "sq := map(i, f) "),
      plot("p_03", 200, { series: [{ x: "i", y: "i" }] }),
    ]);
    ws.recompute();
    expect(ws.getPlot("p_03")?.traces[0]?.points.length).toBe(5);
  });
});

describe("the document format", () => {
  const sheet: Sheet = {
    ...emptySheet("S"),
    regions: [table("t_01", 0), plot("p_02", 200, { xLabel: "span" })],
  };

  it("round-trips through save and open", () => {
    // Serialization orders regions by id, not by position, so a move is a
    // one-line diff. Compare by id rather than by order.
    const byId = (rs: readonly { id: string }[]) =>
      [...rs].sort((a, b) => a.id.localeCompare(b.id));
    expect(byId(parseSheet(serializeSheet(sheet)).regions)).toEqual(byId(sheet.regions));
  });

  it("says what is drawn against what in the projection", () => {
    expect(project(sheet, ["t_01", "p_02"], new Map())).toContain("[p_02] ~ plot load vs span");
  });

  it("survives a projection round trip", () => {
    expect(roundTrips(sheet, ["t_01", "p_02"], new Map())).toBe(true);
  });

  it("reports its series through the API", () => {
    const report = getRegion(sheet, "p_02");
    expect(report.kind).toBe("plot");
    expect(report.series).toEqual([{ x: "span", y: "load" }]);
  });
});
