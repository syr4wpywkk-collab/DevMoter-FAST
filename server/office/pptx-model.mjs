// Slide-outline model + editing operations for stored PPTX documents.
//
// The vendored @devmoter/pptx engine reads .pptx bytes into a structural
// outline (per slide: shape texts, tables as text, notes, image/chart part
// references) and applies whole-deck editing operations that return new
// bytes. This module validates the outline against the office limits,
// projects it into the shape the API/browser reads, and validates/applies
// the editing ops (replaceText, add/duplicate/remove/move slide, theme
// normalization) — mirroring how docx-model.mjs validates save inputs.
import {
  readOutline,
  replaceText,
  removeSlide,
  duplicateSlide,
  moveSlide,
  addBlankSlide,
  renderExtDeck,
  zipInternal,
} from "./pptx-engine.mjs";

export const PPTX_LIMITS = Object.freeze({
  slides: 200,
  texts: 2000,
  textBytes: 32000,
  tables: 200,
  tableCells: 20000,
  notesBytes: 32000,
  ops: 100,
});

export const PPTX_WARNINGS = Object.freeze([
  "スライドはテキストのアウトライン表示です。PowerPointのレイアウトとは一致しません。",
  "図表・画像・テーマは原本のまま保持します。",
]);

const fail = (message, status = 400) =>
  Object.assign(new Error(message), { status });
const CONTROL = /[\u0000-\u0008\u000e-\u001d\u001f]/;

const textOk = (value, limit = PPTX_LIMITS.textBytes) =>
  typeof value === "string" &&
  Buffer.byteLength(value) <= limit &&
  !CONTROL.test(value);

/**
 * Parse stored .pptx bytes into the validated deck outline.
 * Throws 400 on malformed packages or limit violations.
 */
export async function parseDeck(bytes) {
  let outline;
  try {
    outline = await readOutline(new Uint8Array(bytes));
  } catch {
    throw fail("PPTXファイルを読み込めません。");
  }
  if (
    !outline ||
    !Array.isArray(outline.slides) ||
    outline.slides.length !== outline.slideCount ||
    outline.slides.length > PPTX_LIMITS.slides
  )
    throw fail("スライドが大きすぎるか、破損しています。");
  let texts = 0;
  let tables = 0;
  let cells = 0;
  for (const slide of outline.slides) {
    texts += slide.texts.length;
    if (texts > PPTX_LIMITS.texts)
      throw fail("スライドが大きすぎるか、破損しています。");
    for (const item of slide.texts)
      if (!textOk(item.text))
        throw fail("スライドの文字列が不正です。");
    tables += slide.tables.length;
    if (tables > PPTX_LIMITS.tables)
      throw fail("スライドが大きすぎるか、破損しています。");
    for (const table of slide.tables) {
      for (const row of table.rows) {
        cells += row.length;
        if (cells > PPTX_LIMITS.tableCells)
          throw fail("スライドが大きすぎるか、破損しています。");
        for (const cell of row)
          if (!textOk(cell)) throw fail("スライドの文字列が不正です。");
      }
    }
    if (slide.notes !== undefined && !textOk(slide.notes, PPTX_LIMITS.notesBytes))
      throw fail("ノートの文字列が不正です。");
  }
  // readOutline lists slides in part-number order; the package's editing ops
  // (and what a user expects from "slide N") follow <p:sldIdLst> presentation
  // order. Reorder the projection so outline indices and op indices agree.
  const ordered = await presentationOrder(bytes, outline);
  return ordered || outline;
}

/**
 * Outline slides re-indexed into presentation (<p:sldIdLst>) order, or null
 * when the order cannot be resolved (the caller keeps part order then).
 */
