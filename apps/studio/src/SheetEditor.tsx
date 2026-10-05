import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import { createPortal } from "react-dom";
import {
  contentMargins,
  FIELDS,
  TITLE_BLOCK_KEYS,
  isSheetNumber,
  type FieldName,
  type PageFields,
  formatResult,
  formatResultParts,
  pageBox,
  placePoint,
  pointAt,
  resolveFormat,
  type Margins,
  type PageBand,
  type Position,
  type RegionId,
  type RegionResult,
  type RegionStyle,
  type StylePatch,
  type Sheet,
  type Size,
  type TextRun,
} from "@jamcalc/engine";
import {
  displayUnitOf,
  formatValueParts,
  isMatrix,
  isNewerVersion,
  parseSheet,
  plainText,
  serializeSheet,
  styleOfRange,
  writtenUnitOf,
  type Value,
} from "@jamcalc/engine";
import { RegionBody } from "./RegionBody.js";
import { dimensionOf, UnitPicker } from "./UnitPicker.js";
import { MathLiveField } from "./MathLiveField.js";
import { ColourRow } from "./ColourRow.js";
import { PageBands, type BandSelection } from "./Bands.js";
import { BandBar } from "./BandBar.js";
import { addItem, moveItem, nextFreeSpot, removeItem, type NewItem } from "./bandEdit.js";
import { VERSION } from "./product.js";
import { MenuButton } from "./MenuButton.js";
import { alignSnap, type Box, type Guide } from "./alignSnap.js";
import { ImageRegionBody } from "./ImageRegionBody.js";
import { PlotRegionBody } from "./PlotRegionBody.js";
import { TableRegionBody } from "./TableRegionBody.js";
import { TextRegionBody, type TextSelection } from "./TextRegionBody.js";
import { formatControls, type Kind } from "./formatControls.js";
import { formatTarget, rememberRange } from "./formatTarget.js";
import {
  exportPdfThroughHost,
  inDesktop,
  printThroughHost,
  useDesktopMenu,
} from "./useDesktopMenu.js";
import type { Theme } from "./theme.js";
import { useUnsavedCopy } from "./unsavedCopy.js";
import { rememberRecent } from "./recent.js";
import { useSheet } from "./useSheet.js";
import { revealRow } from "./revealRow.js";
import { matchesSymbol } from "./symbolSearch.js";


/** Left is the default, so choosing it clears the property rather than storing it. */
const ALIGNMENTS = [
  { value: "left" as const, label: "align left" },
  { value: "center" as const, label: "centre" },
  { value: "right" as const, label: "align right" },
];

/**
 * The usual four bars, two of them short.
 *
 * Drawn rather than lettered: no Unicode character reads as "align right" at
 * this size, and three identical glyphs told apart by CSS would still look
 * like three identical glyphs.
 */
function AlignIcon({ align }: { align: "left" | "center" | "right" }) {
  const full = 13;
  const short = 8;
  const x = (w: number): number =>
    align === "left" ? 1 : align === "right" ? 1 + (full - w) : 1 + (full - w) / 2;
  return (
    <svg width="15" height="11" viewBox="0 0 15 11" aria-hidden="true">
      {[full, short, full, short].map((w, i) => (
        <rect key={i} x={x(w)} y={i * 3} width={w} height="1.5" rx="0.5" fill="currentColor" />
      ))}
    </svg>
  );
}

/**
 * Snap steps. The default matches DEFAULT_BAND_HEIGHT in the engine, which is
 * not a coincidence: evaluation order quantizes y into 12px bands, so snapping
 * to 12 means a region always lands squarely in one band instead of near a
 * boundary where a 1px nudge could reorder the sheet.
 */
const SNAP_STEPS = [0, 4, 6, 12, 24] as const;

const snap = (v: number, step: number): number =>
  step > 0 ? Math.round(v / step) * step : Math.round(v);

/**
 * How far the cursor drops after an insert when the new region measures less
 * than this. A region starts empty, so its measured height is one line; a bare
 * line of clearance is what stops the next one touching it.
 */
const MIN_ADVANCE = 24;

/**
 * How far a press must travel before it counts as a drag rather than a click.
 *
 * Small enough that dragging feels immediate, large enough to absorb the
 * wobble of a click — the wobble that used to move a box when someone reached
 * in to type in it.
 */
const DRAG_THRESHOLD = 4;

/**
 * Takes ownership of the pointer for the rest of a drag.
 *
 * Two separate problems, both of which show up as the sheet fighting the
 * gesture. Without a pointer capture, moves are delivered to whatever happens
 * to be under the cursor, so passing over another region hands it the events —
 * and leaving the page stops the drag dead. Without suppressing selection, the
 * browser reads the same movement as "highlight the text you are sweeping
 * across", so text lights up in boxes the user is only passing over.
 */
function seizePointer(target: Element, pointerId: number): void {
  try {
    (target as Element & { setPointerCapture(id: number): void }).setPointerCapture(pointerId);
  } catch {
    // Capture is a convenience, not a requirement; a browser that refuses it
    // still gets the selection suppression below.
  }
}

/** Stops the page selecting text while a drag is under way. */
function suppressSelection(on: boolean): void {
  document.body.classList.toggle("is-dragging", on);
  if (on) {
    // Anything already highlighted would otherwise stay lit through the drag.
    const selection = window.getSelection();
    if (selection && !selection.isCollapsed) selection.removeAllRanges();
  }
}

/** A file name made from a sheet's title. */
const fileName = (title: string): string => title.replace(/[^\w-]+/g, "_") || "Untitled";

type PanelTab = "symbols" | "text" | "page";

/** Where the focused sheet draws the window's shared furniture. */
export interface Slots {
  /** The toolbar and the format bar, above the panes. */
  readonly top: HTMLElement;
  /** The side panel, right of the panes. */
  readonly side: HTMLElement;
  /** The status bar and the problem list, below. */
  readonly bottom: HTMLElement;
}

/**
 * Settings that belong to the window rather than to one sheet: they hold as
 * you move between tabs. The side panel is here too — closing one of its tabs
 * should not undo itself when another sheet comes forward.
 */
export interface Prefs {
  readonly grid: number;
  readonly setGrid: (grid: number) => void;
  readonly showGrid: boolean;
  readonly setShowGrid: (on: boolean) => void;
  readonly alignOn: boolean;
  readonly setAlignOn: (on: boolean) => void;
  readonly mathLive: boolean;
  readonly setMathLive: (on: boolean) => void;
  readonly dev: boolean;
  readonly toggleDev: () => void;
  readonly theme: Theme;
  readonly setTheme: (theme: Theme) => void;
  readonly panel: PanelTab;
  readonly setPanel: (tab: PanelTab) => void;
  readonly openTabs: ReadonlySet<PanelTab>;
  readonly setOpenTabs: Dispatch<SetStateAction<ReadonlySet<PanelTab>>>;
}

/** What a tab shows about its sheet. */
export interface DocMeta {
  readonly title: string;
  readonly dirty: boolean;
  readonly path: string | null;
}

/**
 * A sheet as text, without the version that saved it — what "unsaved" is
 * judged on. Two saves of the same sheet by different versions are the same
 * sheet.
 */
function contentOf(doc: Sheet): string {
  const { savedWith: _stamp, ...rest } = doc;
  return serializeSheet(rest as Sheet);
}

function contentOfText(text: string | null): string | null {
  if (text === null) return null;
  try {
    return contentOf(parseSheet(text));
  } catch {
    return text;
  }
}

export interface SheetEditorProps {
  readonly docId: string;
  /** The sheet as opened: from a file, a restored copy, or blank. */
  readonly initial: Sheet;
  /**
   * The text it was opened from, in canonical form. Unsaved means differing
   * from it; null for a restored copy, which starts out unsaved.
   */
  readonly savedText: string | null;
  /** The file it belongs to, on desktop. */
  readonly path: string | null;
  /** Where its pages are drawn: the body of the pane showing it. */
  readonly host: HTMLElement | null;
  /** The keyboard, the menus and the window's furniture are this sheet's. */
  readonly focused: boolean;
  /** On top in its pane. A sheet behind another tab is kept, not drawn. */
  readonly visible: boolean;
  readonly slots: Slots | null;
  readonly prefs: Prefs;
  readonly onMeta: (docId: string, meta: DocMeta) => void;
  readonly onNewSheet: () => void;
  readonly onOpen: () => void;
}

type Drag =
  | {
      mode: "move";
      anchor: RegionId;
      ids: RegionId[];
      ox: number;
      oy: number;
      origin: Map<RegionId, Position>;
      /**
       * False until the pointer has actually travelled.
       *
       * A press on a region is ambiguous: it might be the start of a drag or
       * the start of typing. Waiting for movement lets it be both — which is
       * what makes dragging from anywhere safe, and is why clicking into a box
       * no longer nudges it.
       */
      started: boolean;
    }
  | { mode: "resize"; id: RegionId; ox: number; oy: number; w: number; h: number }
  | { mode: "marquee"; page: number; x0: number; y0: number; x1: number; y1: number };

