/**
 * Light or dark, for everything around the page.
 *
 * The page itself stays white whichever is chosen: a sheet on screen is a
 * picture of what comes out of the printer, and a grey one would be a picture
 * of something else. Dark mode is for the room the sheet is being read in —
 * the toolbar, the panels, the desk the page sits on.
 *
 * The choice is remembered. Until one is made, the system's own setting is
 * followed, so the app matches everything else on the screen without being
 * asked.
 */

import { useCallback, useEffect, useState } from "react";
import { readSetting, writeSetting } from "./settings.js";

export type Theme = "light" | "dark";

const KEY = "jamcalc.theme";

/** What to show, given what was stored and what the system prefers. */
export function resolveTheme(stored: string | null, systemDark: boolean): Theme {
  if (stored === "dark") return "dark";
  if (stored === "light") return "light";
  // Anything else — nothing stored, or a value from a build that wrote
  // something different — is not a choice, so the system decides.
  return systemDark ? "dark" : "light";
}

function systemPrefersDark(): boolean {
  try {
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  } catch {
    return false;
  }
}

const stored = (): string | null => readSetting(KEY);

export function useTheme(): [Theme, (next: Theme) => void] {
  const [theme, setThemeState] = useState<Theme>(() =>
    resolveTheme(stored(), systemPrefersDark()),
  );

  // The attribute is on the root element rather than a class on the app, so
  // the desk behind the page is themed too.
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  // Follow the system while no choice has been made, and stop the moment one
  // is: changing it in the OS should not undo what the user picked here.
  useEffect(() => {
    if (stored() !== null) return;
    let media: MediaQueryList;
    try {
      media = window.matchMedia("(prefers-color-scheme: dark)");
    } catch {
      return;
    }
    const onChange = (e: MediaQueryListEvent): void => {
      if (stored() === null) setThemeState(e.matches ? "dark" : "light");
    };
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  const setTheme = useCallback((next: Theme) => {
    writeSetting(KEY, next);
    setThemeState(next);
  }, []);

  return [theme, setTheme];
}
