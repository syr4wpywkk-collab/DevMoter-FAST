import {
  loadPptx,
  savePptx,
  readPart,
} from "./internal/zip.js";

/**
 * Editing operations on existing .pptx files.
 *
 * All functions take the raw bytes of a .pptx archive and return new bytes
 * (except where noted). The output keeps the package structurally
 * consistent: [Content_Types].xml, ppt/_rels/presentation.xml.rels,
 * ppt/presentation.xml <p:sldIdLst> and per-slide rels are updated together.
 *
 * Implementation note: OOXML parts are manipulated as XML text (targeted,
 * minimal diffs) rather than via a full DOM, so untouched regions of each
 * part are preserved byte-for-byte.
 */

// ---------------------------------------------------------------------------
// XML text helpers
// ---------------------------------------------------------------------------

const XML_ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&apos;": "'",
};

function unescapeXml(s: string): string {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&(amp|lt|gt|quot|apos);/g, (m) => XML_ENTITIES[m] ?? m);
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function countOccurrences(haystack: string, needle: string): number {
  if (needle === "") return 0;
  let n = 0;
  let i = 0;
  while ((i = haystack.indexOf(needle, i)) !== -1) {
    n++;
    i += needle.length;
  }
  return n;
}

// ---------------------------------------------------------------------------
// OOXML package helpers
// ---------------------------------------------------------------------------

const REL_OFFICE = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const CT_SLIDE = "application/vnd.openxmlformats-officedocument.presentationml.slide+xml";
const CT_NOTES_SLIDE = "application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml";

const CONTENT_TYPES = "[Content_Types].xml";
const PRESENTATION = "ppt/presentation.xml";
const PRESENTATION_RELS = "ppt/_rels/presentation.xml.rels";

interface RelEntry {
  id: string;
  type: string;
  target: string;
}

function parseRels(xml: string): RelEntry[] {
  const rels: RelEntry[] = [];
  for (const m of xml.matchAll(/<Relationship\b([^>]*?)\/?>(?:<\/Relationship>)?/g)) {
    const attrs = m[1];
    const get = (name: string) =>
      attrs.match(new RegExp(`${name}="([^"]*)"`))?.[1] ?? "";
    rels.push({ id: get("Id"), type: get("Type"), target: get("Target") });
  }
  return rels;
}

function relsPathFor(partPath: string): string {
  const dir = partPath.slice(0, partPath.lastIndexOf("/"));
  const name = partPath.slice(partPath.lastIndexOf("/") + 1);
  return `${dir}/_rels/${name}.rels`;
}

function dirOf(partPath: string): string {
  return partPath.slice(0, partPath.lastIndexOf("/"));
}

/** Resolve a rel Target (relative to the source part's directory) to a part path. */
function resolveTarget(baseDir: string, target: string): string {
  const segments = target.split("/");
  const out = baseDir.split("/");
  for (const seg of segments) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") out.pop();
    else out.push(seg);
  }
  return out.join("/");
}

/** Make `target` relative to `baseDir` (only ".." steps supported — sufficient here). */
function relativeTarget(baseDir: string, target: string): string {
  const base = baseDir.split("/");
  const t = target.split("/");
  let i = 0;
  while (i < base.length && i < t.length && base[i] === t[i]) i++;
  return [...base.slice(i).map(() => ".."), ...t.slice(i)].join("/");
}

