/**
 * Pagination.
 *
 * Regions store one continuous document `y`. Pages are fixed-height windows
 * onto that, and a page break does not move anything — it contributes an
 * *offset* that pushes everything below it to the top of the next page. The
 * stored coordinates never change.
 *
 * A region that will not fit in what is left of its page is pushed by the same
 * mechanism: an implicit break, computed rather than stored. That is what
 * keeps the promise to hold a region intact across a page boundary,
 * and it needs the renderer to say how tall things are — see `LayoutOptions`.
 *
 * That non-destructive choice matters: inserting a break by rewriting the y of
 * every region below would turn one edit into a diff touching the whole file,
 * and would make removing the break lossy.
 *
 * Pure, and in the engine rather than the shell, because the screen, the print
 * path and a future PDF exporter must agree on which page a region is on.
 */

import type { PageSetup } from "./sheet.js";
import { contentMargins, pageBox } from "./sheet.js";
import type { Position, Region, RegionId } from "./region.js";

/**
 * One piece of a table that did not fit on a single page.
 *
 * Rows are a half-open range into the table's own `cells`. Every piece draws
 * the heading again: a column of numbers with no heading on the page you are
 * looking at is unreadable, and on a checked calculation it is worse than
 * unreadable.
 */
export interface TableFragment {
  readonly page: number;
  /** Top of this piece within the page's content box. */
  readonly y: number;
  readonly firstRow: number;
  /** Exclusive. */
  readonly endRow: number;
}

/** How tall a table's parts are, measured by the renderer. */
export interface TableMetrics {
  readonly header: number;
  readonly rows: readonly number[];
}

export interface Placement {
  /** Zero-based page index. */
  readonly page: number;
  readonly x: number;
  /** y within the page's content box. */
  readonly y: number;
  /**
   * Document y minus placed y for this region. The shell needs it to convert
   * a pointer position back into a stored coordinate while dragging.
   */
  readonly offset: number;
  /**
   * Whether this region falls inside the printable width.
   *
   * The canvas is deliberately larger than the paper — a place to park a trial
   * calculation, a check, a note to yourself — and everything on it computes
   * and binds names as usual. Only what sits within the page is printed.
   *
   * A region is judged by its right edge where that is known: an explicit
   * size, or a measured width passed in. Where it is not, position alone
   * decides, which is the same limitation heights have and will be lifted by
   * the same measuring pass.
   */
  readonly printable: boolean;
  /**
   * The region is taller than a whole page and will run off the bottom
   * whatever is done with it.
   *
   * Nothing can be done about it here, so it is reported rather than hidden.
   * Silently cropping a value is the failure this project exists to avoid, and
   * a table this tall wants splitting between its rows — a separate piece of
   * work this flag is the placeholder for.
   */
  readonly overflows?: boolean;
  /**
   * Present when a table was split across pages. The first fragment is where
   * the region itself is placed; the rest continue it.
   */
  readonly fragments?: readonly TableFragment[];
}

export interface LayoutOptions {
  /**
   * Measured region widths, by id. The renderer knows them; the engine does
   * not, and this is how they arrive without pagination leaving the engine.
   */
  readonly widths?: ReadonlyMap<RegionId, number>;
  /**
   * Measured region heights, by id.
   *
   * Height is a rendering fact — it depends on the font, on whether the
   * notation has a fraction in it, on where the words wrap — and pagination is
   * pure so that the screen and the printer cannot disagree. So the renderer
   * measures and the engine still decides.
   *
   * There is no measure/layout loop to converge here: pagination only ever
   * moves a region *down*, and a region's height does not depend on its
   * vertical position. One pass is enough.
   *
   * Without heights, nothing is pushed and the behaviour is what it was.
   */
  readonly heights?: ReadonlyMap<RegionId, number>;
  /**
   * Per-table row heights, so a table too tall for a page can break between
   * rows rather than run off the bottom.
   *
   * Without them a tall table is reported as overflowing and left alone, which
   * is what happened before this existed.
   */
  readonly tableRows?: ReadonlyMap<RegionId, TableMetrics>;
}

/**
 * A page break's document y, and the offset in force *below* it. Together
 * these are the whole pagination schedule, which is what lets a point that is
 * not a region — the worksheet cursor — be placed by the same rules.
 */
