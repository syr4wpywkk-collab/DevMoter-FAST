// PDF model + projection for stored PDF documents.
//
// The vendored @devmoter/pdf engine (pdf-lib + pdfjs-dist) provides both the
// read surface — page count, metadata, extracted text per page, AcroForm field
// list — and the write operations (rotate/extract/delete/reorder pages, fill
// form fields, text stamps, metadata). PDF is a final-form format: body text
// is never edited in place; every operation produces whole-document bytes that
// the store saves as a new revision.
import {
  extractText,
  getPageInfo,
  rotatePages,
  extractPages,
  deletePages,
  reorderPages,
  listFields,
  fillForm,
  stampText,
  getMetadata,
  setMetadata,
} from "./pdf-engine.mjs";

export const PDF_LIMITS = Object.freeze({
  pages: 512,
  pageText: 64000,
  totalText: 512 * 1024,
  fields: 200,
  fieldName: 512,
  fieldValue: 8000,
  fieldOptions: 200,
  stampText: 200,
  metadataValue: 8000,
});

const fail = (message, status = 400) =>
  Object.assign(new Error(message), { status });

const CONTROL = /[\u0000-\u0008\u000e-\u001d\u001f]/;

/**
 * Parse stored .pdf bytes into the validated model. Throws 400 on malformed
 * documents or limit violations; the store keeps unparsable uploads read-only.
 * XFA forms cannot be read or written by pdf-lib — those are stored with the
 * projection but form fills are rejected at op validation.
 */
export async function parsePdf(bytes) {
  const data = new Uint8Array(bytes);
  let info;
  let extracted;
  let metadata;
  try {
    [info, extracted, metadata] = await Promise.all([
      getPageInfo(data),
      // pdf.js transfers the buffer into its worker; pass a copy so the
      // original bytes stay usable for the other reads.
      extractText(data.slice()),
      getMetadata(data),
    ]);
  } catch {
    throw fail("PDFファイルを読み込めません。");
  }
  if (
    !info ||
    !Number.isInteger(info.pageCount) ||
    info.pageCount < 1 ||
    info.pageCount > PDF_LIMITS.pages ||
    !Array.isArray(info.pages) ||
    info.pages.length !== info.pageCount ||
    info.pages.some(
      (p) =>
        !p ||
        !Number.isFinite(p.width) ||
        !Number.isFinite(p.height) ||
        !Number.isFinite(p.rotation),
    )
  )
    throw fail("PDFが大きすぎるか、破損しています。");
  const pages = [];
  let totalText = 0;
  for (const page of extracted.pages) {
    const text = typeof page.text === "string" ? page.text : "";
    totalText += Buffer.byteLength(text);
    if (
      Buffer.byteLength(text) > PDF_LIMITS.pageText ||
      totalText > PDF_LIMITS.totalText
    )
      throw fail("PDFが大きすぎるか、破損しています。");
    pages.push({ page: page.page, text });
  }
  let fields = [];
  let formSupported = true;
  try {
    fields = await listFields(data);
  } catch {
    // XFA (or a broken AcroForm) cannot be listed by pdf-lib.
    formSupported = false;
  }
  if (fields.length > PDF_LIMITS.fields)
    throw fail("PDFが大きすぎるか、破損しています。");
  return { info, metadata: metadata || {}, pages, fields, formSupported };
}

/**
 * Project the parsed model for the API/browser: page count, sizes/rotation,
 * document metadata, extracted text per page and the form field list.
 * All values here are read-only for the client; edits go through pdf ops.
 */
export function projectPdf(model) {
  return {
    pageCount: model.info.pageCount,
    pageInfo: model.info.pages.map((p) => ({
      width: p.width,
      height: p.height,
      rotation: p.rotation,
    })),
    metadata: model.metadata,
    pages: model.pages.map((p) => ({ page: p.page, text: p.text })),
    fields: model.fields.map((f) => ({
      name: f.name,
      type: f.type,
      value: f.value,
      options: f.options,
      readOnly: f.readOnly,
      required: f.required,
    })),
    formSupported: model.formSupported,
  };
}

export const PDF_WARNINGS = Object.freeze([
  "PDFの本文は最終形です。本文テキストは変更できません。ページ操作・フォーム・スタンプ・文書情報のみ編集できます。",
  "スタンプは標準フォント（ラテン文字）のみ対応します。",
]);
export const PDF_XFA_WARNING =
  "このPDFのフォーム（XFA）は読み取れません。フォーム入力は利用できません。";

