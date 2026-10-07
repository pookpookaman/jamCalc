/**
 * A toolbar button that opens a small menu.
 *
 * The toolbar used to hold every control at once and scroll sideways when it
 * ran out of room, which hides the thing it is meant to show. What is pressed
 * constantly stays a button; the rest is grouped behind one of these.
 *
 * It closes on a press anywhere outside it and on Escape, both captured before
 * the app's own handlers so that closing a menu does not also cancel an edit.
 */

import { useEffect, useRef, useState, type JSX, type ReactNode } from "react";

export interface MenuButtonProps {
  readonly label: string;
  readonly title?: string | undefined;
  /**
   * Which edge of the button the menu lines up with. "right" suits a button
   * near the right of the window; "left" one near the left, where a menu
   * opening leftwards would run off the screen.
   */
  readonly align?: "left" | "right";
  /** Given a function that closes the menu, so an item can close it. */
  readonly children: (close: () => void) => ReactNode;
}

export function MenuButton({ label, title, align = "right", children }: MenuButtonProps): JSX.Element {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent): void => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      setOpen(false);
    };
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [open]);

  return (
    <div className="menu" ref={ref}>
      <button
        className={open ? "menu-open" : ""}
        title={title}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        {label}
        <span className="caret" aria-hidden="true">
          ▾
        </span>
      </button>
      {open ? (
        <div className={align === "left" ? "menu-panel align-left" : "menu-panel"}>{children(() => setOpen(false))}</div>
      ) : null}
    </div>
  );
}