function nextPartNumber(zip: import("jszip"), prefix: string, ext: string): number {
  const re = new RegExp(`^${prefix.replace(/\//g, "\\/")}(\\d+)${ext.replace(".", "\\.")}$`);
  let max = 0;
  for (const p of Object.keys(zip.files)) {
    const m = p.match(re);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return max + 1;
}

function nextRelId(relsXml: string): string {
  let max = 0;
  for (const m of relsXml.matchAll(/Id="rId(\d+)"/g)) {
    max = Math.max(max, Number(m[1]));
  }
  return `rId${max + 1}`;
}

function addContentTypeOverride(xml: string, partName: string, contentType: string): string {
  if (xml.includes(`PartName="/${partName}"`)) return xml;
  const override =
    `<Override PartName="/${partName}" ContentType="${contentType}"/>`;
  return xml.replace("</Types>", `${override}</Types>`);
}

function removeContentTypeOverride(xml: string, partName: string): string {
  return xml.replace(
    new RegExp(`<Override\\b[^>]*PartName="/${partName.replace(/\//g, "\\/")}"[^>]*/>`, "g"),
    "",
  );
}

function ensureDefaultExtension(xml: string, ext: string, contentType: string): string {
  const re = new RegExp(`<Default\\b[^>]*Extension="${ext}"`, "i");
  if (re.test(xml)) return xml;
  return xml.replace(
    "</Types>",
    `<Default Extension="${ext}" ContentType="${contentType}"/></Types>`,
  );
}

interface SldIdEntry {
  raw: string;
  id: number;
  rId: string;
}

function parseSldIdLst(presXml: string): SldIdEntry[] {
  const lst = presXml.match(/<p:sldIdLst>([\s\S]*?)<\/p:sldIdLst>/);
  if (!lst) return [];
  const entries: SldIdEntry[] = [];
  for (const m of lst[1].matchAll(/<p:sldId\b[^>]*\/>/g)) {
    const raw = m[0];
    const id = Number(raw.match(/id="(\d+)"/)?.[1] ?? "0");
    const rId = raw.match(/r:id="([^"]+)"/)?.[1] ?? "";
    entries.push({ raw, id, rId });
  }
  return entries;
}

/** Slide part paths in presentation (sldIdLst) order. */
async function orderedSlidePaths(zip: import("jszip")): Promise<string[]> {
  const presXml = await readPart(zip, PRESENTATION);
  const relsXml = await readPart(zip, PRESENTATION_RELS);
  const rels = new Map(parseRels(relsXml).map((r) => [r.id, r]));
  const paths: string[] = [];
  for (const e of parseSldIdLst(presXml)) {
    const rel = rels.get(e.rId);
    if (!rel) throw new Error(`sldId references missing rel ${e.rId}`);
    paths.push(resolveTarget("ppt", rel.target));
  }
  return paths;
}

function nextSldId(presXml: string): number {
  const ids = parseSldIdLst(presXml).map((e) => e.id);
  return Math.max(255, ...ids) + 1;
}

// ---------------------------------------------------------------------------
// replaceText
// ---------------------------------------------------------------------------

export interface ReplaceTextResult {
  /** New .pptx bytes. */
  data: Uint8Array;
  /** Number of in-run replacements performed. */
  replacements: number;
  /**
   * Occurrences of `from` that span multiple text runs (<a:t> elements)
   * inside one paragraph and were therefore skipped.
   */
  skippedSplitRuns: number;
}

const A_P_RE = /<a:p\b[^>]*>[\s\S]*?<\/a:p>|<a:p\b[^>]*\/>/g;
const A_T_RE = /<a:t(\s[^>]*)?>([\s\S]*?)<\/a:t>/g;

/**
 * Replace `from` with `to` across slide text, table cells and speaker notes.
 *
 * Caveat: replacement works within a single text run (<a:t>). Matches whose
 * text is split across multiple runs in the same paragraph are not replaced;
 * they are counted in `skippedSplitRuns`.
 */
export async function replaceText(
  data: Uint8Array,
  from: string,
  to: string,
): Promise<ReplaceTextResult> {
  if (from === "") throw new TypeError("replaceText: `from` must be non-empty");
  const zip = await loadPptx(data);
  const partPaths = Object.keys(zip.files).filter(
    (p) =>
      /^ppt\/slides\/slide\d+\.xml$/.test(p) ||
      /^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(p),
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
      return para.replace(A_T_RE, (m, attrs: string | undefined, txt: string) => {
        const replaced = unescapeXml(txt).split(from).join(to);
        return `<a:t${attrs ?? ""}>${escapeXml(replaced)}</a:t>`;
      });
    });
    if (out !== xml) zip.file(path, out);
  }

  return { data: await savePptx(zip), replacements, skippedSplitRuns };
}

