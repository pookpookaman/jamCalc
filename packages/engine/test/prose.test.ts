/**
 * Images, and values living inside prose.
 *
 * The inline reference is the one with teeth: a number retyped
 * into a sentence is a number nobody updates, and a sheet whose prose
 * contradicts its arithmetic is worse than one with no prose at all.
 */

import { describe, expect, it } from "vitest";
import { Worksheet } from "../src/document/worksheet.js";
import { humanAuthorship, type ImageRegion, type Region } from "../src/document/region.js";
import { emptySheet, parseSheet, serializeSheet, type Sheet } from "../src/document/sheet.js";
import { project, roundTrips } from "../src/document/projection.js";
import { getRegion } from "../src/api/operations.js";
import { applyPatch } from "../src/api/patch.js";
import { ApiError } from "../src/api/errors.js";
import { plainText, renderedText, runsFromText, textReads } from "../src/document/text.js";

const AT = new Date("2026-09-06T00:00:00Z");
const origin = humanAuthorship(AT);

const math = (id: string, y: number, source: string): Region => ({
  kind: "math", id, position: { x: 48, y }, source, origin,
});
const prose = (id: string, y: number, body: string): Region => ({
  kind: "text", id, position: { x: 48, y }, runs: runsFromText(body), origin,
});

const PIXEL =
  "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

describe("writing a reference", () => {
  it("makes `{name}` its own run", () => {
    const runs = runsFromText("M is {M_u} today");
    expect(runs.map((r) => r.ref ?? null)).toEqual([null, "M_u", null]);
  });

  it("never merges a reference into the text beside it", () => {
    // Merging would dissolve the link into a literal number.
    const runs = runsFromText("{a}{b}");
    expect(runs).toHaveLength(2);
  });

  it("treats doubled braces as literal ones", () => {
    const runs = runsFromText("use {{braces}} plainly");
    expect(runs.every((r) => r.ref === undefined)).toBe(true);
    expect(renderedText(runs)).toBe("use {braces} plainly");
  });

  it("writes a reference back as `{name}`, not as the number it showed", () => {
    // Handing back the value would invite writing it in as literal text and
    // severing the link.
    const runs = runsFromText("M is {M_u}");
    const shown = runs.map((r) => (r.ref ? { ...r, text: "187.5 kip*ft" } : r));
    expect(plainText(shown)).toBe("M is {M_u}");
    expect(renderedText(shown)).toBe("M is 187.5 kip*ft");
  });

  it("round-trips text through plain form", () => {
    const source = "The moment {M_u} governs; {{not}} this one";
    expect(plainText(runsFromText(source))).toBe(source);
  });

  it("reports the names prose reads", () => {
    expect([...textReads(runsFromText("{a} and {b} and {a}"))]).toEqual(["a", "b"]);
  });
});

describe("a reference on a sheet", () => {
  const sheet = (): Region[] => [
    math("r_01", 0, "M_u := 2.4 klf*(25 ft)^2/8 = kip*ft"),
    prose("r_02", 40, "The governing moment is {M_u} at midspan."),
  ];

  it("shows the sheet's own value inside the sentence", () => {
    const ws = new Worksheet(sheet());
    ws.recompute();
    expect(renderedText(ws.getRuns("r_02") ?? [])).toBe(
      "The governing moment is 187.5 kip*ft at midspan.",
    );
  });

  it("follows the value when the sheet changes", () => {
    const ws = new Worksheet(sheet());
    ws.recompute();
    ws.edit("r_01", "M_u := 2.4 klf*(30 ft)^2/8 = kip*ft");
    ws.recompute();
    expect(renderedText(ws.getRuns("r_02") ?? [])).toContain("270 kip*ft");
  });

  it("obeys positional order like any other reference", () => {
    const ws = new Worksheet([
      prose("r_01", 0, "Before: {L}"),
      math("r_02", 40, "L := 25 ft"),
      prose("r_03", 80, "After: {L}"),
    ]);
    ws.recompute();
    expect(ws.getResult("r_01")?.status).toBe("error");
    expect(renderedText(ws.getRuns("r_03") ?? [])).toBe("After: 25 ft");
  });

  it("marks prose that quotes a name the sheet does not define", () => {
    const ws = new Worksheet([prose("r_01", 0, "Missing {nope} here")]);
    ws.recompute();
    expect(ws.getResult("r_01")?.status).toBe("error");
    // The sentence still reads, wanting its number visibly.
    expect(renderedText(ws.getRuns("r_01") ?? [])).toBe("Missing {nope} here");
  });

  it("is blocked, naming the region at fault, when its source fails", () => {
    const ws = new Worksheet([
      math("r_01", 0, "x := 1 kip + 1 ft"),
      prose("r_02", 40, "Value: {x}"),
    ]);
    ws.recompute();
    const r = ws.getResult("r_02");
    expect(r?.status).toBe("blocked");
    if (r?.status === "blocked") expect(r.because).toBe("r_01");
  });

  it("leaves prose without references alone", () => {
    const ws = new Worksheet([prose("r_01", 0, "Just words.")]);
    ws.recompute();
    expect(ws.getResult("r_01")).toBeUndefined();
    expect(ws.getRuns("r_01")).toBeUndefined();
  });
});

