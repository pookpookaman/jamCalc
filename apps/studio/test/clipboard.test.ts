/**
 * Copy and paste of regions: a paste reproduces what was copied — content,
 * look and arrangement — at the new place, under new ids.
 */

import { describe, expect, it } from "vitest";
import { applyPatch, emptySheet, humanAuthorship, type Region } from "@jamcalc/engine";
import { copyRegions, pasteOperations, readCopied } from "../src/clipboard.js";

const AT = new Date("2026-10-07T00:00:00Z");

describe("copying regions", () => {
  it("pastes what was copied, in the same arrangement, under new ids", () => {
    const regions: Region[] = [
      { kind: "math", id: "r_01", position: { x: 48, y: 40 }, source: "F := 10 kip", style: { color: "#b3261e" }, format: { decimals: 2 }, origin: humanAuthorship(AT) },
      { kind: "text", id: "r_02", position: { x: 120, y: 80 }, size: { width: 300 }, runs: [{ text: "Load " }, { text: "{F}", ref: "F" }], style: { bold: false }, origin: humanAuthorship(AT) },
    ];
    const sheet = { ...emptySheet(), regions };

    const copied = readCopied(copyRegions(regions).json);
    expect(copied).not.toBeNull();
    const { operations, ids } = pasteOperations(copied!, { x: 200, y: 400 }, regions.map((r) => r.id));
    const after = applyPatch(sheet, operations, { client: "test", author: "human", now: () => AT }).sheet;

    expect(ids).toEqual(["r_03", "r_04"]);
    const [a, b] = ids.map((id) => after.regions.find((r) => r.id === id)!);
    // Same content and look, moved together: the gap between them is kept.
    expect(a).toMatchObject({ kind: "math", source: "F := 10 kip", style: { color: "#b3261e" }, format: { decimals: 2 }, position: { x: 200, y: 400 } });
    expect(b).toMatchObject({ kind: "text", size: { width: 300 }, style: { bold: false }, position: { x: 272, y: 440 } });
    expect(b?.kind === "text" && b.runs).toEqual(regions[1]?.kind === "text" && regions[1].runs);
    // Anything that is not a copy of regions is not pasted as one.
    expect(readCopied("F := 10 kip")).toBeNull();
  });
});
