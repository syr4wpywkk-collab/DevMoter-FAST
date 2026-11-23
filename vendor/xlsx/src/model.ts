/**
 * Plain workbook model consumed/produced by the XLSX IO layer.
 *
 * `value` holds the cached cell value exactly as stored: numbers (including
 * date/time raw serials), strings, booleans. Error cells set `error: true` and
 * keep the error literal ("#DIV/0!") in `value`. `formula` is the stored
 * formula text verbatim — this layer never evaluates.
 */
export interface WorkbookCell {
  value?: number | string | boolean;
  formula?: string;
  error?: boolean;
  /** Index into the workbook style table (the `s` attribute); keeps formatting alive across writes. */
  style?: number;
  /** Resolved number-format code for the style index, kept aside for date/serial interpretation. */
  numberFormat?: string;
}

export interface Worksheet {
  name: string;
  /** Cells keyed by A1 reference; sparse — only stored cells appear. */
  cells: Map<string, WorkbookCell>;
  /** Merged ranges as A1:B2 references, in document order. */
  merges?: string[];
  /** Used-range reference like "A1:D20". */
  dimension?: string;
}

export interface Workbook {
  sheets: Worksheet[];
}

const COL_RE = /^([A-Za-z]+)([0-9]+)$/;

/** 1-based column index -> letters (1 -> "A", 27 -> "AA"). */
export function columnName(index: number): string {
  let out = "";
  let n = index;
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

/** Column letters -> 1-based column index ("A" -> 1). */
export function columnIndex(name: string): number {
  let out = 0;
  for (const ch of name.toUpperCase()) out = out * 26 + (ch.charCodeAt(0) - 64);
  return out;
}

/** A1 reference -> { row, col } (both 1-based). Throws on malformed refs. */
export function parseCellRef(ref: string): { row: number; col: number } {
  const m = COL_RE.exec(ref);
  if (!m) throw new Error(`invalid cell reference: ${ref}`);
  return { row: Number(m[2]), col: columnIndex(m[1]) };
}

/** { row, col } (1-based) -> A1 reference. */
export function cellRef(row: number, col: number): string {
  return `${columnName(col)}${row}`;
}

/** Used range covering `refs`, like "B2:D9"; undefined when empty. */
export function dimensionOf(refs: Iterable<string>): string | undefined {
  let minRow = Infinity;
  let minCol = Infinity;
  let maxRow = 0;
  let maxCol = 0;
  for (const ref of refs) {
    const { row, col } = parseCellRef(ref);
    if (row < minRow) minRow = row;
    if (col < minCol) minCol = col;
    if (row > maxRow) maxRow = row;
    if (col > maxCol) maxCol = col;
  }
  if (!maxRow) return undefined;
  const first = cellRef(minRow, minCol);
  const last = cellRef(maxRow, maxCol);
  return first === last ? first : `${first}:${last}`;
}

/** Cell refs sorted in worksheet order (row, then column). */
export function sortedCellRefs(cells: Map<string, WorkbookCell>): string[] {
  return [...cells.keys()].sort((a, b) => {
    const pa = parseCellRef(a);
    const pb = parseCellRef(b);
    return pa.row - pb.row || pa.col - pb.col;
  });
}
