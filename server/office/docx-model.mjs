// Whole-document editing model for Office/Docs.
//
// The browser edits the document as an ordered list of blocks. Each block is
// either kept by id (tables, images, fields… and any paragraph the user did
// not touch) or described as a paragraph model (type, heading level, list
// kind, alignment and runs with bold/italic/underline/link). This module turns
// that list back into GenOffice SaveBlocks so that:
// - untouched blocks keep their original bytes (same docxIndex, kind "original"),
// - deleted blocks are simply omitted and reordered blocks keep their bytes,
// - changed paragraphs are regenerated from the original paragraph: its pPr is
//   kept and only pStyle/numPr/outlineLvl/jc are rewritten, and every new run
//   inherits the full run properties of the original run it came from, so
//   fonts, colours and sizes survive text edits.
import JSZip from "jszip";
import { splitXmlChildren, PPR_CHILD_ORDER } from "./engine.mjs";

export const MODEL_LIMITS = Object.freeze({ runs: 500, blockText: 16000, totalText: 1024 * 1024 });
const ALIGNS = ["left", "center", "right", "justify"];
const TYPES = ["paragraph", "heading", "listItem"];
const LIST_KINDS = ["bullet", "ordered"];
// Run fields that stand for atomic content (fields, notes, pictures, revisions…).
// A paragraph containing any of them is kept by id only, never regenerated.
const ATOMIC_RUN_KEYS = [
  "noteRef", "xeTerm", "refField", "refInstr", "instrField", "zoteroFieldId",
  "zoteroFieldPart", "fldBeginXml", "sdtCheckboxXml", "math", "sym", "ruby",
  "image", "ins", "del", "rPrChange",
];
const RUN_MODEL_KEYS = ["text", "bold", "italic", "underline", "link"];

const fail = (message, status = 400) => Object.assign(new Error(message), { status });

/** A paragraph the editor may rewrite: plain runs, no fields/drawings/revisions/section break. */
export function isEditableBlock(block, parsed) {
  if (!["paragraph", "heading", "listItem"].includes(block.type)) return false;
  if (block.docxIndex === null || block.docxIndex === undefined || block.hidden || block.sdtShell) return false;
  if ((block.runs || []).some((run) => run.vanish || ATOMIC_RUN_KEYS.some((key) => run[key] !== undefined))) return false;
  if (typeof block.originalXml !== "string") return false;
  const element = parsed.extras.elements[block.docxIndex];
  if (element?.name !== "w:p") return false;
  if (parsed.internal.documentXml.slice(element.start, element.end) !== block.originalXml) return false;
  return !/<w:(?:fldChar|instrText|fldSimple|drawing|pict|object|sdt|ins|del|moveFrom|moveTo|sectPr|txbxContent)\b/.test(block.originalXml);
}

/** Whether removing this block would change the document's section layout. */
export const isRequiredBlock = (block) => typeof block.originalXml === "string" && /<w:sectPr\b/.test(block.originalXml);

const hrefOf = (run) => (run.link && typeof run.link.href === "string" ? run.link.href : undefined);

/** Adjacent runs with the same model formatting merge; empty runs disappear. */
export function normalizeRuns(runs) {
  const out = [];
  for (const run of runs) {
    if (!run.text) continue;
    const next = { text: run.text, bold: !!run.bold, italic: !!run.italic, underline: !!run.underline, href: run.href || undefined };
    const last = out[out.length - 1];
    if (last && last.bold === next.bold && last.italic === next.italic && last.underline === next.underline && last.href === next.href) last.text += next.text;
    else out.push(next);
  }
  return out;
}

/** The editor model of a parsed paragraph block (what the browser shows and sends back). */
export function modelOf(block) {
  const type = block.type === "heading" ? "heading" : block.type === "listItem" ? "listItem" : "paragraph";
  return {
    type,
    level: type === "heading" ? Math.min(Math.max(block.level || 1, 1), 9) : undefined,
    list: type === "listItem" ? (block.list?.kind === "ordered" ? "ordered" : "bullet") : undefined,
    ilvl: type === "listItem" ? Math.min(Math.max(block.list?.ilvl || 0, 0), 8) : undefined,
    align: ALIGNS.includes(block.format?.align) ? block.format.align : undefined,
    runs: normalizeRuns((block.runs || []).filter((run) => !run.vanish).map((run) => ({ ...run, href: hrefOf(run) }))),
  };
}

