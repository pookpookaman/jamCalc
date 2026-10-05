/**
 * Schema migration.
 *
 * Version the schema from the first commit, and write the
 * migration harness before you need it. This is that harness, written while
 * there is still exactly one version and nothing to migrate — which is the
 * only time it can be written calmly.
 *
 * The deadline it exists for is the first installer. Until then every
 * `.jc` in the world is in this repo and a format change costs a
 * find-and-replace. Afterwards, files sit on other people's disks, and a
 * reader that rejects what it does not recognise destroys work rather than
 * carrying it forward.
 *
 * A migration takes the *raw parsed JSON*, not a `Sheet`. It has to: the whole
 * point is to read a shape the current `Sheet` type can no longer describe.
 */

import { PAGE_SIZES, SCHEMA_VERSION, SheetFormatError } from "./schema.js";
import { bandFromSlots } from "./bands.js";

export interface Migration {
  /** The version this reads. */
  readonly from: number;
  /** The version it produces. Must be greater than `from`. */
  readonly to: number;
  /** What changed, for the error message when a later step is missing. */
  readonly describe: string;
  readonly apply: (raw: Record<string, unknown>) => Record<string, unknown>;
}

/** A format-1 page's paper and margins, read the way format 1 read them. */
function v1Paper(page: Record<string, unknown>): {
  paper: { width: number };
  margins: { top: number; right: number; bottom: number; left: number };
} {
  const base = PAGE_SIZES[page["size"] === "a4" ? "a4" : "letter"];
  const width = page["orientation"] === "landscape" ? base.height : base.width;
  const defaults = { top: 64, right: 48, bottom: 56, left: 48 };
  const margins =
    typeof page["margins"] === "object" && page["margins"] !== null
      ? { ...defaults, ...(page["margins"] as Partial<typeof defaults>) }
      : defaults;
  return { paper: { width }, margins };
}

/**
 * The chain, in order.
 *
 * Each step lands in the same commit as the `SCHEMA_VERSION` it reaches, with
 * a fixture of the outgoing version in `test/fixtures/`. The fixtures are kept
 * forever: they are the only evidence that a build can still open what an
 * earlier build wrote.
 */
export const MIGRATIONS: readonly Migration[] = [
  {
    from: 1,
    to: 2,
    describe: "headers and footers become placed items (docs/headers.md)",
    apply: (raw) => {
      const page = raw["page"];
      if (typeof page !== "object" || page === null) return raw;
      const p = { ...(page as Record<string, unknown>) };
      const { paper, margins } = v1Paper(p);
      for (const where of ["header", "footer"] as const) {
        const band = p[where];
        if (typeof band !== "object" || band === null) continue;
        // Already items: nothing to carry.
        if (Array.isArray((band as Record<string, unknown>)["items"])) continue;
        p[where] = bandFromSlots(band as Record<string, never>, where, paper, margins);
      }
      return { ...raw, page: p };
    },
  },
];

/**
 * A sheet written by a newer build than this one.
 *
 * Its own type because it is not the same conversation as a corrupt file: the
 * file is fine, the application is old, and the only useful thing to tell
 * someone is to update. Extends `SheetFormatError`, so existing handlers keep
 * catching it.
 */
export class SheetVersionError extends SheetFormatError {
  constructor(
    readonly found: number,
    readonly supported: number,
    /** The version that saved it, when the file says (ADR-0016). */
    readonly savedWith?: string,
  ) {
    super(
      savedWith
        ? `this sheet was saved by jamCalc ${savedWith}, which is newer than this one — update to ${savedWith} or later to open it (format ${found}; this build reads ${supported})`
        : `this sheet was saved by a newer version of the app (format ${found}; this build reads ${supported})`,
    );
    this.name = "SheetVersionError";
  }
}

/** Guards against a malformed chain looping forever. */
const MAX_STEPS = 100;

/**
 * Bring raw parsed JSON up to `target`, or explain why it cannot be.
 *
 * `migrations` is a parameter rather than a module reference so the harness
 * can be tested against a synthetic chain. Testing it only against the real
 * chain would test nothing at all while that chain is empty, which is exactly
 * how a migration harness comes to be broken on the day it is first needed.
 */
export function migrateRaw(
  raw: Record<string, unknown>,
  migrations: readonly Migration[] = MIGRATIONS,
  target: number = SCHEMA_VERSION,
): Record<string, unknown> {
  const found = raw["schemaVersion"];
  if (typeof found !== "number" || !Number.isInteger(found) || found < 1) {
    throw new SheetFormatError(
      `missing or invalid schemaVersion (found ${JSON.stringify(found)})`,
    );
  }
  if (found > target) {
    const savedWith = raw["savedWith"];
    throw new SheetVersionError(found, target, typeof savedWith === "string" ? savedWith.slice(0, 40) : undefined);
  }

  let current = raw;
  let version = found;
  for (let step = 0; version < target; step += 1) {
    if (step > MAX_STEPS) {
      throw new SheetFormatError(`migration chain did not terminate at ${version}`);
    }
    const next = migrations.find((m) => m.from === version);
    if (!next) {
      throw new SheetFormatError(
        `no migration from format ${version} to ${version + 1}`,
      );
    }
    if (next.to <= version) {
      throw new SheetFormatError(
        `migration ${next.from}→${next.to} does not move forward`,
      );
    }
    try {
      current = next.apply(current);
    } catch (e) {
      // A migration that throws must say which one, or the report is a stack
      // trace into code the person reading it has never seen.
      throw new SheetFormatError(
        `migrating format ${next.from} to ${next.to} (${next.describe}) failed: ${
          (e as Error).message
        }`,
      );
    }
    version = next.to;
  }

  return { ...current, schemaVersion: target };
}
