// Generated from vendored @devmoter/xlsx sources. See vendor/xlsx/NOTICE.md.

// vendor/xlsx/src/internal/zip.ts
import JSZip from "jszip";
async function loadXlsx(data) {
  return JSZip.loadAsync(data);
}
async function saveXlsx(zip) {
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}
async function readPart(zip, path) {
  const f = zip.file(path);
  if (!f) throw new Error(`missing part: ${path}`);
  return f.async("string");
}
function resolveTarget(baseDir, target) {
  const parts = (target.startsWith("/") ? target : `${baseDir}/${target}`).split("/");
  const out = [];
  for (const p of parts) {
    if (p === "..") out.pop();
    else if (p !== "." && p !== "") out.push(p);
  }
  return out.join("/");
}

// vendor/xlsx/src/internal/xml.ts
import { XMLParser } from "fast-xml-parser";
var parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: false
});
function parseXml(xml) {
  return parser.parse(xml);
}
function asArray(node) {
  if (node === void 0 || node === null) return [];
  return Array.isArray(node) ? node : [node];
}
function textOf(node) {
  if (node === void 0 || node === null) return void 0;
  if (typeof node === "object") {
    const t = node["#text"];
    return t === void 0 ? void 0 : String(t);
  }
  return String(node);
}
function joinText(node) {
  let out = "";
  const walk = (n) => {
    if (n === null || typeof n !== "object") return;
    if (Array.isArray(n)) {
      for (const item of n) walk(item);
      return;
    }
    for (const [key, value] of Object.entries(n)) {
      if (key === "t") for (const t of asArray(value)) out += textOf(t) ?? "";
      else if (key !== "#text") walk(value);
    }
  };
  walk(node);
  return out;
}
function escapeXml(text) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function escapeAttr(value) {
  return escapeXml(value).replace(/"/g, "&quot;");
}
function spacePreserve(text) {
  return /^\s|\s$/.test(text) ? ' xml:space="preserve"' : "";
}

// vendor/xlsx/src/internal/package.ts
async function readRels(zip, relsPath) {
  const f = zip.file(relsPath);
  if (!f) return [];
  const doc = parseXml(await f.async("string"));
  return asArray(doc["Relationships"]?.["Relationship"]).map((r) => {
    const n = r;
    return {
      id: String(n["@_Id"] ?? ""),
      type: String(n["@_Type"] ?? ""),
      target: String(n["@_Target"] ?? "")
    };
  });
}
var relsPathFor = (partPath) => {
  const at = partPath.lastIndexOf("/");
  return `${partPath.slice(0, at + 1)}_rels/${partPath.slice(at + 1)}.rels`;
};
var relTypeEnds = (suffix) => (rel) => rel.type.endsWith(suffix);
var BUILTIN_FORMATS = {
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
  47: "mmss.0"
};
function readStyles(doc) {
  const numFmts = /* @__PURE__ */ new Map();
  for (const f of asArray(doc["numFmts"]?.["numFmt"])) {
    const n = f;
    numFmts.set(Number(n["@_numFmtId"]), String(n["@_formatCode"] ?? ""));
  }
  return asArray(doc["cellXfs"]?.["xf"]).map((xf) => {
    const id = Number(xf["@_numFmtId"]);
    if (!Number.isFinite(id)) return void 0;
    return numFmts.get(id) ?? BUILTIN_FORMATS[id];
  });
}
async function readLayout(zip) {
  const rootRels = await readRels(zip, "_rels/.rels");
  const docRel = rootRels.find(relTypeEnds("/officeDocument"));
  const workbookPath = docRel ? resolveTarget("", docRel.target) : "xl/workbook.xml";
  const workbookDir = workbookPath.slice(0, workbookPath.lastIndexOf("/"));
  const workbookXml = await readPart(zip, workbookPath);
  const workbook = parseXml(workbookXml);
  const rels = await readRels(zip, relsPathFor(workbookPath));
  const relById = new Map(rels.map((r) => [r.id, r]));
  const sheets = [];
  const sheetList = workbook["workbook"]?.["sheets"];
  for (const s of asArray(sheetList?.["sheet"])) {
    const n = s;
    const relId = String(n["@_r:id"] ?? "");
    const rel = relById.get(relId);
    if (!rel) continue;
    sheets.push({
      name: String(n["@_name"] ?? ""),
      sheetId: String(n["@_sheetId"] ?? ""),
      relId,
      path: resolveTarget(workbookDir, rel.target)
    });
  }
  const stringsRel = rels.find(relTypeEnds("/sharedStrings"));
  const sharedStringsPath = stringsRel ? resolveTarget(workbookDir, stringsRel.target) : zip.file(`${workbookDir}/sharedStrings.xml`) ? `${workbookDir}/sharedStrings.xml` : void 0;
  const sharedStrings = [];
  if (sharedStringsPath) {
    const doc = parseXml(await readPart(zip, sharedStringsPath));
    for (const si of asArray(doc["sst"]?.["si"]))
      sharedStrings.push(joinText(si));
  }
  const stylesRel = rels.find(relTypeEnds("/styles"));
  const stylesPath = stylesRel ? resolveTarget(workbookDir, stylesRel.target) : zip.file(`${workbookDir}/styles.xml`) ? `${workbookDir}/styles.xml` : void 0;
  const numberFormats = stylesPath ? readStyles(
    parseXml(await readPart(zip, stylesPath))["styleSheet"] ?? {}
  ) : [];
  return {
    workbookPath,
    workbookDir,
    workbookXml,
    rels,
    sheets,
    sharedStrings,
    sharedStringsPath,
    stylesPath,
    numberFormats
  };
}

// vendor/xlsx/src/model.ts
var COL_RE = /^([A-Za-z]+)([0-9]+)$/;
function columnName(index) {
  let out = "";
  let n = index;
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}
function columnIndex(name) {
  let out = 0;
  for (const ch of name.toUpperCase()) out = out * 26 + (ch.charCodeAt(0) - 64);
  return out;
}
function parseCellRef(ref) {
  const m = COL_RE.exec(ref);
  if (!m) throw new Error(`invalid cell reference: ${ref}`);
  return { row: Number(m[2]), col: columnIndex(m[1]) };
}
function cellRef(row, col) {
  return `${columnName(col)}${row}`;
}
function dimensionOf(refs) {
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
  if (!maxRow) return void 0;
  const first = cellRef(minRow, minCol);
  const last = cellRef(maxRow, maxCol);
  return first === last ? first : `${first}:${last}`;
}
function sortedCellRefs(cells) {
  return [...cells.keys()].sort((a, b) => {
    const pa = parseCellRef(a);
    const pb = parseCellRef(b);
    return pa.row - pb.row || pa.col - pb.col;
  });
}

// vendor/xlsx/src/read.ts
var CELL_WITH_REF = /^[A-Za-z]+[0-9]+$/;
function parseSheetXml(xml, sharedStrings, numberFormats = []) {
  const doc = parseXml(xml);
  const sheet = doc["worksheet"];
  const cells = /* @__PURE__ */ new Map();
  const merges = [];
  let dimension;
  const dim = sheet?.["dimension"];
  if (dim?.["@_ref"] !== void 0) dimension = String(dim["@_ref"]);
  for (const mc of asArray(
    sheet?.["mergeCells"]?.["mergeCell"]
  )) {
    const ref = mc["@_ref"];
    if (ref !== void 0) merges.push(String(ref));
  }
  const sheetData = sheet?.["sheetData"];
  for (const row of asArray(sheetData?.["row"])) {
    const rowNode = row;
    let nextCol = 1;
    const rowNum = Number(rowNode["@_r"]);
    for (const c of asArray(rowNode["c"])) {
      const n = c;
      let ref = n["@_r"] !== void 0 ? String(n["@_r"]) : "";
      if (!CELL_WITH_REF.test(ref)) {
        ref = Number.isFinite(rowNum) ? cellRef(rowNum, nextCol) : "";
      }
      const parsed = {};
      const t = String(n["@_t"] ?? "n");
      const v = textOf(n["v"]);
      const formula = textOf(n["f"]);
      if (formula !== void 0) parsed.formula = formula;
      if (n["@_s"] !== void 0) {
        const s = Number(n["@_s"]);
        if (Number.isFinite(s)) {
          parsed.style = s;
          const fmt = numberFormats[s];
          if (fmt !== void 0) parsed.numberFormat = fmt;
        }
      }
      if (v !== void 0 || t === "inlineStr") {
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
            parsed.value = v === void 0 ? void 0 : Number(v);
        }
      }
      if (parsed.value !== void 0 || parsed.formula !== void 0 || parsed.style !== void 0) {
        if (ref) cells.set(ref, parsed);
      }
      const at = ref ? columnIndex(ref.replace(/[0-9]+$/, "")) : nextCol;
      nextCol = at + 1;
    }
  }
  return { cells, merges, dimension };
}
async function readWorkbook(data) {
  const zip = await loadXlsx(data);
  const layout = await readLayout(zip);
  const sheets = [];
  for (const part of layout.sheets) {
    const parsed = parseSheetXml(
      await readPart(zip, part.path),
      layout.sharedStrings,
      layout.numberFormats
    );
    sheets.push({
      name: part.name,
      cells: parsed.cells,
      merges: parsed.merges.length ? parsed.merges : void 0,
      dimension: parsed.dimension
    });
  }
  return { sheets };
}

