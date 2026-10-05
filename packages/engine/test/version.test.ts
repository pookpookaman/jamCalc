import { describe, expect, it } from "vitest";
import { compareVersions, isNewerVersion } from "../src/version.js";

describe("comparing versions", () => {
  it("orders by major, minor, then patch — as numbers, not text", () => {
    expect(compareVersions("0.10.0", "0.9.9")).toBeGreaterThan(0);
    expect(compareVersions("1.0.0", "0.99.99")).toBeGreaterThan(0);
    expect(compareVersions("0.1.2", "0.1.10")).toBeLessThan(0);
    expect(compareVersions("0.1.0", "0.1.0")).toBe(0);
  });

  it("puts a pre-release before its release", () => {
    expect(compareVersions("0.2.0-beta.1", "0.2.0")).toBeLessThan(0);
    expect(compareVersions("0.2.0-beta.2", "0.2.0-beta.1")).toBeGreaterThan(0);
  });

  it("does not guess at something that is not a version", () => {
    expect(compareVersions("next", "0.1.0")).toBeNull();
    expect(isNewerVersion("garbage", "0.1.0")).toBe(false);
    expect(isNewerVersion(undefined, "0.1.0")).toBe(false);
  });

  it("tells a sheet from a newer build", () => {
    expect(isNewerVersion("0.2.0", "0.1.0")).toBe(true);
    expect(isNewerVersion("0.1.0", "0.1.0")).toBe(false);
  });
});