export function SheetEditor({
  docId,
  initial,
  savedText: openedText,
  path: openedPath,
  host,
  focused,
  visible,
  slots,
  prefs,
  onMeta,
  onNewSheet,
  onOpen,
}: SheetEditorProps) {
  const sheet = useSheet(initial);
  const [selection, setSelection] = useState<ReadonlySet<RegionId>>(new Set());
  const [editing, setEditing] = useState<RegionId | null>(null);
  const {
    panel,
    setPanel,
    openTabs,
    setOpenTabs,
    alignOn,
    setAlignOn,
    grid,
    setGrid,
    showGrid,
    setShowGrid,
    mathLive,
    setMathLive,
    dev,
    toggleDev,
    theme,
    setTheme,
  } = prefs;
  /** Alignment lines to draw while a region is being dragged. */
  const [guides, setGuides] = useState<{ page: number; lines: readonly Guide[] } | null>(null);
  /** What the values list is filtered by; empty shows every value. */
  const [symbolQuery, setSymbolQuery] = useState("");
  /**
   * Whether the full list of problems is open.
   *
   * The status bar has room for one. On a sheet with several, being told there
   * are four more without being able to see them is worse than not being told:
   * you know something is wrong and have to hunt for it.
   */
  const [problemsOpen, setProblemsOpen] = useState(false);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [unitPickerFor, setUnitPickerFor] = useState<RegionId | null>(null);
  /** A value in the list whose unit is being chosen. */
  const [listUnitFor, setListUnitFor] = useState<{ name: string; value: Value; anchor: HTMLElement } | null>(null);
  /** Character range selected inside the text region being edited. */
  const [textSel, setTextSel] = useState<TextSelection | null>(null);

  const dragRef = useRef<Drag | null>(null);
  const pageRefs = useRef(new Map<number, HTMLDivElement>());
  const regionRefs = useRef(new Map<RegionId, HTMLDivElement>());
  const panelBodyRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLElement>(null);

  /**
   * The worksheet cursor: where the next region goes.
   *
   * Stored as a document coordinate, the same space regions live in, so a page
   * break inserted above it carries it along instead of stranding it. It used
   * to be the last pointer position, which meant the insertion point was
   * invisible and moved whenever the mouse did.
   */
  const [cursor, setCursor] = useState<Position>({ x: 48, y: 120 });
  /** A region just inserted, whose height the cursor has yet to step over. */
  const advanceRef = useRef<{ id: RegionId; from: Position } | null>(null);

  const { layout } = sheet;
  const doc = sheet.sheet;
  /**
   * Where the sheet's contents start. A header or footer taller than its
   * margin takes room from them rather than being drawn over them.
   */
  const margins = useMemo(() => contentMargins(doc.page), [doc.page]);
  /** Editing the header and footer, with the sheet itself set aside. */
  const [bandEditing, setBandEditing] = useState(false);
  const [bandSelection, setBandSelection] = useState<BandSelection | null>(null);
  const startBandEditing = useCallback(() => {
    setEditing(null);
    setSelection(new Set());
    setBandEditing(true);
  }, []);
  const stopBandEditing = useCallback(() => {
    setBandEditing(false);
    setBandSelection(null);
  }, []);
  // A sheet sent behind another tab stops editing its header too.
  useEffect(() => {
    if (!visible) stopBandEditing();
  }, [visible, stopBandEditing]);
  /**
   * What the sheet was when it was last opened or saved. Unsaved is a
   * comparison with it rather than a count of edits, so undoing back to it
   * reads as saved again.
   */
  const [savedText, setSavedText] = useState<string | null>(() => contentOfText(openedText));
  const [path, setPath] = useState<string | null>(openedPath);
  const text = sheet.save();
  // Compared without the version stamp: saving records the version, and that
  // alone must not make a sheet look changed.
  const content = useMemo(() => contentOf(doc), [doc]);
  const dirty = content !== savedText;
  /** Saved by a newer jamCalc than this one: said once, and dismissable. */
  const [newerNotice, setNewerNotice] = useState(() =>
    isNewerVersion(initial.savedWith, VERSION) ? (initial.savedWith as string) : null,
  );
  const kept = useUnsavedCopy({ docId, text, dirty, title: doc.title, path });
  useEffect(() => {
    onMeta(docId, { title: doc.title, dirty, path });
  }, [onMeta, docId, doc.title, dirty, path]);

  // A sheet sent behind another tab stops editing. A field left live in a
  // sheet nobody can see is one nobody can finish, and it holds on to focus.
  useEffect(() => {
    if (!visible) setEditing(null);
  }, [visible]);
  const box = pageBox(doc.page);
  const staleCount = sheet.pending.size;
  const shownSymbols = sheet.symbols.filter((s) => matchesSymbol(s.name, symbolQuery));
  const searching = symbolQuery.trim() !== "";

  const tabs = (dev
    ? (["symbols", "text", "page"] as const)
    : (["symbols", "page"] as const)) as ReadonlyArray<"symbols" | "text" | "page">;
  const visibleTabs = tabs.filter((t) => openTabs.has(t));
  // The chosen tab, or whatever is left once it has been closed.
  const activeTab = visibleTabs.includes(panel) ? panel : visibleTabs[0];
  const openTab = (which: "symbols" | "text" | "page"): void => {
    setOpenTabs((cur) => new Set([...cur, which]));
    setPanel(which);
  };

  useEffect(() => {
    if (!dev && panel === "text") setPanel("symbols");
  }, [dev, panel]);

  /**
   * Keep the values list showing whatever is selected on the sheet.
   *
   * Only the panel scrolls. `scrollIntoView` would move every scrollable
   * ancestor, including the canvas, and pull the region just clicked out from
   * under the pointer. Runs on selection alone, not on recompute, so a list
   * scrolled away by hand stays put while typing.
   */
  useEffect(() => {
    if (panel !== "symbols") return;
    const list = panelBodyRef.current;
    const row = list?.querySelector<HTMLElement>("tr.on");
    if (!list || !row) return;
    const top = revealRow(list.getBoundingClientRect(), row.getBoundingClientRect(), list.scrollTop);
    if (top !== null) list.scrollTo({ top, behavior: "smooth" });
  }, [selection, panel, symbolQuery]);

  const only = selection.size === 1 ? [...selection][0] : undefined;
  const selectedRegion = doc.regions.find((r) => r.id === only);
  const traced = only ? new Set(sheet.trace(only)) : new Set<RegionId>();

  const select = useCallback((id: RegionId, additive: boolean) => {
    setSelection((cur) => {
      if (!additive) return new Set([id]);
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // --- pointer handling ----------------------------------------------------

  const startMove = useCallback(
    (e: React.PointerEvent, id: RegionId, started = true) => {
      e.stopPropagation();
      const additive = e.shiftKey || e.metaKey || e.ctrlKey;
      // Dragging a member of a multi-selection moves the whole group.
      const ids = selection.has(id) && !additive ? [...selection] : [id];
      if (!selection.has(id)) select(id, additive);
      const origin = new Map<RegionId, Position>();
      for (const r of doc.regions) if (ids.includes(r.id)) origin.set(r.id, r.position);
      const next: Drag = {
        mode: "move",
        anchor: id,
        ids,
        ox: e.clientX,
        oy: e.clientY,
        origin,
        started,
      };
      // An edge drag is a drag from the first instant and takes the pointer
      // now. A body drag is not one until it has travelled, and must not take
      // it yet: a captured pointer retargets the click that follows to the
      // capturing element, so the region's own "start editing" never fires and
      // a math box cannot be opened at all.
      if (started) {
        seizePointer(e.currentTarget as Element, e.pointerId);
        suppressSelection(true);
      }
      dragRef.current = next;
      setDrag(next);
    },
    [selection, select, doc.regions],
  );

  /**
   * Whether a press landed on something that handles its own pointer.
   *
   * Table cells, plot fields, the buttons on an image: pressing those is not
   * an attempt to move the region, and turning it into one would make them
   * unusable.
   */
  const isInteractive = (target: EventTarget | null): boolean =>
    target instanceof HTMLElement &&
    target.closest("input, textarea, select, button, [contenteditable='true']") !== null;

  const startResize = useCallback(
    (e: React.PointerEvent, id: RegionId) => {
      e.stopPropagation();
      e.preventDefault();
      const el = regionRefs.current.get(id);
      const region = doc.regions.find((r) => r.id === id);
      if (!el) return;
      const next: Drag = {
        mode: "resize",
        id,
        ox: e.clientX,
        oy: e.clientY,
        w: region?.size?.width ?? el.offsetWidth,
        h: region?.size?.height ?? el.offsetHeight,
      };
      seizePointer(e.currentTarget as Element, e.pointerId);
      suppressSelection(true);
      dragRef.current = next;
      setDrag(next);
    },
    [doc.regions],
  );

  const startMarquee = useCallback(
    (e: React.PointerEvent, pageIndex: number) => {
      if (e.button !== 0) return;
      const el = pageRefs.current.get(pageIndex);
      if (!el) return;
      const r = el.getBoundingClientRect();
      const x = e.clientX - r.left - margins.left;
      const y = e.clientY - r.top - margins.top;
      if (!(e.shiftKey || e.metaKey || e.ctrlKey)) setSelection(new Set());
      setEditing(null);
      const next: Drag = { mode: "marquee", page: pageIndex, x0: x, y0: y, x1: x, y1: y };
      seizePointer(e.currentTarget as Element, e.pointerId);
      suppressSelection(true);
      dragRef.current = next;
      setDrag(next);
    },
    [margins],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;

      if (d.mode === "resize") {
        sheet.resizeRegion(d.id, {
          width: Math.max(40, snap(d.w + (e.clientX - d.ox), grid)),
          height: Math.max(20, snap(d.h + (e.clientY - d.oy), grid)),
        } as Size);
        return;
      }

      if (d.mode === "marquee") {
        const el = pageRefs.current.get(d.page);
        if (!el) return;
        const r = el.getBoundingClientRect();
        const next: Drag = {
          ...d,
          x1: e.clientX - r.left - margins.left,
          y1: e.clientY - r.top - margins.top,
        };
        dragRef.current = next;
        setDrag(next);
        return;
      }

      // One delta applied to every selected region, so the group keeps its
      // shape and the whole drag collapses into a single undo step.
      const dx = e.clientX - d.ox;
      const dy = e.clientY - d.oy;
      if (!d.started) {
        // Still ambiguous: a press that has not travelled far enough is a
        // click, and moving the sheet under it would be the old complaint —
        // reaching in to type and nudging the box instead.
        if (Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) return;
        d.started = true;
        // Now it is a drag: take the pointer, and stop the page treating the
        // movement as a text sweep.
        seizePointer(e.currentTarget as Element, e.pointerId);
        suppressSelection(true);
      }
      // The region under the pointer decides where the group lands. Snapping
      // each one to its own neighbours would pull a multiple selection apart.
      const anchorStart = d.origin.get(d.anchor);
      const anchorPlace = layout.placement.get(d.anchor);
      let ox = dx;
      let oy = dy;
      let lines: { page: number; lines: readonly Guide[] } | null = null;

      // Alt is the way past it, for a position that deliberately lines up with
      // nothing.
      if (anchorStart && anchorPlace && alignOn && !e.altKey) {
        const el = regionRefs.current.get(d.anchor);
        const moving: Box = {
          x: anchorStart.x + dx,
          y: anchorStart.y + dy,
          w: el?.offsetWidth ?? 0,
          h: el?.offsetHeight ?? 0,
        };
        // The content area is one of the boxes, so lining up with the margin
        // or the middle of the page needs no special case.
        const others: Box[] = [
          { x: 0, y: 0, w: layout.contentWidth, h: layout.contentHeight },
        ];
        for (const r of doc.regions) {
          if (d.ids.includes(r.id)) continue;
          const p = layout.placement.get(r.id);
          if (!p || p.page !== anchorPlace.page) continue;
          const other = regionRefs.current.get(r.id);
          others.push({ x: p.x, y: p.y, w: other?.offsetWidth ?? 0, h: other?.offsetHeight ?? 0 });
        }
        const snapped = alignSnap(moving, others);
        ox = dx + (snapped.x - moving.x);
        oy = dy + (snapped.y - moving.y);
        if (snapped.guides.length > 0) lines = { page: anchorPlace.page, lines: snapped.guides };
      }
      setGuides(lines);

      const caughtX = lines?.lines.some((g) => g.axis === "x") ?? false;
      const caughtY = lines?.lines.some((g) => g.axis === "y") ?? false;
      const moves = new Map<RegionId, Position>();
      for (const id of d.ids) {
        const start = d.origin.get(id);
        if (!start) continue;
        // Where an edge has caught, that alignment is the position: rounding
        // it to the grid afterwards would put it back out by a pixel or two.
        moves.set(id, {
          x: Math.max(0, caughtX ? start.x + ox : snap(start.x + dx, grid)),
          y: Math.max(0, caughtY ? start.y + oy : snap(start.y + dy, grid)),
        });
      }
      sheet.moveRegions(moves, `move:${d.anchor}`);
    },
    [grid, sheet, margins, doc.regions, layout, alignOn],
  );

  const endDrag = useCallback(() => {
    const d = dragRef.current;
    if (d?.mode === "marquee") {
      const x0 = Math.min(d.x0, d.x1);
      const x1 = Math.max(d.x0, d.x1);
      const y0 = Math.min(d.y0, d.y1);
      const y1 = Math.max(d.y0, d.y1);
      if (x1 - x0 > 3 || y1 - y0 > 3) {
        const hits = doc.regions.filter((r) => {
          const p = layout.placement.get(r.id);
          if (!p || p.page !== d.page) return false;
          const el = regionRefs.current.get(r.id);
          const w = el?.offsetWidth ?? 0;
          const h = el?.offsetHeight ?? 0;
          // Intersection, not containment: requiring a region to be fully
          // enclosed makes wide equations nearly impossible to catch.
          return p.x < x1 && p.x + w > x0 && p.y < y1 && p.y + h > y0;
        });
        setSelection((cur) => new Set([...cur, ...hits.map((r) => r.id)]));
      } else {
        // Under the drag threshold this was a click on empty canvas, which is
        // how the cursor is placed. Same gesture, so nothing new to learn.
        setCursor(
          pointAt(
            layout,
            d.page,
            Math.max(0, snap(d.x0, grid)),
            Math.max(0, snap(d.y0, grid)),
          ),
        );
      }
    }
    dragRef.current = null;
    setDrag(null);
    setGuides(null);
    suppressSelection(false);
  }, [doc.regions, layout, grid]);

  const addAt = useCallback(
    (kind: "math" | "text" | "table" | "plot" | "image" | "pagebreak") => {
      const at = { x: snap(cursor.x, grid), y: snap(cursor.y, grid) };
      const id = sheet.addRegion(kind, at);
      setSelection(new Set([id]));
      // A table's cells are always editable, so there is no edit mode to enter.
      const opens = kind === "math" || kind === "text";
      if (opens) setEditing(id);

      // Step the cursor over what was just inserted, or two regions added in
      // a row land on top of each other. The height has to be measured, so
      // this is finished in the layout effect below, once the region has a
      // box. For a page break the same step is what carries the cursor to the
      // next page: a break pushes what is strictly below it, and this now is.
      advanceRef.current = { id, from: at };
    },
    [sheet, grid, cursor],
  );

  /**
   * Measure every region and hand the sizes to pagination.
   *
   * A layout effect, not requestAnimationFrame: rAF does not run while the
   * window is hidden, and a sheet that paginates differently in the background
   * would print differently from what was on screen.
   */
  useLayoutEffect(() => {
    // A sheet behind another tab is not drawn, and a region that is not drawn
    // measures as zero; paginating on that would move everything.
    if (!visible) return;
    const heights = new Map<RegionId, number>();
    const widths = new Map<RegionId, number>();
    for (const region of doc.regions) {
      const el = regionRefs.current.get(region.id);
      if (!el) continue;
      heights.set(region.id, el.offsetHeight);
      widths.set(region.id, el.offsetWidth);
    }

    /**
     * Table row heights, gathered from every piece at once.
     *
     * Once a table is split no single element holds all its rows, so measuring
     * one piece would shrink the table, which would change the split, which
     * would change the measurement. Every row appears in exactly one piece, so
     * reading them all covers the table exactly once and the answer is stable.
     */
    const tableRows = new Map<RegionId, { header: number; rows: number[] }>();
    // This sheet's regions only: ids repeat between sheets, and another open
    // sheet's table would otherwise be measured as this one's.
    for (const el of canvasRef.current?.querySelectorAll<HTMLElement>("[data-region]") ?? []) {
      const table = el.querySelector("table");
      if (!table) continue;
      const id = el.dataset["region"] as RegionId | undefined;
      if (!id) continue;
      const firstRow = Number(el.dataset["firstRow"] ?? 0);
      const entry = tableRows.get(id) ?? { header: 0, rows: [] };
      const head = table.querySelector("thead");
      if (head) entry.header = (head as HTMLElement).offsetHeight;
      const rows = table.querySelectorAll<HTMLElement>("tbody tr");
      rows.forEach((tr, i) => {
        entry.rows[firstRow + i] = tr.offsetHeight;
      });
      tableRows.set(id, entry);
    }
    // A table whose rows were not all seen this pass is left alone rather than
    // split on a partial measurement.
    for (const [id, entry] of [...tableRows]) {
      const region = doc.regions.find((r) => r.id === id);
      const expected = region?.kind === "table" ? region.cells.length : 0;
      if (entry.rows.length !== expected || entry.rows.some((h) => h === undefined)) {
        tableRows.delete(id);
      }
    }

    sheet.reportSizes(heights, widths, tableRows);
  });

  /**
   * A picture dropped onto the sheet.
   *
   * There is no button for it. Dropping the file is what everyone tries first,
   * and it says where the picture goes in the same gesture — which a button
   * cannot do.
   */
  const dropImage = useCallback(
    (file: File, at: Position) => {
      // Read first, then make the region: the picture arrives with it, in one
      // patch. Creating the region and filling it from the reader's callback
      // instead leaves the second patch naming a region the sheet it was made
      // against does not have, and it is refused without a word.
      const reader = new FileReader();
      reader.onload = () => {
        setSelection(new Set([sheet.addImage(String(reader.result), file.name, at)]));
      };
      reader.onerror = () => window.alert(`could not read ${file.name}`);
      reader.readAsDataURL(file);
    },
    [sheet],
  );

  /**
   * Finish the advance started by `addAt`.
   *
   * A layout effect, not requestAnimationFrame: rAF does not run while the
   * window is hidden or occluded, so adding a region with the app in the
   * background left the cursor where it was and the next insert landed on top
   * of the last one. This runs after every commit and costs a null check.
   */
  useLayoutEffect(() => {
    const pending = advanceRef.current;
    if (!pending) return;
    advanceRef.current = null;
    const height = regionRefs.current.get(pending.id)?.offsetHeight ?? 0;
    setCursor({
      x: pending.from.x,
      y: snap(pending.from.y + Math.max(height, MIN_ADVANCE) + 8, grid),
    });
  });

  // --- keyboard ------------------------------------------------------------

  useEffect(() => {
    // Several sheets may be open. Only the one being worked in answers keys,
    // or one press of M would add a region to every open sheet.
    if (!focused) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const typing =
        t?.tagName === "INPUT" || t?.tagName === "TEXTAREA" || t?.isContentEditable === true;

      // Editing the header and footer: the sheet's own shortcuts are off, and
      // Delete, the arrows and Esc act on the band instead.
      if (bandEditing) {
        if (typing) return;
        if (e.key === "Escape") {
          e.preventDefault();
          if (bandSelection) setBandSelection(null);
          else stopBandEditing();
          return;
        }
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
          e.preventDefault();
          if (e.shiftKey) sheet.redo();
          else sheet.undo();
          return;
        }
        const band = bandSelection ? doc.page[bandSelection.where] : undefined;
        if (!bandSelection || !band) return;
        if (e.key === "Delete" || e.key === "Backspace") {
          e.preventDefault();
          sheet.setBand(bandSelection.where, removeItem(band, bandSelection.id));
          setBandSelection(null);
          return;
        }
        const step = e.shiftKey ? 10 : 1;
        const nudge: Record<string, [number, number]> = {
          ArrowLeft: [-step, 0],
          ArrowRight: [step, 0],
          ArrowUp: [0, -step],
          ArrowDown: [0, step],
        };
        const d = nudge[e.key];
        if (d) {
          e.preventDefault();
          const bounds = {
            width: box.width,
            height: bandSelection.where === "header" ? margins.top : margins.bottom,
          };
          sheet.setBand(
            bandSelection.where,
            moveItem(band, bandSelection.id, d[0], d[1], bounds),
            `band-nudge-${bandSelection.id}`,
          );
        }
        return;
      }

      if (e.key === "Escape") {
        setEditing(null);
        setProblemsOpen(false);
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        setEditing(null);
        if (e.shiftKey) sheet.redo();
        else sheet.undo();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") {
        e.preventDefault();
        setEditing(null);
        sheet.redo();
        return;
      }
      if (e.key === "F9") {
        e.preventDefault();
        sheet.calculateNow();
        return;
      }

      // Single-letter shortcuts must never fire while typing, or `m` becomes
      // impossible to write inside a text region.
      if (typing || e.ctrlKey || e.metaKey || e.altKey) return;

      // The same list the Insert menu shows. A key here and a label there
      // that disagree is worse than no shortcut at all.
      const INSERTS: Record<string, "math" | "text" | "table" | "plot" | "pagebreak"> = {
        m: "math",
        t: "text",
        d: "table",
        p: "plot",
        b: "pagebreak",
      };
      const kind = INSERTS[e.key];
      if (kind) {
        e.preventDefault();
        addAt(kind);
        return;
      }
      if ((e.key === "Delete" || e.key === "Backspace") && selection.size > 0) {
        e.preventDefault();
        sheet.removeRegions(selection);
        setSelection(new Set());
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sheet, selection, addAt, focused, bandEditing, bandSelection, doc.page, box.width, margins, stopBandEditing]);

  const printSheet = useCallback(() => {
    if (
      staleCount > 0 &&
      !window.confirm(
        `${staleCount} value${staleCount === 1 ? "" : "s"} on this sheet have not been recalculated.\n\nPrint anyway?`,
      )
    ) {
      return;
    }
    printThroughHost();
  }, [staleCount]);

  /**
   * PDF export gets the same staleness guard as printing, not a weaker one:
   * a PDF is more likely to be emailed onward than a print is.
   */
  const exportPdf = useCallback(() => {
    if (
      staleCount > 0 &&
      !window.confirm(
        `${staleCount} value${staleCount === 1 ? "" : "s"} on this sheet have not been recalculated.

Export anyway?`,
      )
    ) {
      return;
    }
    void exportPdfThroughHost(path);
  }, [staleCount, path]);


  /**
   * Saves: to the sheet's own file on desktop — asking where the first time,
   * or always for Save As — and as a download in a browser.
   */
  const saveSheet = useCallback(
    async (as = false): Promise<boolean> => {
      // The file records the version that saved it (ADR-0016).
      const current = serializeSheet(VERSION ? { ...doc, savedWith: VERSION } : doc);
      const bridge = window.desktop;
      if (bridge?.present) {
        let target: string | null = null;
        try {
          // The shell writes only to a file the user has chosen. One it will
          // not write to is asked about again, the same as a first save.
          if (!as && path && (await bridge.save?.(path, current))) target = path;
          else target = (await bridge.saveAs?.(`${fileName(doc.title)}.jc`, current)) ?? null;
        } catch (e) {
          window.alert(`The sheet was not saved.\n\n${(e as Error).message}`);
          return false;
        }
        if (!target) return false;
        setPath(target);
      } else {
        const blob = new Blob([current], { type: "application/json" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = `${fileName(doc.title)}.jc`;
        a.click();
        URL.revokeObjectURL(a.href);
        rememberRecent(doc.title, current);
      }
      sheet.stampSaved(VERSION);
      setSavedText(contentOf(doc));
      return true;
    },
    [sheet, path, doc],
  );
  const saveNow = useCallback(() => void saveSheet(), [saveSheet]);
  const saveAsNow = useCallback(() => void saveSheet(true), [saveSheet]);

  // The desktop shell's menu bar drives the same handlers the toolbar does,
  // so there is one definition of what Print or Undo means. Only the sheet
  // being worked in answers: every open sheet answering Print would print
  // them all.
  useDesktopMenu(
    {
      print: printSheet,
      exportPdf,
      undo: sheet.undo,
      redo: sheet.redo,
      recalculate: sheet.calculateNow,
      save: saveNow,
      saveAs: saveAsNow,
    },
    focused,
  );

  /**
   * Print, save and open from the keyboard, in a browser.
   *
   * In a tab these keys belong to the browser, which would print the sheet
   * without asking about values that have not been recalculated (ADR-0006) and
   * save the web page itself rather than the sheet. So the app takes them. The
   * desktop app gets the same keys from its menu, which already routes them
   * through the same handlers — taking them here too would do everything twice.
   */
  useEffect(() => {
    if (inDesktop() || !focused) return;
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey) return;
      const key = e.key.toLowerCase();
      if (key === "p") {
        e.preventDefault();
        printSheet();
      } else if (key === "s") {
        e.preventDefault();
        void saveSheet();
      } else if (key === "o") {
        e.preventDefault();
        onOpen();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [printSheet, saveSheet, onOpen, focused]);

  /**
   * The last highlighted range, kept after the highlight itself is gone.
   *
   * A control that takes focus collapses the selection in the contentEditable
   * before its own handler runs. The colour swatches and the B and I buttons
   * dodge that by cancelling mousedown, but a `<select>` cannot: cancelling
   * mousedown stops the dropdown from opening. So the size control read an
   * empty selection and styled the whole box — which is exactly the bug the
   * range formatting was built to fix, reappearing through the one control
   * that could not use the trick.
   *
   * Remembering the range works for any control that steals focus, which is
   * why it replaces the trick rather than joining it.
   */
  const lastRange = useRef<{ id: RegionId; start: number; end: number } | null>(null);
  lastRange.current = rememberRange(editing, textSel, lastRange.current);

  /**
   * The range the format bar acts on: the live highlight, or the one that was
   * live a moment ago in the region still being edited.
   *
   * The rules are in `formatTarget.ts` and tested there. They were wrong once
   * in a way nothing caught: a control that takes focus collapses the
   * highlight before its handler runs, and the size then applied to the whole
   * region.
   */
  const activeRange = formatTarget(editing, textSel, lastRange.current);

  const rangeTarget = activeRange?.id ?? null;

  const setStyle = useCallback(
    (patch: StylePatch) => {
      if (activeRange) {
        sheet.styleTextRange(activeRange.id, activeRange.start, activeRange.end, patch);
        return;
      }
      if (selection.size > 0) sheet.styleRegions(selection, patch);
    },
    [activeRange, selection, sheet],
  );

  /** What the toolbar should show as current. */
  const activeStyle: RegionStyle =
    activeRange
      ? styleOfRange(
          (doc.regions.find((r) => r.id === activeRange.id) as { runs?: readonly TextRun[] })?.runs ?? [],
          activeRange.start,
          activeRange.end,
        )
      : (selectedRegion?.style ?? {});

  const unitTarget = (() => {
    if (only === undefined) return null;
    const result = sheet.results.get(only);
    if (!result || result.status !== "ok" || result.isFunction) return null;
    return result;
  })();

  /**
   * Which property controls are worth showing.
   *
   * The rules are in `formatControls.ts` and tested there. A control that
   * cannot act on what is selected is not disabled, it is absent: a bar with
   * half its controls permanently greyed out is one people stop reading.
   */
  const controls = formatControls(
    activeRange
      ? [(doc.regions.find((r) => r.id === activeRange.id)?.kind ?? "text") as Kind]
      : [...selection].flatMap((id) => {
          const kind = doc.regions.find((r) => r.id === id)?.kind;
          return kind ? [kind as Kind] : [];
        }),
    activeRange !== null,
    only !== undefined && unitTarget !== null,
  );

  /** The text regions alignment would act on. */
  const alignTargets = activeRange ? [activeRange.id] : [...selection];
  const currentAlign =
    doc.regions.find((r) => r.id === alignTargets[0] && r.kind === "text")?.kind === "text"
      ? ((doc.regions.find((r) => r.id === alignTargets[0]) as { align?: string }).align ??
        "left")
      : "left";

  const canFormat = rangeTarget !== null || selection.size > 0;

  /** Decimals shown in the toolbar for the current selection. */
  const formatChoice = (() => {
    const region = doc.regions.find((r) => r.id === only);
    const f = resolveFormat(region?.format, doc.format);
    return f?.decimals === undefined ? "auto" : String(f.decimals);
  })();

  /** The result whose unit the picker would change. */

  const problems = sheet.order
    .map((id) => ({ id, result: sheet.results.get(id) }))
    .filter((p) => p.result && p.result.status !== "ok");
  const shownProblem = problems.find((p) => selection.has(p.id)) ?? problems[0];

  /**
   * A short look at what a region holds, to tell one problem from another.
   *
   * Two regions can fail with the same sentence — ``L` is not defined` twice over
   * says nothing about which line to go and look at.
   */
  const sourceOf = (id: RegionId): string => {
    const region = doc.regions.find((r) => r.id === id);
    if (!region) return "";
    const text =
      region.kind === "math"
        ? region.source
        : region.kind === "text"
          ? plainText(region.runs)
          : region.kind;
    return text.length > 40 ? `${text.slice(0, 40)}…` : text;
  };

  /** Selects a region and brings it into view. */
  const revealRegion = useCallback((id: RegionId) => {
    setSelection(new Set([id]));
    setEditing(null);
    regionRefs.current.get(id)?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, []);

  /** The error code is a machine label; users get the sentence only. */
  const problemText = (result: RegionResult | undefined): string => {
    if (!result) return "";
    if (result.status === "error") {
      if (!dev) return result.error.message;
      const detail = result.error.detail ? ` (${result.error.detail})` : "";
      return `${result.error.code}: ${result.error.message}${detail}`;
    }
    if (result.status === "blocked") {
      return dev
        ? `blocked: \`${result.missing}\` unavailable from ${result.because}`
        : `waiting on \`${result.missing}\`, which could not be calculated`;
    }
    return "";
  };

  const bandFields = useMemo(
    (): Omit<PageFields, "page"> => ({
      title: doc.title,
      titleBlock: doc.titleBlock,
      pages: layout.pageCount,
      printed: new Date(),
      ...(doc.page.firstSheet !== undefined ? { firstSheet: doc.page.firstSheet } : {}),
      ...(doc.page.totalSheets !== undefined ? { totalSheets: doc.page.totalSheets } : {}),
      ...(VERSION ? { version: VERSION } : {}),
      ...(doc.savedWith !== undefined ? { savedWith: doc.savedWith } : {}),
      ...(path ? { file: path.split(/[\\/]/).pop() as string } : {}),
    }),
    [doc.title, doc.titleBlock, doc.page.firstSheet, doc.page.totalSheets, doc.savedWith, layout.pageCount, path],
  );

  /**
   * The unit a name is listed in: the one chosen for it in the list, else the
   * one its definition asks for or was written in (`65 psf`), else none — and
   * then the list picks one that suits the size of the number.
   */
  const listUnit = useCallback(
    (name: string, definedIn: RegionId): string | undefined => {
      const chosen = doc.valueUnits?.[name];
      if (chosen) return chosen;
      const region = doc.regions.find((r) => r.id === definedIn);
      if (region?.kind === "math") return writtenUnitOf(region.source);
      if (region?.kind === "table") return region.columns.find((c) => c.name === name)?.unit || undefined;
      return undefined;
    },
    [doc.valueUnits, doc.regions],
  );

  /** A typed field's value, set from the header: the title is the sheet's own. */
  const setFieldValue = useCallback(
    (field: FieldName, value: string) => {
      if (field === "title") sheet.setTitle(value || "Untitled");
      else sheet.setTitleBlock({ [field]: value });
    },
    [sheet],
  );

  const addToBand = useCallback(
    (what: NewItem) => {
      const where = bandSelection?.where ?? "header";
      const band = doc.page[where];
      const bounds = {
        width: box.width,
        height: where === "header" ? margins.top : margins.bottom,
      };
      const added = addItem(band, what, nextFreeSpot(band, margins.left, bounds), bounds);
      sheet.setBand(where, added.band);
      setBandSelection({ where, id: added.id });
    },
    [bandSelection, doc.page, box.width, margins, sheet],
  );


  // The cursor can sit past the last region — press M at the foot of a full
  // page and the next one has to exist to draw it on.
  const cursorAt = placePoint(layout, cursor);

  /**
   * How far past the paper anything sits.
   *
   * The canvas is a working area, not the sheet: regions may be parked to the
   * right of the page. Absolutely positioned children do not extend their
   * container, so the page carries a margin wide enough to scroll to them.
   */
  const overhang = Math.max(
    0,
    ...doc.regions.map(
      (r) => r.position.x + (r.size?.width ?? 0) - layout.contentWidth,
    ),
  );

  /** Regions that will not appear on paper. */
  const offSheet = doc.regions.filter(
    (r) => layout.placement.get(r.id)?.printable === false,
  ).length;

  /**
   * Regions taller than a page, which run off the bottom whatever is done.
   * Reported rather than hidden: the alternative is a printed sheet quietly
   * missing its last rows.
   */
  const tooTall = doc.regions.filter(
    (r) => layout.placement.get(r.id)?.overflows === true,
  ).length;
  const pages = Array.from(
    { length: Math.max(layout.pageCount, cursorAt.page + 1) },
    (_, i) => i,
  );

  // The window's shared furniture belongs to the sheet being worked in.
  const chrome = focused && visible ? slots : null;

  return (
    <>
      {chrome
        ? createPortal(
            <>
              {/*
                `@page` cannot be set from an element's inline style, and the paper is
                no longer fixed — a sheet set to A4 landscape printed onto a hardcoded
                letter-portrait page would be silently cropped. This keeps the printed
                sheet the same size as the one on screen.
              */}
              <style>{`@page { size: ${doc.page.size} ${doc.page.orientation}; margin: 0; }`}</style>
              <header className="toolbar">
                <input className="title" value={doc.title} onChange={(e) => sheet.setTitle(e.target.value)} />
                <span className={`autosave ${kept.note ? "warn" : ""}`} title={kept.note ?? undefined}>
                  {kept.note ? "unsaved — no copy kept" : dirty ? "unsaved changes" : path ? "saved" : ""}
                </span>
                <div className="spacer" />
                <button disabled={!sheet.canUndo} onClick={sheet.undo} title="Undo (Ctrl+Z)">↶</button>
                <button disabled={!sheet.canRedo} onClick={sheet.redo} title="Redo (Ctrl+Shift+Z)">↷</button>
                <span className="divider" />
                {/* Everything that goes on a sheet, in one place, each with the key
                    that does the same thing. A shortcut spelled out somewhere else is
                    a shortcut nobody finds. */}
                <MenuButton label="Insert" title="insert a region">
                  {(close) => (
                    <>
                      <button onClick={() => { addAt("math"); close(); }}>
                        Math <kbd>M</kbd>
                      </button>
                      <button onClick={() => { addAt("text"); close(); }}>
                        Text <kbd>T</kbd>
                      </button>
                      <button onClick={() => { addAt("table"); close(); }}>
                        Data table <kbd>D</kbd>
                      </button>
                      <button onClick={() => { addAt("plot"); close(); }}>
                        Plot <kbd>P</kbd>
                      </button>
                      <button onClick={() => { addAt("pagebreak"); close(); }}>
                        Page break <kbd>B</kbd>
                      </button>
                    </>
                  )}
                </MenuButton>
                <button
                  disabled={selection.size === 0}
                  onClick={() => {
                    sheet.removeRegions(selection);
                    setSelection(new Set());
                  }}
                >
                  Delete{selection.size > 1 ? ` (${selection.size})` : ""}
                </button>
                <span className="divider" />
                <select
                  className="calc-mode"
                  value={sheet.autoCalc ? "auto" : "manual"}
                  onChange={(e) => sheet.setAuto(e.target.value === "auto")}
                >
                  <option value="auto">Auto calc</option>
                  <option value="manual">Manual calc</option>
                </select>
                <button
                  className={staleCount > 0 ? "calc-now urgent" : "calc-now"}
                  disabled={staleCount === 0}
                  onClick={sheet.calculateNow}
                  title="Recalculate (F9)"
                >
                  {staleCount > 0 ? `Calculate (${staleCount})` : "Calculate"}
                </button>
                <span className="divider" />
                <MenuButton label="Options" title="panels, snap, grid and editor options">
                  {(close) => (
                    <>
                      <button onClick={() => { openTab("symbols"); close(); }}>Values panel</button>
                      <button onClick={() => { openTab("page"); close(); }}>Page setup</button>
                      <button onClick={() => { close(); startBandEditing(); }}>Header and footer</button>
                      <span className="menu-rule" />
                      <label className="menu-row">
                        <span>Snap</span>
                        <select value={grid} onChange={(e) => setGrid(Number(e.target.value))}>
                          {SNAP_STEPS.map((g) => (
                            <option key={g} value={g}>{g === 0 ? "off" : `${g} px`}</option>
                          ))}
                        </select>
                      </label>
                      <label className="menu-row check">
                        <input
                          type="checkbox"
                          checked={showGrid}
                          onChange={(e) => setShowGrid(e.target.checked)}
                        />
                        <span>Show grid</span>
                      </label>
                      <label className="menu-row check" title="line regions up with each other as they are dragged">
                        <input
                          type="checkbox"
                          checked={alignOn}
                          onChange={(e) => setAlignOn(e.target.checked)}
                        />
                        <span>Snap to objects</span>
                      </label>
                      <span className="menu-rule" />
                      <label
                        className="menu-row check"
                        title="dark surroundings; the page itself stays white, as it prints"
                      >
                        <input
                          type="checkbox"
                          checked={theme === "dark"}
                          onChange={(e) => setTheme(e.target.checked ? "dark" : "light")}
                        />
                        <span>Dark theme</span>
                      </label>
                      {/* The plain-text editor is deprecated and on its way out. It
                          stays reachable in developer mode as a way out if the
                          structured editor ever misbehaves on a real sheet. */}
                      {dev ? (
                        <label
                          className="menu-row check"
                          title="fall back to the plain-text editor (deprecated, for diagnosis only)"
                        >
                          <input
                            type="checkbox"
                            checked={mathLive}
                            onChange={(e) => setMathLive(e.target.checked)}
                          />
                          <span>2-D math editor</span>
                        </label>
                      ) : null}
                    </>
                  )}
                </MenuButton>
                <MenuButton label="File" title="new, open and save">
                  {(close) => (
                    <>
                      <button onClick={() => { close(); onNewSheet(); }}>New sheet</button>
                      <button onClick={() => { close(); onOpen(); }}>Open…</button>
                      <button onClick={() => { close(); void saveSheet(); }}>Save</button>
                      {inDesktop() ? (
                        <button onClick={() => { close(); void saveSheet(true); }}>Save as…</button>
                      ) : null}
                      <button onClick={() => { close(); printSheet(); }}>Print…</button>
                    </>
                  )}
                </MenuButton>
              </header>

              {/* Contextual. With nothing selected there is nothing to say, and a bar
                  whose only content is an instruction to select something is noise on
                  every sheet that is being read rather than edited. */}
              {bandEditing ? (
                <BandBar
                  page={doc.page}
                  selected={bandSelection}
                  onBand={(where, band, tag) => sheet.setBand(where, band, tag)}
                  onSelect={setBandSelection}
                  onAdd={addToBand}
                  onDone={stopBandEditing}
                  onApply={(t) => {
                    sheet.setBands(t.header ?? null, t.footer ?? null);
                    setBandSelection(null);
                  }}
                />
              ) : controls.none && selection.size === 0 && activeRange === null ? null : (
              <div className="format">
                {controls.none ? (
                  <span className="label muted">nothing to format here</span>
                ) : (
                  <span className="label">Format</span>
                )}

                {controls.size ? (
                  <select
                    value={activeStyle.fontSize ?? selectedRegion?.style?.fontSize ?? 13}
                    onChange={(e) => setStyle({ fontSize: Number(e.target.value) })}
                    title="font size"
                  >
                    {[10, 11, 12, 13, 14, 16, 18, 20, 24, 28].map((s) => (
                      <option key={s} value={s}>{s} pt</option>
                    ))}
                  </select>
                ) : null}

                {controls.colour ? (
                  <ColourRow
                    {...(controls.resultColour ? { label: "Equation" } : {})}
                    value={activeStyle.color}
                    onPick={(c) => setStyle({ color: c })}
                  />
                ) : null}
                {controls.resultColour ? (
                  <ColourRow
                    label="Result"
                    value={activeStyle.resultColor}
                    onPick={(c) => setStyle({ resultColor: c })}
                  />
                ) : null}

                {controls.weight ? (
                  <>
                    <button
                      onMouseDown={(e) => e.preventDefault()}
                      className={`toggle ${activeStyle.bold ? "on" : ""}`}
                      onClick={() => setStyle({ bold: !activeStyle.bold })}
                      title="bold"
                    >
                      <b>B</b>
                    </button>
                    <button
                      onMouseDown={(e) => e.preventDefault()}
                      className={`toggle ${activeStyle.italic ? "on" : ""}`}
                      onClick={() => setStyle({ italic: !activeStyle.italic })}
                      title="italic"
                    >
                      <i>I</i>
                    </button>
                  </>
                ) : null}

                {controls.align ? (
                  <>
                    <span className="divider" />
                    {ALIGNMENTS.map(({ value, label }) => (
                      <button
                        key={value}
                        onMouseDown={(e) => e.preventDefault()}
                        className={`toggle align ${currentAlign === value ? "on" : ""}`}
                        onClick={() => sheet.setAlign(alignTargets, value === "left" ? null : value)}
                        title={label}
                      >
                        <AlignIcon align={value} />
                      </button>
                    ))}
                  </>
                ) : null}

                {controls.decimals ? (
                  <>
                    <span className="divider" />
                    <span className="label">Decimals</span>
                    <select
                      value={formatChoice}
                      onChange={(e) => {
                        const v = e.target.value;
                        sheet.setRegionFormat(
                          selection,
                          v === "auto" ? { decimals: undefined } : { decimals: Number(v) },
                        );
                      }}
                    >
                      <option value="auto">auto</option>
                      {[0, 1, 2, 3, 4, 5].map((d) => (
                        <option key={d} value={d}>{d}</option>
                      ))}
                    </select>
                  </>
                ) : null}

                {controls.units ? (
                  <button
                    onClick={() => only && setUnitPickerFor(only)}
                    title="choose the unit this result is shown in"
                  >
                    Units…
                  </button>
                ) : null}

                <div className="spacer" />
                <span className="hint">
                  {/* Read from `activeRange`, not the live selection: they used to be
                      the same thing, and a `textSel!` here crashed the whole app the
                      moment a remembered range outlived its highlight. */}
                  {activeRange
                    ? `formatting ${activeRange.end - activeRange.start} characters`
                    : selection.size > 1
                      ? `${selection.size} selected`
                      : "drag an edge to move"}
                </span>
              </div>
              )}
            </>,
            chrome.top,
          )
        : null}

      {/* The pages go in the pane showing this sheet. The editor itself
          stays where it is, so moving the tab to another pane keeps
          its undo history and everything unsaved. */}
      {host
        ? createPortal(
            <main className="canvas" ref={canvasRef} hidden={!visible}>
              {newerNotice ? (
                <div className="sheet-notice" role="status">
                  <span>
                    This sheet was saved by jamCalc {newerNotice}, which is newer than this one
                    ({VERSION}). Anything that version added which this one does not know about will
                    be lost if the sheet is saved here.
                  </span>
                  <button onClick={() => setNewerNotice(null)}>OK</button>
                </div>
              ) : null}
              {pages.map((pageIndex) => (
                <div
                  key={pageIndex}
                  ref={(el) => {
                    if (el) pageRefs.current.set(pageIndex, el);
                  }}
                  className={`page ${pageIndex >= layout.pageCount ? "is-cursor-only" : ""} ${
                    bandEditing ? "is-editing-bands" : ""
                  }`}
                  style={{ width: box.width, height: box.height, marginRight: overhang }}
                  onPointerMove={onPointerMove}
                  onPointerUp={endDrag}
                  onPointerCancel={endDrag}
                >
                  {/* A page holding nothing but the cursor is not part of the
                      document yet: it has no number, and it must not print. It
                      becomes real the moment something is put on it. */}
                  {pageIndex < layout.pageCount ? (
                    <>
                      <PageBands
                        page={doc.page}
                        paper={box}
                        fields={{ ...bandFields, page: pageIndex + 1 }}
                        editing={bandEditing}
                        selected={bandSelection}
                        onSelect={setBandSelection}
                        onBand={(where, band, tag) => sheet.setBand(where, band, tag)}
                        onValue={setFieldValue}
                        onStartEditing={startBandEditing}
                      />
                    </>
                  ) : null}

                  <div
                    className={`content ${showGrid && grid > 0 ? "show-grid" : ""}`}
                    style={
                      {
                        left: margins.left,
                        top: margins.top,
                        width: layout.contentWidth,
                        height: layout.contentHeight,
                        "--grid": `${grid}px`,
                      } as React.CSSProperties
                    }
                    onPointerDown={(e) => {
                      // The sheet is set aside while its header is edited;
                      // clicking it is the way back.
                      if (bandEditing) {
                        stopBandEditing();
                        return;
                      }
                      if (e.target === e.currentTarget) startMarquee(e, pageIndex);
                    }}
                    onDragOver={(e) => {
                      if (![...e.dataTransfer.items].some((i) => i.kind === "file")) return;
                      e.preventDefault();
                      e.dataTransfer.dropEffect = "copy";
                    }}
                    onDrop={(e) => {
                      const file = [...e.dataTransfer.files].find((f) =>
                        f.type.startsWith("image/"),
                      );
                      if (!file) return;
                      e.preventDefault();
                      const box = e.currentTarget.getBoundingClientRect();
                      dropImage(
                        file,
                        pointAt(
                          layout,
                          pageIndex,
                          Math.max(0, snap(e.clientX - box.left, grid)),
                          Math.max(0, snap(e.clientY - box.top, grid)),
                        ),
                      );
                    }}
                  >
                    {guides && guides.page === pageIndex
                      ? guides.lines.map((g, i) => (
                          <span
                            key={i}
                            className={`guide guide-${g.axis}`}
                            style={
                              g.axis === "x"
                                ? { left: g.at, top: g.from, height: g.to - g.from }
                                : { top: g.at, left: g.from, width: g.to - g.from }
                            }
                          />
                        ))
                      : null}

                    {doc.regions.map((region) => {
                      const place = layout.placement.get(region.id);
                      if (!place) return null;
                      // A table too tall for a page draws once per piece, each on
                      // its own page and each repeating the heading.
                      const piece = place.fragments?.find((f) => f.page === pageIndex);
                      if (place.fragments ? !piece : place.page !== pageIndex) return null;
                      const top = piece ? piece.y : place.y;
                      const isFirstPiece = !piece || piece === place.fragments?.[0];
                      const result = sheet.results.get(region.id);
                      const status = result?.status ?? "ok";
                      const style = region.style ?? {};
                      const numberFormat = resolveFormat(region.format, doc.format);

                      if (region.kind === "pagebreak") {
                        return (
                          <div
                            key={region.id}
                            ref={(el) => {
                              if (el) regionRefs.current.set(region.id, el);
                            }}
                            className={`pagebreak ${selection.has(region.id) ? "is-selected" : ""}`}
                            style={{ top: place.y, width: layout.contentWidth }}
                            onClick={(e) => {
                              e.stopPropagation();
                              select(region.id, e.shiftKey);
                            }}
                          >
                            <span className="handle" onPointerDown={(e) => startMove(e, region.id)} />
                            <span className="label">page break</span>
                          </div>
                        );
                      }

                      return (
                        <div
                          key={region.id}
                          ref={(el) => {
                            // The first piece is the region for anything that
                            // scrolls to it or measures it as a whole.
                            if (el && isFirstPiece) regionRefs.current.set(region.id, el);
                          }}
                          data-region={region.id}
                          data-first-row={piece ? piece.firstRow : 0}
                          className={[
                            "region",
                            `is-${region.kind}`,
                            region.kind === "math"
                              ? region.source.length === 0
                                ? "is-empty"
                                : ""
                              : region.kind === "text" && region.runs.length === 0
                                ? "is-empty"
                                : "",
                            selection.has(region.id) ? "is-selected" : "",
                            traced.has(region.id) ? "is-traced" : "",
                            place.printable ? "" : "is-offsheet",
                            place.overflows ? "is-overflowing" : "",
                            status === "error" ? "is-error" : "",
                            status === "blocked" ? "is-blocked" : "",
                            sheet.pending.has(region.id) ? "is-stale" : "",
                          ]
                            .filter(Boolean)
                            .join(" ")}
                          style={{
                            left: place.x,
                            top,
                            ...(region.size
                              ? {
                                  width: region.size.width,
                                  ...(region.size.height ? { minHeight: region.size.height } : {}),
                                }
                              : {}),
                            fontSize: `${style.fontSize ?? 13}px`,
                            color: style.color ?? "inherit",
                            // The equation's colour reaches its units too, which
                            // are otherwise grey; the result's covers its number
                            // and unit. Unset, both fall back to the defaults.
                            ...(style.color ? { "--unit-color": style.color } : {}),
                            ...(style.resultColor
                              ? { "--result-color": style.resultColor, "--result-unit-color": style.resultColor }
                              : {}),
                            fontWeight: (style.bold ?? region.kind === "text") ? 600 : 400,
                            fontStyle: style.italic ? "italic" : "normal",
                          }}
                          onPointerDown={(e) => {
                            // Anywhere on the region is a handle, so long as the
                            // press is not meant for something inside it and the
                            // region is not being typed into.
                            if (e.button !== 0) return;
                            if (editing === region.id) return;
                            if (isInteractive(e.target)) return;
                            startMove(e, region.id, false);
                          }}
                          onClick={(e) => {
                            e.stopPropagation();
                            select(region.id, e.shiftKey || e.metaKey || e.ctrlKey);
                          }}
                        >
                          {/* The edge is the handle: a band along each side that
                              moves the region from the first instant, even while
                              it is being edited, and never covers the content a
                              click opens for editing. */}
                          {(["top", "right", "bottom", "left"] as const).map((side) => (
                            <span
                              key={side}
                              className={`edge edge-${side}`}
                              title={dev ? `${region.id} — drag to move` : "drag to move"}
                              onPointerDown={(e) => {
                                if (e.button !== 0) return;
                                startMove(e, region.id);
                              }}
                            />
                          ))}
                          {region.kind === "text" ? (
                            <TextRegionBody
                              {...(region.align ? { align: region.align } : {})}
                              // Displayed with references resolved; edited as
                              // written, so the link is never silently replaced by
                              // the number it happened to show.
                              runs={
                                editing === region.id
                                  ? region.runs
                                  : sheet.runs.get(region.id) ?? region.runs
                              }
                              editing={editing === region.id}
                              onChange={(runs) => sheet.editText(region.id, runs)}
                              onSelectionChange={setTextSel}
                              onDone={() => setEditing(null)}
                              onStartEdit={() => setEditing(region.id)}
                            />
                          ) : region.kind === "image" ? (
                            <ImageRegionBody
                              src={region.src}
                              {...(region.alt !== undefined ? { alt: region.alt } : {})}
                              {...(region.size?.width ? { width: region.size.width } : {})}
                              {...(region.size?.height ? { height: region.size.height } : {})}
                              onChange={(src, alt) => sheet.editImage(region.id, src, alt)}
                            />
                          ) : region.kind === "plot" ? (
                            <PlotRegionBody
                              {...(sheet.plots.get(region.id)
                                ? { model: sheet.plots.get(region.id)! }
                                : {})}
                              series={region.series}
                              width={region.size?.width ?? 320}
                              height={region.size?.height ?? 200}
                              {...(region.style ? { style: region.style } : {})}
                              problemText={
                                result?.status === "error"
                                  ? result.error.message
                                  : result?.status === "blocked"
                                    ? `waiting on ${result.because}`
                                    : ""
                              }
                              onChange={(next) => sheet.editPlot(region.id, next)}
                            />
                          ) : region.kind === "table" ? (
                            <TableRegionBody
                              columns={region.columns}
                              cells={region.cells}
                              {...(piece
                                ? {
                                    firstRow: piece.firstRow,
                                    endRow: piece.endRow,
                                    editable: isFirstPiece,
                                  }
                                : {})}
                              {...(region.style ? { style: region.style } : {})}
                              problemText={
                                result?.status === "error" ? result.error.message : ""
                              }
                              onChange={(columns, cells) =>
                                sheet.editTable(region.id, columns, cells)
                              }
                            />
                          ) : mathLive && editing === region.id ? (
                            <MathLiveField
                              source={region.source}
                              {...(region.style?.fontSize
                                ? { fontSize: region.style.fontSize }
                                : {})}
                              onChange={(v) => sheet.editRegion(region.id, v)}
                              onDone={() => setEditing(null)}
                            />
                          ) : (
                            <RegionBody
                              region={region}
                              resultParts={formatResultParts(result, numberFormat)}
                              showResult={result?.status === "ok" && result.showResult === true}
                              problemText={status === "ok" ? "" : formatResult(result)}
                              onPickUnit={() => setUnitPickerFor(region.id)}
                              editing={editing === region.id}
                              onEdit={(v) => sheet.editRegion(region.id, v)}
                              onDone={() => setEditing(null)}
                              onStartEdit={() => setEditing(region.id)}
                            />
                          )}
                          {selection.size === 1 && selection.has(region.id) ? (
                            <span
                              className="resize"
                              onClick={(e) => e.stopPropagation()}
                              onPointerDown={(e) => startResize(e, region.id)}
                            />
                          ) : null}
                        </div>
                      );
                    })}

                    {cursorAt.page === pageIndex ? (
                      <div
                        className="worksheet-cursor"
                        style={{ left: cursorAt.x, top: cursorAt.y }}
                        aria-hidden="true"
                      />
                    ) : null}

                    {drag?.mode === "marquee" && drag.page === pageIndex ? (
                      <div
                        className="marquee"
                        style={{
                          left: Math.min(drag.x0, drag.x1),
                          top: Math.min(drag.y0, drag.y1),
                          width: Math.abs(drag.x1 - drag.x0),
                          height: Math.abs(drag.y1 - drag.y0),
                        }}
                      />
                    ) : null}
                  </div>
                </div>
              ))}
            </main>,
            host,
          )
        : null}

      {chrome && visibleTabs.length > 0
        ? createPortal(
            <aside className="panel">
              <div className="tabs">
                {visibleTabs.map((t) => (
                  <button key={t} className={activeTab === t ? "active" : ""} onClick={() => setPanel(t)}>
                    {t === "symbols" ? "Values" : t === "text" ? "Projection" : "Page"}
                  </button>
                ))}
                <button
                  className="panel-close"
                  title="close this tab (Options reopens it)"
                  aria-label="close this tab"
                  onClick={() =>
                    setOpenTabs((cur) => {
                      const next = new Set(cur);
                      if (activeTab) next.delete(activeTab);
                      return next;
                    })
                  }
                >
                  ×
                </button>
              </div>

              {activeTab === "symbols" ? (
                <div className="symbol-search">
                  <input
                    type="search"
                    placeholder="Search values"
                    aria-label="Search values"
                    spellCheck={false}
                    value={symbolQuery}
                    onChange={(e) => setSymbolQuery(e.target.value)}
                    onKeyDown={(e) => {
                      // Escape clears the search first; only an empty box lets it
                      // through to do what it does everywhere else.
                      if (e.key === "Escape" && symbolQuery !== "") {
                        e.stopPropagation();
                        setSymbolQuery("");
                      }
                    }}
                  />
                  {searching ? (
                    <span className="count">
                      {shownSymbols.length} of {sheet.symbols.length}
                    </span>
                  ) : null}
                </div>
              ) : null}

              <div className="panel-body" ref={panelBodyRef}>
                {activeTab === "symbols" ? (
                  searching && shownSymbols.length === 0 ? (
                    <p className="symbols-empty">No values match “{symbolQuery.trim()}”</p>
                  ) : (
                    <table className="symbols">
                    <tbody>
                      {shownSymbols.map((s) => (
                        <tr
                          key={s.name}
                          className={selection.has(s.definedIn) ? "on" : ""}
                          onClick={() => {
                            setSelection(new Set([s.definedIn]));
                            setEditing(null);
                            regionRefs.current
                              .get(s.definedIn)
                              ?.scrollIntoView({ behavior: "smooth", block: "center" });
                          }}
                          title="click to jump to where this is defined"
                        >
                          <td className="name">{s.name}</td>
                          {(() => {
                            const parts = formatValueParts(s.value, listUnit(s.name, s.definedIn));
                            const shown = parts.unit === undefined ? parts.text : `${parts.text} ${parts.unit}`;
                            const dimension = isMatrix(s.value) ? s.value.commonDimension() : s.value.dimension;
                            return (
                              <td className="val">
                                {dimension && !dimension.isDimensionless ? (
                                  <button
                                    className={`val-unit ${doc.valueUnits?.[s.name] ? "is-chosen" : ""}`}
                                    title="choose the unit this is listed in"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setListUnitFor({ name: s.name, value: s.value, anchor: e.currentTarget });
                                    }}
                                  >
                                    {shown}
                                  </button>
                                ) : (
                                  shown
                                )}
                              </td>
                            );
                          })()}
                          {dev ? <td className="src">{s.definedIn}</td> : null}
                        </tr>
                      ))}
                    </tbody>
                    </table>
                  )
                ) : activeTab === "text" ? (
                  <pre className="projection">{sheet.projection}</pre>
                ) : (
                  <PagePanel sheet={sheet} onEditBands={startBandEditing} />
                )}
              </div>
            </aside>,
            chrome.side,
          )
        : null}

      {listUnitFor !== null ? (
        <UnitPicker
          dimension={
            (isMatrix(listUnitFor.value) ? listUnitFor.value.commonDimension() : listUnitFor.value.dimension) ?? null
          }
          chosen={doc.valueUnits?.[listUnitFor.name]}
          anchor={listUnitFor.anchor}
          onPick={(unit) => {
            sheet.setValueUnit(listUnitFor.name, unit);
            setListUnitFor(null);
          }}
          onClose={() => setListUnitFor(null)}
        />
      ) : null}

      {unitPickerFor !== null ? (
        <UnitPicker
          dimension={dimensionOf(sheet.results.get(unitPickerFor))}
          chosen={displayUnitOf(
            (doc.regions.find((r) => r.id === unitPickerFor) as { source?: string })?.source ?? "",
          )}
          anchor={regionRefs.current.get(unitPickerFor) ?? null}
          onPick={(unit) => {
            sheet.setUnit(unitPickerFor, unit);
            setUnitPickerFor(null);
          }}
          onClose={() => setUnitPickerFor(null)}
        />
      ) : null}

      {chrome
        ? createPortal(
            <>
              {/* Regions that will not print are a reason to show the bar in their own
                  right: the whole point is that the user is told before the sheet goes
                  out, not after it comes back. */}
              {problemsOpen && problems.length > 0 ? (
                <div className="problem-list" role="dialog" aria-label="Problems on this sheet">
                  <div className="problem-list-head">
                    <span>
                      {problems.length} problem{problems.length === 1 ? "" : "s"}
                    </span>
                    <button onClick={() => setProblemsOpen(false)} title="close">×</button>
                  </div>
                  <ul>
                    {problems.map(({ id, result }) => (
                      <li key={id}>
                        <button
                          onClick={() => {
                            revealRegion(id);
                            setProblemsOpen(false);
                          }}
                        >
                          <span className={`mark ${result?.status === "blocked" ? "waiting" : ""}`}>
                            {result?.status === "blocked" ? "\u2026" : "!"}
                          </span>
                          {dev ? <b>{id}</b> : null}
                          <span className="what">{problemText(result)}</span>
                          {/* The source text is what tells one region from another
                              when the messages read alike. */}
                          <span className="where">{sourceOf(id)}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {dev || shownProblem || staleCount > 0 || offSheet > 0 || tooTall > 0 ? (
                <footer
                  className={`status ${shownProblem ? "has-problem" : ""} ${
                    staleCount > 0 && !shownProblem ? "has-stale" : ""
                  }`}
                >
                  {shownProblem ? (
                    <button
                      className="problem-msg"
                      onClick={() => {
                        setSelection(new Set([shownProblem.id]));
                        setEditing(null);
                        regionRefs.current
                          .get(shownProblem.id)
                          ?.scrollIntoView({ behavior: "smooth", block: "center" });
                      }}
                    >
                      <span className="mark">!</span>
                      {dev ? <b>{shownProblem.id}</b> : null}
                      <span>{problemText(shownProblem.result)}</span>
                    </button>
                  ) : null}
                  {shownProblem && problems.length > 1 ? (
                    <button
                      className={`problem-more ${problemsOpen ? "on" : ""}`}
                      title="show every problem on this sheet"
                      onClick={() => setProblemsOpen((open) => !open)}
                    >
                      +{problems.length - 1} more
                    </button>
                  ) : staleCount > 0 ? (
                    <button className="stale-msg" onClick={sheet.calculateNow}>
                      <span className="mark">~</span>
                      <span>
                        {staleCount} value{staleCount === 1 ? "" : "s"} out of date — press F9
                      </span>
                    </button>
                  ) : (
                    <span>
                      {doc.regions.length} regions · {layout.pageCount} page
                      {layout.pageCount === 1 ? "" : "s"}
                    </span>
                  )}

                  {/* Its own slot, not part of the message rotation: how many regions
                      will be missing from the print is a standing fact about the
                      document, and an unrelated error must not hide it. */}
                  {tooTall > 0 ? (
                    <button
                      className="offsheet-count"
                      title="taller than a page — the bottom will not print"
                      onClick={() => {
                        const first = doc.regions.find(
                          (r) => layout.placement.get(r.id)?.overflows === true,
                        );
                        if (!first) return;
                        setSelection(new Set([first.id]));
                        regionRefs.current
                          .get(first.id)
                          ?.scrollIntoView({ behavior: "smooth", block: "center" });
                      }}
                    >
                      {tooTall} region{tooTall === 1 ? " is" : "s are"} taller than a page
                    </button>
                  ) : null}

                  {offSheet > 0 ? (
                    <button
                      className="offsheet-count"
                      title="past the right edge of the page — on the sheet, but not on paper"
                      onClick={() => {
                        const first = doc.regions.find(
                          (r) => layout.placement.get(r.id)?.printable === false,
                        );
                        if (!first) return;
                        setSelection(new Set([first.id]));
                        regionRefs.current
                          .get(first.id)
                          ?.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
                      }}
                    >
                      {offSheet} region{offSheet === 1 ? "" : "s"} will not print
                    </button>
                  ) : null}

                  <div className="spacer" />
                  {dev ? (
                    <>
                      <span>
                        recompute: {sheet.stats.evaluated} evaluated, {sheet.stats.reused} reused
                      </span>
                      <span>
                        {selection.size > 0
                          ? `selected ${[...selection].join(", ")}`
                          : "click a region to trace it"}
                      </span>
                      <button className="dev-chip" onClick={toggleDev} title="Ctrl+Shift+D">
                        dev
                      </button>
                    </>
                  ) : null}
                </footer>
              ) : null}
            </>,
            chrome.bottom,
          )
        : null}
    </>
  );
}

function PagePanel({
  sheet,
  onEditBands,
}: {
  sheet: ReturnType<typeof useSheet>;
  onEditBands: () => void;
}) {
  const page = sheet.sheet.page;
  const setMargin = (edge: keyof Margins, v: number) =>
    sheet.setPage({ margins: { ...page.margins, [edge]: v } });
  /** Blank clears a sheet number back to its default; anything else must be one. */
  const setSheetNumber = (key: "firstSheet" | "totalSheets", raw: string) => {
    if (raw.trim() === "") {
      sheet.setPage({ [key]: undefined } as unknown as Partial<typeof page>);
      return;
    }
    const n = Number(raw);
    if (isSheetNumber(n)) sheet.setPage({ [key]: n });
  };

  return (
    <div className="page-panel">
      <div className="group">
        <div className="group-title">Paper</div>
        <div className="row">
          <label className="mini">
            <span>Size</span>
            <select value={page.size} onChange={(e) => sheet.setPage({ size: e.target.value as "letter" | "a4" })}>
              <option value="letter">Letter</option>
              <option value="a4">A4</option>
            </select>
          </label>
          <label className="mini">
            <span>Orientation</span>
            <select
              value={page.orientation}
              onChange={(e) => sheet.setPage({ orientation: e.target.value as "portrait" | "landscape" })}
            >
              <option value="portrait">Portrait</option>
              <option value="landscape">Landscape</option>
            </select>
          </label>
        </div>
      </div>

      <div className="group">
        <div className="group-title">Margins</div>
        <div className="row">
          {(["top", "right", "bottom", "left"] as const).map((edge) => (
            <label className="mini" key={edge}>
              <span>{edge[0]!.toUpperCase() + edge.slice(1)}</span>
              <input
                type="number"
                min={0}
                max={300}
                value={page.margins[edge]}
                onChange={(e) => setMargin(edge, Number(e.target.value))}
              />
            </label>
          ))}
        </div>
      </div>

      <div className="group">
        <div className="group-title">Header and footer</div>
        <p className="panel-note">
          Laid out on the page: double-click the header or footer, or use the button.
        </p>
        <button className="panel-button" onClick={onEditBands}>
          Edit header and footer
        </button>
      </div>

      <div className="group">
        <div className="group-title">Sheet numbering</div>
        <div className="row">
          <label className="mini" title="the number printed on this file's first page">
            <span>First sheet</span>
            <input
              type="number"
              min={1}
              placeholder="1"
              value={page.firstSheet ?? ""}
              onChange={(e) => setSheetNumber("firstSheet", e.target.value)}
            />
          </label>
          <label className="mini" title="the package's total, when this calc is part of a larger set; blank for this file's own">
            <span>Of total</span>
            <input
              type="number"
              min={1}
              placeholder="auto"
              value={page.totalSheets ?? ""}
              onChange={(e) => setSheetNumber("totalSheets", e.target.value)}
            />
          </label>
        </div>
      </div>

      <div className="group">
        <div className="group-title">Title block</div>
        {TITLE_BLOCK_KEYS.map((k) => (
          <label className="field" key={k}>
            <span>{FIELDS.find((f) => f.name === k)?.label ?? k}</span>
            <input
              value={sheet.sheet.titleBlock[k] ?? ""}
              onChange={(e) => sheet.setTitleBlock({ [k]: e.target.value })}
            />
          </label>
        ))}
      </div>
    </div>
  );
}
