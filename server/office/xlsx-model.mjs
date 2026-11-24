// Read-only workbook model + projection for stored Excel documents.
//
// The vendored @devmoter/xlsx engine turns .xlsx bytes into a plain workbook
// (sheets, sparse cells with raw values and verbatim formula strings — never
// evaluated here). This module validates that model against the office limits
// and projects it into the shape the API/browser reads, mirroring how
// docx-model.mjs projects parsed DOCX blocks for the editor. Cell edits and
// the calc-engine wiring (calc.mjs) produce new workbook models that the
// store serializes back through writeWorkbook.
import {
  readWorkbook,
  parseCellRef,
  cellRef,
  sortedCellRefs,
} from "./xlsx-engine.mjs";

export const XLSX_LIMITS = Object.freeze({
  sheets: 64,
  cells: 200000,
  cellText: 32767,
  merges: 10000,
  // Worksheet bounds: edits may address any real Excel address, not only
  // cells already present in the file.
  maxRow: 1048576,
  maxCol: 16384,
  edits: 100,
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
 * stored cell's raw value / verbatim formula. When `computed` (the result of
 * recalcWorkbook) is given, computed engine values replace the file's cached
 * ones for formula cells — the grid and the AI projection show what the
 * formula actually evaluates to now, not what was stored last.
 */
export function projectWorkbook(workbook, computed) {
  return {
    sheets: workbook.sheets.map((sheet) => {
      const values = computed?.sheets.get(sheet.name);
      return {
        name: sheet.name,
        ref: sheet.dimension,
        ...sheetSize(sheet.dimension),
        merges: sheet.merges || [],
        editable: true,
        cells: sortedCellRefs(sheet.cells).map((ref) => {
          const cell = sheet.cells.get(ref);
          const { row, col } = parseCellRef(ref);
          const fresh = values?.get(ref);
          return {
            ref,
            row,
            col,
            value: fresh && "value" in fresh ? fresh.value : cell.value,
            formula: cell.formula,
            error: fresh?.error || cell.error || undefined,
            style: cell.style,
            numberFormat: cell.numberFormat,
          };
        }),
      };
    }),
  };
}

export const XLSX_WARNINGS = Object.freeze([
  "表示は計算済みプレビューです。書式・レイアウトは原本のまま保持します。",
  "日付・時刻はシリアル値のまま表示される場合があります。",
]);
// Shown instead of the first warning when the calc engine could not run.
export const XLSX_STALE_WARNING =
  "計算エンジンを利用できないため、保存されたキャッシュ値を表示しています。";

/** Split "Sheet!A1" (or 'Quoted Sheet'!A1) into { sheet, ref }. */
export function parseCellAddress(address) {
  if (typeof address !== "string") return null;
  const bang = address.lastIndexOf("!");
  const rawSheet = bang === -1 ? "" : address.slice(0, bang);
  const rawRef = bang === -1 ? address : address.slice(bang + 1);
  const sheet =
    rawSheet.startsWith("'") && rawSheet.endsWith("'")
      ? rawSheet.slice(1, -1).replace(/''/g, "'")
      : rawSheet;
  let parsed;
  try {
    parsed = parseCellRef(rawRef.replace(/\$/g, ""));
  } catch {
    return null;
  }
  if (
    parsed.row < 1 ||
    parsed.col < 1 ||
    parsed.row > XLSX_LIMITS.maxRow ||
    parsed.col > XLSX_LIMITS.maxCol
  )
    return null;
  return { sheet: sheet || null, ref: cellRef(parsed.row, parsed.col) };
}

/** { sheet, ref } -> "Sheet!A1" (quoted only when the name needs it). */
export function cellAddress(sheet, ref) {
  return /^[A-Za-z_][A-Za-z0-9_.]*$/.test(sheet)
    ? `${sheet}!${ref}`
    : `'${sheet.replace(/'/g, "''")}'!${ref}`;
}

const NUMBER_TEXT = /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?$/;

/**
 * Interpret one edited cell's text the way Excel typing does:
 * "=" prefix -> formula, empty -> clear, numeric -> number,
 * TRUE/FALSE -> boolean, anything else -> text.
 * Returns the new cell content; `ref` must already be validated.
 */
export function editToCell(text) {
  if (text === "") return null;
  if (text.startsWith("=")) {
    const formula = text.slice(1);
    if (!formula || Buffer.byteLength(formula) > XLSX_LIMITS.cellText)
      throw fail("セル内容が不正です。");
    return { formula };
  }
  if (NUMBER_TEXT.test(text)) {
    const value = Number(text);
    if (Number.isFinite(value)) return { value };
  }
  if (text === "TRUE") return { value: true };
  if (text === "FALSE") return { value: false };
  return { value: text };
}

const cloneWorkbook = (workbook) => ({
  sheets: workbook.sheets.map((sheet) => ({
    ...sheet,
    cells: new Map(sheet.cells),
    merges: sheet.merges ? [...sheet.merges] : undefined,
  })),
});

/**
 * Apply cell edits ({sheet, ref} + text) to a copy of the workbook model.
 * Edits may create cells outside the stored range; clearing removes the cell
 * contents. Returns the cloned model — the original is never mutated.
 */
export function applyCellEdits(workbook, edits) {
  if (
    !Array.isArray(edits) ||
    !edits.length ||
    edits.length > XLSX_LIMITS.edits
  )
    throw fail("変更件数が不正です。");
  const model = cloneWorkbook(workbook);
  const byName = new Map(model.sheets.map((sheet) => [sheet.name, sheet]));
  const seen = new Set();
  let added = 0;
  const applied = edits.map((edit) => {
    if (
      !edit ||
      Object.keys(edit).some((key) => !["cell", "text"].includes(key))
    )
      throw fail("セル内容が不正です。");
    const at = parseCellAddress(edit.cell);
    const sheet = at && byName.get(at.sheet ?? model.sheets[0].name);
    if (
      !at ||
      !sheet ||
      typeof edit.text !== "string" ||
      Buffer.byteLength(edit.text) > XLSX_LIMITS.cellText ||
      CONTROL.test(edit.text)
    )
      throw fail("セル内容が不正です。");
    const key = `${sheet.name}!${at.ref}`;
    if (seen.has(key)) throw fail("編集できない、または重複したセルです。");
    seen.add(key);
    const next = editToCell(edit.text);
    const existing = sheet.cells.get(at.ref);
    if (next === null) {
      if (existing?.style !== undefined)
        // Keep the style entry so formatting survives a cleared cell.
        sheet.cells.set(at.ref, { style: existing.style, numberFormat: existing.numberFormat });
      else sheet.cells.delete(at.ref);
    } else {
      if (!existing && ++added + sheet.cells.size > XLSX_LIMITS.cells)
        throw fail("ブックが大きすぎるか、破損しています。");
      sheet.cells.set(at.ref, {
        ...next,
        style: existing?.style,
        numberFormat: existing?.numberFormat,
      });
    }
    return { cell: cellAddress(sheet.name, at.ref), text: edit.text };
  });
  return { model, applied };
}
