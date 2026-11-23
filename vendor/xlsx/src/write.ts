import JSZip from "jszip";
import { loadXlsx, readPart, saveXlsx } from "./internal/zip.js";
import { escapeAttr, escapeXml, spacePreserve } from "./internal/xml.js";
import { readLayout } from "./internal/package.js";
import { parseSheetXml } from "./read.js";
import { dimensionOf, parseCellRef, sortedCellRefs } from "./model.js";
import type { Workbook, WorkbookCell, Worksheet } from "./model.js";

const NS_MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const NS_R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const NS_PKG_RELS = "http://schemas.openxmlformats.org/package/2006/relationships";
const NS_CT = "http://schemas.openxmlformats.org/package/2006/content-types";
const REL_WORKSHEET = `${NS_R}/worksheet`;
const REL_STYLES = `${NS_R}/styles`;
const REL_STRINGS = `${NS_R}/sharedStrings`;
const CT_SHEET =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml";
const CT_STRINGS =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml";
const CT_STYLES =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml";
const CT_WORKBOOK =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml";

/** Assign shared-string indices, reusing existing entries then appending new ones. */
function makeStringIndex(existing: string[]) {
  const index = new Map<string, number>();
  existing.forEach((s, i) => {
    if (!index.has(s)) index.set(s, i);
  });
  const additions: string[] = [];
  return {
    get(text: string): number {
      let i = index.get(text);
      if (i === undefined) {
        i = existing.length + additions.length;
        index.set(text, i);
        additions.push(text);
      }
      return i;
    },
    additions,
  };
}

type StringIndex = ReturnType<typeof makeStringIndex>;

/** One `<c>` element. String cells go through the shared-string table. */
function cellXml(ref: string, cell: WorkbookCell, strings: StringIndex): string {
  let attrs = ` r="${ref}"`;
  if (cell.style !== undefined) attrs += ` s="${cell.style}"`;
  const value = cell.value;
  let body = "";
  let t: string | undefined;
  if (cell.error) t = "e";
  else if (typeof value === "boolean") t = "b";
  else if (typeof value === "string") t = cell.formula !== undefined ? "str" : "s";
  if (t) attrs += ` t="${t}"`;
  if (cell.formula !== undefined) body += `<f>${escapeXml(cell.formula)}</f>`;
  if (value !== undefined) {
    const v =
      typeof value === "boolean"
        ? value ? "1" : "0"
        : typeof value === "string"
          ? t === "s"
            ? String(strings.get(value))
            : escapeXml(value)
          : String(value);
    body += `<v>${v}</v>`;
  }
  return body ? `<c${attrs}>${body}</c>` : `<c${attrs}/>`;
}

function rowsXml(sheet: Worksheet, strings: StringIndex): string {
  const refs = sortedCellRefs(sheet.cells);
  let out = "";
  let row = 0;
  let open = false;
  for (const ref of refs) {
    const { row: r } = parseCellRef(ref);
    if (r !== row) {
      if (open) out += "</row>";
      out += `<row r="${r}">`;
      row = r;
      open = true;
    }
    out += cellXml(ref, sheet.cells.get(ref)!, strings);
  }
  if (open) out += "</row>";
  return out;
}

const sheetDataXml = (sheet: Worksheet, strings: StringIndex): string => {
  const rows = rowsXml(sheet, strings);
  return rows ? `<sheetData>${rows}</sheetData>` : "<sheetData/>";
};

const mergeCellsXml = (merges: string[] | undefined): string =>
  merges && merges.length
    ? `<mergeCells count="${merges.length}">${merges
        .map((ref) => `<mergeCell ref="${escapeAttr(ref)}"/>`)
        .join("")}</mergeCells>`
    : "";