// ---------------------------------------------------------------------------
// Slide list operations
// ---------------------------------------------------------------------------

function insertSldId(presXml: string, entry: string, afterIndex: number): string {
  const lst = presXml.match(/<p:sldIdLst>([\s\S]*?)<\/p:sldIdLst>/);
  if (!lst) throw new Error("presentation.xml has no <p:sldIdLst>");
  const items = [...lst[1].matchAll(/<p:sldId\b[^>]*\/>/g)].map((m) => m[0]);
  items.splice(afterIndex + 1, 0, entry);
  return presXml.replace(lst[0], `<p:sldIdLst>${items.join("")}</p:sldIdLst>`);
}

/** Remove a slide part and everything that becomes dangling without it. */
async function removeSlidePart(zip: import("jszip"), slidePath: string): Promise<void> {
  const relsPath = relsPathFor(slidePath);
  const baseDir = dirOf(slidePath);
  const slideRels = zip.file(relsPath);
  if (slideRels) {
    const relsXml = await slideRels.async("string");
    for (const rel of parseRels(relsXml)) {
      if (rel.type === `${REL_OFFICE}/notesSlide`) {
        const notesPath = resolveTarget(baseDir, rel.target);
        // Delete the notes slide and its rels: its rels point back to the
        // slide being removed, so keeping it would leave dangling references.
        zip.remove(notesPath);
        zip.remove(relsPathFor(notesPath));
        const ct = await readPart(zip, CONTENT_TYPES);
        zip.file(CONTENT_TYPES, removeContentTypeOverride(ct, notesPath));
      }
    }
  }
  zip.remove(relsPath);
  zip.remove(slidePath);
  const ct = await readPart(zip, CONTENT_TYPES);
  zip.file(CONTENT_TYPES, removeContentTypeOverride(ct, slidePath));
}

/**
 * Remove the slide at `index` (0-based, in presentation order).
 * Throws RangeError for an out-of-range index.
 */
export async function removeSlide(data: Uint8Array, index: number): Promise<Uint8Array> {
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
    "",
  );
  zip.file(PRESENTATION_RELS, newRels);

  await removeSlidePart(zip, slidePath);
  return savePptx(zip);
}

/**
 * Deep-copy the slide at `index` and insert the copy immediately after it.
 * The slide part, its rels and a referenced notes slide (if any) are
 * duplicated; shared parts (layout, images) keep pointing at the originals.
 * Throws RangeError for an out-of-range index.
 */
