/**
 * The code whose failure mode is losing someone's work.
 *
 * Saving, crash recovery and the recent list were verified until now only by
 * running the app by hand — which proves they worked once, on one machine, and
 * says nothing about tomorrow. These are the paths where a silent regression
 * costs a user their afternoon rather than a misplaced pixel.
 */

import { mkdtemp, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promises as nodeFs } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearSheetRecovery,
  isRecoveryId,
  listRecovered,
  listTemplates,
  MAX_TEMPLATE,
  removeTemplate,
  templateFileName,
  writeTemplate,
  pruneRecent,
  readRecent,
  readText,
  rememberRecent,
  writeAtomically,
  writeSheetRecovery,
} from "../src/files.js";

let dir = "";

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "jamcalc-files-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const file = (name: string): string => join(dir, name);

describe("writing a document", () => {
  it("writes what it was given", async () => {
    await writeAtomically(file("a.jc"), "hello");
    expect(await readText(file("a.jc"))).toBe("hello");
  });

  it("replaces an existing file completely", async () => {
    await writeAtomically(file("a.jc"), "a long first version");
    await writeAtomically(file("a.jc"), "short");
    // Not "short" with the tail of the old file still after it, which is what
    // writing in place would leave.
    expect(await readText(file("a.jc"))).toBe("short");
  });

  it("leaves no temporary file behind", async () => {
    await writeAtomically(file("a.jc"), "x");
    const left = (await readdir(dir)).filter((f) => f.includes(".tmp"));
    expect(left).toEqual([]);
  });

  it("writes bytes without re-encoding them", async () => {
    // A PDF goes through this path. UTF-8 encoding it would corrupt it.
    const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x00, 0xff, 0xfe]);
    await writeAtomically(file("a.pdf"), bytes);
    expect(new Uint8Array(await readFile(file("a.pdf")))).toEqual(bytes);
  });

  it("does not destroy the old file when the write cannot be made", async () => {
    // The whole point of writing elsewhere and renaming: a failure leaves the
    // previous version intact rather than a truncated one.
    await writeAtomically(file("a.jc"), "the good version");
    await mkdir(file("blocked.jc"));
    await expect(writeAtomically(file("blocked.jc"), "x")).rejects.toThrow();
    expect(await readText(file("a.jc"))).toBe("the good version");
  });

  it("creates a file that is complete the moment it appears", async () => {
    // The rename is what makes this true; a reader can never observe a
    // half-written document.
    const big = "x".repeat(200_000);
    await writeAtomically(file("big.jc"), big);
    expect((await stat(file("big.jc"))).size).toBe(big.length);
  });
});

describe("replacing a file Windows is holding open", () => {
  // Seen as an intermittent failure of "keeps the list short": a rename onto a
  // file something (a virus scanner) has just opened fails with EPERM.
  const busy = (): NodeJS.ErrnoException => Object.assign(new Error("EPERM: operation not permitted"), { code: "EPERM" });

  it.runIf(process.platform === "win32")("tries again, and the write lands", async () => {
    const real = nodeFs.rename.bind(nodeFs);
    let refusals = 2;
    const spy = vi.spyOn(nodeFs, "rename").mockImplementation(async (from, to) => {
      if (refusals-- > 0) throw busy();
      return real(from, to);
    });
    try {
      await writeAtomically(file("doc.jc"), "new");
    } finally {
      spy.mockRestore();
    }
    expect(await readText(file("doc.jc"))).toBe("new");
    expect(await readdir(dir)).toEqual(["doc.jc"]);
  });

  it.runIf(process.platform === "win32")("gives up in the end, leaving the old file and no temp", async () => {
    await writeFile(file("doc.jc"), "old");
    const spy = vi.spyOn(nodeFs, "rename").mockRejectedValue(busy());
    try {
      await expect(writeAtomically(file("doc.jc"), "new")).rejects.toThrow(/EPERM/);
    } finally {
      spy.mockRestore();
    }
    expect(await readText(file("doc.jc"))).toBe("old");
    expect(await readdir(dir)).toEqual(["doc.jc"]);
  });
});

describe("recent documents", () => {
  it("starts empty", async () => {
    expect(await readRecent(dir)).toEqual([]);
  });

  it("puts the newest first", async () => {
    await rememberRecent(dir, "a.jc");
    await rememberRecent(dir, "b.jc");
    expect(await readRecent(dir)).toEqual(["b.jc", "a.jc"]);
  });

  it("moves a file already listed rather than duplicating it", async () => {
    await rememberRecent(dir, "a.jc");
    await rememberRecent(dir, "b.jc");
    await rememberRecent(dir, "a.jc");
    expect(await readRecent(dir)).toEqual(["a.jc", "b.jc"]);
  });

  it("keeps the list short", async () => {
    for (let i = 0; i < 12; i += 1) await rememberRecent(dir, `f${i}.jc`);
    const list = await readRecent(dir);
    expect(list).toHaveLength(8);
    expect(list[0]).toBe("f11.jc");
  });

  it("drops entries whose file has gone", async () => {
    // A Recent entry that fails when clicked is worse than a short list.
    await writeAtomically(file("here.jc"), "{}");
    await rememberRecent(dir, file("here.jc"));
    await rememberRecent(dir, file("gone.jc"));
    expect(await pruneRecent(dir)).toEqual([file("here.jc")]);
    expect(await readRecent(dir)).toEqual([file("here.jc")]);
  });

  it("leaves the list alone when every file is still there", async () => {
    await writeAtomically(file("here.jc"), "{}");
    await rememberRecent(dir, file("here.jc"));
    expect(await pruneRecent(dir)).toEqual([file("here.jc")]);
  });

  it("treats a corrupt list as an empty one", async () => {
    // Never a reason to fail to start.
    await writeFile(join(dir, "recent.json"), "not json at all", "utf8");
    expect(await readRecent(dir)).toEqual([]);
    await expect(rememberRecent(dir, "a.jc")).resolves.toEqual(["a.jc"]);
  });

  it("ignores entries that are not paths", async () => {
    await writeFile(join(dir, "recent.json"), '["a.jc", 42, null]', "utf8");
    expect(await readRecent(dir)).toEqual(["a.jc"]);
  });
});