/** Complete worksheet part for a sheet that has no original to patch. */
function sheetXml(sheet: Worksheet, strings: StringIndex): string {
  const dim = dimensionOf(sheet.cells.keys()) ?? "A1";
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="${NS_MAIN}" xmlns:r="${NS_R}">` +
    `<dimension ref="${dim}"/>` +
    sheetDataXml(sheet, strings) +
    mergeCellsXml(sheet.merges) +
    `</worksheet>`
  );
}

/**
 * Rewrite only `<dimension>`, `<sheetData>` and `<mergeCells>` inside the
 * original worksheet part so columns, views, print setup and any other
 * extensions keep their bytes.
 */
function patchSheetXml(xml: string, sheet: Worksheet, strings: StringIndex): string {
  let out = xml;
  const dim = dimensionOf(sheet.cells.keys());
  if (/<dimension\b[^>]*\bref="[^"]*"/.test(out)) {
    if (dim !== undefined)
      out = out.replace(/(<dimension\b[^>]*\bref=")[^"]*(")/, `$1${dim}$2`);
    else out = out.replace(/<dimension\b[^>]*\/>/, "");
  } else if (dim !== undefined) {
    // Dimension precedes sheetData in schema order.
    out = out.replace(/<sheetData\b/, `<dimension ref="${dim}"/><sheetData`);
  }
  const data = sheetDataXml(sheet, strings);
  if (/<sheetData\s*\/>/.test(out))
    out = out.replace(/<sheetData\s*\/>/, () => data);
  else if (/<sheetData>[\s\S]*<\/sheetData>/.test(out))
    out = out.replace(/<sheetData>[\s\S]*<\/sheetData>/, () => data);
  else out = out.replace(/<\/worksheet>/, () => `${data}</worksheet>`);
  const merges = mergeCellsXml(sheet.merges);
  if (/<mergeCells\b[^>]*>[\s\S]*<\/mergeCells>/.test(out))
    out = out.replace(/<mergeCells\b[^>]*>[\s\S]*<\/mergeCells>/, () => merges);
  else if (/<mergeCells\b[^>]*\/>/.test(out))
    out = out.replace(/<mergeCells\b[^>]*\/>/, () => merges);
  else if (merges) out = out.replace(/<\/sheetData>/, () => `</sheetData>${merges}`);
  return out;
}

/** Canonical cell form so a re-parsed original and the model compare equal. */
const cellKey = (cell: WorkbookCell): string =>
  JSON.stringify({
    v: cell.value,
    f: cell.formula,
    e: cell.error || undefined,
    s: cell.style,
  });

function sameCells(a: Map<string, WorkbookCell>, b: Map<string, WorkbookCell>): boolean {
  if (a.size !== b.size) return false;
  for (const [ref, cell] of a) {
    const other = b.get(ref);
    if (!other || cellKey(cell) !== cellKey(other)) return false;
  }
  return true;
}

const sameMerges = (a: string[] | undefined, b: string[]): boolean =>
  JSON.stringify(a ?? []) === JSON.stringify(b);

const countStringCells = (cells: Map<string, WorkbookCell>): number => {
  let n = 0;
  for (const cell of cells.values())
    if (typeof cell.value === "string" && cell.formula === undefined && !cell.error) n++;
  return n;
};

const relsPathFor = (partPath: string): string => {
  const at = partPath.lastIndexOf("/");
  return `${partPath.slice(0, at + 1)}_rels/${partPath.slice(at + 1)}.rels`;
};

/** Update/insert an attribute in the first match of `<tag ...>` — used for sst counts. */
function setAttr(xml: string, tag: string, name: string, value: number): string {
  return xml.replace(new RegExp(`<${tag}\\b[^>]*>`), (open) => {
    if (new RegExp(`\\b${name}="[^"]*"`).test(open))
      return open.replace(new RegExp(`\\b${name}="[^"]*"`), `${name}="${value}"`);
    return open.replace(/>$/, ` ${name}="${value}">`);
  });
}

function checkModel(model: Workbook): void {
  const names = new Set<string>();
  for (const sheet of model.sheets) {
    if (names.has(sheet.name)) throw new Error(`duplicate sheet name: ${sheet.name}`);
    names.add(sheet.name);
    for (const ref of sheet.cells.keys()) parseCellRef(ref); // validates
  }
}

