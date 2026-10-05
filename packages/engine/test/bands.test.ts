/**
 * Headers and footers as placed items (docs/headers.md): the fields they
 * show, the sheet-number offset, reading them safely, and carrying format-1
 * sheets forward so they print as they did.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  bandFromSlots,
  fieldValue,
  fillBandText,
  readBand,
  type BandItem,
  type PageFields,
} from "../src/document/bands.js";
import { contentBox } from "../src/document/layout.js";
import {
  contentMargins,
  emptySheet,
  parseSheet,
  serializeSheet,
  type PageSetup,
} from "../src/document/sheet.js";

const FIXTURES = join(fileURLToPath(new URL(".", import.meta.url)), "fixtures");

const fields: PageFields = {
  title: "Beam Check",
  titleBlock: { project: "Riverside Bridge", by: "JD", rev: "B", checkedBy: "RS", date: "30 Sep 2026" },
  page: 2,
  pages: 7,
  printed: new Date("2026-10-04T12:00:00Z"),
};

describe("fields", () => {
  it("fill from the title block and the page", () => {
    expect(fillBandText("Sheet {sheet} of {sheets}", fields)).toBe("Sheet 2 of 7");
    expect(fillBandText("{project} — {title}", fields)).toBe("Riverside Bridge — Beam Check");
    expect(fillBandText("By {by}  Chk {checkedBy}  Rev {rev}", fields)).toBe("By JD  Chk RS  Rev B");
  });

  it("keep the stated date apart from the day of printing", () => {
    expect(fieldValue("date", fields)).toBe("30 Sep 2026");
    expect(fieldValue("printed", fields)).toBe(fields.printed.toLocaleDateString());
  });

  it("print an unknown name as written rather than blanking it", () => {
    expect(fillBandText("{oops}", fields)).toBe("{oops}");
  });

  it("are empty when the sheet has no value", () => {
    expect(fillBandText("[{job}]", fields)).toBe("[]");
  });
});

describe("sheet numbering", () => {
  it("counts from 1 by default", () => {
    expect([fieldValue("sheet", fields), fieldValue("sheets", fields)]).toEqual(["2", "7"]);
  });

  it("starts where this calc sits in a package", () => {
    const f = { ...fields, firstSheet: 12, totalSheets: 40 };
    expect(fillBandText("Sheet {sheet} of {sheets}", f)).toBe("Sheet 13 of 40");
    // The file's own pages are still there for anyone who wants them.
    expect(fillBandText("{page}/{pages}", f)).toBe("2/7");
  });

  it("totals this file's own sheets when no package total is given", () => {
    expect(fieldValue("sheets", { ...fields, firstSheet: 12 })).toBe("18");
  });
});

describe("reading a band", () => {
  const item = (extra: Record<string, unknown>) => ({ id: "i_01", x: 0, y: 0, width: 10, height: 10, ...extra });

  it("keeps what it recognises", () => {
    const band = readBand({
      height: 90,
      items: [
        item({ kind: "field", field: "project", caption: true }),
        { ...item({ kind: "text", text: "Sheet {sheet}" }), id: "i_02" },
        { ...item({ kind: "line", vertical: true }), id: "i_03" },
        { ...item({ kind: "box" }), id: "i_04" },
      ],
    });
    expect(band.height).toBe(90);
    expect(band.items.map((i) => i.kind)).toEqual(["field", "text", "line", "box"]);
  });

  it("drops what it cannot trust instead of failing the sheet", () => {
    const band = readBand({
      items: [
        item({ kind: "field", field: "nope" }),
        { ...item({ kind: "wobble" }), id: "i_02" },
        // A logo must be embedded: a sheet must never fetch from anywhere.
        { ...item({ kind: "image", src: "https://example.com/logo.png" }), id: "i_03" },
        { ...item({ kind: "image", src: "data:text/html;base64,AAAA" }), id: "i_04" },
        { ...item({ kind: "image", src: "data:image/png;base64,iVBORw0KGgo=" }), id: "i_05" },
        // A second item with an id already used.
        { ...item({ kind: "box" }), id: "i_05" },
        "not an item",
      ],
    });
    expect(band.items.map((i) => `${i.id}:${i.kind}`)).toEqual(["i_05:image"]);
  });

  it("keeps only styles that make sense", () => {
    const [kept] = readBand({
      items: [item({ kind: "text", text: "x", style: { color: "url(evil)", fontSize: 9000, bold: true, align: "middle" } })],
    }).items as BandItem[];
    expect(kept?.style).toEqual({ bold: true });
  });

  it("refuses something that is not a band at all", () => {
    expect(() => readBand("header")).toThrow();
    expect(() => readBand({ items: "x" })).toThrow();
  });
});

describe("where the contents go", () => {
  const page = (header?: PageSetup["header"]): PageSetup => ({
    ...emptySheet().page,
    ...(header ? { header } : {}),
  });

  it("uses the margins while the header fits inside them", () => {
    expect(contentMargins(page({ height: 40, items: [item()] })).top).toBe(64);
  });

  it("pushes the contents down for a header taller than its margin", () => {
    const tall = page({ height: 120, items: [item()] });
    expect(contentMargins(tall).top).toBe(120);
    expect(contentBox(tall).height).toBe(contentBox(page()).height - (120 - 64));
  });

  it("takes no room for an empty or hidden header", () => {
    expect(contentMargins(page({ height: 200, items: [] })).top).toBe(64);
    expect(contentMargins(page({ height: 200, enabled: false, items: [item()] })).top).toBe(64);
  });

  function item(): BandItem {
    return { id: "i_01", kind: "box", x: 0, y: 0, width: 10, height: 10 };
  }
});

describe("a new sheet", () => {
  it("has an empty header and footer", () => {
    const sheet = emptySheet();
    expect(sheet.page.header).toBeUndefined();
    expect(sheet.page.footer).toBeUndefined();
  });

  it("round-trips a laid-out band exactly", () => {
    const sheet = {
      ...emptySheet("T"),
      titleBlock: { project: "P", checkedBy: "RS" },
      page: {
        ...emptySheet().page,
        firstSheet: 3,
        header: {
          height: 80,
          items: [
            { id: "i_01", kind: "field" as const, field: "project" as const, caption: true, x: 48, y: 10, width: 200, height: 30, style: { bold: true } },
          ],
        },
      },
    };
    const text = serializeSheet(sheet);
    expect(serializeSheet(parseSheet(text))).toBe(text);
    expect(parseSheet(text).page.firstSheet).toBe(3);
  });
});

describe("carrying a format-1 sheet forward", () => {
  const v1 = parseSheet(readFileSync(join(FIXTURES, "format-v1-beam.jc"), "utf8"));

  it("puts the three slots where they were, as text", () => {
    const texts = v1.page.header?.items.filter((i) => i.kind === "text") ?? [];
    expect(texts.map((t) => [t.kind === "text" && t.text, t.x, t.y, t.width, t.style?.align])).toEqual([
      ["{project}", 48, 24, 240, "left"],
      ["{title}", 288, 24, 240, "center"],
      ["Sheet {page} of {pages}", 528, 24, 240, "right"],
    ]);
  });

  it("draws the rule where it was", () => {
    const line = v1.page.header?.items.find((i) => i.kind === "line");
    expect(line && [line.x, line.y, line.width]).toEqual([48, 41, 720]);
  });

  it("keeps the day of printing as the day of printing", () => {
    const texts = (v1.page.footer?.items ?? []).flatMap((i) => (i.kind === "text" ? [i.text] : []));
    expect(texts.join(" ")).toContain("{printed}");
    expect(texts.join(" ")).not.toContain("{date}");
  });

  it("does not move the contents", () => {
    expect(contentMargins(v1.page)).toEqual(v1.page.margins);
  });

  it("drops an empty band's rule along with it", () => {
    const band = bandFromSlots({ left: "", center: "", right: "" }, "header", { width: 816 }, { top: 64, right: 48, bottom: 56, left: 48 });
    expect(band.items).toEqual([]);
  });

  it("keeps a hidden band's contents, still hidden", () => {
    const band = bandFromSlots({ left: "x", enabled: false }, "footer", { width: 816 }, { top: 64, right: 48, bottom: 56, left: 48 });
    expect(band.enabled).toBe(false);
    expect(band.items.length).toBeGreaterThan(0);
  });
});
