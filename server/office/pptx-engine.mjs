// Generated from vendored @devmoter/pptx sources. See vendor/pptx/NOTICE.md.
var __defProp = Object.defineProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// vendor/pptx/src/internal/zip.ts
var zip_exports = {};
__export(zip_exports, {
  loadPptx: () => loadPptx,
  readPart: () => readPart,
  savePptx: () => savePptx,
  slidePartPaths: () => slidePartPaths
});
import JSZip from "jszip";
async function loadPptx(data) {
  return JSZip.loadAsync(data);
}
async function savePptx(zip) {
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}
async function readPart(zip, path) {
  const f = zip.file(path);
  if (!f) throw new Error(`missing part: ${path}`);
  return f.async("string");
}
function slidePartPaths(zip) {
  return Object.keys(zip.files).filter((p) => /^ppt\/slides\/slide\d+\.xml$/.test(p)).sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]));
}

// vendor/pptx/src/internal/xml.ts
import { XMLParser } from "fast-xml-parser";
var parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  parseTagValue: false,
  parseAttributeValue: false,
  // Keep whitespace inside runs: <a:t xml:space="preserve"> may carry
  // meaningful leading/trailing spaces.
  trimValues: false
});
function parseXml(xml) {
  return parser.parse(xml);
}
function asArray(node) {
  if (node === void 0 || node === null) return [];
  return Array.isArray(node) ? node : [node];
}