// vendor/xlsx/src/write.ts
import JSZip2 from "jszip";
var NS_MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
var NS_R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
var NS_PKG_RELS = "http://schemas.openxmlformats.org/package/2006/relationships";
var NS_CT = "http://schemas.openxmlformats.org/package/2006/content-types";
var REL_WORKSHEET = `${NS_R}/worksheet`;
var REL_STYLES = `${NS_R}/styles`;
var REL_STRINGS = `${NS_R}/sharedStrings`;
var CT_SHEET = "application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml";
var CT_STRINGS = "application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml";
var CT_STYLES = "application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml";
var CT_WORKBOOK = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml";
function makeStringIndex(existing) {
  const index = /* @__PURE__ */ new Map();
  existing.forEach((s, i) => {
    if (!index.has(s)) index.set(s, i);
  });
  const additions = [];
  return {
    get(text) {
      let i = index.get(text);
      if (i === void 0) {
        i = existing.length + additions.length;
        index.set(text, i);
        additions.push(text);
      }
      return i;
    },
    additions
  };
}
function cellXml(ref, cell, strings) {
  let attrs = ` r="${ref}"`;
  if (cell.style !== void 0) attrs += ` s="${cell.style}"`;
  const value = cell.value;
  let body = "";
  let t;
  if (cell.error) t = "e";
  else if (typeof value === "boolean") t = "b";
  else if (typeof value === "string") t = cell.formula !== void 0 ? "str" : "s";
  if (t) attrs += ` t="${t}"`;
  if (cell.formula !== void 0) body += `<f>${escapeXml(cell.formula)}</f>`;
  if (value !== void 0) {
    const v = typeof value === "boolean" ? value ? "1" : "0" : typeof value === "string" ? t === "s" ? String(strings.get(value)) : escapeXml(value) : String(value);
    body += `<v>${v}</v>`;
  }
  return body ? `<c${attrs}>${body}</c>` : `<c${attrs}/>`;
}
function rowsXml(sheet, strings) {
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
    out += cellXml(ref, sheet.cells.get(ref), strings);
  }
  if (open) out += "</row>";
  return out;
}
var sheetDataXml = (sheet, strings) => {
  const rows = rowsXml(sheet, strings);
  return rows ? `<sheetData>${rows}</sheetData>` : "<sheetData/>";
};
var mergeCellsXml = (merges) => merges && merges.length ? `<mergeCells count="${merges.length}">${merges.map((ref) => `<mergeCell ref="${escapeAttr(ref)}"/>`).join("")}</mergeCells>` : "";
function sheetXml(sheet, strings) {
  const dim = dimensionOf(sheet.cells.keys()) ?? "A1";
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="${NS_MAIN}" xmlns:r="${NS_R}"><dimension ref="${dim}"/>` + sheetDataXml(sheet, strings) + mergeCellsXml(sheet.merges) + `</worksheet>`;
}
function patchSheetXml(xml, sheet, strings) {
  let out = xml;
  const dim = dimensionOf(sheet.cells.keys());
  if (/<dimension\b[^>]*\bref="[^"]*"/.test(out)) {
    if (dim !== void 0)
      out = out.replace(/(<dimension\b[^>]*\bref=")[^"]*(")/, `$1${dim}$2`);
    else out = out.replace(/<dimension\b[^>]*\/>/, "");
  } else if (dim !== void 0) {
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
var cellKey = (cell) => JSON.stringify({
  v: cell.value,
  f: cell.formula,
  e: cell.error || void 0,
  s: cell.style
});
function sameCells(a, b) {
  if (a.size !== b.size) return false;
  for (const [ref, cell] of a) {
    const other = b.get(ref);
    if (!other || cellKey(cell) !== cellKey(other)) return false;
  }
  return true;
}
var sameMerges = (a, b) => JSON.stringify(a ?? []) === JSON.stringify(b);
var countStringCells = (cells) => {
  let n = 0;
  for (const cell of cells.values())
    if (typeof cell.value === "string" && cell.formula === void 0 && !cell.error) n++;
  return n;
};
var relsPathFor2 = (partPath) => {
  const at = partPath.lastIndexOf("/");
  return `${partPath.slice(0, at + 1)}_rels/${partPath.slice(at + 1)}.rels`;
};
function setAttr(xml, tag, name, value) {
  return xml.replace(new RegExp(`<${tag}\\b[^>]*>`), (open) => {
    if (new RegExp(`\\b${name}="[^"]*"`).test(open))
      return open.replace(new RegExp(`\\b${name}="[^"]*"`), `${name}="${value}"`);
    return open.replace(/>$/, ` ${name}="${value}">`);
  });
}
function checkModel(model) {
  const names = /* @__PURE__ */ new Set();
  for (const sheet of model.sheets) {
    if (names.has(sheet.name)) throw new Error(`duplicate sheet name: ${sheet.name}`);
    names.add(sheet.name);
    for (const ref of sheet.cells.keys()) parseCellRef(ref);
  }
}
async function patchWorkbook(model, originalBytes) {
  const zip = await loadXlsx(originalBytes);
  const layout = await readLayout(zip);
  const byName = new Map(layout.sheets.map((s) => [s.name, s]));
  const strings = makeStringIndex(layout.sharedStrings);
  let totalStrings = 0;
  const matched = /* @__PURE__ */ new Set();
  const added = [];
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
      `removing sheets is not supported when patching (${removed.map((s) => s.name).join(", ")})`
    );
  if (added.length) {
    const usedIds = new Set(layout.rels.map((r) => r.id));
    let nextRid = 1;
    let maxSheetId = layout.sheets.reduce(
      (m, s) => Math.max(m, Number(s.sheetId) || 0),
      0
    );
    let nextPart = 1;
    const partNumbers = layout.sheets.map((s) => {
      const m = /sheet(\d+)\.xml$/.exec(s.path);
      return m ? Number(m[1]) : 0;
    });
    nextPart = Math.max(0, ...partNumbers) + 1;
    let workbookXml = layout.workbookXml;
    let relsXml = await (zip.file(relsPathFor2(layout.workbookPath))?.async("string") ?? Promise.resolve(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${NS_PKG_RELS}"></Relationships>`
    ));
    let contentTypes = await readPart(zip, "[Content_Types].xml");
    for (const name of added) {
      while (usedIds.has(`rId${nextRid}`)) nextRid++;
      const relId = `rId${nextRid}`;
      usedIds.add(relId);
      const path = `${layout.workbookDir}/worksheets/sheet${nextPart++}.xml`;
      const modelSheet = model.sheets.find((s) => s.name === name);
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
        () => `<Relationship Id="${relId}" Type="${REL_WORKSHEET}" Target="${escapeAttr(target)}"/></Relationships>`
      );
      contentTypes = contentTypes.replace(
        /<\/Types>/,
        () => `<Override PartName="/${path}" ContentType="${CT_SHEET}"/></Types>`
      );
    }
    zip.file(layout.workbookPath, workbookXml);
    zip.file(relsPathFor2(layout.workbookPath), relsXml);
    zip.file("[Content_Types].xml", contentTypes);
  }
  if (strings.additions.length) {
    const items = strings.additions.map((s) => `<si><t${spacePreserve(s)}>${escapeXml(s)}</t></si>`).join("");
    if (layout.sharedStringsPath) {
      let xml = await readPart(zip, layout.sharedStringsPath);
      xml = xml.replace(/<\/sst>/, `${items}</sst>`);
      xml = setAttr(xml, "sst", "count", totalStrings);
      xml = setAttr(
        xml,
        "sst",
        "uniqueCount",
        layout.sharedStrings.length + strings.additions.length
      );
      zip.file(layout.sharedStringsPath, xml);
    } else {
      const path = `${layout.workbookDir}/sharedStrings.xml`;
      zip.file(
        path,
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><sst xmlns="${NS_MAIN}" count="${totalStrings}" uniqueCount="${strings.additions.length}">${items}</sst>`
      );
      const relsPath = relsPathFor2(layout.workbookPath);
      let relsXml = await (zip.file(relsPath)?.async("string") ?? Promise.resolve(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${NS_PKG_RELS}"></Relationships>`
      ));
      const usedIds = new Set(layout.rels.map((r) => r.id));
      let n = 1;
      while (usedIds.has(`rId${n}`)) n++;
      relsXml = relsXml.replace(
        /<\/Relationships>/,
        `<Relationship Id="rId${n}" Type="${REL_STRINGS}" Target="sharedStrings.xml"/></Relationships>`
      );
      zip.file(relsPath, relsXml);
      let contentTypes = await readPart(zip, "[Content_Types].xml");
      contentTypes = contentTypes.replace(
        /<\/Types>/,
        `<Override PartName="/${path}" ContentType="${CT_STRINGS}"/></Types>`
      );
      zip.file("[Content_Types].xml", contentTypes);
    }
  }
  return saveXlsx(zip);
}
var MINIMAL_STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="${NS_MAIN}"><fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts><fills count="1"><fill><patternFill/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="1"><xf/></cellXfs></styleSheet>`;
async function buildWorkbook(model) {
  const zip = new JSZip2();
  const strings = makeStringIndex([]);
  const sheetXmls = model.sheets.map((s) => sheetXml(s, strings));
  const totalStrings = model.sheets.reduce((n, s) => n + countStringCells(s.cells), 0);
  const overrides = model.sheets.map(
    (_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="${CT_SHEET}"/>`
  ).join("");
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="${NS_CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="${CT_WORKBOOK}"/><Override PartName="/xl/styles.xml" ContentType="${CT_STYLES}"/>` + (strings.additions.length ? `<Override PartName="/xl/sharedStrings.xml" ContentType="${CT_STRINGS}"/>` : "") + `${overrides}</Types>`
  );
  zip.file(
    "_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${NS_PKG_RELS}"><Relationship Id="rId1" Type="${NS_R}/officeDocument" Target="xl/workbook.xml"/></Relationships>`
  );
  zip.file(
    "xl/workbook.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="${NS_MAIN}" xmlns:r="${NS_R}"><sheets>` + model.sheets.map(
      (s, i) => `<sheet name="${escapeAttr(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`
    ).join("") + `</sheets></workbook>`
  );
  const sheetRels = model.sheets.map(
    (_, i) => `<Relationship Id="rId${i + 1}" Type="${REL_WORKSHEET}" Target="worksheets/sheet${i + 1}.xml"/>`
  ).join("");
  const extra = `<Relationship Id="rId${model.sheets.length + 1}" Type="${REL_STYLES}" Target="styles.xml"/>` + (strings.additions.length ? `<Relationship Id="rId${model.sheets.length + 2}" Type="${REL_STRINGS}" Target="sharedStrings.xml"/>` : "");
  zip.file(
    "xl/_rels/workbook.xml.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${NS_PKG_RELS}">${sheetRels}${extra}</Relationships>`
  );
  zip.file("xl/styles.xml", MINIMAL_STYLES);
  if (strings.additions.length)
    zip.file(
      "xl/sharedStrings.xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><sst xmlns="${NS_MAIN}" count="${totalStrings}" uniqueCount="${strings.additions.length}">` + strings.additions.map((s) => `<si><t${spacePreserve(s)}>${escapeXml(s)}</t></si>`).join("") + `</sst>`
    );
  model.sheets.forEach(
    (s, i) => zip.file(`xl/worksheets/sheet${i + 1}.xml`, sheetXmls[i])
  );
  return saveXlsx(zip);
}
async function writeWorkbook(model, originalBytes) {
  checkModel(model);
  return originalBytes ? patchWorkbook(model, originalBytes) : buildWorkbook(model);
}
export {
  cellRef,
  columnIndex,
  columnName,
  dimensionOf,
  parseCellRef,
  readWorkbook,
  sortedCellRefs,
  writeWorkbook
};
