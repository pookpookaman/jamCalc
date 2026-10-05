/**
 * Comparing product versions (ADR-0016), for telling someone a sheet was
 * saved by a newer jamCalc than the one opening it.
 *
 * `major.minor.patch`, with an optional pre-release tag that sorts before the
 * release it precedes (0.2.0-beta.1 < 0.2.0). Anything that is not a version
 * compares as unknown rather than guessing.
 */

const VERSION = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/;

/** Negative, zero or positive as `a` is older, the same, or newer; null if either is not a version. */
export function compareVersions(a: string, b: string): number | null {
  const x = VERSION.exec(a.trim());
  const y = VERSION.exec(b.trim());
  if (!x || !y) return null;
  for (let i = 1; i <= 3; i += 1) {
    const d = Number(x[i]) - Number(y[i]);
    if (d !== 0) return d;
  }
  const px = x[4];
  const py = y[4];
  if (px === py) return 0;
  if (px === undefined) return 1;
  if (py === undefined) return -1;
  return px < py ? -1 : 1;
}

/** Whether a sheet saved by `savedWith` comes from a newer version than `running`. */
export const isNewerVersion = (savedWith: string | undefined, running: string): boolean =>
  savedWith !== undefined && (compareVersions(savedWith, running) ?? 0) > 0;