export interface BreakStop {
  readonly at: number;
  readonly offset: number;
  /** The page this break sits at the foot of. */
  readonly page: number;
}

export interface Layout {
  readonly pageCount: number;
  readonly contentWidth: number;
  readonly contentHeight: number;
  readonly placement: ReadonlyMap<RegionId, Placement>;
  readonly breaks: readonly BreakStop[];
}

export function contentBox(page: PageSetup): {
  width: number;
  height: number;
} {
  const box = pageBox(page);
  // A header or footer taller than its margin takes room from the contents.
  const m = contentMargins(page);
  return {
    width: box.width - m.left - m.right,
    height: box.height - m.top - m.bottom,
  };
}

export function paginate(
  regions: readonly Region[],
  page: PageSetup,
  options: LayoutOptions = {},
): Layout {
  const { width: contentWidth, height: contentHeight } = contentBox(page);
  const placement = new Map<RegionId, Placement>();
  const breaks: BreakStop[] = [];

  // Layout order is document y, which is not evaluation order — evaluation
  // reads left to right within a band, and a page break cares only about
  // vertical position.
  const ordered = [...regions].sort(
    (a, b) => a.position.y - b.position.y || a.position.x - b.position.x,
  );

  let offset = 0;
  let maxPage = 0;

  /**
   * Where a region ends, as far as this knows. Absent means "unknown", and an
   * unknown height is never pushed: guessing would move things for no reason.
   */
  const heightOf = (region: Region): number | undefined =>
    options.heights?.get(region.id) ?? region.size?.height;

  /** A region's right edge, as far as it is known here. */
  const rightEdge = (region: Region): number =>
    region.position.x + (options.widths?.get(region.id) ?? region.size?.width ?? 0);
  const fitsWidth = (region: Region): boolean =>
    // A page break spans the sheet by definition and is never off-page.
    region.kind === "pagebreak" ||
    (region.position.x >= 0 && rightEdge(region) <= contentWidth);

  for (const region of ordered) {
    const flowY = region.position.y + offset;
    const pageIndex = Math.max(0, Math.floor(flowY / contentHeight));

    if (region.kind === "pagebreak") {
      // Sits at the foot of the page it breaks, and pushes what follows.
      placement.set(region.id, {
        page: pageIndex,
        x: region.position.x,
        y: flowY - pageIndex * contentHeight,
        offset,
        printable: true,
      });
      maxPage = Math.max(maxPage, pageIndex);
      offset += (pageIndex + 1) * contentHeight - flowY;
      breaks.push({ at: region.position.y, offset, page: pageIndex });
      continue;
    }

    let placedFlowY = flowY;
    let placedPage = pageIndex;
    let yInPage = flowY - pageIndex * contentHeight;
    let overflows = false;
    let fragments: TableFragment[] | undefined;

    const metrics = region.kind === "table" ? options.tableRows?.get(region.id) : undefined;
    const total = metrics
      ? metrics.header + metrics.rows.reduce((n, r) => n + r, 0)
      : undefined;

    // A table taller than any page is the only thing that splits. One that
    // fits somewhere is kept whole and pushed, because a table broken for no
    // reason is harder to read than one that starts lower down.
    if (metrics && total !== undefined && total > contentHeight) {
      fragments = [];
      let cursorY = yInPage;
      let cursorPage = pageIndex;

      // Never leave a heading stranded with a row or two under it at the foot
      // of a page. If this page cannot hold the heading and two rows, start
      // the table on the next one.
      const smallest =
        metrics.header + (metrics.rows[0] ?? 0) + (metrics.rows[1] ?? metrics.rows[0] ?? 0);
      if (contentHeight - cursorY < smallest && cursorY > 0) {
        offset += contentHeight - cursorY;
        cursorPage += 1;
        cursorY = 0;
      }

      let row = 0;
      while (row < metrics.rows.length) {
        const top = cursorY;
        let used = metrics.header;
        const first = row;
        while (
          row < metrics.rows.length &&
          cursorY + used + (metrics.rows[row] as number) <= contentHeight
        ) {
          used += metrics.rows[row] as number;
          row += 1;
        }
        if (row === first) {
          // A single row taller than a whole page. Nothing can be done in
          // layout; take it and say so.
          used += metrics.rows[row] as number;
          row += 1;
          overflows = true;
        }
        fragments.push({ page: cursorPage, y: top, firstRow: first, endRow: row });
        if (row < metrics.rows.length) {
          cursorPage += 1;
          cursorY = 0;
        } else {
          cursorY = top + used;
        }
      }

      const last = fragments[fragments.length - 1] as TableFragment;
      placedPage = (fragments[0] as TableFragment).page;
      yInPage = (fragments[0] as TableFragment).y;
      // Everything below the table follows its last piece, not its stored
      // height: the split consumed extra pages and repeated headings.
      const endsAt = last.page * contentHeight + cursorY;
      offset = endsAt - (region.position.y + total);
      for (const f of fragments) maxPage = Math.max(maxPage, f.page);
      placement.set(region.id, {
        page: placedPage,
        x: region.position.x,
        y: yInPage,
        offset,
        printable: fitsWidth(region),
        ...(overflows ? { overflows: true } : {}),
        fragments,
      });
      continue;
    }

    const height = heightOf(region);
    if (height !== undefined && yInPage + height > contentHeight) {
      if (height > contentHeight) {
        // Taller than any page. Pushing it would only move the problem, so it
        // is left where it starts and reported.
        overflows = true;
      } else if (yInPage > 0) {
        // It fits on a page, just not on what is left of this one. Push it to
        // the top of the next, exactly as an explicit break would — an offset,
        // never a rewritten coordinate, so a region's stored position still
        // means what it says and moving one is still a one-line diff.
        const push = contentHeight - yInPage;
        offset += push;
        breaks.push({ at: region.position.y, offset, page: pageIndex });
        placedFlowY = region.position.y + offset;
        placedPage = Math.max(0, Math.floor(placedFlowY / contentHeight));
        yInPage = placedFlowY - placedPage * contentHeight;
      }
    }

    const printable = fitsWidth(region);
    placement.set(region.id, {
      page: placedPage,
      x: region.position.x,
      y: yInPage,
      offset,
      printable,
      ...(overflows ? { overflows: true } : {}),
    });
    // A page that holds nothing printable is not a page of the document.
    if (printable) maxPage = Math.max(maxPage, placedPage);
  }

  return {
    pageCount: maxPage + 1,
    contentWidth,
    contentHeight,
    placement,
    breaks,
  };
}