// vendor/pptx/src/read.ts
function resolveTarget(baseDir, target) {
  const parts = (baseDir + "/" + target).split("/");
  const out = [];
  for (const p of parts) {
    if (p === "..") out.pop();
    else if (p !== "." && p !== "") out.push(p);
  }
  return out.join("/");
}
async function readRels(zip, relsPath) {
  const f = zip.file(relsPath);
  if (!f) return [];
  const doc = parseXml(await f.async("string"));
  return asArray(doc["Relationships"]?.["Relationship"]).map(
    (r) => {
      const n = r;
      return {
        id: String(n["@_Id"] ?? ""),
        type: String(n["@_Type"] ?? ""),
        target: String(n["@_Target"] ?? "")
      };
    }
  );
}
function contentTypeLookup(doc) {
  const byPart = /* @__PURE__ */ new Map();
  const byExt = /* @__PURE__ */ new Map();
  const types = doc["Types"];
  for (const d of asArray(types?.["Default"])) {
    const n = d;
    byExt.set(String(n["@_Extension"]), String(n["@_ContentType"]));
  }
  for (const o of asArray(types?.["Override"])) {
    const n = o;
    byPart.set(String(n["@_PartName"]).replace(/^\//, ""), String(n["@_ContentType"]));
  }
  return { byPart, byExt };
}
function joinRuns(node) {
  let out = "";
  const walk = (n) => {
    if (n === null || typeof n !== "object") return;
    if (Array.isArray(n)) {
      for (const item of n) walk(item);
      return;
    }
    for (const [key, value] of Object.entries(n)) {
      if (key === "a:t") {
        for (const t of asArray(value)) out += String(t ?? "");
      } else {
        walk(value);
      }
    }
  };
  walk(node);
  return out;
}
function placeholderType(sp) {
  const ph = sp["p:nvSpPr"]?.["p:nvPr"];
  const phEl = ph?.["p:ph"];
  if (!phEl) return void 0;
  return String(phEl["@_type"] ?? "body");
}
async function readSlide(zip, slidePath, contentTypes, index) {
  const doc = parseXml(await readPart(zip, slidePath));
  const slideDir = slidePath.slice(0, slidePath.lastIndexOf("/"));
  const slideName = slidePath.slice(slidePath.lastIndexOf("/") + 1);
  const rels = await readRels(zip, `${slideDir}/_rels/${slideName}.rels`);
  const relById = new Map(rels.map((r) => [r.id, r]));
  const spTree = doc["p:sld"]?.["p:cSld"]?.["p:spTree"];
  const texts = [];
  const tables = [];
  const images = [];
  const placeholders = [];
  const graphics = [];
  for (const sp of asArray(spTree?.["p:sp"])) {
    const n = sp;
    const phType = placeholderType(n);
    if (phType !== void 0) placeholders.push(phType);
    const txBody = n["p:txBody"];
    if (txBody === void 0) continue;
    const runs = joinRuns(txBody);
    const cNvPr = n["p:nvSpPr"]?.["p:cNvPr"];
    const shapeName = cNvPr && cNvPr["@_name"] !== void 0 ? String(cNvPr["@_name"]) : void 0;
    const hasRun = JSON.stringify(txBody).includes('"a:t"');
    if (hasRun) texts.push(shapeName ? { shapeName, text: runs } : { text: runs });
  }
  for (const gf of asArray(spTree?.["p:graphicFrame"])) {
    const n = gf;
    const graphicData = n["a:graphic"]?.["a:graphicData"] ?? void 0;
    const tbl = graphicData?.["a:tbl"];
    if (tbl) {
      const rows = asArray(tbl["a:tr"]).map(
        (tr) => asArray(tr["a:tc"]).map((tc) => joinRuns(tc))
      );
      tables.push({ rows });
    }
  }
  for (const pic of asArray(spTree?.["p:pic"])) {
    const n = pic;
    const blipFill = n["p:blipFill"];
    const blip = asArray(blipFill?.["a:blip"])[0];
    const embed = blip?.["@_r:embed"];
    const rel = embed !== void 0 ? relById.get(String(embed)) : void 0;
    if (!rel) continue;
    const partPath = resolveTarget(slideDir, rel.target);
    const ext = partPath.split(".").pop() ?? "";
    const contentType = contentTypes.byPart.get(partPath) ?? contentTypes.byExt.get(ext) ?? "";
    images.push({ partPath, contentType });
  }
  for (const rel of rels) {
    if (/\/(chart|diagram)/.test(rel.type)) {
      graphics.push(resolveTarget(slideDir, rel.target));
    }
  }
  const notesRel = rels.find((r) => r.type.endsWith("/notesSlide"));
  let notes;
  if (notesRel) {
    const notesPath = resolveTarget(slideDir, notesRel.target);
    const notesFile = zip.file(notesPath);
    if (notesFile) {
      const notesDoc = parseXml(await notesFile.async("string"));
      const notesTree = notesDoc["p:notes"]?.["p:cSld"]?.["p:spTree"];
      const chunks = [];
      for (const sp of asArray(notesTree?.["p:sp"])) {
        const n = sp;
        const phType = placeholderType(n);
        if (phType !== void 0 && phType !== "body") continue;
        const t = joinRuns(n["p:txBody"]);
        if (t) chunks.push(t);
      }
      if (chunks.length) notes = chunks.join("\n");
    }
  }
  const outline = { index, texts, tables, images, placeholders, graphics };
  if (notes !== void 0) outline.notes = notes;
  return outline;
}
async function readOutline(data) {
  const zip = await loadPptx(data);
  const contentTypes = contentTypeLookup(
    parseXml(await readPart(zip, "[Content_Types].xml"))
  );
  let size;
  const presFile = zip.file("ppt/presentation.xml");
  if (presFile) {
    const pres = parseXml(await presFile.async("string"));
    const sldSz = pres["p:presentation"]?.["p:sldSz"];
    if (sldSz && sldSz["@_cx"] !== void 0 && sldSz["@_cy"] !== void 0) {
      size = { wEmu: Number(sldSz["@_cx"]), hEmu: Number(sldSz["@_cy"]) };
    }
  }
  const paths = slidePartPaths(zip);
  const slides = [];
  for (let i = 0; i < paths.length; i++) {
    slides.push(await readSlide(zip, paths[i], contentTypes, i));
  }
  return { slideCount: slides.length, ...size ? { size } : {}, slides };
}

// vendor/pptx/src/edit.ts
var XML_ENTITIES = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&apos;": "'"
};
function unescapeXml(s) {
  return s.replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10))).replace(/&(amp|lt|gt|quot|apos);/g, (m) => XML_ENTITIES[m] ?? m);
}
function escapeXml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function countOccurrences(haystack, needle) {
  if (needle === "") return 0;
  let n = 0;
  let i = 0;
  while ((i = haystack.indexOf(needle, i)) !== -1) {
    n++;
    i += needle.length;
  }
  return n;
}
var REL_OFFICE = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
var CT_SLIDE = "application/vnd.openxmlformats-officedocument.presentationml.slide+xml";
var CT_NOTES_SLIDE = "application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml";
var CONTENT_TYPES = "[Content_Types].xml";
var PRESENTATION = "ppt/presentation.xml";
var PRESENTATION_RELS = "ppt/_rels/presentation.xml.rels";
function parseRels(xml) {
  const rels = [];
  for (const m of xml.matchAll(/<Relationship\b([^>]*?)\/?>(?:<\/Relationship>)?/g)) {
    const attrs = m[1];
    const get = (name) => attrs.match(new RegExp(`${name}="([^"]*)"`))?.[1] ?? "";
    rels.push({ id: get("Id"), type: get("Type"), target: get("Target") });
  }
  return rels;
}
function relsPathFor(partPath) {
  const dir = partPath.slice(0, partPath.lastIndexOf("/"));
  const name = partPath.slice(partPath.lastIndexOf("/") + 1);
  return `${dir}/_rels/${name}.rels`;
}
function dirOf(partPath) {
  return partPath.slice(0, partPath.lastIndexOf("/"));
}
function resolveTarget2(baseDir, target) {
  const segments = target.split("/");
  const out = baseDir.split("/");
  for (const seg of segments) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") out.pop();
    else out.push(seg);
  }
  return out.join("/");
}
function relativeTarget(baseDir, target) {
  const base = baseDir.split("/");
  const t = target.split("/");
  let i = 0;
  while (i < base.length && i < t.length && base[i] === t[i]) i++;
  return [...base.slice(i).map(() => ".."), ...t.slice(i)].join("/");
}
function nextPartNumber(zip, prefix, ext) {
  const re = new RegExp(`^${prefix.replace(/\//g, "\\/")}(\\d+)${ext.replace(".", "\\.")}$`);
  let max = 0;
  for (const p of Object.keys(zip.files)) {
    const m = p.match(re);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return max + 1;
}
function nextRelId(relsXml) {
  let max = 0;
  for (const m of relsXml.matchAll(/Id="rId(\d+)"/g)) {
    max = Math.max(max, Number(m[1]));
  }
  return `rId${max + 1}`;
}
function addContentTypeOverride(xml, partName, contentType) {
  if (xml.includes(`PartName="/${partName}"`)) return xml;
  const override = `<Override PartName="/${partName}" ContentType="${contentType}"/>`;
  return xml.replace("</Types>", `${override}</Types>`);
}
function removeContentTypeOverride(xml, partName) {
  return xml.replace(
    new RegExp(`<Override\\b[^>]*PartName="/${partName.replace(/\//g, "\\/")}"[^>]*/>`, "g"),
    ""
  );
}
function parseSldIdLst(presXml) {
  const lst = presXml.match(/<p:sldIdLst>([\s\S]*?)<\/p:sldIdLst>/);
  if (!lst) return [];
  const entries = [];
  for (const m of lst[1].matchAll(/<p:sldId\b[^>]*\/>/g)) {
    const raw = m[0];
    const id = Number(raw.match(/id="(\d+)"/)?.[1] ?? "0");
    const rId = raw.match(/r:id="([^"]+)"/)?.[1] ?? "";
    entries.push({ raw, id, rId });
  }
  return entries;
}
async function orderedSlidePaths(zip) {
  const presXml = await readPart(zip, PRESENTATION);
  const relsXml = await readPart(zip, PRESENTATION_RELS);
  const rels = new Map(parseRels(relsXml).map((r) => [r.id, r]));
  const paths = [];
  for (const e of parseSldIdLst(presXml)) {
    const rel = rels.get(e.rId);
    if (!rel) throw new Error(`sldId references missing rel ${e.rId}`);
    paths.push(resolveTarget2("ppt", rel.target));
  }
  return paths;
}
function nextSldId(presXml) {
  const ids = parseSldIdLst(presXml).map((e) => e.id);
  return Math.max(255, ...ids) + 1;
}
var A_P_RE = /<a:p\b[^>]*>[\s\S]*?<\/a:p>|<a:p\b[^>]*\/>/g;
var A_T_RE = /<a:t(\s[^>]*)?>([\s\S]*?)<\/a:t>/g;
async function replaceText(data, from, to) {
  if (from === "") throw new TypeError("replaceText: `from` must be non-empty");
  const zip = await loadPptx(data);
  const partPaths = Object.keys(zip.files).filter(
    (p) => /^ppt\/slides\/slide\d+\.xml$/.test(p) || /^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(p)
  );
  let replacements = 0;
  let skippedSplitRuns = 0;
  for (const path of partPaths) {
    const xml = await readPart(zip, path);
    const out = xml.replace(A_P_RE, (para) => {
      const runTexts = [...para.matchAll(A_T_RE)].map((m) => unescapeXml(m[2]));
      const total = countOccurrences(runTexts.join(""), from);
      const inRuns = runTexts.reduce((s, t) => s + countOccurrences(t, from), 0);
      skippedSplitRuns += total - inRuns;
      replacements += inRuns;
      if (inRuns === 0) return para;
      return para.replace(A_T_RE, (m, attrs, txt) => {
        const replaced = unescapeXml(txt).split(from).join(to);
        return `<a:t${attrs ?? ""}>${escapeXml(replaced)}</a:t>`;
      });
    });
    if (out !== xml) zip.file(path, out);
  }
  return { data: await savePptx(zip), replacements, skippedSplitRuns };
}
function insertSldId(presXml, entry, afterIndex) {
  const lst = presXml.match(/<p:sldIdLst>([\s\S]*?)<\/p:sldIdLst>/);
  if (!lst) throw new Error("presentation.xml has no <p:sldIdLst>");
  const items = [...lst[1].matchAll(/<p:sldId\b[^>]*\/>/g)].map((m) => m[0]);
  items.splice(afterIndex + 1, 0, entry);
  return presXml.replace(lst[0], `<p:sldIdLst>${items.join("")}</p:sldIdLst>`);
}
async function removeSlidePart(zip, slidePath) {
  const relsPath = relsPathFor(slidePath);
  const baseDir = dirOf(slidePath);
  const slideRels = zip.file(relsPath);
  if (slideRels) {
    const relsXml = await slideRels.async("string");
    for (const rel of parseRels(relsXml)) {
      if (rel.type === `${REL_OFFICE}/notesSlide`) {
        const notesPath = resolveTarget2(baseDir, rel.target);
        zip.remove(notesPath);
        zip.remove(relsPathFor(notesPath));
        const ct2 = await readPart(zip, CONTENT_TYPES);
        zip.file(CONTENT_TYPES, removeContentTypeOverride(ct2, notesPath));
      }
    }
  }
  zip.remove(relsPath);
  zip.remove(slidePath);
  const ct = await readPart(zip, CONTENT_TYPES);
  zip.file(CONTENT_TYPES, removeContentTypeOverride(ct, slidePath));
}
async function removeSlide(data, index) {
  const zip = await loadPptx(data);
  const paths = await orderedSlidePaths(zip);
  if (index < 0 || index >= paths.length) {
    throw new RangeError(`removeSlide: index ${index} out of range (0..${paths.length - 1})`);
  }
  const slidePath = paths[index];
  const presXml = await readPart(zip, PRESENTATION);
  const sldIds = parseSldIdLst(presXml);
  const rId = sldIds[index].rId;
  const newPres = presXml.replace(sldIds[index].raw, "");
  zip.file(PRESENTATION, newPres);
  const relsXml = await readPart(zip, PRESENTATION_RELS);
  const newRels = relsXml.replace(
    new RegExp(`<Relationship\\b[^>]*Id="${rId}"[^>]*/>`),
    ""
  );
  zip.file(PRESENTATION_RELS, newRels);
  await removeSlidePart(zip, slidePath);
  return savePptx(zip);
}
async function duplicateSlide(data, index) {
  const zip = await loadPptx(data);
  const paths = await orderedSlidePaths(zip);
  if (index < 0 || index >= paths.length) {
    throw new RangeError(`duplicateSlide: index ${index} out of range (0..${paths.length - 1})`);
  }
  const srcPath = paths[index];
  const srcNum = Number(srcPath.match(/slide(\d+)\.xml$/)[1]);
  const newNum = nextPartNumber(zip, "ppt/slides/slide", ".xml");
  const newPath = `ppt/slides/slide${newNum}.xml`;
  const srcBase = dirOf(srcPath);
  zip.file(newPath, await readPart(zip, srcPath));
  const srcRelsPath = relsPathFor(srcPath);
  let newRelsXml = "";
  const srcRelsFile = zip.file(srcRelsPath);
  if (srcRelsFile) {
    newRelsXml = await srcRelsFile.async("string");
    for (const rel of parseRels(newRelsXml)) {
      if (rel.type === `${REL_OFFICE}/notesSlide`) {
        const srcNotes = resolveTarget2(srcBase, rel.target);
        const newNotesNum = nextPartNumber(zip, "ppt/notesSlides/notesSlide", ".xml");
        const newNotes = `ppt/notesSlides/notesSlide${newNotesNum}.xml`;
        zip.file(newNotes, await readPart(zip, srcNotes));
        const srcNotesRels = zip.file(relsPathFor(srcNotes));
        if (srcNotesRels) {
          let notesRelsXml = await srcNotesRels.async("string");
          for (const nrel of parseRels(notesRelsXml)) {
            if (nrel.type === `${REL_OFFICE}/slide`) {
              notesRelsXml = notesRelsXml.replace(
                `Target="${nrel.target}"`,
                `Target="${relativeTarget(dirOf(newNotes), newPath)}"`
              );
            }
          }
          zip.file(relsPathFor(newNotes), notesRelsXml);
        }
        newRelsXml = newRelsXml.replace(
          `Target="${rel.target}"`,
          `Target="${relativeTarget(srcBase, newNotes)}"`
        );
        let ct2 = await readPart(zip, CONTENT_TYPES);
        ct2 = addContentTypeOverride(ct2, newNotes, CT_NOTES_SLIDE);
        zip.file(CONTENT_TYPES, ct2);
      }
    }
    zip.file(relsPathFor(newPath), newRelsXml);
  }
  let ct = await readPart(zip, CONTENT_TYPES);
  ct = addContentTypeOverride(ct, newPath, CT_SLIDE);
  zip.file(CONTENT_TYPES, ct);
  const relsXml = await readPart(zip, PRESENTATION_RELS);
  const newRId = nextRelId(relsXml);
  zip.file(
    PRESENTATION_RELS,
    relsXml.replace(
      "</Relationships>",
      `<Relationship Id="${newRId}" Type="${REL_OFFICE}/slide" Target="slides/slide${newNum}.xml"/></Relationships>`
    )
  );
  const presXml = await readPart(zip, PRESENTATION);
  zip.file(
    PRESENTATION,
    insertSldId(presXml, `<p:sldId id="${nextSldId(presXml)}" r:id="${newRId}"/>`, index)
  );
  return savePptx(zip);
}
async function moveSlide(data, from, to) {
  const zip = await loadPptx(data);
  const presXml = await readPart(zip, PRESENTATION);
  const entries = parseSldIdLst(presXml);
  if (from < 0 || from >= entries.length || to < 0 || to >= entries.length) {
    throw new RangeError(
      `moveSlide: from/to out of range (0..${entries.length - 1})`
    );
  }
  const [moved] = entries.splice(from, 1);
  entries.splice(to, 0, moved);
  const lst = presXml.match(/<p:sldIdLst>[\s\S]*?<\/p:sldIdLst>/)[0];
  zip.file(
    PRESENTATION,
    presXml.replace(lst, `<p:sldIdLst>${entries.map((e) => e.raw).join("")}</p:sldIdLst>`)
  );
  return savePptx(zip);
}
async function addBlankSlide(data) {
  const zip = await loadPptx(data);
  const paths = await orderedSlidePaths(zip);
  if (paths.length === 0) {
    throw new Error(
      "addBlankSlide: deck has no slides; cannot clone a layout reference safely"
    );
  }
  const firstRelsXml = await readPart(zip, relsPathFor(paths[0]));
  const layoutRel = parseRels(firstRelsXml).find(
    (r) => r.type === `${REL_OFFICE}/slideLayout`
  );
  if (!layoutRel) {
    throw new Error(
      "addBlankSlide: first slide has no slideLayout relationship to clone"
    );
  }
  const newNum = nextPartNumber(zip, "ppt/slides/slide", ".xml");
  const newPath = `ppt/slides/slide${newNum}.xml`;
  const blankXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="${REL_OFFICE}" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`;
  zip.file(newPath, blankXml);
  const relTarget = relativeTarget(dirOf(paths[0]), resolveTarget2(dirOf(paths[0]), layoutRel.target));
  zip.file(
    relsPathFor(newPath),
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL_OFFICE}/slideLayout" Target="${relTarget}"/></Relationships>`
  );
  let ct = await readPart(zip, CONTENT_TYPES);
  ct = addContentTypeOverride(ct, newPath, CT_SLIDE);
  zip.file(CONTENT_TYPES, ct);
  const relsXml = await readPart(zip, PRESENTATION_RELS);
  const newRId = nextRelId(relsXml);
  zip.file(
    PRESENTATION_RELS,
    relsXml.replace(
      "</Relationships>",
      `<Relationship Id="${newRId}" Type="${REL_OFFICE}/slide" Target="slides/slide${newNum}.xml"/></Relationships>`
    )
  );
  const presXml = await readPart(zip, PRESENTATION);
  const lastIndex = parseSldIdLst(presXml).length - 1;
  zip.file(
    PRESENTATION,
    insertSldId(presXml, `<p:sldId id="${nextSldId(presXml)}" r:id="${newRId}"/>`, lastIndex)
  );
  return savePptx(zip);
}