/** Patch `originalBytes` in place: only changed sheet parts (+ shared strings/rels as needed) are rewritten. */
async function patchWorkbook(model: Workbook, originalBytes: Uint8Array): Promise<Uint8Array> {
  const zip = await loadXlsx(originalBytes);
  const layout = await readLayout(zip);
  const byName = new Map(layout.sheets.map((s) => [s.name, s]));

  const strings = makeStringIndex(layout.sharedStrings);
  let totalStrings = 0;
  const matched = new Set<string>();
  const added: string[] = [];

  for (const sheet of model.sheets) {
    const part = byName.get(sheet.name);
    if (!part) {
      added.push(sheet.name);
      continue;
    }
    matched.add(part.path);
    const originalXml = await readPart(zip, part.path);
    const parsed = parseSheetXml(originalXml, layout.sharedStrings);
    if (sameCells(parsed.cells, sheet.cells) && sameMerges(sheet.merges, parsed.merges)) {
      totalStrings += countStringCells(parsed.cells);
      continue;
    }
    zip.file(part.path, patchSheetXml(originalXml, sheet, strings));
    totalStrings += countStringCells(sheet.cells);
  }
  const removed = layout.sheets.filter((s) => !matched.has(s.path));
  if (removed.length)
    throw new Error(
      `removing sheets is not supported when patching (${removed.map((s) => s.name).join(", ")})`,
    );

  // New sheets: fresh parts plus workbook.xml / rels / content-type entries.
  if (added.length) {
    const usedIds = new Set(layout.rels.map((r) => r.id));
    let nextRid = 1;
    let maxSheetId = layout.sheets.reduce(
      (m, s) => Math.max(m, Number(s.sheetId) || 0),
      0,
    );
    let nextPart = 1;
    const partNumbers = layout.sheets.map((s) => {
      const m = /sheet(\d+)\.xml$/.exec(s.path);
      return m ? Number(m[1]) : 0;
    });
    nextPart = Math.max(0, ...partNumbers) + 1;
    let workbookXml = layout.workbookXml;
    let relsXml = await (zip.file(relsPathFor(layout.workbookPath))?.async("string") ??
      Promise.resolve(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${NS_PKG_RELS}"></Relationships>`,
      ));
    let contentTypes = await readPart(zip, "[Content_Types].xml");
    for (const name of added) {
      while (usedIds.has(`rId${nextRid}`)) nextRid++;
      const relId = `rId${nextRid}`;
      usedIds.add(relId);
      const path = `${layout.workbookDir}/worksheets/sheet${nextPart++}.xml`;
      const modelSheet = model.sheets.find((s) => s.name === name)!;
      zip.file(path, sheetXml(modelSheet, strings));
      totalStrings += countStringCells(modelSheet.cells);
      const entry = `<sheet name="${escapeAttr(name)}" sheetId="${++maxSheetId}" r:id="${relId}"/>`;
      if (/<\/sheets>/.test(workbookXml))
        workbookXml = workbookXml.replace(/<\/sheets>/, () => `${entry}</sheets>`);
      else
        workbookXml = workbookXml.replace(/<sheets\s*\/>/, () => `<sheets>${entry}</sheets>`);
      const target = path.slice(layout.workbookDir.length + 1);
      relsXml = relsXml.replace(
        /<\/Relationships>/,
        () =>
          `<Relationship Id="${relId}" Type="${REL_WORKSHEET}" Target="${escapeAttr(target)}"/></Relationships>`,
      );
      contentTypes = contentTypes.replace(
        /<\/Types>/,
        () => `<Override PartName="/${path}" ContentType="${CT_SHEET}"/></Types>`,
      );
    }
    zip.file(layout.workbookPath, workbookXml);
    zip.file(relsPathFor(layout.workbookPath), relsXml);
    zip.file("[Content_Types].xml", contentTypes);
  }

  // Shared strings: append new entries; create the part when absent.
  if (strings.additions.length) {
    const items = strings.additions
      .map((s) => `<si><t${spacePreserve(s)}>${escapeXml(s)}</t></si>`)
      .join("");
    if (layout.sharedStringsPath) {
      let xml = await readPart(zip, layout.sharedStringsPath);
      xml = xml.replace(/<\/sst>/, `${items}</sst>`);
      xml = setAttr(xml, "sst", "count", totalStrings);
      xml = setAttr(
        xml,
        "sst",
        "uniqueCount",
        layout.sharedStrings.length + strings.additions.length,
      );
      zip.file(layout.sharedStringsPath, xml);
    } else {
      const path = `${layout.workbookDir}/sharedStrings.xml`;
      zip.file(
        path,
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
          `<sst xmlns="${NS_MAIN}" count="${totalStrings}" uniqueCount="${strings.additions.length}">${items}</sst>`,
      );
      const relsPath = relsPathFor(layout.workbookPath);
      let relsXml = await (zip.file(relsPath)?.async("string") ??
        Promise.resolve(
          `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${NS_PKG_RELS}"></Relationships>`,
        ));
      const usedIds = new Set(layout.rels.map((r) => r.id));
      let n = 1;
      while (usedIds.has(`rId${n}`)) n++;
      relsXml = relsXml.replace(
        /<\/Relationships>/,
        `<Relationship Id="rId${n}" Type="${REL_STRINGS}" Target="sharedStrings.xml"/></Relationships>`,
      );
      zip.file(relsPath, relsXml);
      let contentTypes = await readPart(zip, "[Content_Types].xml");
      contentTypes = contentTypes.replace(
        /<\/Types>/,
        `<Override PartName="/${path}" ContentType="${CT_STRINGS}"/></Types>`,
      );
      zip.file("[Content_Types].xml", contentTypes);
    }
  }
  return saveXlsx(zip);
}

