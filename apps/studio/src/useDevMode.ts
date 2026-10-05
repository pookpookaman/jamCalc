/**
 * Developer mode.
 *
 * Splits the UI into what an engineer preparing a calculation needs and what
 * only someone working ON the tool needs: region ids, recompute telemetry, the
 * text projection (which is really the API surface, not a document view).
 *
 * Off by default, and deliberately not a visible button — a toggle on the
 * toolbar is itself clutter for the audience this hides things from. It is
 * reachable three ways:
 *
 *   - Ctrl/Cmd + Shift + D
 *   - ?dev=1 in the URL (handy for a bug report: "open this link")
 *   - localStorage, so it survives a reload once you have turned it on
 */

import { useCallback, useEffect, useState } from "react";
import { readSetting, writeSetting } from "./settings.js";

const KEY = "jamcalc.devMode";

function initialDev(): boolean {
  try {
    const param = new URLSearchParams(window.location.search).get("dev");
    if (param !== null) return param !== "0" && param !== "false";
    return readSetting(KEY) === "1";
  } catch {
    // Private browsing and some embedded webviews throw on storage access.
    return false;
  }
}

export function useDevMode(): [boolean, () => void] {
  const [dev, setDev] = useState(initialDev);

  const toggle = useCallback(() => {
    setDev((d) => {
      const next = !d;
      writeSetting(KEY, next ? "1" : "0");
      return next;
    });
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "d") {
        e.preventDefault();
        toggle();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggle]);

  return [dev, toggle];
}