const sameModel = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const CONTROL = /[\u0000-\u0008\u000e-\u001d\u001f]/;
const SAFE_NEW_HREF = /^(?:https?:\/\/|mailto:)[^\s<>"]{1,2000}$/i;

/** Validate one browser block and return its normalised model. */
function readModel(input) {
  const keys = Object.keys(input);
  if (keys.some((key) => !["id", "base", "type", "level", "list", "ilvl", "align", "runs"].includes(key)))
    throw fail("本文の入力が不正です。");
  if (!TYPES.includes(input.type)) throw fail("段落の種類が不正です。");
  if (input.align !== undefined && input.align !== null && !ALIGNS.includes(input.align)) throw fail("配置の指定が不正です。");
  if (input.type === "heading" && !(Number.isInteger(input.level) && input.level >= 1 && input.level <= 9)) throw fail("見出しの指定が不正です。");
  if (input.type === "listItem" && !LIST_KINDS.includes(input.list)) throw fail("リストの指定が不正です。");
  if (input.ilvl !== undefined && !(Number.isInteger(input.ilvl) && input.ilvl >= 0 && input.ilvl <= 8)) throw fail("リストの指定が不正です。");
  if (!Array.isArray(input.runs) || input.runs.length > MODEL_LIMITS.runs) throw fail("本文の入力が不正です。");
  let length = 0;
  for (const run of input.runs) {
    if (!run || typeof run !== "object" || Object.keys(run).some((key) => !["text", "bold", "italic", "underline", "href"].includes(key)))
      throw fail("本文の入力が不正です。");
    if (typeof run.text !== "string" || CONTROL.test(run.text)) throw fail("本文の入力が不正です。");
    if (["bold", "italic", "underline"].some((key) => run[key] !== undefined && typeof run[key] !== "boolean")) throw fail("本文の入力が不正です。");
    if (run.href !== undefined && (typeof run.href !== "string" || run.href.length > 2000)) throw fail("リンクの指定が不正です。");
    length += Buffer.byteLength(run.text);
  }
  if (length > MODEL_LIMITS.blockText) throw fail("1段落の文字数が上限を超えています。");
  return {
    length,
    model: {
      type: input.type,
      level: input.type === "heading" ? input.level : undefined,
      list: input.type === "listItem" ? input.list : undefined,
      ilvl: input.type === "listItem" ? input.ilvl || 0 : undefined,
      align: input.align || undefined,
      runs: normalizeRuns(input.runs),
    },
  };
}

// ---------------------------------------------------------------- pPr -------
const rank = (name) => {
  const at = PPR_CHILD_ORDER.indexOf(name);
  return at === -1 ? PPR_CHILD_ORDER.length : at;
};
function pPrChildren(rawPPr) {
  const open = /^<w:pPr(?:\s[^>]*)?>/.exec(rawPPr || "")?.[0];
  if (!open) return { open: "<w:pPr>", children: [] };
  return { open, children: splitXmlChildren(rawPPr.slice(open.length, rawPPr.length - "</w:pPr>".length)) };
}
function setChild(children, name, xml) {
  const kept = children.filter((child) => child.name !== name);
  if (xml === null) return kept;
  const at = kept.findIndex((child) => rank(child.name) > rank(name));
  kept.splice(at === -1 ? kept.length : at, 0, { name, xml });
  return kept;
}
const escapeAttr = (value) => String(value).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

function paragraphProperties({ base, model, structural, ctx, numId }) {
  let { open, children } = pPrChildren(base?.rawPPr);
  // a copied paragraph (Enter inside an existing one) never carries the old revision record
  children = children.filter((child) => child.name !== "w:pPrChange");
  if (structural) {
    children = setChild(children, "w:numPr", null);
    children = setChild(children, "w:outlineLvl", null);
    children = setChild(children, "w:pStyle", null);
    if (model.type === "heading") {
      const styleId = ctx.headingStyle(model.level);
      if (styleId) children = setChild(children, "w:pStyle", `<w:pStyle w:val="${escapeAttr(styleId)}"/>`);
      else children = setChild(children, "w:outlineLvl", `<w:outlineLvl w:val="${model.level - 1}"/>`);
    } else if (model.type === "listItem") {
      if (ctx.listParagraphStyleId)
        children = setChild(children, "w:pStyle", `<w:pStyle w:val="${escapeAttr(ctx.listParagraphStyleId)}"/>`);
    }
  }
  if (model.type === "listItem" && numId !== undefined)
    children = setChild(children, "w:numPr", `<w:numPr><w:ilvl w:val="${model.ilvl}"/><w:numId w:val="${escapeAttr(numId)}"/></w:numPr>`);
  const baseAlign = base ? modelOf(base).align : undefined;
  if (model.align !== baseAlign || !base) {
    let jc = model.align === "justify" ? "both" : model.align;
    if (base?.format?.bidi && (jc === "left" || jc === "right")) jc = jc === "left" ? "right" : "left";
    children = setChild(children, "w:jc", jc ? `<w:jc w:val="${jc}"/>` : null);
  }
  return children.length ? `${open}${children.map((child) => child.xml).join("")}</w:pPr>` : "";
}

// ---------------------------------------------------------------- runs ------
function templateFields(run) {
  const out = {};
  for (const [key, value] of Object.entries(run)) if (!RUN_MODEL_KEYS.includes(key) && key !== "vanish") out[key] = value;
  return out;
}
const isHigh = (code) => code >= 0xd800 && code <= 0xdbff;
const LCS_CELLS = 4_000_000;
const MIN_STRETCH = 4;

/**
 * For each character of `next`, the index of the character of `previous` it
 * was kept from (-1 when typed). Common prefix/suffix first, then an LCS over
 * the changed middle when it is small enough (paragraph-sized).
 */
export function alignText(previous, next) {
  const out = new Array(next.length).fill(-1);
  let prefix = 0;
  const max = Math.min(previous.length, next.length);
  while (prefix < max && previous[prefix] === next[prefix]) out[prefix] = prefix++;
  let suffix = 0;
  while (suffix < max - prefix && previous[previous.length - 1 - suffix] === next[next.length - 1 - suffix]) {
    out[next.length - 1 - suffix] = previous.length - 1 - suffix;
    suffix++;
  }
  const a = previous.slice(prefix, previous.length - suffix);
  const b = next.slice(prefix, next.length - suffix);
  if (!a.length || !b.length || (a.length + 1) * (b.length + 1) > LCS_CELLS) return out;
  const width = b.length + 1;
  const table = new Uint32Array((a.length + 1) * width);
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--)
      table[i * width + j] = a[i] === b[j] ? table[(i + 1) * width + j + 1] + 1 : Math.max(table[(i + 1) * width + j], table[i * width + j + 1]);
  const pairs = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      pairs.push([i, j]);
      i++;
      j++;
    } else if (table[(i + 1) * width + j] >= table[i * width + j + 1]) i++;
    else j++;
  }
  // keep only matched stretches long enough to be "the same text"; scattered single
  // letters shared by unrelated words must not drag formatting around
  for (let start = 0; start < pairs.length; ) {
    let end = start + 1;
    while (end < pairs.length && pairs[end][0] === pairs[end - 1][0] + 1 && pairs[end][1] === pairs[end - 1][1] + 1) end++;
    if (end - start >= MIN_STRETCH) for (let k = start; k < end; k++) out[prefix + pairs[k][1]] = prefix + pairs[k][0];
    start = end;
  }
  return out;
}

