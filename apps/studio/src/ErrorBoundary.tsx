/**
 * What the user sees when the app breaks.
 *
 * Without this, a render error unmounts everything and leaves a white window.
 * Someone who has been working for an hour cannot tell a crash from losing
 * their sheets, and the honest answer — that unsaved work is kept, and the
 * home screen offers it after a reload — is invisible at exactly the moment it
 * matters.
 *
 * It also offers the kept copies as files. If something is broken badly enough
 * to reach here, reloading into the same broken state is a real possibility,
 * and the work should be able to leave without it.
 */

import { Component, type ErrorInfo, type ReactNode } from "react";
import { unsavedInBrowser } from "./unsavedCopy.js";

interface Props {
  readonly children: ReactNode;
}

interface State {
  readonly error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // Kept in the console for whoever is looking: the panel deliberately shows
    // the message rather than a stack, which helps nobody using the app.
    console.error("The worksheet stopped rendering:", error, info.componentStack);
  }

  private download = (): void => {
    for (const entry of unsavedInBrowser()) {
      const blob = new Blob([entry.text], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${entry.title.replace(/[^\w-]+/g, "_") || "recovered"}.jc`;
      a.click();
      URL.revokeObjectURL(a.href);
    }
  };

  override render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    const copies = unsavedInBrowser();
    const inShell = window.desktop?.present === true;
    return (
      <div className="crash">
        <h1>The worksheet stopped drawing.</h1>
        <p className="what">{error.message}</p>
        {copies.length > 0 ? (
          <p>
            Unsaved changes in {copies.length} sheet{copies.length === 1 ? " are" : "s are"} kept, and
            the home screen offers them after you reload. You can also take copies first.
          </p>
        ) : inShell ? (
          <p>
            Unsaved work is kept as recovery files, and the home screen offers it after you
            reload.
          </p>
        ) : (
          <p>No unsaved changes were found in this browser.</p>
        )}
        <div className="actions">
          <button onClick={() => window.location.reload()}>Reload</button>
          {copies.length > 0 ? <button onClick={this.download}>Save copies first</button> : null}
        </div>
        <p className="note">
          This is a fault in the application, not in your calculation.
        </p>
      </div>
    );
  }
}
