/**
 * The workspace: the home screen, the open sheets, and how they are laid out.
 *
 * Nothing opens by itself when the app starts. The home screen offers a new
 * sheet, a file, a recent one, and any unsaved work a previous session left
 * behind — offered, never reopened on its own.
 *
 * Open sheets live in tabs, and tabs in panes side by side; the rules are in
 * workspace.ts, tested there. The pane last clicked is focused: its sheet
 * answers the keyboard and the menus, and draws the toolbar, the side panel
 * and the status bar into the window's shared slots. Every other sheet draws
 * only its pages.
 *
 * Every open sheet's editor is rendered here, in one list that never
 * reorders, and places its pages into whichever pane shows it. Rendering the
 * editor inside its pane instead would rebuild it whenever its tab moved, and
 * take its undo history and its unsaved changes with it.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from "react";
import { emptySheet, parseSheet, serializeSheet, type Sheet } from "@jamcalc/engine";
import { Home } from "./Home.js";
import { PRODUCT } from "./product.js";
import { SheetEditor, type DocMeta, type Prefs, type Slots } from "./SheetEditor.js";
import { listRecent, rememberRecent, type RecentEntry } from "./recent.js";
import { useTheme } from "./theme.js";
import { defaultTemplate } from "./templates.js";
import { discardUnsaved, listUnsaved, type UnsavedEntry } from "./unsavedCopy.js";
import { signalRendered, useDesktopMenu } from "./useDesktopMenu.js";
import { useDevMode } from "./useDevMode.js";
import {
  MAX_PANES,
  activateTab,
  closeTab,
  emptyLayout,
  focusPane,
  focusedDoc,
  moveTab,
  openTab,
  paneOf,
  splitTab,
  type DocId,
  type Layout,
  type Pane,
  type PaneId,
} from "./workspace.js";

type PanelTab = "symbols" | "text" | "page";
type Side = "left" | "right" | "center";

interface OpenDoc {
  readonly id: DocId;
  readonly initial: Sheet;
  readonly savedText: string | null;
  readonly path: string | null;
}

/** What a dragged tab carries: a type of its own, so a dragged file is never taken for one. */
const TAB_TYPE = "application/x-jamcalc-tab";

let counter = 0;
const freshId = (prefix: string): string =>
  `${prefix}${Date.now().toString(36)}${(counter += 1).toString(36)}`;

/**
 * Lets go of a math field's focus before its sheet can leave the screen.
 *
 * MathLive keeps one global note of the focused field. A sheet sent behind
 * another tab is hidden in the same moment, and a hidden element loses focus
 * without the blur MathLive listens for — so the note is left on a field that
 * is about to be torn down, and the next field to take focus throws. Blurring
 * first, while the field is still on screen, lets MathLive hear it.
 */
function releaseFocus(): void {
  const active = document.activeElement;
  if (active instanceof HTMLElement && active.tagName === "MATH-FIELD") active.blur();
}

/** A sheet and its text in canonical form, so "unsaved" compares like with like. */
function canonical(text: string): { sheet: Sheet; text: string } {
  const sheet = parseSheet(text);
  return { sheet, text: serializeSheet(sheet) };
}