/**
 * New runs for a changed paragraph. Each character of the new text is mapped to
 * the original run it came from (common prefix/suffix keep their run, inserted
 * text joins the run at the insertion point), so formatting the model cannot
 * express (font, colour, size, highlight…) stays where it was.
 */
function buildRuns(base, modelRuns, isNew = false) {
  const sources = (base?.runs || []).filter((run) => !run.vanish && run.text);
  const newText = modelRuns.map((run) => run.text).join("");
  const owners = new Array(newText.length).fill(-1);
  if (sources.length) {
    const oldOwners = [];
    sources.forEach((run, index) => { for (let i = 0; i < run.text.length; i++) oldOwners.push(index); });
    const oldText = sources.map((run) => run.text).join("");
    const matched = alignText(oldText, newText);
    // unmatched (typed) characters continue the formatting of the character before them
    let previous = isNew ? sources.length - 1 : -1;
    for (let i = 0; i < newText.length; i++) {
      if (matched[i] >= 0) previous = oldOwners[matched[i]];
      owners[i] = previous;
    }
    // text typed at the very start takes the formatting of what follows it
    const firstMatch = matched.findIndex((value) => value >= 0);
    for (let i = 0; i < newText.length && owners[i] < 0; i++) owners[i] = firstMatch >= 0 ? oldOwners[matched[firstMatch]] : 0;
  }
  const out = [];
  let offset = 0;
  for (const modelRun of modelRuns) {
    let start = 0;
    const text = modelRun.text;
    for (let i = 1; i <= text.length; i++) {
      const boundary =
        i === text.length ||
        (owners[offset + i] !== owners[offset + i - 1] && !isHigh(text.charCodeAt(i - 1)));
      if (!boundary) continue;
      const owner = owners[offset + start];
      const template = owner >= 0 ? sources[owner] : undefined;
      const run = { ...(template ? templateFields(template) : {}), text: text.slice(start, i) };
      if (modelRun.bold) run.bold = true;
      if (modelRun.italic) run.italic = true;
      if (modelRun.underline) run.underline = true;
      const templateHref = template ? hrefOf(template) : undefined;
      if (modelRun.href) {
        run.link = modelRun.href === templateHref ? { ...template.link } : { href: modelRun.href };
      } else if (templateHref && typeof run.rawRPr === "string") {
        // unlinking: drop the character style that only made the run look like a link
        run.rawRPr = run.rawRPr.replace(/<w:rStyle w:val="Hyperlink"\/>/, "");
      }
      const last = out[out.length - 1];
      const { text: _t, ...shape } = run;
      if (last && last.text && JSON.stringify({ ...last, text: undefined }) === JSON.stringify({ ...shape, text: undefined })) last.text += run.text;
      else out.push(run);
      start = i;
    }
    offset += text.length;
  }
  return out;
}