const intList = (value, limit) =>
  Array.isArray(value) &&
  value.length > 0 &&
  value.length <= limit &&
  value.every((v) => Number.isInteger(v) && v >= 1 && v <= limit);

const pageSelection = (value, pageCount) => {
  if (value === "all") return "all";
  if (!intList(value, pageCount)) return null;
  if (new Set(value).size !== value.length) return null;
  return value;
};

const METADATA_KEYS = ["title", "author", "subject", "keywords", "creator"];

const validFieldValue = (v) =>
  (typeof v === "string" && Buffer.byteLength(v) <= PDF_LIMITS.fieldValue && !CONTROL.test(v)) ||
  typeof v === "boolean" ||
  (Array.isArray(v) &&
    v.length <= PDF_LIMITS.fieldOptions &&
    v.every((s) => typeof s === "string" && Buffer.byteLength(s) <= PDF_LIMITS.fieldValue && !CONTROL.test(s)));

/**
 * Validate a PDF operation request against the parsed model and normalize it.
 * Kinds: rotate | extract | delete | reorder | fillForm | stamp | metadata.
 * Throws 400 on anything outside that surface — callers never reach the
 * engine with unvalidated input.
 */
export function validatePdfOp(model, op) {
  if (!op || typeof op !== "object" || Array.isArray(op))
    throw fail("PDF操作が不正です。");
  const pageCount = model.info.pageCount;
  const keys = Object.keys(op);
  const only = (...allowed) =>
    keys.every((k) => ["kind", ...allowed].includes(k));
  switch (op.kind) {
    case "rotate": {
      if (!only("pages", "degrees")) throw fail("PDF操作が不正です。");
      const pages = pageSelection(op.pages ?? "all", pageCount);
      if (pages === null || ![90, 180, 270].includes(op.degrees))
        throw fail("PDF操作が不正です。");
      return { kind: "rotate", pages, degrees: op.degrees };
    }
    case "extract": {
      if (!only("pages") || !intList(op.pages, pageCount))
        throw fail("PDF操作が不正です。");
      return { kind: "extract", pages: op.pages };
    }
    case "delete": {
      if (!only("pages") || !intList(op.pages, pageCount))
        throw fail("PDF操作が不正です。");
      if (new Set(op.pages).size !== op.pages.length)
        throw fail("PDF操作が不正です。");
      if (new Set(op.pages).size >= pageCount)
        throw fail("すべてのページは削除できません。");
      return { kind: "delete", pages: op.pages };
    }
    case "reorder": {
      if (!only("order")) throw fail("PDF操作が不正です。");
      const order = op.order;
      if (
        !Array.isArray(order) ||
        order.length !== pageCount ||
        new Set(order).size !== pageCount ||
        !order.every((v) => Number.isInteger(v) && v >= 1 && v <= pageCount)
      )
        throw fail("ページ順が不正です。");
      return { kind: "reorder", order };
    }
    case "fillForm": {
      if (!only("values") || !model.formSupported)
        throw fail("PDF操作が不正です。");
      const values = op.values;
      if (
        !values ||
        typeof values !== "object" ||
        Array.isArray(values) ||
        Object.keys(values).length > PDF_LIMITS.fields
      )
        throw fail("フォーム入力が不正です。");
      const known = new Map(model.fields.map((f) => [f.name, f]));
      const clean = {};
      for (const [name, value] of Object.entries(values)) {
        const field = known.get(name);
        if (
          !field ||
          field.readOnly ||
          ["button", "signature"].includes(field.type) ||
          name.length > PDF_LIMITS.fieldName ||
          !validFieldValue(value)
        )
          throw fail("フォーム入力が不正です。");
        if (
          (field.type === "text" && typeof value !== "string") ||
          (field.type === "checkbox" && typeof value !== "boolean") ||
          (["dropdown", "radio"].includes(field.type) &&
            (typeof value !== "string" || !(field.options || []).includes(value))) ||
          (field.type === "optionList" &&
            (typeof value !== "string" && !Array.isArray(value)))
        )
          throw fail("フォーム入力が不正です。");
        clean[name] = value;
      }
      if (!Object.keys(clean).length) throw fail("PDF操作が不正です。");
      return { kind: "fillForm", values: clean };
    }
    case "stamp": {
      if (!only("text", "pages", "position")) throw fail("PDF操作が不正です。");
      const pages =
        op.pages === undefined ? "all" : pageSelection(op.pages, pageCount);
      if (
        pages === null ||
        !["header", "footer", "diagonal"].includes(op.position) ||
        typeof op.text !== "string" ||
        !op.text.trim() ||
        Buffer.byteLength(op.text) > PDF_LIMITS.stampText ||
        CONTROL.test(op.text)
      )
        throw fail("PDF操作が不正です。");
      // Pages stay 1-based here; applyPdfOp converts for the engine's
      // 0-based API so validated ops can re-enter validation unchanged.
      return {
        kind: "stamp",
        text: op.text,
        pages,
        position: op.position,
      };
    }
    case "metadata": {
      // Accepts both the UI wire shape ({kind, title, ...}) and the
      // normalized AI-proposal shape ({kind, metadata:{...}}).
      if (!only("metadata", ...METADATA_KEYS))
        throw fail("PDF操作が不正です。");
      const src =
        op.metadata &&
        typeof op.metadata === "object" &&
        !Array.isArray(op.metadata)
          ? op.metadata
          : op;
      if (!METADATA_KEYS.some((k) => src[k] !== undefined))
        throw fail("PDF操作が不正です。");
      const metadata = {};
      for (const key of METADATA_KEYS) {
        const value = src[key];
        if (value === undefined) continue;
        if (
          key === "keywords"
            ? !(Array.isArray(value)
                ? value.every(
                    (s) => typeof s === "string" && Buffer.byteLength(s) <= PDF_LIMITS.metadataValue && !CONTROL.test(s),
                  ) && value.length <= 50
                : typeof value === "string" && Buffer.byteLength(value) <= PDF_LIMITS.metadataValue && !CONTROL.test(value))
            : typeof value !== "string" ||
              Buffer.byteLength(value) > PDF_LIMITS.metadataValue ||
              CONTROL.test(value)
        )
          throw fail("文書情報が不正です。");
        metadata[key] =
          key === "keywords" && typeof value === "string"
            ? value.split(/\s+/).filter(Boolean)
            : value;
      }
      return { kind: "metadata", metadata };
    }
    default:
      throw fail("PDF操作が不正です。");
  }
}

