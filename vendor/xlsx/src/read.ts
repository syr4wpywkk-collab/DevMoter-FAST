import type JSZip from "jszip";
import { loadXlsx, readPart } from "./internal/zip.js";
import { parseXml, asArray, joinText, textOf } from "./internal/xml.js";
import { readLayout } from "./internal/package.js";
import { cellRef, columnIndex } from "./model.js";
import type { Workbook, WorkbookCell, Worksheet } from "./model.js";

type Node = Record<string, unknown>;

export interface ParsedSheet {
  cells: Map<string, WorkbookCell>;
  merges: string[];
  dimension?: string;
}

const CELL_WITH_REF = /^[A-Za-z]+[0-9]+$/;

/**
 * Parse one worksheet XML part into sparse cells, merges and dimension.
 * `numberFormats[i]` is the formatCode resolved from styles.xml for style `i`.
 */
export function parseSheetXml(
  xml: string,
  sharedStrings: string[],
  numberFormats: (string | undefined)[] = [],
): ParsedSheet {
  const doc = parseXml(xml);
  const sheet = doc["worksheet"] as Node | undefined;
  const cells = new Map<string, WorkbookCell>();
  const merges: string[] = [];
  let dimension: string | undefined;

  const dim = sheet?.["dimension"] as Node | undefined;
  if (dim?.["@_ref"] !== undefined) dimension = String(dim["@_ref"]);

  for (const mc of asArray(
    (sheet?.["mergeCells"] as Node | undefined)?.["mergeCell"],
  )) {
    const ref = (mc as Node)["@_ref"];
    if (ref !== undefined) merges.push(String(ref));
  }

  const sheetData = sheet?.["sheetData"] as Node | undefined;
  for (const row of asArray(sheetData?.["row"])) {
    const rowNode = row as Node;
    // Missing r= on cells is rare but legal; fall back to document order.
    let nextCol = 1;
    const rowNum = Number(rowNode["@_r"]);
    for (const c of asArray(rowNode["c"])) {
      const n = c as Node;
      let ref = n["@_r"] !== undefined ? String(n["@_r"]) : "";
      if (!CELL_WITH_REF.test(ref)) {
        ref = Number.isFinite(rowNum) ? cellRef(rowNum, nextCol) : "";
      }
      const parsed: WorkbookCell = {};
      const t = String(n["@_t"] ?? "n");
      const v = textOf(n["v"]);
      const formula = textOf(n["f"]);
      if (formula !== undefined) parsed.formula = formula;
      if (n["@_s"] !== undefined) {
        const s = Number(n["@_s"]);
        if (Number.isFinite(s)) {
          parsed.style = s;
          const fmt = numberFormats[s];
          if (fmt !== undefined) parsed.numberFormat = fmt;
        }
      }
      if (v !== undefined || t === "inlineStr") {
        switch (t) {
          case "s": {
            const idx = Number(v);
            parsed.value = sharedStrings[idx] ?? "";
            break;
          }
          case "inlineStr":
            parsed.value = joinText(n["is"]);
            break;
          case "b":
            parsed.value = v === "1" || v === "true";
            break;
          case "e":
            parsed.value = v ?? "";
            parsed.error = true;
            break;
          case "str":
            parsed.value = v ?? "";
            break;
          default:
            parsed.value = v === undefined ? undefined : Number(v);
        }
      }
      if (parsed.value !== undefined || parsed.formula !== undefined || parsed.style !== undefined)
        if (ref) cells.set(ref, parsed);
      const at = ref ? columnIndex(ref.replace(/[0-9]+$/, "")) : nextCol;
      nextCol = at + 1;
    }
  }
  return { cells, merges, dimension };
}

/**
 * Convert .xlsx bytes to the plain workbook model. Formulas stay strings;
 * styles surface as the raw `s` index plus a resolved `numberFormat` so callers
 * can keep date serials aside without interpreting them.
 */
export async function readWorkbook(data: Uint8Array): Promise<Workbook> {
  const zip = await loadXlsx(data);
  const layout = await readLayout(zip);
  const sheets: Worksheet[] = [];
  for (const part of layout.sheets) {
    const parsed = parseSheetXml(
      await readPart(zip, part.path),
      layout.sharedStrings,
      layout.numberFormats,
    );
    sheets.push({
      name: part.name,
      cells: parsed.cells,
      merges: parsed.merges.length ? parsed.merges : undefined,
      dimension: parsed.dimension,
    });
  }
  return { sheets };
}
