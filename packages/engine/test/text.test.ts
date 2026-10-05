import { describe, expect, it } from "vitest";
import {
  applyStyleToRange,
  normalize,
  plainText,
  replaceRange,
  runsFromText,
  sliceRuns,
  styleOfRange,
  textLength,
  type TextRun,
} from "../src/document/text.js";

const RED = { color: "#b3261e" };

describe("run invariants", () => {
  it("merges adjacent runs with equal style", () => {
    // Without this, typing one character at a time grows an unbounded list of
    // single-character runs.
    const runs = normalize([{ text: "a" }, { text: "b" }, { text: "c" }]);
    expect(runs).toEqual([{ text: "abc" }]);
  });

  it("drops empty runs and empty styles", () => {
    expect(normalize([{ text: "" }, { text: "x", style: {} }])).toEqual([{ text: "x" }]);
    expect(normalize([{ text: "x", style: { bold: false } }])).toEqual([{ text: "x" }]);
  });

  it("keeps runs that differ", () => {
    const runs = normalize([{ text: "a" }, { text: "b", style: RED }, { text: "c" }]);
    expect(runs).toHaveLength(3);
  });
});

describe("styling a selection", () => {
  const base = runsFromText("The quick brown fox");

  it("styles only the selected characters", () => {
    const runs = applyStyleToRange(base, 4, 9, RED); // "quick"
    expect(plainText(runs)).toBe("The quick brown fox");
    expect(runs).toEqual([
      { text: "The " },
      { text: "quick", style: RED },
      { text: " brown fox" },
    ]);
  });

  it("merges into existing style rather than replacing it", () => {
    // Colouring text that is already bold must leave it bold.
    const bold = applyStyleToRange(base, 4, 9, { bold: true });
    const both = applyStyleToRange(bold, 4, 9, RED);
    expect(both[1]?.style).toEqual({ bold: true, color: RED.color });
  });

  it("styles across a run boundary", () => {
    const start = applyStyleToRange(base, 0, 3, { bold: true });
    const across = applyStyleToRange(start, 2, 6, RED);
    expect(plainText(across)).toBe("The quick brown fox");
    expect(across.map((r) => r.text)).toEqual(["Th", "e", " qu", "ick brown fox"]);
    expect(across[1]?.style).toEqual({ bold: true, color: RED.color });
    expect(across[2]?.style).toEqual(RED);
  });

  it("leaves the text alone for an empty or inverted range", () => {
    expect(applyStyleToRange(base, 5, 5, RED)).toEqual(base);
    // A backwards drag selects the same characters.
    expect(applyStyleToRange(base, 9, 4, RED)).toEqual(applyStyleToRange(base, 4, 9, RED));
  });

  it("clamps a range past the end", () => {
    const runs = applyStyleToRange(base, 16, 999, RED);
    expect(plainText(runs)).toBe("The quick brown fox");
    expect(runs[runs.length - 1]?.style).toEqual(RED);
  });

  it("renormalizes so repeated styling does not fragment", () => {
    let runs: TextRun[] = base;
    for (let i = 0; i < 6; i++) runs = applyStyleToRange(runs, 4, 9, RED);
    expect(runs).toHaveLength(3);
  });
});

describe("reading style back", () => {
  it("reports a style shared by the whole range", () => {
    const runs = applyStyleToRange(runsFromText("abcdef"), 0, 6, { bold: true });
    expect(styleOfRange(runs, 1, 4)).toEqual({ bold: true });
  });

  it("reports nothing common across a mixed range", () => {
    const runs = applyStyleToRange(runsFromText("abcdef"), 0, 3, { bold: true });
    expect(styleOfRange(runs, 0, 6).bold).toBeUndefined();
  });
});

describe("editing text", () => {
  it("inherits the style at the insertion point", () => {
    const runs = applyStyleToRange(runsFromText("bold"), 0, 4, { bold: true });
    const typed = replaceRange(runs, 4, 4, "er");
    // Typing at the end of a bold word stays bold, as in any editor.
    expect(plainText(typed)).toBe("bolder");
    expect(typed).toHaveLength(1);
    expect(typed[0]?.style).toEqual({ bold: true });
  });

  it("deletes a range and keeps surrounding styles", () => {
    const runs = applyStyleToRange(runsFromText("The quick fox"), 4, 9, RED);
    const cut = replaceRange(runs, 4, 10, "");
    expect(plainText(cut)).toBe("The fox");
    expect(cut).toEqual([{ text: "The fox" }]);
  });

  it("slices a styled range", () => {
    const runs = applyStyleToRange(runsFromText("abcdef"), 2, 4, RED);
    expect(sliceRuns(runs, 1, 5)).toEqual([
      { text: "b" },
      { text: "cd", style: RED },
      { text: "e" },
    ]);
    expect(textLength(runs)).toBe(6);
  });
});

describe("runs in the document format", () => {
  it("round-trips styled runs", async () => {
    const { emptySheet, parseSheet, serializeSheet } = await import("../src/document/sheet.js");
    const { humanAuthorship } = await import("../src/document/region.js");
    const runs = applyStyleToRange(runsFromText("The quick fox"), 4, 9, RED);
    const sheet = {
      ...emptySheet("T"),
      regions: [
        {
          kind: "text" as const,
          id: "r_01",
          position: { x: 0, y: 0 },
          runs,
          origin: humanAuthorship(new Date("2026-09-04T00:00:00Z")),
        },
      ],
    };
    const back = parseSheet(serializeSheet(sheet));
    const region = back.regions[0];
    expect(region?.kind).toBe("text");
    expect(region?.kind === "text" && region.runs).toEqual(runs);
  });

  it("reads an older sheet that stored one plain string", async () => {
    const { parseSheet } = await import("../src/document/sheet.js");
    const back = parseSheet(
      JSON.stringify({
        schemaVersion: 1,
        title: "Old",
        page: { size: "letter", orientation: "portrait", margin: 48 },
        regions: [
          {
            id: "r_01",
            kind: "text",
            position: { x: 0, y: 0 },
            text: "a note",
            origin: { author: "human", at: "2026-01-01T00:00:00.000Z" },
          },
        ],
        changeLog: [],
      }),
    );
    const region = back.regions[0];
    // Losing the prose on a saved sheet would be unforgivable for a format
    // change nobody asked for.
    expect(region?.kind === "text" && plainText(region.runs)).toBe("a note");
  });
});