async function presentationOrder(bytes, outline) {
  try {
    const zip = await zipInternal.loadPptx(new Uint8Array(bytes));
    const paths = zipInternal.slidePartPaths(zip); // part-number order, matches outline
    const byPath = new Map(paths.map((path, i) => [path, i]));
    const pres = await zipInternal.readPart(zip, "ppt/presentation.xml");
    const relsFile = zip.file("ppt/_rels/presentation.xml.rels");
    if (!relsFile) return null;
    const rels = await relsFile.async("string");
    const targets = new Map();
    for (const match of rels.matchAll(/<Relationship\b[^>]*>/g)) {
      const tag = match[0];
      const id = /Id="([^"]+)"/.exec(tag)?.[1];
      const target = /Target="([^"]+)"/.exec(tag)?.[1];
      if (id && target) {
        // Targets are relative to ppt/: "slides/slideN.xml".
        const parts = `ppt/${target}`.split("/").filter((p) => p !== "." && p !== "");
        const resolved = [];
        for (const part of parts) part === ".." ? resolved.pop() : resolved.push(part);
        targets.set(id, resolved.join("/"));
      }
    }
    const lst = /<p:sldIdLst>([\s\S]*?)<\/p:sldIdLst>/.exec(pres)?.[1];
    if (!lst) return null;
    const order = [];
    for (const match of lst.matchAll(/r:id="([^"]+)"/g)) {
      const at = byPath.get(targets.get(match[1]));
      if (at !== undefined) order.push(at);
    }
    if (order.length !== outline.slides.length) return null;
    return {
      ...outline,
      slides: order.map((at, index) => ({ ...outline.slides[at], index })),
    };
  } catch {
    return null;
  }
}

/** Read-only projection of the outline for the API/browser. */
export function projectDeck(outline) {
  return {
    slideCount: outline.slideCount,
    slides: outline.slides.map((slide) => ({
      index: slide.index,
      texts: slide.texts.map((item) =>
        item.shapeName ? { shapeName: item.shapeName, text: item.text } : { text: item.text },
      ),
      tables: slide.tables.map((table) => ({ rows: table.rows })),
      notes: slide.notes,
      images: slide.images.length,
      graphics: slide.graphics.length,
      placeholders: slide.placeholders,
    })),
  };
}

// ---------------------------------------------------------------- ops ------
const OP_TYPES = [
  "replaceText",
  "addSlide",
  "duplicateSlide",
  "removeSlide",
  "moveSlide",
  "theme",
];
const HEX = /^[0-9a-fA-F]{6}$/;
const LAYOUTS = ["LAYOUT_WIDE", "LAYOUT_4x3", "LAYOUT_16x9"];
const indexOk = (value, count) => Number.isInteger(value) && value >= 0 && value < count;

/**
 * Validate one pptx editing op against the current slide count.
 * Returns the normalised op; throws 400 on anything unapplicable.
 */
function validateDeckOp(op, slideCount) {
  if (!op || typeof op !== "object" || !OP_TYPES.includes(op.type))
    throw fail("スライド操作が不正です。");
  switch (op.type) {
    case "replaceText": {
      const keys = Object.keys(op);
      if (
        keys.some((k) => !["type", "from", "to"].includes(k)) ||
        typeof op.from !== "string" ||
        op.from === "" ||
        Buffer.byteLength(op.from) > PPTX_LIMITS.textBytes ||
        typeof op.to !== "string" ||
        Buffer.byteLength(op.to) > PPTX_LIMITS.textBytes ||
        CONTROL.test(op.from) ||
        CONTROL.test(op.to)
      )
        throw fail("テキスト置換の指定が不正です。");
      return { type: "replaceText", from: op.from, to: op.to };
    }
    case "addSlide":
      if (Object.keys(op).length !== 1 || slideCount + 1 > PPTX_LIMITS.slides)
        throw fail("スライドをこれ以上追加できません。");
      return { type: "addSlide" };
    case "duplicateSlide":
      if (
        Object.keys(op).some((k) => !["type", "index"].includes(k)) ||
        !indexOk(op.index, slideCount) ||
        slideCount + 1 > PPTX_LIMITS.slides
      )
        throw fail("複製するスライドの指定が不正です。");
      return { type: "duplicateSlide", index: op.index };
    case "removeSlide":
      if (
        Object.keys(op).some((k) => !["type", "index"].includes(k)) ||
        !indexOk(op.index, slideCount) ||
        slideCount <= 1
      )
        throw fail("削除するスライドの指定が不正です。");
      return { type: "removeSlide", index: op.index };
    case "moveSlide":
      if (
        Object.keys(op).some((k) => !["type", "from", "to"].includes(k)) ||
        !indexOk(op.from, slideCount) ||
        !(Number.isInteger(op.to) && op.to >= 0 && op.to <= slideCount - 1)
      )
        throw fail("移動するスライドの指定が不正です。");
      return { type: "moveSlide", from: op.from, to: op.to };
    case "theme": {
      // Master-level normalization: deck-wide background, footer, slide
      // numbers and layout. Applied by re-rendering the outline through the
      // extended spec — a proposal, reviewed before saving like all AI output.
      if (
        Object.keys(op).some(
          (k) => !["type", "layout", "background", "footerText", "slideNumber"].includes(k),
        ) ||
        (op.layout !== undefined && !LAYOUTS.includes(op.layout)) ||
        (op.background !== undefined && (typeof op.background !== "string" || !HEX.test(op.background))) ||
        (op.footerText !== undefined && !textOk(op.footerText, 200)) ||
        (op.slideNumber !== undefined && typeof op.slideNumber !== "boolean") ||
        !Object.keys(op).some((k) => k !== "type")
      )
        throw fail("テーマ正規化の指定が不正です。");
      const out = { type: "theme" };
      if (op.layout !== undefined) out.layout = op.layout;
      if (op.background !== undefined) out.background = op.background.toUpperCase();
      if (op.footerText !== undefined) out.footerText = op.footerText;
      if (op.slideNumber !== undefined) out.slideNumber = op.slideNumber;
      return out;
    }
  }
  throw fail("スライド操作が不正です。");
}