describe("images", () => {
  const image: ImageRegion = {
    kind: "image", id: "r_01", position: { x: 48, y: 0 },
    src: PIXEL, alt: "sketch", origin,
  };
  const sheet: Sheet = { ...emptySheet("S"), regions: [image] };

  it("round-trips through save and open", () => {
    expect(parseSheet(serializeSheet(sheet)).regions[0]).toEqual(image);
  });

  it("says what it is in the projection, not what it contains", () => {
    // A data URI in the projection would bury the sheet in base64.
    expect(project(sheet, ["r_01"], new Map())).toContain("[r_01] @ image sketch");
    expect(project(sheet, ["r_01"], new Map())).not.toContain("base64");
  });

  it("survives a projection round trip", () => {
    expect(roundTrips(sheet, ["r_01"], new Map())).toBe(true);
  });

  it("reports its size rather than its bytes", () => {
    const report = getRegion(sheet, "r_01");
    expect(report.kind).toBe("image");
    expect(report.bytes).toBe(PIXEL.length);
    expect(report.text).toBe("sketch");
  });

  it("refuses a remote URL, by any route", () => {
    // A sheet that fetched its own pictures would contact whoever served them
    // each time it was opened. The API refuses one on update and on insert,
    // and a file that holds one opens with an empty frame instead.
    const ctx = { client: "test", now: () => AT };
    const remote = "https://example.com/a.png";
    expect(() => applyPatch(sheet, [{ op: "update", id: "r_01", src: remote }], ctx)).toThrow(ApiError);
    expect(() => applyPatch(sheet, [{ op: "insert", kind: "image", src: remote }], ctx)).toThrow(ApiError);
    const file = serializeSheet({ ...sheet, regions: [{ ...image, src: remote }] });
    expect((parseSheet(file).regions[0] as ImageRegion).src).toBe("");
  });

  it("accepts an embedded picture", () => {
    const { sheet: next } = applyPatch(
      sheet,
      [{ op: "insert", kind: "image", id: "r_02", src: PIXEL, alt: "detail" }],
      { client: "test", now: () => AT },
    );
    const added = next.regions.find((r) => r.id === "r_02");
    expect(added).toMatchObject({ kind: "image", src: PIXEL, alt: "detail" });
  });
});

describe("alignment", () => {
  const block = (align?: "left" | "center" | "right"): Region => ({
    kind: "text", id: "r_01", position: { x: 48, y: 0 },
    runs: runsFromText("a heading"), origin,
    ...(align ? { align } : {}),
  });

  it("survives save and open", () => {
    const sheet: Sheet = { ...emptySheet("S"), regions: [block("center")] };
    expect(parseSheet(serializeSheet(sheet)).regions[0]).toEqual(block("center"));
  });

  it("is set through the API", () => {
    const sheet: Sheet = { ...emptySheet("S"), regions: [block()] };
    const { sheet: next } = applyPatch(
      sheet,
      [{ op: "update", id: "r_01", align: "right" }],
      { client: "test", now: () => AT },
    );
    expect(next.regions[0]).toMatchObject({ align: "right" });
    // And the file actually carries it: the property meant nothing until it
    // reached the disk.
    expect(serializeSheet(next)).toContain('"align"');
  });

  it("is cleared by setting it to null, rather than stored as `left`", () => {
    const sheet: Sheet = { ...emptySheet("S"), regions: [block("center")] };
    const { sheet: next } = applyPatch(
      sheet,
      [{ op: "update", id: "r_01", align: null }],
      { client: "test", now: () => AT },
    );
    expect((next.regions[0] as { align?: string }).align).toBeUndefined();
    expect(serializeSheet(next)).not.toContain('"align"');
  });

  it("belongs to prose alone", () => {
    // A property of a block of words; there is no such thing for an equation.
    const sheet: Sheet = {
      ...emptySheet("S"),
      regions: [{
        kind: "math", id: "r_01", position: { x: 48, y: 0 },
        source: "a := 1", origin,
      }],
    };
    expect(() =>
      applyPatch(sheet, [{ op: "update", id: "r_01", align: "center" }], {
        client: "test", now: () => AT,
      }),
    ).toThrow(/alignment applies to text/);
  });
});
