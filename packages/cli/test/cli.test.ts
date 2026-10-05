import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main } from "../src/main.js";
import { emptySheet, humanAuthorship, serializeSheet, type Region, type Sheet } from "@jamcalc/engine";

const AT = new Date("2026-09-05T00:00:00Z");
const math = (id: string, y: number, source: string): Region => ({
  kind: "math",
  id,
  position: { x: 48, y },
  source,
  origin: humanAuthorship(AT),
});

function beamSheet(): Sheet {
  return {
    ...emptySheet("Beam"),
    regions: [
      math("r_01", 0, "w := 2.4 klf"),
      math("r_02", 40, "L := 25 ft"),
      math("r_03", 80, "M := w*L^2/8 = kip*ft"),
    ],
  };
}

let dir: string;
let file: string;
let out: string[];
let err: string[];

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "calc-cli-"));
  file = join(dir, "sheet.jc");
  await writeFile(file, serializeSheet(beamSheet()), "utf8");
  out = [];
  err = [];
  vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    out.push(String(chunk));
    return true;
  });
  vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
    err.push(String(chunk));
    return true;
  });
});

afterEach(async () => {
  vi.restoreAllMocks();
  await rm(dir, { recursive: true, force: true });
});

const stdout = (): string => out.join("");
const stderr = (): string => err.join("");

describe("reading", () => {
  it("prints the sheet as text", async () => {
    expect(await main(["show", file])).toBe(0);
    expect(stdout()).toContain("[r_03] M := w*L^2/8 = kip*ft");
    expect(stdout()).toContain("187.5 kip*ft");
  });

  it("lists symbols with their values", async () => {
    expect(await main(["symbols", file])).toBe(0);
    expect(stdout()).toMatch(/M\s+187\.5 kip\*ft\s+r_03/);
  });

  it("traces what feeds a region", async () => {
    expect(await main(["trace", file, "r_03"])).toBe(0);
    expect(stdout()).toContain("r_01");
    expect(stdout()).toContain("r_02");
    expect(stdout()).not.toContain("r_03 ");
  });

  it("exits non-zero when the sheet has an error", async () => {
    await writeFile(
      file,
      serializeSheet({
        ...emptySheet("Broken"),
        regions: [math("r_01", 0, "L := 1 ft + 1 kip")],
      }),
      "utf8",
    );
    // The non-zero exit is the whole point of running this in CI.
    expect(await main(["regions", file])).toBe(1);
  });
});

describe("evaluating", () => {
  it("applies overrides without saving them", async () => {
    expect(await main(["eval", file, "--set", "L=40 ft"])).toBe(0);
    expect(stdout()).toContain("480 kip*ft");
    // The file must be untouched: `eval` is the dry run.
    expect(await readFile(file, "utf8")).toContain("L := 25 ft");
  });

  it("rejects a malformed --set", async () => {
    expect(await main(["eval", file, "--set", "L"])).toBe(2);
    expect(stderr()).toContain("name=value");
  });

  it("reports an unknown name as structured JSON", async () => {
    expect(await main(["eval", file, "--set", "nope=1"])).toBe(1);
    // A script has no span to look at, so the error must be machine-readable.
    expect(JSON.parse(stderr().trim())).toMatchObject({ code: "unknown_name" });
  });
});

describe("overrides reach every command that reads", () => {
  // Until 30 Sep only `eval` honoured --set. The rest ignored it without a
  // word and reported the saved inputs: L = 25 ft gives 187.5, L = 40 ft 480.
  const unchanged = async (): Promise<void> => {
    expect(await readFile(file, "utf8")).toContain("L := 25 ft");
  };

  it("symbols", async () => {
    expect(await main(["symbols", file, "--set", "L=40 ft"])).toBe(0);
    expect(stdout()).toContain("480");
    expect(stdout()).not.toContain("187.5");
    await unchanged();
  });

  it("regions", async () => {
    expect(await main(["regions", file, "--set", "L=40 ft"])).toBe(0);
    expect(stdout()).toContain("480 kip*ft");
    await unchanged();
  });

  it("show", async () => {
    expect(await main(["show", file, "--set", "L=40 ft"])).toBe(0);
    expect(stdout()).toContain("L := 40 ft");
    await unchanged();
  });

  it("trace", async () => {
    expect(await main(["trace", file, "r_03", "--set", "L=40 ft"])).toBe(0);
    expect(stdout()).toContain("L := 40 ft");
    await unchanged();
  });

  it("export, in every format", async () => {
    for (const format of ["csv", "json", "text"]) {
      out = [];
      expect(await main(["export", file, "--as", format, "--set", "L=40 ft"])).toBe(0);
      expect(stdout(), format).toMatch(/480|40 ft/);
      expect(stdout(), format).not.toContain("187.5");
    }
    await unchanged();
  });

  it("an unknown name is an error everywhere, not only in eval", async () => {
    expect(await main(["symbols", file, "--set", "nope=1"])).toBe(1);
    expect(JSON.parse(stderr().trim())).toMatchObject({ code: "unknown_name" });
  });

  it("patch refuses --set rather than guessing which change wins", async () => {
    const ops = join(dir, "ops.json");
    await writeFile(ops, "[]", "utf8");
    expect(await main(["patch", file, ops, "--set", "L=40 ft"])).toBe(2);
    expect(stderr()).toContain("patch does not take --set");
    await unchanged();
  });
});

