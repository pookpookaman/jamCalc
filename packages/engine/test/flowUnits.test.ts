/**
 * Flow and power units, for pump and pipe sizing.
 *
 * The constants are exact by definition: a US gallon is 231 cubic inches and a
 * mechanical horsepower is 550 foot-pounds-force per second. The checks below
 * are the relationships an engineer would use to sanity-check them by hand.
 */

import { describe, expect, it } from "vitest";
import { parseUnit, quantityFrom, valueIn } from "../src/units/parse.js";
import { preferredUnit } from "../src/units/prefer.js";
import { DIM } from "../src/dimension.js";

describe("gallons and gpm", () => {
  it("defines a gallon as 231 cubic inches", () => {
    expect(valueIn(quantityFrom(1, "gal"), "in^3")).toBeCloseTo(231, 9);
  });

  it("converts gpm to cubic feet per minute", () => {
    // 1 ft^3 = 1728 in^3, so 1 gpm = 231/1728 ft^3/min.
    expect(valueIn(quantityFrom(1, "gpm"), "ft^3/min")).toBeCloseTo(231 / 1728, 12);
  });

  it("makes gpm a flow, and gal/min the same thing", () => {
    expect(parseUnit("gpm").dimension.equals(DIM.FLOW)).toBe(true);
    expect(valueIn(quantityFrom(500, "gpm"), "gal/min")).toBeCloseTo(500, 9);
  });

  it("shows a flow in gpm unless told otherwise", () => {
    expect(preferredUnit(DIM.FLOW)).toBe("gpm");
  });
});

describe("power", () => {
  it("defines a horsepower as 550 ft*lbf/s", () => {
    expect(valueIn(quantityFrom(1, "hp"), "ft*lbf/s")).toBeCloseTo(550, 9);
    expect(valueIn(quantityFrom(1, "hp"), "W")).toBeCloseTo(745.6998715822702, 6);
  });

  it("gives the pump rule of thumb: gpm x psi / 1714 = hp", () => {
    const hydraulic = quantityFrom(1714, "gpm").mul(quantityFrom(1, "psi"));
    expect(hydraulic.dimension.equals(DIM.POWER)).toBe(true);
    expect(valueIn(hydraulic, "hp")).toBeCloseTo(1, 3);
  });

  it("shows a power in hp unless told otherwise", () => {
    expect(preferredUnit(DIM.POWER)).toBe("hp");
  });
});