// vendor/pptx/src/plan.ts
import PptxGenJS from "pptxgenjs";
function bulletsOf(slide) {
  return slide.bullets ?? [];
}
function planSlideToSpec(slide) {
  const notes = slide.notes;
  switch (slide.intent) {
    case "title":
      return {
        kind: "title",
        text: { heading: slide.heading, bullets: bulletsOf(slide) },
        notes
      };
    case "agenda":
    case "concept":
    case "summary":
      return {
        kind: "bullets",
        text: { heading: slide.heading, bullets: bulletsOf(slide) },
        notes
      };
    case "comparison":
      if (slide.table) {
        return { kind: "table", table: slide.table, notes };
      }
      return {
        kind: "bullets",
        text: { heading: slide.heading, bullets: bulletsOf(slide) },
        notes
      };
    case "data":
      if (slide.chart && slide.chart.series.every((s) => s.values.length === slide.chart.labels.length)) {
        return { kind: "chart", chart: slide.chart, notes };
      }
      if (slide.table) {
        return { kind: "table", table: slide.table, notes };
      }
      return {
        kind: "bullets",
        text: { heading: slide.heading, bullets: bulletsOf(slide) },
        notes
      };
    case "closing":
      return {
        kind: "closing",
        text: { heading: slide.heading, bullets: bulletsOf(slide) },
        notes
      };
  }
}
function planToSpec(plan) {
  return {
    title: plan.title,
    slides: plan.slides.map(planSlideToSpec)
  };
}
var LAYOUT = "LAYOUT_WIDE";
var FONT = "Calibri";
var COLOR_HEADING = "1F3864";
var COLOR_BODY = "333333";
var COLOR_MUTED = "7F7F7F";
function addNotes(slide, notes) {
  if (notes) slide.addNotes(notes);
}
function addImageHintPlaceholder(slide, hint, y) {
  if (!hint) return;
  slide.addText(`[image: ${hint}]`, {
    x: 0.6,
    y,
    w: 12.1,
    h: 0.4,
    fontFace: FONT,
    fontSize: 12,
    italic: true,
    color: COLOR_MUTED
  });
}
function renderSpecSlide(pptx, spec, planSlide) {
  const slide = pptx.addSlide();
  switch (spec.kind) {
    case "title": {
      slide.addText(spec.text.heading, {
        x: 0.6,
        y: 2.4,
        w: 12.1,
        h: 1.4,
        fontFace: FONT,
        fontSize: 44,
        bold: true,
        align: "center",
        color: COLOR_HEADING
      });
      if (spec.text.bullets.length > 0) {
        slide.addText(spec.text.bullets.join("\n"), {
          x: 0.6,
          y: 4,
          w: 12.1,
          h: 1.6,
          fontFace: FONT,
          fontSize: 20,
          align: "center",
          color: COLOR_BODY,
          valign: "top"
        });
      }
      addImageHintPlaceholder(slide, planSlide.imageHint, 5.8);
      break;
    }
    case "closing": {
      slide.addText(spec.text.heading, {
        x: 0.6,
        y: 2.8,
        w: 12.1,
        h: 1.2,
        fontFace: FONT,
        fontSize: 36,
        bold: true,
        align: "center",
        color: COLOR_HEADING
      });
      if (spec.text.bullets.length > 0) {
        slide.addText(spec.text.bullets.join("\n"), {
          x: 0.6,
          y: 4.2,
          w: 12.1,
          h: 1.4,
          fontFace: FONT,
          fontSize: 18,
          align: "center",
          color: COLOR_BODY,
          valign: "top"
        });
      }
      addImageHintPlaceholder(slide, planSlide.imageHint, 5.8);
      break;
    }
    case "bullets": {
      slide.addText(spec.text.heading, {
        x: 0.6,
        y: 0.4,
        w: 12.1,
        h: 0.9,
        fontFace: FONT,
        fontSize: 28,
        bold: true,
        color: COLOR_HEADING
      });
      slide.addText(
        spec.text.bullets.map((b) => ({ text: b, options: { bullet: { code: "2022" } } })),
        {
          x: 0.9,
          y: 1.5,
          w: 11.5,
          h: 5,
          fontFace: FONT,
          fontSize: 18,
          color: COLOR_BODY,
          valign: "top",
          paraSpaceAfter: 8
        }
      );
      addImageHintPlaceholder(slide, planSlide.imageHint, 6.8);
      break;
    }
    case "table": {
      slide.addText(planSlide.heading, {
        x: 0.6,
        y: 0.4,
        w: 12.1,
        h: 0.9,
        fontFace: FONT,
        fontSize: 28,
        bold: true,
        color: COLOR_HEADING
      });
      const headerRow = spec.table.header.map((cell) => ({
        text: cell,
        options: { bold: true, fill: { color: "D9E2F3" } }
      }));
      const rows = spec.table.rows.map((r) => r.map((cell) => ({ text: cell })));
      slide.addTable([headerRow, ...rows], {
        x: 0.6,
        y: 1.5,
        w: 12.1,
        fontFace: FONT,
        fontSize: 14,
        color: COLOR_BODY,
        border: { type: "solid", pt: 0.75, color: "BFBFBF" },
        valign: "middle"
      });
      addImageHintPlaceholder(slide, planSlide.imageHint, 6.8);
      break;
    }
    case "chart": {
      slide.addText(planSlide.heading, {
        x: 0.6,
        y: 0.4,
        w: 12.1,
        h: 0.9,
        fontFace: FONT,
        fontSize: 28,
        bold: true,
        color: COLOR_HEADING
      });
      const chartType = spec.chart.kind === "bar" ? pptx.ChartType.bar : spec.chart.kind === "line" ? pptx.ChartType.line : pptx.ChartType.pie;
      const data = spec.chart.series.map((s) => ({
        name: s.name,
        labels: spec.chart.labels,
        values: s.values
      }));
      slide.addChart(chartType, data, {
        x: 0.6,
        y: 1.5,
        w: 12.1,
        h: 5.2,
        showLegend: spec.chart.series.length > 1,
        showTitle: false
      });
      addImageHintPlaceholder(slide, planSlide.imageHint, 6.9);
      break;
    }
  }
  addNotes(slide, spec.notes);
}
async function renderPlan(plan) {
  const spec = planToSpec(plan);
  const pptx = new PptxGenJS();
  pptx.defineLayout({ name: LAYOUT, width: 13.33, height: 7.5 });
  pptx.layout = LAYOUT;
  pptx.title = plan.title;
  if (plan.audience) pptx.subject = `audience: ${plan.audience}`;
  spec.slides.forEach((s, i) => renderSpecSlide(pptx, s, plan.slides[i]));
  const out = await pptx.write({ outputType: "uint8array" });
  return out;
}

