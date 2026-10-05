/**
 * Finding the sheet a launch was asked to open.
 *
 * A double-clicked file reaches the app only as a command-line argument, and
 * the argument list looks different packaged, in development, and when a
 * second launch hands its arguments to the first.
 */

import { describe, expect, it } from "vitest";
import { sheetArgument } from "../src/launch.js";

describe("finding the sheet the app was started with", () => {
  it("finds a double-clicked file in a packaged launch", () => {
    expect(
      sheetArgument(["C:\\Program Files\\jamCalc\\jamCalc.exe", "C:\\work\\beam.jc"]),
    ).toBe("C:\\work\\beam.jc");
  });

  it("finds it in a development launch", () => {
    expect(sheetArgument(["electron.exe", ".", "C:\\work\\beam.jc"])).toBe("C:\\work\\beam.jc");
  });

  it("does not mistake the app's own folder for a sheet", () => {
    expect(sheetArgument(["electron.exe", "."])).toBeUndefined();
  });

  it("ignores the case of the extension", () => {
    expect(sheetArgument(["app.exe", "D:\\BEAM.JC"])).toBe("D:\\BEAM.JC");
  });

  it("finds a sheet passed on by a second launch among Chromium's flags", () => {
    const argv = ["app.exe", "--allow-file-access-from-files", "--original-process-start-time=1", "C:\\w\\a.jc"];
    expect(sheetArgument(argv)).toBe("C:\\w\\a.jc");
  });

  it("does not open the files named for a headless export", () => {
    expect(sheetArgument(["app.exe", "--export-pdf", "in.jc", "out.pdf"])).toBeUndefined();
  });
});