describe("a copy per open sheet", () => {
  it("keeps each sheet's copy separately, with its title and file", async () => {
    await writeSheetRecovery(dir, "d1", "one", { title: "Beam" });
    await writeSheetRecovery(dir, "d2", "two", { title: "Column", path: "C:/work/col.jc" });
    const found = await listRecovered(dir);
    expect(found.map((f) => [f.id, f.title, f.text, f.path])).toEqual(
      expect.arrayContaining([
        ["d1", "Beam", "one", undefined],
        ["d2", "Column", "two", "C:/work/col.jc"],
      ]),
    );
    expect(found).toHaveLength(2);
  });

  it("lists the newest first", async () => {
    await writeSheetRecovery(dir, "old", "a", { title: "Old" });
    await new Promise((r) => setTimeout(r, 5));
    await writeSheetRecovery(dir, "new", "b", { title: "New" });
    expect((await listRecovered(dir)).map((f) => f.id)).toEqual(["new", "old"]);
  });

  it("forgets one sheet's copy and leaves the others", async () => {
    await writeSheetRecovery(dir, "d1", "one", { title: "A" });
    await writeSheetRecovery(dir, "d2", "two", { title: "B" });
    await clearSheetRecovery(dir, "d1");
    expect((await listRecovered(dir)).map((f) => f.id)).toEqual(["d2"]);
    expect(await readdir(join(dir, "recovery"))).toEqual(["d2.jc", "d2.json"]);
  });

  it("still offers a copy whose note is corrupt", async () => {
    await writeSheetRecovery(dir, "d1", "the work", { title: "A" });
    await writeFile(join(dir, "recovery", "d1.json"), "{not json");
    const [found] = await listRecovered(dir);
    expect(found?.text).toBe("the work");
    expect(found?.title).toBe("");
  });

  it("has nothing to offer when there is no folder", async () => {
    expect(await listRecovered(dir)).toEqual([]);
  });

  it("refuses an id that could leave the folder", async () => {
    for (const id of ["../x", "a/b", "a\b", "", "x".repeat(65)]) {
      await expect(writeSheetRecovery(dir, id, "t", {})).rejects.toThrow();
    }
    expect(isRecoveryId("d1abc_2-x")).toBe(true);
    expect(isRecoveryId(42)).toBe(false);
    // Clearing a bad id is quietly nothing, never a delete somewhere else.
    await writeFile(file("keep.jc"), "keep");
    await clearSheetRecovery(dir, "../keep");
    expect(await readText(file("keep.jc"))).toBe("keep");
  });
});

describe("header and footer templates", () => {
  it("keeps one file per template, and lists them", async () => {
    await writeTemplate(dir, "Office A", "one");
    await writeTemplate(dir, "Office B", "two");
    expect(await listTemplates(dir)).toEqual(["one", "two"]);
    expect(await readdir(join(dir, "templates"))).toEqual(["Office A.jctemplate", "Office B.jctemplate"]);
  });

  it("replaces a template saved again under the same name", async () => {
    await writeTemplate(dir, "Office", "old");
    await writeTemplate(dir, "Office", "new");
    expect(await listTemplates(dir)).toEqual(["new"]);
  });

  it("removes one and leaves the rest", async () => {
    await writeTemplate(dir, "A", "a");
    await writeTemplate(dir, "B", "b");
    await removeTemplate(dir, "A");
    expect(await listTemplates(dir)).toEqual(["b"]);
  });

  it("has nothing to list when there is no folder", async () => {
    expect(await listTemplates(dir)).toEqual([]);
  });

  it("never lets a name leave the folder or name a device", () => {
    expect(templateFileName("../../evil")).toBe("_evil.jctemplate");
    expect(templateFileName(String.raw`a/b\c`)).toBe("a_b_c.jctemplate");
    expect(templateFileName("..")).toBeNull();
    expect(templateFileName("   ")).toBeNull();
    expect(templateFileName("CON")).toBeNull();
  });

  it("refuses something too large to be a template", async () => {
    await expect(writeTemplate(dir, "Big", "x".repeat(MAX_TEMPLATE + 1))).rejects.toThrow();
  });
});
