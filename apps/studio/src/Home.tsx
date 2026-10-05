/**
 * Where the app starts.
 *
 * Nothing from a previous session opens by itself: starting clean was the
 * decision. What a previous session left unsaved is offered here instead —
 * to restore or discard, one sheet at a time — so the safety net a crash
 * needs is still there without deciding for anyone what they are working on.
 */

import type { JSX } from "react";
import { PRODUCT, VERSION } from "./product.js";
import type { RecentEntry } from "./recent.js";
import type { Theme } from "./theme.js";
import type { UnsavedEntry } from "./unsavedCopy.js";
import { inDesktop } from "./useDesktopMenu.js";

export interface HomeProps {
  readonly unsaved: readonly UnsavedEntry[];
  readonly recent: readonly RecentEntry[];
  readonly onNew: () => void;
  readonly onOpen: () => void;
  readonly onRestore: (entry: UnsavedEntry) => void;
  readonly onDiscard: (entry: UnsavedEntry) => void;
  readonly onOpenRecent: (entry: RecentEntry) => void;
  readonly theme: Theme;
  readonly setTheme: (theme: Theme) => void;
}

const when = (iso: string | undefined): string => {
  if (!iso) return "";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleString();
};

export function Home({
  unsaved,
  recent,
  onNew,
  onOpen,
  onRestore,
  onDiscard,
  onOpenRecent,
  theme,
  setTheme,
}: HomeProps): JSX.Element {
  return (
    <main className="home">
      <div className="home-inner">
        <header className="home-head">
          {PRODUCT ? <h1>{PRODUCT}</h1> : null}
        </header>

        <div className="home-actions">
          <button className="home-primary" onClick={onNew}>
            <span className="home-icon" aria-hidden="true">+</span>
            <span className="home-label">
              <b>New sheet</b>
              <small>Start from a blank page</small>
            </span>
          </button>
          <button className="home-primary" onClick={onOpen}>
            <span className="home-icon" aria-hidden="true">
              <svg viewBox="0 0 20 20" width="18" height="18">
                <path d="M3 6h5l2 2h7v8H3z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
              </svg>
            </span>
            <span className="home-label">
              <b>Open…</b>
              <small>A .jc file from your computer</small>
            </span>
          </button>
        </div>

        {unsaved.length > 0 ? (
          <section className="home-section home-unsaved">
            <h2>Unsaved work from your last session</h2>
            <ul>
              {unsaved.map((entry) => (
                <li key={entry.id}>
                  <div className="home-item-text">
                    <b>{entry.title}</b>
                    <small>
                      {entry.path ?? "never saved"}
                      {entry.at ? ` · ${when(entry.at)}` : ""}
                    </small>
                  </div>
                  <div className="home-item-actions">
                    <button onClick={() => onRestore(entry)}>Restore</button>
                    <button className="quiet" onClick={() => onDiscard(entry)}>
                      Discard
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <section className="home-section">
          <h2>{inDesktop() ? "Recent files" : "Recent in this browser"}</h2>
          {recent.length === 0 ? (
            <p className="home-empty">Nothing yet. Sheets you open or save will appear here.</p>
          ) : (
            <ul>
              {recent.map((entry) => (
                <li key={entry.key}>
                  <button className="home-recent" onClick={() => onOpenRecent(entry)}>
                    <b>{entry.title}</b>
                    <small>{entry.path ?? (entry.at ? `copy kept ${when(entry.at)}` : "")}</small>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <footer className="home-foot">
          {VERSION ? <span className="home-version">{PRODUCT || "jamCalc"} {VERSION}</span> : null}
          <label className="menu-row check">
            <input
              type="checkbox"
              checked={theme === "dark"}
              onChange={(e) => setTheme(e.target.checked ? "dark" : "light")}
            />
            <span>Dark theme</span>
          </label>
        </footer>
      </div>
    </main>
  );
}
