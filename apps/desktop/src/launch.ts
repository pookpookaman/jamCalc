/**
 * What the app was asked to open when it was started.
 *
 * On Windows a double-clicked `.jc` arrives as a command-line argument: the
 * packaged app gets `[exe, path]`, a development run `[electron, ".", path]`,
 * and a second launch passes its whole argv on to the first. So the file is
 * found by what it is, not by where it sits. The two arguments of
 * `--export-pdf` are files too, and are not documents to open in a window.
 *
 * No Electron here, so it can be tested without starting the app.
 */

const SHEET = /\.jc$/i;

export function sheetArgument(argv: readonly string[]): string | undefined {
  const exportAt = argv.indexOf("--export-pdf");
  return argv.find(
    (arg, i) =>
      SHEET.test(arg) && !(exportAt >= 0 && (i === exportAt + 1 || i === exportAt + 2)),
  );
}
