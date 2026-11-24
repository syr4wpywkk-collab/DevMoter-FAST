import type JSZip from "jszip";
import { parseXml, asArray, joinText, textOf } from "./xml.js";
import { readPart, resolveTarget } from "./zip.js";

type Node = Record<string, unknown>;

export interface Rel {
  id: string;
  type: string;
  target: string;
}

export interface SheetPart {
  name: string;
  sheetId: string;
  relId: string;
  /** Package part path like "xl/worksheets/sheet1.xml". */
  path: string;
}

export interface PackageLayout {
  /** Workbook part path like "xl/workbook.xml" and its directory ("xl"). */
  workbookPath: string;
  workbookDir: string;
  workbookXml: string;
  rels: Rel[];
  sheets: SheetPart[];
  sharedStrings: string[];
  /** sharedStrings part path when present. */
  sharedStringsPath?: string;
  /** styles part path when present. */
  stylesPath?: string;
  /** Style index -> numFmt formatCode, resolved from styles.xml. */
  numberFormats: (string | undefined)[];
}

/** Parse a .rels part; returns [] when absent. */
export async function readRels(zip: JSZip, relsPath: string): Promise<Rel[]> {
  const f = zip.file(relsPath);
  if (!f) return [];
  const doc = parseXml(await f.async("string"));
  return asArray((doc["Relationships"] as Node | undefined)?.["Relationship"]).map((r) => {
    const n = r as Node;
    return {
      id: String(n["@_Id"] ?? ""),
      type: String(n["@_Type"] ?? ""),
      target: String(n["@_Target"] ?? ""),
    };
  });
}

const relsPathFor = (partPath: string): string => {
  const at = partPath.lastIndexOf("/");
  return `${partPath.slice(0, at + 1)}_rels/${partPath.slice(at + 1)}.rels`;
};

const relTypeEnds = (suffix: string) => (rel: Rel) => rel.type.endsWith(suffix);

/** Number formats built into OOXML that matter for date/serial interpretation. */
const BUILTIN_FORMATS: Record<number, string> = {
  9: "0%",
  10: "0.00%",
  11: "0.00E+00",
  14: "m/d/yyyy",
  15: "d-mmm-yy",
  16: "d-mmm",
  17: "mmm-yy",
  18: "h:mm AM/PM",
  19: "h:mm:ss AM/PM",
  20: "h:mm",
  21: "h:mm:ss",
  22: "m/d/yyyy h:mm",
  45: "mm:ss",
  46: "[h]:mm:ss",
  47: "mmss.0",
};

function readStyles(doc: Node): (string | undefined)[] {
  const numFmts = new Map<number, string>();
  for (const f of asArray((doc["numFmts"] as Node | undefined)?.["numFmt"])) {
    const n = f as Node;
    numFmts.set(Number(n["@_numFmtId"]), String(n["@_formatCode"] ?? ""));
  }
  return asArray((doc["cellXfs"] as Node | undefined)?.["xf"]).map((xf) => {
    const id = Number((xf as Node)["@_numFmtId"]);
    if (!Number.isFinite(id)) return undefined;
    return numFmts.get(id) ?? BUILTIN_FORMATS[id];
  });
}

/** Locate the workbook part, its sheet parts, shared strings and styles. */
export async function readLayout(zip: JSZip): Promise<PackageLayout> {
  const rootRels = await readRels(zip, "_rels/.rels");
  const docRel = rootRels.find(relTypeEnds("/officeDocument"));
  const workbookPath = docRel
    ? resolveTarget("", docRel.target)
    : "xl/workbook.xml";
  const workbookDir = workbookPath.slice(0, workbookPath.lastIndexOf("/"));
  const workbookXml = await readPart(zip, workbookPath);
  const workbook = parseXml(workbookXml);
  const rels = await readRels(zip, relsPathFor(workbookPath));
  const relById = new Map(rels.map((r) => [r.id, r]));

  const sheets: SheetPart[] = [];
  const sheetList =
    (workbook["workbook"] as Node | undefined)?.["sheets"] as Node | undefined;
  for (const s of asArray(sheetList?.["sheet"])) {
    const n = s as Node;
    const relId = String(n["@_r:id"] ?? "");
    const rel = relById.get(relId);
    if (!rel) continue;
    sheets.push({
      name: String(n["@_name"] ?? ""),
      sheetId: String(n["@_sheetId"] ?? ""),
      relId,
      path: resolveTarget(workbookDir, rel.target),
    });
  }

  const stringsRel = rels.find(relTypeEnds("/sharedStrings"));
  const sharedStringsPath = stringsRel
    ? resolveTarget(workbookDir, stringsRel.target)
    : zip.file(`${workbookDir}/sharedStrings.xml`)
      ? `${workbookDir}/sharedStrings.xml`
      : undefined;
  const sharedStrings: string[] = [];
  if (sharedStringsPath) {
    const doc = parseXml(await readPart(zip, sharedStringsPath));
    for (const si of asArray((doc["sst"] as Node | undefined)?.["si"]))
      sharedStrings.push(joinText(si));
  }

  const stylesRel = rels.find(relTypeEnds("/styles"));
  const stylesPath = stylesRel
    ? resolveTarget(workbookDir, stylesRel.target)
    : zip.file(`${workbookDir}/styles.xml`)
      ? `${workbookDir}/styles.xml`
      : undefined;
  const numberFormats = stylesPath
    ? readStyles(
        (parseXml(await readPart(zip, stylesPath))["styleSheet"] as Node | undefined) ?? {},
      )
    : [];

  return {
    workbookPath,
    workbookDir,
    workbookXml,
    rels,
    sheets,
    sharedStrings,
    sharedStringsPath,
    stylesPath,
    numberFormats,
  };
}

export { textOf };
