import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  MIGRATIONS,
  SheetVersionError,
  migrateRaw,
  type Migration,
} from "../src/document/migrate.js";
import { SCHEMA_VERSION, SheetFormatError } from "../src/document/schema.js";
import { parseSheet, serializeSheet } from "../src/document/sheet.js";

const FIXTURES = join(fileURLToPath(new URL(".", import.meta.url)), "fixtures");

/**
 * A synthetic chain. The real one is empty until the format moves, and a
 * harness tested only against an empty chain is a harness nobody has tested.
 */
const rename = (from: number, to: number, was: string, now: string): Migration => ({
  from,
  to,
  describe: `${was} became ${now}`,
  apply: (raw) => {
    const { [was]: value, ...rest } = raw;
    return { ...rest, [now]: value };
  },
});

describe("migrating raw sheets", () => {
  it("leaves a current sheet alone", () => {
    const raw = { schemaVersion: 1, title: "T" };
    expect(migrateRaw(raw, [], 1)).toEqual(raw);
  });

  it("runs one step", () => {
    const out = migrateRaw({ schemaVersion: 1, margin: 48 }, [rename(1, 2, "margin", "margins")], 2);
    expect(out).toEqual({ schemaVersion: 2, margins: 48 });
  });

  it("runs a chain of steps in order", () => {
    const out = migrateRaw(
      { schemaVersion: 1, a: "x" },
      [rename(1, 2, "a", "b"), rename(2, 3, "b", "c")],
      3,
    );
    expect(out).toEqual({ schemaVersion: 3, c: "x" });
  });

  it("follows a migration that skips a version", () => {
    // A single step may cover 1→3; the chain is followed, not counted.
    const out = migrateRaw({ schemaVersion: 1, a: "x" }, [rename(1, 3, "a", "c")], 3);
    expect(out).toEqual({ schemaVersion: 3, c: "x" });
  });

  it("refuses a sheet from a newer build, and says so distinctly", () => {
    // Not a corrupt file: the file is fine and the app is old. The shell has
    // to be able to tell those apart to say anything useful.
    const err = (() => {
      try {
        migrateRaw({ schemaVersion: 9 }, [], 1);
      } catch (e) {
        return e;
      }
      return null;
    })();
    expect(err).toBeInstanceOf(SheetVersionError);
    expect(err).toBeInstanceOf(SheetFormatError);
    expect((err as SheetVersionError).found).toBe(9);
    expect((err as Error).message).toMatch(/newer version/);
  });

  it("names the gap when the chain is incomplete", () => {
    expect(() => migrateRaw({ schemaVersion: 1 }, [], 3)).toThrow(/no migration from format 1/);
  });

  it("reports which migration failed rather than a bare stack", () => {
    const boom: Migration = {
      from: 1,
      to: 2,
      describe: "regions regrouped",
      apply: () => {
        throw new Error("region r_03 has no position");
      },
    };
    expect(() => migrateRaw({ schemaVersion: 1 }, [boom], 2)).toThrow(
      /migrating format 1 to 2 \(regions regrouped\) failed: region r_03 has no position/,
    );
  });

  it("rejects a chain that does not move forward instead of looping", () => {
    const stuck: Migration = { from: 1, to: 1, describe: "nothing", apply: (r) => r };
    expect(() => migrateRaw({ schemaVersion: 1 }, [stuck], 2)).toThrow(/does not move forward/);
  });

  it("rejects a missing or nonsense version", () => {
    expect(() => migrateRaw({}, [], 1)).toThrow(/missing or invalid schemaVersion/);
    expect(() => migrateRaw({ schemaVersion: "1" }, [], 1)).toThrow(/schemaVersion/);
    expect(() => migrateRaw({ schemaVersion: 1.5 }, [], 1)).toThrow(/schemaVersion/);
  });

  it("does not mutate what it was given", () => {
    const raw = { schemaVersion: 1, a: "x" };
    migrateRaw(raw, [rename(1, 2, "a", "b")], 2);
    expect(raw).toEqual({ schemaVersion: 1, a: "x" });
  });

  it("declares a chain that actually reaches the current version", () => {
    // Guards the real table: every released version must have a path forward.
    for (let v = 1; v < SCHEMA_VERSION; v += 1) {
      expect(
        MIGRATIONS.some((m) => m.from === v),
        `no migration reads format ${v}`,
      ).toBe(true);
    }
  });
});

/**
 * Every fixture is a file some earlier build wrote. They are kept forever and
 * this test is the promise that they still open.
 */
describe("released-format fixtures", () => {
  const files = readdirSync(FIXTURES).filter((f) => f.endsWith(".jc"));

  it("has at least one", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  for (const file of files) {
    it(`opens ${file}`, () => {
      const sheet = parseSheet(readFileSync(join(FIXTURES, file), "utf8"));
      expect(sheet.schemaVersion).toBe(SCHEMA_VERSION);
      expect(sheet.regions.length).toBeGreaterThan(0);
      // And saves as the current format, so opening an old sheet upgrades it.
      expect(parseSheet(serializeSheet(sheet)).regions).toEqual(sheet.regions);
    });
  }
});