export async function duplicateSlide(data: Uint8Array, index: number): Promise<Uint8Array> {
  const zip = await loadPptx(data);
  const paths = await orderedSlidePaths(zip);
  if (index < 0 || index >= paths.length) {
    throw new RangeError(`duplicateSlide: index ${index} out of range (0..${paths.length - 1})`);
  }
  const srcPath = paths[index];
  const srcNum = Number(srcPath.match(/slide(\d+)\.xml$/)![1]);
  const newNum = nextPartNumber(zip, "ppt/slides/slide", ".xml");
  const newPath = `ppt/slides/slide${newNum}.xml`;
  const srcBase = dirOf(srcPath);

  zip.file(newPath, await readPart(zip, srcPath));

  const srcRelsPath = relsPathFor(srcPath);
  let newRelsXml = "";
  const srcRelsFile = zip.file(srcRelsPath);
  if (srcRelsFile) {
    newRelsXml = await srcRelsFile.async("string");
    // Deep-copy a notes slide so the copy does not share a back-reference
    // (notesSlide rels point to their owning slide).
    for (const rel of parseRels(newRelsXml)) {
      if (rel.type === `${REL_OFFICE}/notesSlide`) {
        const srcNotes = resolveTarget(srcBase, rel.target);
        const newNotesNum = nextPartNumber(zip, "ppt/notesSlides/notesSlide", ".xml");
        const newNotes = `ppt/notesSlides/notesSlide${newNotesNum}.xml`;
        zip.file(newNotes, await readPart(zip, srcNotes));
        const srcNotesRels = zip.file(relsPathFor(srcNotes));
        if (srcNotesRels) {
          let notesRelsXml = await srcNotesRels.async("string");
          // Re-point the notes slide's slide rel at the new slide part.
          for (const nrel of parseRels(notesRelsXml)) {
            if (nrel.type === `${REL_OFFICE}/slide`) {
              notesRelsXml = notesRelsXml.replace(
                `Target="${nrel.target}"`,
                `Target="${relativeTarget(dirOf(newNotes), newPath)}"`,
              );
            }
          }
          zip.file(relsPathFor(newNotes), notesRelsXml);
        }
        newRelsXml = newRelsXml.replace(
          `Target="${rel.target}"`,
          `Target="${relativeTarget(srcBase, newNotes)}"`,
        );
        let ct = await readPart(zip, CONTENT_TYPES);
        ct = addContentTypeOverride(ct, newNotes, CT_NOTES_SLIDE);
        zip.file(CONTENT_TYPES, ct);
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
      `<Relationship Id="${newRId}" Type="${REL_OFFICE}/slide" Target="slides/slide${newNum}.xml"/></Relationships>`,
    ),
  );

  const presXml = await readPart(zip, PRESENTATION);
  zip.file(
    PRESENTATION,
    insertSldId(presXml, `<p:sldId id="${nextSldId(presXml)}" r:id="${newRId}"/>`, index),
  );

  return savePptx(zip);
}

/**
 * Move the slide at position `from` to position `to` (0-based, presentation
 * order). Only <p:sldIdLst> order changes; parts are untouched.
 * Throws RangeError for out-of-range arguments.
 */
export async function moveSlide(data: Uint8Array, from: number, to: number): Promise<Uint8Array> {
  const zip = await loadPptx(data);
  const presXml = await readPart(zip, PRESENTATION);
  const entries = parseSldIdLst(presXml);
  if (from < 0 || from >= entries.length || to < 0 || to >= entries.length) {
    throw new RangeError(
      `moveSlide: from/to out of range (0..${entries.length - 1})`,
    );
  }
  const [moved] = entries.splice(from, 1);
  entries.splice(to, 0, moved);
  const lst = presXml.match(/<p:sldIdLst>[\s\S]*?<\/p:sldIdLst>/)![0];
  zip.file(
    PRESENTATION,
    presXml.replace(lst, `<p:sldIdLst>${entries.map((e) => e.raw).join("")}</p:sldIdLst>`),
  );
  return savePptx(zip);
}

/**
 * Append a minimal, valid blank slide at the end of the deck.
 *
 * The new slide references the same slide layout part as the first existing
 * slide (copied as the only relationship). If the deck has no existing slide
 * to clone a layout reference from, a documented error is thrown instead of
 * emitting a corrupt file.
 */
export async function addBlankSlide(data: Uint8Array): Promise<Uint8Array> {
  const zip = await loadPptx(data);
  const paths = await orderedSlidePaths(zip);
  if (paths.length === 0) {
    throw new Error(
      "addBlankSlide: deck has no slides; cannot clone a layout reference safely",
    );
  }
  const firstRelsXml = await readPart(zip, relsPathFor(paths[0]));
  const layoutRel = parseRels(firstRelsXml).find(
    (r) => r.type === `${REL_OFFICE}/slideLayout`,
  );
  if (!layoutRel) {
    throw new Error(
      "addBlankSlide: first slide has no slideLayout relationship to clone",
    );
  }

  const newNum = nextPartNumber(zip, "ppt/slides/slide", ".xml");
  const newPath = `ppt/slides/slide${newNum}.xml`;

  const blankXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n` +
    `<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ` +
    `xmlns:r="${REL_OFFICE}" ` +
    `xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">` +
    `<p:cSld><p:spTree>` +
    `<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>` +
    `<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/>` +
    `<a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>` +
    `</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`;
  zip.file(newPath, blankXml);

  const relTarget = relativeTarget(dirOf(paths[0]), resolveTarget(dirOf(paths[0]), layoutRel.target));
  zip.file(
    relsPathFor(newPath),
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n` +
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      `<Relationship Id="rId1" Type="${REL_OFFICE}/slideLayout" Target="${relTarget}"/>` +
      `</Relationships>`,
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
      `<Relationship Id="${newRId}" Type="${REL_OFFICE}/slide" Target="slides/slide${newNum}.xml"/></Relationships>`,
    ),
  );

  const presXml = await readPart(zip, PRESENTATION);
  const lastIndex = parseSldIdLst(presXml).length - 1;
  zip.file(
    PRESENTATION,
    insertSldId(presXml, `<p:sldId id="${nextSldId(presXml)}" r:id="${newRId}"/>`, lastIndex),
  );

  return savePptx(zip);
}

// ---------------------------------------------------------------------------
// swapImage
// ---------------------------------------------------------------------------

const MIME_BY_EXT: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  bmp: "image/bmp",
  svg: "image/svg+xml",
  tif: "image/tiff",
  tiff: "image/tiff",
  emf: "image/x-emf",
  wmf: "image/x-wmf",
};

export interface SwapImageInput {
  /** New image bytes. */
  data: Uint8Array;
  /**
   * Image type: either a file extension ("png", "jpeg", ...) or a MIME type
   * ("image/png", ...). If the extension differs from the existing part's,
   * the part is renamed, all relationships targeting it are re-pointed, and
   * a <Default> content-type entry is registered for the new extension.
   */
  type: string;
}

/**
 * Replace the bytes of an image part (e.g. "ppt/media/image1.png").
 * Throws if the part does not exist or the type is unrecognized.
 */
export async function swapImage(
  data: Uint8Array,
  partPath: string,
  newImage: SwapImageInput,
): Promise<Uint8Array> {
  const zip = await loadPptx(data);
  const file = zip.file(partPath);
  if (!file) throw new Error(`swapImage: no such part: ${partPath}`);

  let ext: string;
  let mime: string;
  if (newImage.type.includes("/")) {
    mime = newImage.type;
    const found = Object.entries(MIME_BY_EXT).find(([, m]) => m === mime);
    if (!found) throw new Error(`swapImage: unsupported MIME type ${mime}`);
    ext = found[0];
  } else {
    ext = newImage.type.replace(/^\./, "").toLowerCase();
    mime = MIME_BY_EXT[ext];
    if (!mime) throw new Error(`swapImage: unsupported image extension ${newImage.type}`);
  }

  const oldExt = partPath.slice(partPath.lastIndexOf(".") + 1).toLowerCase();
  let targetPath = partPath;
  if (ext !== oldExt) {
    targetPath = partPath.slice(0, partPath.lastIndexOf(".")) + "." + ext;
    // Re-point every relationship that targets the old part.
    for (const p of Object.keys(zip.files)) {
      if (!p.endsWith(".rels")) continue;
      const xml = await zip.file(p)!.async("string");
      // Source part dir = parent of the _rels directory.
      const srcDir = p.slice(0, p.lastIndexOf("/_rels/"));
      let changed = false;
      const out = xml.replace(/Target="([^"]+)"/g, (m, t: string) => {
        if (t.includes("://") || t.startsWith("/")) return m;
        if (resolveTarget(srcDir, t) !== partPath) return m;
        changed = true;
        return `Target="${relativeTarget(srcDir, targetPath)}"`;
      });
      if (changed) zip.file(p, out);
    }
    zip.remove(partPath);
  }
  zip.file(targetPath, newImage.data);

  if (ext !== oldExt) {
    const ct = await readPart(zip, CONTENT_TYPES);
    zip.file(CONTENT_TYPES, ensureDefaultExtension(ct, ext, mime));
  }

  return savePptx(zip);
}
