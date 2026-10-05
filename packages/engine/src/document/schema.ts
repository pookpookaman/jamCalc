/**
 * The format's version and its error type.
 *
 * Their own module because `sheet.ts` and `migrate.ts` both need them and each
 * needs the other: the reader migrates before parsing, and a migration is
 * defined in terms of the version it targets. Left in `sheet.ts`, that cycle
 * put `SheetFormatError` in the temporal dead zone while `migrate.ts` was
 * extending it — a ReferenceError at import time, before any sheet is read.
 */

/**
 * Bump this in the same commit as the migration that reaches it, and add a
 * fixture of the outgoing version to `test/fixtures/`.
 */
export const SCHEMA_VERSION = 2;

/**
 * Paper in px at 96 dpi. Here rather than in `sheet.ts` because a migration
 * needs it, and migrations cannot import `sheet.ts` (see above).
 */
export const PAGE_SIZES = {
  letter: { width: 816, height: 1056 },
  a4: { width: 794, height: 1123 },
} as const;

export class SheetFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SheetFormatError";
  }
}