// ------------------------------------------------------------- context ------
async function documentContext(parsed) {
  let zip;
  const part = async (path) => {
    zip ??= await JSZip.loadAsync(parsed.internal.originalBytes);
    const file = zip.file(path);
    return file ? file.async("string") : null;
  };
  const stylesXml = await part("word/styles.xml");
  const numberingXml = await part("word/numbering.xml");
  const styleUpserts = [];
  const HEADING_SIZES = { 1: 32, 2: 28, 3: 26 };
  const headingStyle = (level) => {
    const known = parsed.headingStyleIds.get(level);
    if (known) return known;
    if (stylesXml === null) return undefined;
    const styleId = `Heading${level}`;
    if (!new RegExp(`w:styleId="${styleId}"`).test(stylesXml) && !styleUpserts.some((up) => up.styleId === styleId))
      styleUpserts.push({
        styleId,
        type: "paragraph",
        name: `heading ${level}`,
        next: "Normal",
        rPr: { bold: true, sizeHalfPoints: HEADING_SIZES[level] || 24 },
        pPr: { keepNext: true, outlineLevel: level, spaceBeforeTwips: 240, spaceAfterTwips: 80 },
      });
    return styleId;
  };
  let maxNumId = numberingXml === null ? 2 : 0;
  for (const match of (numberingXml || "").matchAll(/<w:num\s[^>]*w:numId="(\d+)"/g))
    maxNumId = Math.max(maxNumId, Number(match[1]));
  const newDefs = [];
  const allocateList = (kind) => {
    const numId = String(++maxNumId);
    newDefs.push({ numId, kind });
    return numId;
  };
  return {
    headingStyle,
    listParagraphStyleId: parsed.listParagraphStyleId,
    allocateList,
    options: () => ({
      ...(styleUpserts.length ? { styleUpserts } : {}),
      ...(newDefs.length ? { numbering: { newDefs } } : {}),
    }),
  };
}