/**
 * Validate a list of ops against the current outline, tracking how each op
 * changes the slide count so later index ops are checked in sequence.
 */
export function validateDeckOps(outline, ops) {
  if (!Array.isArray(ops) || !ops.length || ops.length > PPTX_LIMITS.ops)
    throw fail("変更件数が不正です。");
  let slideCount = outline.slideCount;
  return ops.map((input) => {
    const op = validateDeckOp(input, slideCount);
    if (op.type === "addSlide" || op.type === "duplicateSlide") slideCount += 1;
    if (op.type === "removeSlide") slideCount -= 1;
    return op;
  });
}

/** Lower the outline onto the extended spec used for theme normalization. */
function deckSpecOf(outline, theme) {
  const master = { name: "main" };
  if (theme.background) master.background = theme.background;
  if (theme.footerText !== undefined) master.footerText = theme.footerText;
  if (theme.slideNumber !== undefined) master.slideNumber = theme.slideNumber;
  const slides = outline.slides.map((slide) => {
    const [first, ...rest] = slide.texts;
    const bullets = rest.flatMap((item) => item.text.split("\n").filter((line) => line.trim()));
    for (const table of slide.tables)
      for (const row of table.rows) bullets.push(row.join(" | "));
    const out = { kind: "bullets", master: "main", bullets };
    if (first?.text) out.title = first.text;
    if (slide.notes) out.notes = slide.notes;
    return out;
  });
  const spec = { masters: [master], slides };
  if (theme.layout) spec.layout = theme.layout;
  return spec;
}

/**
 * Apply one validated op to .pptx bytes; returns the new bytes.
 * `theme` re-renders the whole deck from its outline (text/tables-as-text/
 * notes survive; images, charts and the original design do not).
 */
async function applyDeckOp(bytes, op) {
  switch (op.type) {
    case "replaceText": {
      const result = await replaceText(new Uint8Array(bytes), op.from, op.to);
      if (!result.replacements)
        throw fail("対象の文字列が見つかりません。", 409);
      return result.data;
    }
    case "addSlide":
      return addBlankSlide(new Uint8Array(bytes));
    case "duplicateSlide":
      return duplicateSlide(new Uint8Array(bytes), op.index);
    case "removeSlide":
      return removeSlide(new Uint8Array(bytes), op.index);
    case "moveSlide":
      return moveSlide(new Uint8Array(bytes), op.from, op.to);
    case "theme": {
      const outline = await readOutline(new Uint8Array(bytes));
      return renderExtDeck(deckSpecOf(outline, op));
    }
  }
  throw fail("スライド操作が不正です。");
}

/** Apply validated ops in order; returns the new .pptx bytes. */
export async function applyDeckOps(bytes, ops) {
  let out = new Uint8Array(bytes);
  for (const op of ops) out = await applyDeckOp(out, op);
  return out;
}