/**
 * Where a bare point lands, by the same rules as a region.
 *
 * The worksheet cursor is a document coordinate like any region's, so it has
 * to survive a page break inserted above it — which means it cannot be stored
 * as "page 2, 40px down". A break affects a point strictly below it, so a
 * cursor sitting exactly on a break stays at the foot of the page it breaks,
 * and nudging it one pixel down moves it to the top of the next page. That is
 * also what makes "insert a break, then keep typing" advance the way you
 * expect.
 */
/**
 * The offset in force on a page. Constant across a page: a break moves
 * everything after it to the next page, so no two document regions on the same
 * page can be separated by one.
 */
export function offsetForPage(layout: Layout, page: number): number {
  let offset = 0;
  for (const stop of layout.breaks) {
    if (stop.page >= page) break;
    offset = stop.offset;
  }
  return offset;
}

/**
 * Inverse of `placePoint`: the document coordinate a click on a page means.
 * The shell needs this to turn "the user clicked here" into a position that
 * survives a break inserted above it later.
 */
export function pointAt(
  layout: Layout,
  page: number,
  xInPage: number,
  yInPage: number,
): Position {
  return {
    x: xInPage,
    y: page * layout.contentHeight + yInPage - offsetForPage(layout, page),
  };
}

export function placePoint(layout: Layout, point: Position): Placement {
  let offset = 0;
  for (const stop of layout.breaks) {
    if (stop.at >= point.y) break;
    offset = stop.offset;
  }
  const flowY = point.y + offset;
  const page = Math.max(0, Math.floor(flowY / layout.contentHeight));
  return {
    page,
    x: point.x,
    y: flowY - page * layout.contentHeight,
    offset,
    printable: point.x >= 0 && point.x <= layout.contentWidth,
  };
}

/**
 * Inverse of `paginate` for one point: the stored y that would place a region
 * at `y` on `page`, given the offset in force there.
 */
export function documentY(
  pageIndex: number,
  yInPage: number,
  contentHeight: number,
  offset: number,
): number {
  return pageIndex * contentHeight + yInPage - offset;
}