export function App(): JSX.Element {
  const [docs, setDocs] = useState<ReadonlyMap<DocId, OpenDoc>>(() => new Map());
  const [meta, setMeta] = useState<ReadonlyMap<DocId, DocMeta>>(() => new Map());
  const [layout, setLayout] = useState<Layout>(emptyLayout);
  /** Any change that can put a sheet behind another goes through here. */
  const changeLayout = useCallback((change: (cur: Layout) => Layout) => {
    releaseFocus();
    setLayout(change);
  }, []);
  const [unsaved, setUnsaved] = useState<readonly UnsavedEntry[]>([]);
  const [recent, setRecent] = useState<readonly RecentEntry[]>([]);

  // Settings that belong to the window, and hold across tabs.
  const [grid, setGrid] = useState(12);
  const [showGrid, setShowGrid] = useState(false);
  const [alignOn, setAlignOn] = useState(true);
  const [mathLive, setMathLive] = useState(true);
  const [dev, toggleDev] = useDevMode();
  const [theme, setTheme] = useTheme();
  const [panel, setPanel] = useState<PanelTab>("symbols");
  const [openTabs, setOpenTabs] = useState<ReadonlySet<PanelTab>>(
    () => new Set<PanelTab>(["symbols", "page"]),
  );
  const prefs = useMemo<Prefs>(
    () => ({
      grid,
      setGrid,
      showGrid,
      setShowGrid,
      alignOn,
      setAlignOn,
      mathLive,
      setMathLive,
      dev,
      toggleDev,
      theme,
      setTheme,
      panel,
      setPanel,
      openTabs,
      setOpenTabs,
    }),
    [grid, showGrid, alignOn, mathLive, dev, toggleDev, theme, setTheme, panel, openTabs],
  );

  // The window's shared slots, filled by whichever sheet is focused.
  const [top, setTop] = useState<HTMLElement | null>(null);
  const [side, setSide] = useState<HTMLElement | null>(null);
  const [bottom, setBottom] = useState<HTMLElement | null>(null);
  const slots = useMemo<Slots | null>(
    () => (top && side && bottom ? { top, side, bottom } : null),
    [top, side, bottom],
  );

  /**
   * Each pane's host element, where its sheets draw their pages.
   *
   * One callback per pane, kept: a fresh ref callback on every render is
   * called with null and then the element each time, and two state updates
   * per render is a render loop.
   */
  const [hosts, setHosts] = useState<ReadonlyMap<PaneId, HTMLElement>>(() => new Map());
  const hostCallbacks = useRef(new Map<PaneId, (el: HTMLElement | null) => void>());
  const hostRef = useCallback((pane: PaneId) => {
    let callback = hostCallbacks.current.get(pane);
    if (!callback) {
      callback = (el) =>
        setHosts((cur) => {
          if (el ? cur.get(pane) === el : !cur.has(pane)) return cur;
          const next = new Map(cur);
          if (el) next.set(pane, el);
          else next.delete(pane);
          return next;
        });
      hostCallbacks.current.set(pane, callback);
    }
    return callback;
  }, []);

  const fileRef = useRef<HTMLInputElement>(null);

  // The latest state, for handlers that must not change identity.
  const latest = useRef({ docs, meta, layout });
  latest.current = { docs, meta, layout };

  const atHome = layout.panes.length === 0;
  const refreshHome = useCallback(() => {
    void listUnsaved().then(setUnsaved);
    void listRecent().then(setRecent);
  }, []);
  useEffect(() => {
    if (atHome) refreshHome();
  }, [atHome, refreshHome]);

  const openSheet = useCallback(
    (sheet: Sheet, savedText: string | null, path: string | null, id: DocId = freshId("d")) => {
      setDocs((cur) => new Map(cur).set(id, { id, initial: sheet, savedText, path }));
      changeLayout((cur) => openTab(cur, id, freshId("p")));
      return id;
    },
    [changeLayout],
  );

  const newSheet = useCallback(() => {
    // Starts from the default template's header and footer, if one was
    // chosen; a new sheet is otherwise empty. Either way it is not a change:
    // nothing is unsaved until the user does something.
    void defaultTemplate().then((template) => {
      const blank = emptySheet("Untitled");
      const sheet = template
        ? {
            ...blank,
            page: {
              ...blank.page,
              ...(template.header ? { header: template.header } : {}),
              ...(template.footer ? { footer: template.footer } : {}),
            },
          }
        : blank;
      openSheet(sheet, serializeSheet(sheet), null);
    });
  }, [openSheet]);

  /** A sheet's text, from a picker, the shell or a recent copy. */
  const openText = useCallback(
    (text: string, path: string | null): DocId | null => {
      // A file that is already open comes forward rather than opening twice,
      // where the two copies would each think they were the file.
      if (path) {
        for (const doc of latest.current.docs.values()) {
          if ((latest.current.meta.get(doc.id)?.path ?? doc.path) === path) {
            changeLayout((cur) => activateTab(cur, doc.id));
            return doc.id;
          }
        }
      }
      try {
        const opened = canonical(text);
        return openSheet(opened.sheet, opened.text, path);
      } catch (e) {
        window.alert(`That file could not be opened as a sheet.\n\n${(e as Error).message}`);
        return null;
      }
    },
    [openSheet],
  );

  const openFromDisk = useCallback(() => {
    const bridge = window.desktop;
    // On desktop each chosen file arrives as an "opened" document.
    if (bridge?.open) void bridge.open();
    else fileRef.current?.click();
  }, []);

  const restore = useCallback(
    (entry: UnsavedEntry) => {
      let sheet: Sheet;
      try {
        sheet = parseSheet(entry.text);
      } catch (e) {
        window.alert(`That copy could not be reopened.\n\n${(e as Error).message}`);
        return;
      }
      // Under its own id, so it keeps writing to the copy it came from:
      // there is never a moment when the work exists only in memory.
      openSheet(sheet, null, entry.path ?? null, entry.id);
    },
    [openSheet],
  );

  const discard = useCallback(
    (entry: UnsavedEntry) => {
      if (!window.confirm(`Discard the unsaved changes to ${entry.title}?\n\nThis cannot be undone.`)) {
        return;
      }
      void discardUnsaved(entry.id).then(refreshHome);
    },
    [refreshHome],
  );

  const openRecent = useCallback(
    (entry: RecentEntry) => {
      if (entry.path) void window.desktop?.openPath?.(entry.path);
      else if (entry.text !== undefined) openText(entry.text, null);
    },
    [openText],
  );

  const onMeta = useCallback((id: DocId, m: DocMeta) => {
    setMeta((cur) => {
      const prev = cur.get(id);
      if (prev && prev.title === m.title && prev.dirty === m.dirty && prev.path === m.path) {
        return cur;
      }
      return new Map(cur).set(id, m);
    });
  }, []);

  const close = useCallback((id: DocId) => {
    const m = latest.current.meta.get(id);
    if (m?.dirty && !window.confirm(`${m.title || "This sheet"} has unsaved changes.\n\nClose it and discard them?`)) {
      return;
    }
    void discardUnsaved(id);
    changeLayout((cur) => closeTab(cur, id));
    setDocs((cur) => {
      const next = new Map(cur);
      next.delete(id);
      return next;
    });
    setMeta((cur) => {
      const next = new Map(cur);
      next.delete(id);
      return next;
    });
  }, [changeLayout]);

  const closeFocused = useCallback(() => {
    const id = focusedDoc(latest.current.layout);
    if (id) close(id);
  }, [close]);

  const dropOnTabs = useCallback((doc: DocId, pane: PaneId, drawnIndex: number) => {
    changeLayout((cur) => {
      // The drop point counts the tabs as drawn, which still include the one
      // being dragged; moveTab counts them once it has left.
      const from = paneOf(cur, doc);
      const index =
        from?.id === pane && from.tabs.indexOf(doc) < drawnIndex ? drawnIndex - 1 : drawnIndex;
      return moveTab(cur, doc, pane, index);
    });
  }, [changeLayout]);

  const dropOnPane = useCallback((doc: DocId, pane: PaneId, where: Side) => {
    changeLayout((cur) =>
      where === "center"
        ? moveTab(cur, doc, pane, Number.MAX_SAFE_INTEGER)
        : splitTab(cur, doc, pane, where, freshId("p")),
    );
  }, [changeLayout]);

  // --- the desktop shell ------------------------------------------------------

  useEffect(() => {
    const bridge = window.desktop;
    if (!bridge?.onDocument) return;
    const off = bridge.onDocument("opened", ({ path, text }) => {
      if (typeof text !== "string") return;
      if (openText(text, path ?? null)) {
        // A headless export waits for this rather than guessing at a delay:
        // the new tab has to mount, measure its regions and paginate first.
        window.setTimeout(() => signalRendered(), 300);
      }
    });
    bridge.listening?.();
    return off;
  }, [openText]);

  useEffect(() => {
    const bridge = window.desktop;
    if (!bridge?.onCloseRequest) return;
    return bridge.onCloseRequest(() => {
      const unsavedNow = [...latest.current.meta.values()].filter((m) => m.dirty);
      const what =
        unsavedNow.length === 1
          ? `${unsavedNow[0]?.title || "A sheet"} has unsaved changes.`
          : `${unsavedNow.length} sheets have unsaved changes.`;
      if (
        unsavedNow.length === 0 ||
        window.confirm(`${what}\n\nClose anyway? A copy of each is kept and offered on the home screen next time.`)
      ) {
        bridge.approveClose?.();
      }
    });
  }, []);

  useDesktopMenu({ new: newSheet, closeTab: closeFocused }, true);

  // The title names the sheet being worked in.
  const focused = focusedDoc(layout);
  const focusedMeta = focused ? meta.get(focused) : undefined;
  const titleName = focusedMeta ? focusedMeta.title || "Untitled" : "Home";
  const titleEdited = focusedMeta?.dirty ?? false;
  useEffect(() => {
    const bridge = window.desktop;
    if (bridge?.setTitle) bridge.setTitle(titleName, titleEdited);
    else document.title = `${titleEdited ? "• " : ""}${titleName}${PRODUCT ? ` — ${PRODUCT}` : ""}`;
  }, [titleName, titleEdited]);

  return (
    <div className="app">
      <div className="slot" ref={setTop} />
      <div className="body">
        {atHome ? (
          <Home
            unsaved={unsaved}
            recent={recent}
            onNew={newSheet}
            onOpen={openFromDisk}
            onRestore={restore}
            onDiscard={discard}
            onOpenRecent={openRecent}
            theme={theme}
            setTheme={setTheme}
          />
        ) : (
          <div className="panes">
            {layout.panes.map((pane) => (
              <PaneView
                key={pane.id}
                pane={pane}
                focused={pane.id === layout.focused}
                canSplit={pane.tabs.length > 1 && layout.panes.length < MAX_PANES}
                meta={meta}
                hostRef={hostRef(pane.id)}
                onFocus={() => setLayout((cur) => focusPane(cur, pane.id))}
                onActivate={(id) => changeLayout((cur) => activateTab(cur, id))}
                onClose={close}
                onSplit={(id) => changeLayout((cur) => splitTab(cur, id, pane.id, "right", freshId("p")))}
                onDropTabs={dropOnTabs}
                onDropPane={dropOnPane}
              />
            ))}
          </div>
        )}
        <div className="slot" ref={setSide} />
      </div>
      <div className="slot" ref={setBottom} />

      {[...docs.values()].map((doc) => {
        const pane = paneOf(layout, doc.id);
        const visible = pane?.active === doc.id;
        return (
          <SheetEditor
            key={doc.id}
            docId={doc.id}
            initial={doc.initial}
            savedText={doc.savedText}
            path={doc.path}
            host={pane ? (hosts.get(pane.id) ?? null) : null}
            focused={visible && pane?.id === layout.focused}
            visible={visible}
            slots={slots}
            prefs={prefs}
            onMeta={onMeta}
            onNewSheet={newSheet}
            onOpen={openFromDisk}
          />
        );
      })}

      <input
        ref={fileRef}
        type="file"
        accept=".jc,.json"
        multiple
        hidden
        onChange={(e) => {
          // Read them all, then open in the order chosen: opened as each read
          // finished, the tabs came out in whatever order the reads did.
          const files = [...(e.target.files ?? [])];
          void Promise.all(files.map((file) => file.text())).then((texts) => {
            for (const text of texts) {
              if (!openText(text, null)) continue;
              try {
                rememberRecent(parseSheet(text).title, text);
              } catch {
                /* openText has already said what was wrong */
              }
            }
          });
          e.target.value = "";
        }}
      />
    </div>
  );
}

