/**
 * Which theme to show.
 *
 * A stored choice is a choice and always wins; anything else defers to the
 * system, so the app matches the rest of the screen until someone says
 * otherwise.
 */

import { describe, expect, it } from "vitest";
import { resolveTheme } from "../src/theme.js";

describe("resolving the theme", () => {
  it("follows the system when nothing is stored", () => {
    expect(resolveTheme(null, true)).toBe("dark");
    expect(resolveTheme(null, false)).toBe("light");
  });

  it("keeps a stored choice whatever the system says", () => {
    expect(resolveTheme("dark", false)).toBe("dark");
    expect(resolveTheme("light", true)).toBe("light");
  });

  it("treats a value it does not recognise as no choice at all", () => {
    // A stored value from another build must not leave the app in a theme
    // that does not exist.
    expect(resolveTheme("midnight", true)).toBe("dark");
    expect(resolveTheme("", true)).toBe("dark");
    expect(resolveTheme("1", false)).toBe("light");
  });
});
