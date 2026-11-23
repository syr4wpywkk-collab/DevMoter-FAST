// Read-only workbook model + projection for stored Excel documents.
//
// The vendored @devmoter/xlsx engine turns .xlsx bytes into a plain workbook
// (sheets, sparse cells with raw values and verbatim formula strings — never
// evaluated here). This module validates that model against the office limits
// and projects it into the shape the API/browser reads, mirroring how
// docx-model.mjs projects parsed DOCX blocks for the editor. Editing, calc
// wiring and UI are a later track; every projected cell is read-only.
import {
  readWorkbook,
  parseCellRef,
  sortedCellRefs,
} from "./xlsx-engine.mjs";

export const XLSX_LIMITS = Object.freeze({
  sheets: 64,
  cells: 200000,
  cellText: 32767,
  merges: 10000,
});

const fail = (message, status = 400) =>
  Object.assign(new Error(message), { status });

const CONTROL = /[\u0000-\u0008\u000e-\u001d\u001f]/;

/**
 * Parse stored .xlsx bytes into the validated workbook model.
 * Throws 400 on malformed packages or limit violations.
 */
export async function parseWorkbook(bytes) {
  let workbook;
  try {
    workbook = await readWorkbook(new Uint8Array(bytes));
  } catch {
    throw fail("XLSXファイルを読み込めません。");
  }
  if (!Array.isArray(workbook.sheets) || workbook.sheets.length > XLSX_LIMITS.sheets)
    throw fail("ブックが大きすぎるか、破損しています。");
  let cells = 0;
  for (const sheet of workbook.sheets) {
    cells += sheet.cells.size;
    if (cells > XLSX_LIMITS.cells) throw fail("ブックが大きすぎるか、破損しています。");
    if ((sheet.merges || []).length > XLSX_LIMITS.merges)
      throw fail("ブックが大きすぎるか、破損しています。");
    for (const [ref, cell] of sheet.cells) {
      try {
        parseCellRef(ref);
      } catch {
        throw fail("ブックが大きすぎるか、破損しています。");
      }
      if (cell.error !== undefined && cell.error !== true)
        throw fail("ブックが大きすぎるか、破損しています。");
      if (cell.formula !== undefined && (typeof cell.formula !== "string" || Buffer.byteLength(cell.formula) > XLSX_LIMITS.cellText))
        throw fail("ブックが大きすぎるか、破損しています。");
      if (cell.value !== undefined) {
        const t = typeof cell.value;
        if (t === "string") {
          if (Buffer.byteLength(cell.value) > XLSX_LIMITS.cellText || CONTROL.test(cell.value))
            throw fail("ブックが大きすぎるか、破損しています。");
        } else if (t === "number") {
          if (!Number.isFinite(cell.value)) throw fail("ブックが大きすぎるか、破損しています。");
        } else if (t !== "boolean") {
          throw fail("ブックが大きすぎるか、破損しています。");
        }
      }
    }
  }
  return workbook;
}

/** Used range "A1:D9" -> { rows, cols }; empty sheets report 0x0. */
function sheetSize(dimension) {
  if (typeof dimension !== "string") return { rows: 0, cols: 0 };
  const end = dimension.includes(":") ? dimension.slice(dimension.indexOf(":") + 1) : dimension;
  try {
    const { row, col } = parseCellRef(end.replace(/\$/g, ""));
    return { rows: row, cols: col };
  } catch {
    return { rows: 0, cols: 0 };
  }
}

/**
 * Project the workbook model for the API: sheet names, dimensions and each
 * stored cell's raw value / verbatim formula. All cells are read-only in this
 * track; cached values may be stale relative to their formulas (no engine is
 * run), which the caller warns about.
 */
export function projectWorkbook(workbook) {
  return {
    sheets: workbook.sheets.map((sheet) => ({
      name: sheet.name,
      ref: sheet.dimension,
      ...sheetSize(sheet.dimension),
      merges: sheet.merges || [],
      editable: false,
      cells: sortedCellRefs(sheet.cells).map((ref) => {
        const cell = sheet.cells.get(ref);
        const { row, col } = parseCellRef(ref);
        return {
          ref,
          row,
          col,
          value: cell.value,
          formula: cell.formula,
          error: cell.error || undefined,
          style: cell.style,
          numberFormat: cell.numberFormat,
        };
      }),
    })),
  };
}

export const XLSX_WARNINGS = Object.freeze([
  "表示は読み取り専用のプレビューです。数式は計算されず、保存されたキャッシュ値をそのまま表示します。",
  "日付・時刻はシリアル値のまま表示される場合があります。",
]);
