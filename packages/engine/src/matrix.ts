/**
 * Matrices and vectors.
 *
 * A matrix holds a `Quantity` per cell rather than one dimension for the whole
 * thing. That is the difference between a value model that can hold a
 * tabulated lookup — a column of areas beside a column of section moduli — and
 * one that can only hold homogeneous arrays. Operations that need homogeneity
 * check for it; the container does not impose it.
 *
 * Row-major, and a vector is an n×1 matrix. One shape means indexing,
 * reduction and printing have one implementation each.
 */

import { Dimension } from "./dimension.js";
import { Quantity } from "./quantity.js";

export class MatrixValue {
  readonly rows: number;
  readonly cols: number;
  /** Row-major, length rows*cols. */
  readonly cells: readonly Quantity[];

  private constructor(rows: number, cols: number, cells: readonly Quantity[]) {
    this.rows = rows;
    this.cols = cols;
    this.cells = cells;
  }

  static of(grid: readonly (readonly Quantity[])[]): MatrixValue {
    const rows = grid.length;
    const cols = rows === 0 ? 0 : (grid[0] as readonly Quantity[]).length;
    for (const row of grid) {
      if (row.length !== cols) {
        throw new RangeError("every row of a matrix must have the same length");
      }
    }
    return new MatrixValue(rows, cols, grid.flat());
  }

  static column(values: readonly Quantity[]): MatrixValue {
    return new MatrixValue(values.length, 1, values);
  }

  static fromCells(rows: number, cols: number, cells: readonly Quantity[]): MatrixValue {
    return new MatrixValue(rows, cols, cells);
  }

  get size(): number {
    return this.rows * this.cols;
  }

  get isVector(): boolean {
    return this.cols === 1 || this.rows === 1;
  }

  /** 0-based internally; the language's 1-based indexing is applied above. */
  at(row: number, col: number): Quantity {
    const cell = this.cells[row * this.cols + col];
    if (!cell) throw new RangeError("index out of range");
    return cell;
  }

  row(i: number): Quantity[] {
    return this.cells.slice(i * this.cols, (i + 1) * this.cols);
  }

  toRows(): Quantity[][] {
    return Array.from({ length: this.rows }, (_, i) => this.row(i));
  }

  map(fn: (q: Quantity, row: number, col: number) => Quantity): MatrixValue {
    return new MatrixValue(
      this.rows,
      this.cols,
      this.cells.map((q, i) => fn(q, Math.floor(i / this.cols), i % this.cols)),
    );
  }

  transpose(): MatrixValue {
    const out: Quantity[] = [];
    for (let c = 0; c < this.cols; c++) {
      for (let r = 0; r < this.rows; r++) out.push(this.at(r, c));
    }
    return new MatrixValue(this.cols, this.rows, out);
  }

  sameShape(other: MatrixValue): boolean {
    return this.rows === other.rows && this.cols === other.cols;
  }

  /** The dimension shared by every cell, or undefined if they differ. */
  commonDimension(): Dimension | undefined {
    const first = this.cells[0];
    if (!first) return undefined;
    return this.cells.every((c) => c.dimension.equals(first.dimension))
      ? first.dimension
      : undefined;
  }
}