// vendor/pptx/src/plan-schema.ts
var deckPlanSchema = {
  $schema: "http://json-schema.org/draft-07/schema#",
  $id: "https://devmoter.dev/schemas/deck-plan.json",
  title: "DeckPlan",
  description: "A slide-deck plan as emitted by an LLM before rendering to PPTX.",
  type: "object",
  required: ["title", "slides"],
  additionalProperties: false,
  properties: {
    title: { type: "string", minLength: 1 },
    audience: { type: "string" },
    goal: { type: "string" },
    slides: {
      type: "array",
      minItems: 1,
      items: { $ref: "#/definitions/planSlide" }
    }
  },
  definitions: {
    planSlide: {
      type: "object",
      required: ["intent", "heading"],
      additionalProperties: false,
      properties: {
        intent: {
          type: "string",
          enum: ["title", "agenda", "concept", "data", "comparison", "summary", "closing"]
        },
        heading: { type: "string", minLength: 1 },
        bullets: {
          type: "array",
          items: { type: "string", minLength: 1 }
        },
        table: {
          type: "object",
          required: ["header", "rows"],
          additionalProperties: false,
          properties: {
            header: { type: "array", minItems: 1, items: { type: "string" } },
            rows: {
              type: "array",
              items: { type: "array", items: { type: "string" } }
            }
          }
        },
        chart: {
          type: "object",
          required: ["kind", "labels", "series"],
          additionalProperties: false,
          properties: {
            kind: { type: "string", enum: ["bar", "line", "pie"] },
            labels: { type: "array", minItems: 1, items: { type: "string" } },
            series: {
              type: "array",
              minItems: 1,
              items: {
                type: "object",
                required: ["name", "values"],
                additionalProperties: false,
                properties: {
                  name: { type: "string", minLength: 1 },
                  values: { type: "array", minItems: 1, items: { type: "number" } }
                }
              }
            }
          }
        },
        imageHint: { type: "string" },
        notes: { type: "string" }
      }
    }
  }
};
function typeOf(v) {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  return typeof v;
}
function resolveRef(root, ref) {
  const m = /^#\/definitions\/([^/]+)$/.exec(ref);
  if (!m) return void 0;
  const defs = root.definitions;
  return defs?.[m[1]];
}
function validateNode(value, schema, path, root, errors) {
  if (typeof schema.$ref === "string") {
    const target = resolveRef(root, schema.$ref);
    if (target) validateNode(value, target, path, root, errors);
    return;
  }
  const expected = schema.type;
  if (expected && typeOf(value) !== expected) {
    errors.push({ path, message: `expected ${expected}, got ${typeOf(value)}` });
    return;
  }
  if (schema.enum && Array.isArray(schema.enum) && !schema.enum.includes(value)) {
    errors.push({ path, message: `must be one of ${schema.enum.map((e) => JSON.stringify(e)).join(", ")}` });
  }
  if (typeof value === "string") {
    const minLength = schema.minLength;
    if (minLength !== void 0 && value.length < minLength) {
      errors.push({ path, message: `string shorter than minLength ${minLength}` });
    }
  }
  if (Array.isArray(value)) {
    const minItems = schema.minItems;
    if (minItems !== void 0 && value.length < minItems) {
      errors.push({ path, message: `array has fewer than minItems ${minItems}` });
    }
    const items = schema.items;
    if (items) value.forEach((item, i) => validateNode(item, items, `${path}/${i}`, root, errors));
  }
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const obj = value;
    const required = schema.required ?? [];
    for (const key of required) {
      if (!(key in obj)) errors.push({ path: `${path}/${key}`, message: "missing required property" });
    }
    const props = schema.properties ?? {};
    for (const [key, sub] of Object.entries(props)) {
      if (key in obj) validateNode(obj[key], sub, `${path}/${key}`, root, errors);
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(obj)) {
        if (!(key in props)) errors.push({ path: `${path}/${key}`, message: "unexpected property" });
      }
    }
  }
}
function validatePlan(value) {
  const errors = [];
  validateNode(value, deckPlanSchema, "", deckPlanSchema, errors);
  return { valid: errors.length === 0, errors };
}
function parsePlan(value) {
  return validatePlan(value).valid ? value : null;
}

