/**
 * Which property controls belong on screen.
 *
 * The rule is that a control appears when it would do something. A bar with
 * half its controls permanently greyed out teaches people to stop reading it,
 * and a decimals control beside a picture promises something the app cannot
 * do.
 */

import { describe, expect, it } from "vitest";
import { formatControls, type Kind } from "../src/formatControls.js";

const on = (kinds: Kind[], range = false, units = false) =>
  formatControls(kinds, range, units);

describe("with nothing selected", () => {
  it("offers nothing at all", () => {
    const c = on([]);
    expect(c.none).toBe(true);
    expect(c.size || c.colour || c.weight || c.align || c.decimals || c.units).toBe(false);
  });
});

describe("prose", () => {
  it("offers alignment, which nothing else does", () => {
    expect(on(["text"]).align).toBe(true);
    expect(on(["math"]).align).toBe(false);
    expect(on(["table"]).align).toBe(false);
  });

  it("offers the character controls", () => {
    const c = on(["text"]);
    expect([c.size, c.colour, c.weight]).toEqual([true, true, true]);
  });

  it("does not offer decimals: there is no number to round", () => {
    expect(on(["text"]).decimals).toBe(false);
  });

  it("offers alignment for a highlight inside prose", () => {
    // Alignment acts on the block the highlighted characters are in.
    const c = on(["text"], true);
    expect(c.align).toBe(true);
    expect(c.size).toBe(true);
  });

  it("offers nothing numeric for a highlight", () => {
    const c = on(["math"], true, true);
    expect(c.decimals).toBe(false);
    expect(c.units).toBe(false);
  });
});

describe("maths", () => {
  it("offers decimals", () => {
    expect(on(["math"]).decimals).toBe(true);
  });

  it("offers units for a single region that can use one", () => {
    expect(on(["math"], false, true).units).toBe(true);
  });

  it("does not offer units when the result cannot take one", () => {
    expect(on(["math"], false, false).units).toBe(false);
  });

  it("does not offer units for several regions at once", () => {
    // The picker chooses a unit for one result; two would be ambiguous.
    expect(on(["math", "math"], false, true).units).toBe(false);
  });
});

describe("tables", () => {
  it("offers the character controls", () => {
    const c = on(["table"]);
    expect([c.size, c.colour, c.weight]).toEqual([true, true, true]);
  });

  it("does not offer decimals: the numbers were typed, not computed", () => {
    expect(on(["table"]).decimals).toBe(false);
  });
});

describe("things with nothing to format", () => {
  it("offers nothing for a picture", () => {
    expect(on(["image"]).none).toBe(true);
  });

  it("offers nothing for a page break", () => {
    expect(on(["pagebreak"]).none).toBe(true);
  });

  it("offers nothing for a plot", () => {
    // Its labels come from the stylesheet; a font size would silently do
    // nothing, and offering it would be a lie.
    expect(on(["plot"]).none).toBe(true);
  });
});

describe("a mixed selection", () => {
  it("offers only what everything shares", () => {
    const c = on(["math", "text"]);
    expect([c.size, c.colour, c.weight]).toEqual([true, true, true]);
    // Pressing align would change the prose and quietly skip the maths.
    expect(c.align).toBe(false);
    expect(c.decimals).toBe(false);
  });

  it("offers nothing once something formattable meets something that is not", () => {
    expect(on(["text", "image"]).none).toBe(true);
    expect(on(["math", "pagebreak"]).none).toBe(true);
  });

  it("keeps decimals for several maths regions", () => {
    expect(on(["math", "math"]).decimals).toBe(true);
  });
});

describe("the result's own colour", () => {
  it("is offered for math", () => {
    expect(formatControls(["math"], false).resultColour).toBe(true);
    expect(formatControls(["math", "math"], false).resultColour).toBe(true);
  });

  it("is not offered where there is no result", () => {
    expect(formatControls(["text"], false).resultColour).toBe(false);
    expect(formatControls(["table"], false).resultColour).toBe(false);
    expect(formatControls(["math", "text"], false).resultColour).toBe(false);
    // Highlighted prose is text, whatever else is selected.
    expect(formatControls(["math"], true).resultColour).toBe(false);
  });
});