const MINIMAL_STYLES =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<styleSheet xmlns="${NS_MAIN}"><fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts>` +
  `<fills count="1"><fill><patternFill/></fill></fills><borders count="1"><border/></borders>` +
  `<cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="1"><xf/></cellXfs></styleSheet>`;

/** Emit a minimal valid workbook when there are no original bytes to patch. */
async function buildWorkbook(model: Workbook): Promise<Uint8Array> {
  const zip = new JSZip();
  const strings = makeStringIndex([]);
  const sheetXmls = model.sheets.map((s) => sheetXml(s, strings));
  const totalStrings = model.sheets.reduce((n, s) => n + countStringCells(s.cells), 0);

  const overrides = model.sheets
    .map(
      (_, i) =>
        `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="${CT_SHEET}"/>`,
    )
    .join("");
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Types xmlns="${NS_CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
      `<Default Extension="xml" ContentType="application/xml"/>` +
      `<Override PartName="/xl/workbook.xml" ContentType="${CT_WORKBOOK}"/>` +
      `<Override PartName="/xl/styles.xml" ContentType="${CT_STYLES}"/>` +
      (strings.additions.length
        ? `<Override PartName="/xl/sharedStrings.xml" ContentType="${CT_STRINGS}"/>`
        : "") +
      `${overrides}</Types>`,
  );
  zip.file(
    "_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Relationships xmlns="${NS_PKG_RELS}"><Relationship Id="rId1" Type="${NS_R}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
  );
  zip.file(
    "xl/workbook.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<workbook xmlns="${NS_MAIN}" xmlns:r="${NS_R}"><sheets>` +
      model.sheets
        .map(
          (s, i) =>
            `<sheet name="${escapeAttr(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`,
        )
        .join("") +
      `</sheets></workbook>`,
  );
  const sheetRels = model.sheets
    .map(
      (_, i) =>
        `<Relationship Id="rId${i + 1}" Type="${REL_WORKSHEET}" Target="worksheets/sheet${i + 1}.xml"/>`,
    )
    .join("");
  const extra = `<Relationship Id="rId${model.sheets.length + 1}" Type="${REL_STYLES}" Target="styles.xml"/>` +
    (strings.additions.length
      ? `<Relationship Id="rId${model.sheets.length + 2}" Type="${REL_STRINGS}" Target="sharedStrings.xml"/>`
      : "");
  zip.file(
    "xl/_rels/workbook.xml.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Relationships xmlns="${NS_PKG_RELS}">${sheetRels}${extra}</Relationships>`,
  );
  zip.file("xl/styles.xml", MINIMAL_STYLES);
  if (strings.additions.length)
    zip.file(
      "xl/sharedStrings.xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<sst xmlns="${NS_MAIN}" count="${totalStrings}" uniqueCount="${strings.additions.length}">` +
        strings.additions
          .map((s) => `<si><t${spacePreserve(s)}>${escapeXml(s)}</t></si>`)
          .join("") +
        `</sst>`,
    );
  model.sheets.forEach((s, i) =>
    zip.file(`xl/worksheets/sheet${i + 1}.xml`, sheetXmls[i]),
  );
  return saveXlsx(zip);
}

/**
 * Serialize the workbook model. With `originalBytes` only sheet parts whose
 * cells or merges changed are rewritten — styles, theme, and every other part
 * keep their bytes. Without it a minimal valid workbook is emitted (style
 * indices/number formats are preserved only in the patch path; a fresh file
 * carries no styles).
 */
export async function writeWorkbook(
  model: Workbook,
  originalBytes?: Uint8Array,
): Promise<Uint8Array> {
  checkModel(model);
  return originalBytes ? patchWorkbook(model, originalBytes) : buildWorkbook(model);
}