/**
 * Turn the browser's ordered block list into GenOffice SaveBlocks + options.
 * Throws a 400 for anything it cannot apply exactly.
 */
export async function planDocumentSave(parsed, inputs, limits) {
  if (!Array.isArray(inputs) || !inputs.length || inputs.length > limits.blocks) throw fail("文書の構成が不正です。");
  const visible = parsed.blocks.filter((block) => !block.hidden);
  const byId = new Map(visible.map((block) => [block.id, block]));
  const used = new Set();
  const ctx = await documentContext(parsed);
  const finalBlocks = [];
  let total = 0;
  let previousList = null; // { kind, numId } of the block just emitted, if it is a list item
  for (const input of inputs) {
    if (!input || typeof input !== "object") throw fail("文書の構成が不正です。");
    if (input.id !== undefined && Object.keys(input).length === 1) {
      const block = byId.get(input.id);
      if (!block || used.has(input.id)) throw fail("編集できない、または重複した要素です。");
      used.add(input.id);
      finalBlocks.push({ kind: "original", docxIndex: block.docxIndex });
      previousList = block.type === "listItem" && block.list ? { kind: block.list.kind, numId: block.list.numId } : null;
      continue;
    }
    const { model, length } = readModel(input);
    total += length;
    if (total > MODEL_LIMITS.totalText) throw fail("文書の文字数が上限を超えています。");
    let original;
    let base;
    if (input.id !== undefined) {
      original = byId.get(input.id);
      if (!original || used.has(input.id) || !isEditableBlock(original, parsed)) throw fail("編集できない、または重複した段落です。");
      used.add(input.id);
      base = original;
    } else if (input.base !== undefined) {
      base = byId.get(input.base);
      if (!base || !isEditableBlock(base, parsed)) throw fail("段落の元情報が不正です。");
    }
    if (original && sameModel(model, modelOf(original))) {
      finalBlocks.push({ kind: "original", docxIndex: original.docxIndex });
      previousList = model.type === "listItem" ? { kind: model.list, numId: original.list?.numId } : null;
      continue;
    }
    for (const run of model.runs)
      if (run.href && !SAFE_NEW_HREF.test(run.href) && !(base?.runs || []).some((r) => hrefOf(r) === run.href))
        throw fail("リンクはhttp(s)またはmailtoのURLを指定してください。");
    const baseModel = base ? modelOf(base) : null;
    const structural =
      !baseModel || baseModel.type !== model.type || baseModel.level !== model.level || baseModel.list !== model.list;
    let numId;
    if (model.type === "listItem") {
      if (!structural && base.list?.numId && baseModel.ilvl === model.ilvl) numId = undefined; // keep raw numPr
      else if (!structural && base.list?.numId) numId = base.list.numId;
      else if (previousList?.kind === model.list && previousList.numId) numId = previousList.numId;
      else numId = ctx.allocateList(model.list);
    }
    const rawPPr = paragraphProperties({ base, model, structural, ctx, numId });
    const generated = {
      type: model.type,
      level: model.level,
      runs: buildRuns(base, model.runs, !original),
      rawPPr,
    };
    if (original) {
      generated.bookmarks = original.bookmarks;
      generated.hiddenBookmarks = original.hiddenBookmarks;
      generated.commentStarts = original.commentStarts;
      generated.commentEnds = original.commentEnds;
    } else {
      // a new paragraph copied from another must not duplicate its comment anchors
      for (const run of generated.runs) delete run.commentIds;
    }
    finalBlocks.push(original ? { kind: "generated", block: generated, docxIndex: original.docxIndex } : { kind: "generated", block: generated });
    previousList = model.type === "listItem" ? { kind: model.list, numId: numId ?? base?.list?.numId } : null;
  }
  for (const block of visible)
    if (!used.has(block.id) && isRequiredBlock(block)) throw fail("区切り（セクション）を含む要素は削除できません。");
  return { finalBlocks, options: ctx.options() };
}