// vendor/pptx/src/render-ext.ts
import PptxGenJS2 from "pptxgenjs";
var SHAPE_NAME = {
  rect: "rect",
  roundRect: "roundRect",
  oval: "ellipse",
  line: "line"
};
function toTextRuns(items) {
  return items.map((it) => {
    const b = it;
    const item = typeof b === "string" ? { text: b } : b;
    return {
      text: item.text,
      options: {
        breakLine: true,
        bullet: true,
        ...item.url ? { hyperlink: { url: item.url }, color: "0563C1" } : {}
      }
    };
  });
}
function addShape(slide, s) {
  const opts = {
    x: s.x,
    y: s.y,
    w: s.w,
    h: s.h,
    ...s.fill ? { fill: { color: s.fill.color ?? "FFFFFF", transparency: s.fill.transparency } } : {},
    ...s.line ? { line: { color: s.line.color ?? "000000", width: s.line.width, dashType: s.line.dashType } } : {}
  };
  slide.addShape(SHAPE_NAME[s.kind], opts);
  if (s.text && s.kind !== "line") {
    slide.addText(s.text, {
      x: s.x,
      y: s.y,
      w: s.w,
      h: s.h,
      align: "center",
      valign: "middle"
    });
  }
}
async function renderExtDeck(spec) {
  const pptx = new PptxGenJS2();
  pptx.layout = spec.layout ?? "LAYOUT_WIDE";
  if (spec.title) pptx.title = spec.title;
  const masterNames = /* @__PURE__ */ new Set();
  for (const m of spec.masters ?? []) {
    masterNames.add(m.name);
    const objects = [];
    if (m.footerText) {
      objects.push({
        text: {
          text: m.footerText,
          options: { x: 0.5, y: "90%", w: 4, h: 0.4, fontSize: 10, color: "808080" }
        }
      });
    }
    pptx.defineSlideMaster({
      title: m.name,
      background: m.background ? { color: m.background } : void 0,
      objects: objects.length ? objects : void 0,
      slideNumber: m.slideNumber ?? m.footerText ? { x: "92%", y: "90%", color: "808080", fontSize: 10 } : void 0
    });
  }
  for (const s of spec.slides) {
    const slide = pptx.addSlide(s.master ? { masterName: s.master } : void 0);
    if (s.notes) slide.addNotes(s.notes);
    switch (s.kind) {
      case "title": {
        slide.addText(s.title, { x: 0.5, y: 2, w: "90%", h: 1.5, fontSize: 36, bold: true });
        if (s.subtitle)
          slide.addText(s.subtitle, { x: 0.5, y: 3.6, w: "90%", h: 1, fontSize: 20 });
        break;
      }
      case "bullets": {
        if (s.title)
          slide.addText(s.title, { x: 0.5, y: 0.3, w: "90%", h: 0.8, fontSize: 24, bold: true });
        slide.addText(toTextRuns(s.bullets), { x: 0.6, y: 1.2, w: "88%", h: 5 });
        break;
      }
      case "shapes": {
        if (s.title)
          slide.addText(s.title, { x: 0.5, y: 0.3, w: "90%", h: 0.8, fontSize: 24, bold: true });
        for (const sh of s.shapes) addShape(slide, sh);
        break;
      }
      case "twoColumn": {
        if (s.title)
          slide.addText(s.title, { x: 0.5, y: 0.3, w: "90%", h: 0.8, fontSize: 24, bold: true });
        slide.addText(toTextRuns(s.left), { x: 0.5, y: 1.2, w: "44%", h: 5 });
        slide.addText(toTextRuns(s.right), { x: "52%", y: 1.2, w: "44%", h: 5 });
        break;
      }
      case "quote": {
        slide.addText(`\u201C${s.text}\u201D`, {
          x: 1,
          y: 2,
          w: "80%",
          h: 2,
          fontSize: 28,
          italic: true,
          align: "center"
        });
        if (s.attribution)
          slide.addText(`\u2014 ${s.attribution}`, {
            x: 1,
            y: 4.2,
            w: "80%",
            h: 0.6,
            fontSize: 18,
            align: "center"
          });
        break;
      }
    }
  }
  const out = await pptx.write({ outputType: "uint8array" });
  return out;
}
export {
  addBlankSlide,
  deckPlanSchema,
  duplicateSlide,
  moveSlide,
  parsePlan,
  planToSpec,
  readOutline,
  removeSlide,
  renderExtDeck,
  renderPlan,
  replaceText,
  validatePlan,
  zip_exports as zipInternal
};