/**
 * AI shaping proposals for PDF are limited to metadata edits and text stamps
 * (the docx text-editing surface has no PDF equivalent — body text is final).
 * Each proposal entry is validated like a UI op and normalized for the apply
 * step; nothing is written here.
 */
export function validatePdfShapeOps(model, ops) {
  if (
    !Array.isArray(ops) ||
    !ops.length ||
    ops.length > 30
  )
    throw fail("変更件数が不正です。");
  const seenMetadata = new Set();
  return ops.map((op) => {
    if (!["metadata", "stamp"].includes(op?.kind))
      throw fail("構成の変更案が不正です。");
    if (op.kind === "metadata") {
      for (const key of Object.keys(op.metadata || {})) {
        if (seenMetadata.has(key)) throw fail("構成の変更案が不正です。");
        seenMetadata.add(key);
      }
    }
    return validatePdfOp(model, op);
  });
}

/** Apply a validated op to stored bytes; returns new whole-document bytes. */
export async function applyPdfOp(bytes, op) {
  const data = new Uint8Array(bytes);
  try {
    switch (op.kind) {
      case "rotate":
        return await rotatePages(data, op.pages, op.degrees);
      case "extract":
        return await extractPages(data, op.pages);
      case "delete":
        return await deletePages(data, op.pages);
      case "reorder":
        return await reorderPages(data, op.order);
      case "fillForm":
        return await fillForm(data, op.values);
      case "stamp":
        return await stampText(data, {
          text: op.text,
          pages: op.pages === "all" ? "all" : op.pages.map((p) => p - 1),
          position: op.position,
        });
      case "metadata":
        return await setMetadata(data, op.metadata);
      default:
        throw fail("PDF操作が不正です。");
    }
  } catch (error) {
    if (error?.status) throw error;
    throw fail("PDFを保存できませんでした。");
  }
}