interface PaneViewProps {
  readonly pane: Pane;
  readonly focused: boolean;
  readonly canSplit: boolean;
  readonly meta: ReadonlyMap<DocId, DocMeta>;
  readonly hostRef: (el: HTMLElement | null) => void;
  readonly onFocus: () => void;
  readonly onActivate: (id: DocId) => void;
  readonly onClose: (id: DocId) => void;
  readonly onSplit: (id: DocId) => void;
  readonly onDropTabs: (doc: DocId, pane: PaneId, drawnIndex: number) => void;
  readonly onDropPane: (doc: DocId, pane: PaneId, where: Side) => void;
}

/**
 * One pane: its tab bar, and the host its sheets draw their pages into.
 *
 * The pages belong to their editors, which live elsewhere in React's tree, so
 * a React handler here would never hear an event that starts on them — React
 * delivers events along its own tree, not the page's. Focus and tab drops are
 * listened for on the elements themselves, which the pages do sit inside.
 */
function PaneView({
  pane,
  focused,
  canSplit,
  meta,
  hostRef,
  onFocus,
  onActivate,
  onClose,
  onSplit,
  onDropTabs,
  onDropPane,
}: PaneViewProps): JSX.Element {
  const sectionRef = useRef<HTMLElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const tabsRef = useRef<HTMLDivElement>(null);
  const [dropAt, setDropAt] = useState<number | null>(null);
  const [dropSide, setDropSide] = useState<Side | null>(null);

  const handlers = useRef({ onFocus, onDropPane, paneId: pane.id });
  handlers.current = { onFocus, onDropPane, paneId: pane.id };

  const isTab = (dt: DataTransfer | null): boolean => dt?.types.includes(TAB_TYPE) ?? false;

  /** Which part of the pane a drop lands in: the outer quarters split it. */
  const sideAt = (x: number, box: DOMRect): Side => {
    const f = (x - box.left) / box.width;
    return f < 0.25 ? "left" : f > 0.75 ? "right" : "center";
  };

  useEffect(() => {
    const section = sectionRef.current;
    const body = bodyRef.current;
    if (!section || !body) return;
    const focus = (): void => handlers.current.onFocus();
    const over = (e: DragEvent): void => {
      if (!isTab(e.dataTransfer)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
      setDropSide(sideAt(e.clientX, body.getBoundingClientRect()));
    };
    const leave = (e: DragEvent): void => {
      if (!body.contains(e.relatedTarget as Node | null)) setDropSide(null);
    };
    const drop = (e: DragEvent): void => {
      const doc = e.dataTransfer?.getData(TAB_TYPE);
      setDropSide(null);
      if (!doc) return;
      e.preventDefault();
      handlers.current.onDropPane(doc, handlers.current.paneId, sideAt(e.clientX, body.getBoundingClientRect()));
    };
    section.addEventListener("pointerdown", focus, true);
    body.addEventListener("dragover", over);
    body.addEventListener("dragleave", leave);
    body.addEventListener("drop", drop);
    return () => {
      section.removeEventListener("pointerdown", focus, true);
      body.removeEventListener("dragover", over);
      body.removeEventListener("dragleave", leave);
      body.removeEventListener("drop", drop);
    };
  }, []);

  /** Where between the tabs a drop lands, from the pointer's x. */
  const indexAt = (x: number): number => {
    const tabs = [...(tabsRef.current?.querySelectorAll<HTMLElement>(".tab") ?? [])];
    const at = tabs.findIndex((t) => {
      const b = t.getBoundingClientRect();
      return x < b.left + b.width / 2;
    });
    return at < 0 ? tabs.length : at;
  };

  return (
    <section ref={sectionRef} className={`pane ${focused ? "is-focused" : ""}`}>
      <div
        className="tabbar"
        ref={tabsRef}
        role="tablist"
        onDragOver={(e) => {
          if (!isTab(e.dataTransfer)) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
          setDropAt(indexAt(e.clientX));
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropAt(null);
        }}
        onDrop={(e) => {
          const doc = e.dataTransfer.getData(TAB_TYPE);
          setDropAt(null);
          if (!doc) return;
          e.preventDefault();
          onDropTabs(doc, pane.id, indexAt(e.clientX));
        }}
      >
        {pane.tabs.map((id, i) => {
          const m = meta.get(id);
          const title = m?.title || "Untitled";
          const classes = [
            "tab",
            pane.active === id ? "is-active" : "",
            m?.dirty ? "is-dirty" : "",
            dropAt === i ? "drop-before" : "",
            dropAt === pane.tabs.length && i === pane.tabs.length - 1 ? "drop-after" : "",
          ];
          return (
            <div
              key={id}
              role="tab"
              aria-selected={pane.active === id}
              className={classes.filter(Boolean).join(" ")}
              title={m?.path ?? title}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData(TAB_TYPE, id);
                e.dataTransfer.effectAllowed = "move";
              }}
              onDragEnd={() => setDropAt(null)}
              onClick={() => onActivate(id)}
              onAuxClick={(e) => {
                // Middle-click closes, as it does in every browser.
                if (e.button !== 1) return;
                e.preventDefault();
                onClose(id);
              }}
            >
              <span className="tab-title">{title}</span>
              <button
                className="tab-close"
                title={m?.dirty ? "unsaved changes — close" : "close"}
                aria-label={`close ${title}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onClose(id);
                }}
              >
                <span className="tab-dot" aria-hidden="true" />
                <span className="tab-x" aria-hidden="true">
                  ×
                </span>
              </button>
            </div>
          );
        })}
        <div className="tabbar-rest" />
        <button
          className="tabbar-split"
          title="Show the current tab beside this one (or drag a tab to the side of a pane)"
          aria-label="split"
          disabled={!canSplit}
          onClick={() => {
            if (pane.active) onSplit(pane.active);
          }}
        >
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
            <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" fill="none" stroke="currentColor" />
            <path d="M8 2.5v11" stroke="currentColor" />
          </svg>
        </button>
      </div>
      <div className="pane-body" ref={bodyRef}>
        <div className="pane-host" ref={hostRef} />
        {dropSide ? <div className={`pane-drop is-${dropSide}`} aria-hidden="true" /> : null}
      </div>
    </section>
  );
}
