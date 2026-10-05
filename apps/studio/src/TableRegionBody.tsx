/**
 * A data table you type into.
 *
 * The grid is the region's whole content, so unlike math and text there is no
 * separate "editing" mode: cells are inputs all the time. Clicking a cell to
 * edit it, then clicking out to see it, would be two states for something that
 * looks like one thing.
 *
 * Every change goes out as a whole-region update. A table is small — tens of
 * rows — and sending the grid means the operation stays one that any caller
 * could send, rather than a cell-level protocol only this component speaks.
 */

import { useCallback } from "react";
import type { RegionStyle, TableColumn } from "@jamcalc/engine";

export interface TableRegionBodyProps {
  readonly columns: readonly TableColumn[];
  readonly cells: readonly (readonly (number | null)[])[];
  /**
   * The slice of rows this piece shows, when the table was split across
   * pages. Every piece repeats the heading — a column of figures with no
   * heading on the page in front of you is unreadable.
   */
  readonly firstRow?: number;
  readonly endRow?: number;
  /** False on continuation pieces, which have no room for controls. */
  readonly editable?: boolean;
  readonly style?: RegionStyle;
  /** The region's error, if it has one. Shown against the offending grid. */
  readonly problemText?: string;
  readonly onChange: (
    columns: readonly TableColumn[],
    cells: readonly (readonly (number | null)[])[],
  ) => void;
}

/**
 * What the user typed, as a number or nothing.
 *
 * An unparseable cell becomes `null` rather than NaN: the engine reports an
 * empty cell by row and column, which is a better thing to read than "not a
 * number" for what is usually a half-typed value.
 */
function toCell(text: string): number | null {
  const trimmed = text.trim();
  if (trimmed === "") return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

const cellText = (v: number | null | undefined): string =>
  v === null || v === undefined ? "" : String(v);

export function TableRegionBody({
  columns,
  cells,
  firstRow = 0,
  endRow,
  editable = true,
  style,
  problemText,
  onChange,
}: TableRegionBodyProps) {
  const from = firstRow;
  const to = endRow ?? cells.length;
  const setCell = useCallback(
    (row: number, col: number, text: string) => {
      const next = cells.map((r, i) =>
        i === row ? r.map((c, j) => (j === col ? toCell(text) : c)) : r,
      );
      onChange(columns, next);
    },
    [cells, columns, onChange],
  );

  const setColumn = useCallback(
    (index: number, patch: Partial<TableColumn>) => {
      const next = columns.map((c, i) => {
        if (i !== index) return c;
        const merged = { ...c, ...patch };
        // An empty unit is no unit, not a unit named "".
        if (merged.unit !== undefined && merged.unit.trim() === "") delete merged.unit;
        return merged;
      });
      onChange(next, cells);
    },
    [cells, columns, onChange],
  );

  const addRow = useCallback(() => {
    onChange(columns, [...cells, columns.map(() => null)]);
  }, [cells, columns, onChange]);

  const addColumn = useCallback(() => {
    // Named for its position so it is valid immediately; two columns called
    // the same thing is an error the engine would report at once.
    const taken = new Set(columns.map((c) => c.name));
    let n = columns.length + 1;
    while (taken.has(`c${n}`)) n += 1;
    onChange(
      [...columns, { name: `c${n}` }],
      cells.map((r) => [...r, null]),
    );
  }, [cells, columns, onChange]);

  const removeRow = useCallback(() => {
    if (cells.length <= 1) return;
    onChange(columns, cells.slice(0, -1));
  }, [cells, columns, onChange]);

  const removeColumn = useCallback(() => {
    if (columns.length <= 1) return;
    onChange(
      columns.slice(0, -1),
      cells.map((r) => r.slice(0, -1)),
    );
  }, [cells, columns, onChange]);

  return (
    <div className="table-region" style={style ? { color: style.color } : undefined}>
      <table style={style?.fontSize ? { fontSize: style.fontSize } : undefined}>
        <thead>
          <tr>
            {columns.map((column, i) => (
              <th key={i}>
                <input
                  className="col-name"
                  value={column.name}
                  spellCheck={false}
                  onChange={(e) => setColumn(i, { name: e.target.value })}
                  title="the name this column binds on the sheet"
                />
                <input
                  className="col-unit"
                  value={column.unit ?? ""}
                  spellCheck={false}
                  placeholder="unit"
                  onChange={(e) => setColumn(i, { unit: e.target.value })}
                  title="the unit every cell in this column is in"
                />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {cells.slice(from, to).map((row, i) => {
            const r = from + i;
            return (
            <tr key={r}>
              {columns.map((_, c) => (
                <td key={c}>
                  <input
                    inputMode="decimal"
                    value={cellText(row[c])}
                    onChange={(e) => setCell(r, c, e.target.value)}
                  />
                </td>
              ))}
            </tr>
            );
          })}
        </tbody>
      </table>

      {editable ? (
      <div className="table-controls">
        <button onClick={addRow} title="add a row">+ row</button>
        <button onClick={removeRow} title="remove the last row" disabled={cells.length <= 1}>
          − row
        </button>
        <button onClick={addColumn} title="add a column">+ col</button>
        <button
          onClick={removeColumn}
          title="remove the last column"
          disabled={columns.length <= 1}
        >
          − col
        </button>
      </div>
      ) : null}

      {problemText ? <p className="table-problem">{problemText}</p> : null}
    </div>
  );
}