describe("writing", () => {
  it("sets an input and saves", async () => {
    expect(await main(["set", file, "--set", "L=30 ft"])).toBe(0);
    const saved = await readFile(file, "utf8");
    expect(saved).toContain("L := 30 ft");
    expect(saved).toContain('"client": "cli"');
  });

  it("leaves the file alone on --dry-run", async () => {
    expect(await main(["set", file, "--set", "L=30 ft", "--dry-run"])).toBe(0);
    expect(stdout()).toContain("L := 30 ft");
    expect(await readFile(file, "utf8")).toContain("L := 25 ft");
  });

  it("applies a patch file atomically", async () => {
    const ops = join(dir, "ops.json");
    await writeFile(
      ops,
      JSON.stringify([
        { op: "update", id: "r_02", source: "L := 30 ft" },
        { op: "insert", kind: "math", after: "r_03", source: "note := 1" },
      ]),
      "utf8",
    );
    expect(await main(["patch", file, ops, "--client", "robot"])).toBe(0);
    const saved = await readFile(file, "utf8");
    expect(saved).toContain("L := 30 ft");
    expect(saved).toContain("note := 1");
    expect(saved).toContain('"client": "robot"');
    expect(saved).toContain('"author": "api"');
  });

  it("writes nothing when one operation in a patch fails", async () => {
    const ops = join(dir, "ops.json");
    await writeFile(
      ops,
      JSON.stringify([
        { op: "update", id: "r_02", source: "L := 30 ft" },
        { op: "delete", id: "r_99" },
      ]),
      "utf8",
    );
    expect(await main(["patch", file, ops])).toBe(1);
    expect(JSON.parse(stderr().trim())).toMatchObject({
      code: "unknown_region",
      operation: 1,
    });
    expect(await readFile(file, "utf8")).toContain("L := 25 ft");
  });
});

describe("export", () => {
  it("writes CSV to a file", async () => {
    const target = join(dir, "out.csv");
    expect(await main(["export", file, "--as", "csv", "-o", target])).toBe(0);
    const csv = await readFile(target, "utf8");
    expect(csv.split("\n")[0]).toBe("id,defines,source,value,unit,status");
    expect(csv).toContain("kip*ft");
  });

  it("gives a pure number its value, not an empty column", async () => {
    // Found 30 Sep: a ratio, a DCR or a pass/fail flag has no unit, and its
    // value was left out — so the column people export for was blank.
    const ratio: Sheet = {
      ...beamSheet(),
      regions: [...beamSheet().regions, math("r_04", 120, "DCR := M/(200 kip*ft) =")],
    };
    await writeFile(file, serializeSheet(ratio), "utf8");
    expect(await main(["export", file, "--as", "csv"])).toBe(0);
    const row = stdout().split(String.fromCharCode(10)).find((l) => l.startsWith("r_04,")) ?? "";
    expect(Number(row.split(",")[3])).toBeCloseTo(0.9375, 10);
    expect(row.split(",")[4]).toBe("");
  });

  it("rejects an unknown format", async () => {
    expect(await main(["export", file, "--as", "pdf"])).toBe(2);
  });
});

describe("versions", () => {
  it("prints its own", async () => {
    expect(await main(["--version"])).toBe(0);
    expect(stdout().trim()).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("records the version in every sheet it saves", async () => {
    expect(await main(["set", file, "--set", "L=30 ft"])).toBe(0);
    const saved = JSON.parse(await readFile(file, "utf8")) as { savedWith?: string };
    expect(saved.savedWith).toMatch(/^\d+\.\d+\.\d+/);
  });
});

describe("usage", () => {
  it("prints help with no arguments", async () => {
    expect(await main([])).toBe(0);
    expect(stdout()).toContain("calc — read and edit calculation sheets");
  });

  it("rejects an unknown command", async () => {
    expect(await main(["frobnicate", file])).toBe(2);
  });

  it("reports a missing file without a stack trace", async () => {
    expect(await main(["show", join(dir, "nope.jc")])).toBe(1);
    expect(stderr()).toContain("calc:");
  });
});
