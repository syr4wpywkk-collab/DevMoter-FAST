import {
  mkdir,
  writeFile,
  rename,
  lstat,
  readdir,
  rm,
} from "node:fs/promises";
import { join } from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { readHandle, withOpenFile } from "../safe-file.mjs";
import { parseDocx, saveDocx, buildBlankDocx } from "./engine.mjs";
import {
  isEditableBlock,
  isRequiredBlock,
  modelOf,
  planDocumentSave,
} from "./docx-model.mjs";
import { writeWorkbook } from "./xlsx-engine.mjs";
import {
  applyCellEdits,
  parseWorkbook,
  projectWorkbook,
  XLSX_STALE_WARNING,
  XLSX_WARNINGS,
} from "./xlsx-model.mjs";
import {
  parseDeck,
  projectDeck,
  validateDeckOps,
  applyDeckOps,
  PPTX_WARNINGS,
} from "./pptx-model.mjs";
import { recalcWorkbook } from "./calc.mjs";
import {
  parsePdf,
  projectPdf,
  validatePdfOp,
  validatePdfShapeOps,
  applyPdfOp,
  PDF_WARNINGS,
  PDF_XFA_WARNING,
} from "./pdf-model.mjs";

export const OFFICE_LIMITS = Object.freeze({
  uploadBytes: 12 * 1024 * 1024,
  documents: 100,
  blocks: 2000,
  edits: 100,
  textBytes: 16000,
  revisions: 50,
});
// Document format is classified at ingest from the extension plus a content
// sniff (the wire equivalent of the declared MIME): OOXML formats are ZIP
// packages and PDF starts with %PDF. DOCX is the only format with
// parse/edit support so far; the others are stored with their original bytes.
export const OFFICE_FORMATS = Object.freeze(["docx", "pptx", "pdf", "excel"]);
const FORMAT_EXT = Object.freeze({
  docx: "docx",
  pptx: "pptx",
  pdf: "pdf",
  excel: "xlsx",
});
const extOf = (name) =>
  /\.([^.\\/]+)$/.exec(typeof name === "string" ? name.trim() : "")?.[1]?.toLowerCase();
export const formatForName = (name) =>
  ({ docx: "docx", pptx: "pptx", pdf: "pdf", xlsx: "excel" })[extOf(name)] ||
  null;
const sniffFormat = (bytes) =>
  !bytes || bytes.length < 4
    ? null
    : bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46
      ? "pdf"
      : bytes[0] === 0x50 && bytes[1] === 0x4b
        ? "ooxml"
        : null;
const fail = (message, status = 400) =>
  Object.assign(new Error(message), { status });
const uuid = (value) =>
  typeof value === "string" && /^[a-f0-9-]{36}$/.test(value);
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const editable = isEditableBlock;
/**
 * AI proposals still address one paragraph each ({ blockId, text }); they are
 * only validated here and applied in the editor, which saves the whole document.
 */
export function validateEdits(parsed, edits) {
  if (
    !Array.isArray(edits) ||
    !edits.length ||
    edits.length > OFFICE_LIMITS.edits
  )
    throw fail("変更件数が不正です。");
  const seen = new Set();
  return edits.map((edit) => {
    if (
      !edit ||
      Object.keys(edit).some((key) => !["blockId", "text"].includes(key)) ||
      typeof edit.text !== "string" ||
      Buffer.byteLength(edit.text) > OFFICE_LIMITS.textBytes ||
      /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(edit.text) ||
      edit.text.split("\n").length > 100
    )
      throw fail("本文の入力が不正です。");
    const block = parsed.blocks.find((item) => item.id === edit.blockId);
    if (!block || !editable(block, parsed) || seen.has(edit.blockId))
      throw fail("編集できない、または重複した本文です。");
    seen.add(edit.blockId);
    return { blockId: block.id, text: edit.text };
  });
}
const SHAPE_KEYS = ["blockId", "type", "level", "list", "ilvl", "align"];
const SHAPE_TYPES = ["paragraph", "heading", "listItem"];
const SHAPE_LISTS = ["bullet", "ordered"];
const SHAPE_ALIGNS = ["left", "center", "right", "justify"];
/**
 * AI shaping proposals address one block each and only normalize its structure
 * (type, heading level, list kind/level, alignment). They are validated here —
 * including against the revision they were proposed for — and applied in the
 * editor like text proposals; nothing is written by the proposal itself.
 */
export function validateShapeEdits(parsed, shapes) {
  if (
    !Array.isArray(shapes) ||
    !shapes.length ||
    shapes.length > OFFICE_LIMITS.edits
  )
    throw fail("変更件数が不正です。");
  const seen = new Set();
  return shapes.map((shape) => {
    if (
      !shape ||
      Object.keys(shape).some((key) => !SHAPE_KEYS.includes(key)) ||
      (shape.type !== undefined && !SHAPE_TYPES.includes(shape.type)) ||
      (shape.level !== undefined &&
        !(Number.isInteger(shape.level) && shape.level >= 1 && shape.level <= 9)) ||
      (shape.list !== undefined && !SHAPE_LISTS.includes(shape.list)) ||
      (shape.ilvl !== undefined &&
        !(Number.isInteger(shape.ilvl) && shape.ilvl >= 0 && shape.ilvl <= 8)) ||
      (shape.align !== undefined && !SHAPE_ALIGNS.includes(shape.align)) ||
      !Object.keys(shape).some((key) => key !== "blockId")
    )
      throw fail("構成の変更案が不正です。");
    const block = parsed.blocks.find((item) => item.id === shape.blockId);
    if (!block || !editable(block, parsed) || seen.has(shape.blockId))
      throw fail("編集できない、または重複した本文です。");
    seen.add(shape.blockId);
    const type = shape.type ??
      (block.type === "heading" ? "heading" : block.type === "listItem" ? "listItem" : "paragraph");
    if (
      (shape.level !== undefined && type !== "heading") ||
      (shape.list !== undefined && type !== "listItem") ||
      (shape.ilvl !== undefined && type !== "listItem")
    )
      throw fail("構成の変更案が不正です。");
    const edit = { blockId: block.id, type };
    if (type === "heading") {
      const level = shape.level ?? block.level;
      if (!(Number.isInteger(level) && level >= 1 && level <= 9))
        throw fail("構成の変更案が不正です。");
      edit.level = level;
    }
    if (type === "listItem") {
      edit.list = shape.list ?? (block.list?.kind === "ordered" ? "ordered" : "bullet");
      edit.ilvl = shape.ilvl ?? Math.min(Math.max(block.list?.ilvl || 0, 0), 8);
    }
    if (shape.align !== undefined) edit.align = shape.align;
    return edit;
  });
}
// Autosave writes often; saves within this window replace the latest edit
// revision instead of adding one, so history stays meaningful.
const COALESCE_MS = 10 * 60 * 1000;
const validName = (name) =>
  typeof name === "string" &&
  formatForName(name) !== null &&
  name.length <= 160 &&
  name.trim().length > extOf(name).length + 1 &&
  !/[\/\\\u0000-\u001f]/.test(name);

export function createOfficeStore({ rootDir }) {
  let queue = Promise.resolve();
  const serial = (work) => {
    const next = queue.then(work);
    queue = next.catch(() => {});
    return next;
  };
  const ensure = async () => {
    await mkdir(rootDir, { recursive: true, mode: 0o700 });
    const info = await lstat(rootDir);
    if (
      !info.isDirectory() ||
      info.isSymbolicLink() ||
      (info.mode & 0o077) !== 0
    )
      throw fail("Office保存領域を利用できません。", 500);
  };
  const dir = (id) => {
    if (!uuid(id)) throw fail("文書IDが不正です。");
    return join(rootDir, id);
  };
  // One no-follow open: the type/mode/size checks and the read use the same file.
  const read = (path) =>
    withOpenFile(path, { noFollow: true }, async (handle, info) => {
      if (
        !info.isFile() ||
        (info.mode & 0o077) !== 0 ||
        info.size > OFFICE_LIMITS.uploadBytes
      )
        throw fail("文書を読み込めません。");
      return readHandle(handle, OFFICE_LIMITS.uploadBytes);
    }).catch((error) => {
      if (error?.code === "ELOOP" || error?.code === "EFBIG") throw fail("文書を読み込めません。");
      throw error;
    });
  const metadata = async (id) => {
    const target = dir(id);
    const info = await lstat(target);
    if (
      !info.isDirectory() ||
      info.isSymbolicLink() ||
      (info.mode & 0o077) !== 0
    )
      throw fail("文書を読み込めません。");
    const meta = JSON.parse(
      (await read(join(target, "metadata.json"))).toString(),
    );
    if (
      !meta ||
      meta.id !== id ||
      !uuid(meta.revision) ||
      typeof meta.name !== "string" ||
      !Array.isArray(meta.history) ||
      !meta.history.length ||
      meta.history.length > OFFICE_LIMITS.revisions ||
      meta.history.some(
        (h) =>
          !uuid(h?.revision) ||
          !["original", "edit", "restore"].includes(h.source) ||
          !Number.isFinite(Date.parse(h.createdAt)),
      ) ||
      !meta.history.some((h) => h.revision === meta.revision)
    )
      throw fail("文書の保存情報が破損しています。", 500);
    // Documents stored before format classification default to DOCX on read;
    // the stored metadata file itself is not rewritten.
    meta.format = OFFICE_FORMATS.includes(meta.format) ? meta.format : "docx";
    return meta;
  };
  const atomic = async (path, bytes) => {
    const temp = `${path}.${randomUUID()}.tmp`;
    try {
      await writeFile(temp, bytes, { mode: 0o600, flag: "wx" });
      await rename(temp, path);
    } finally {
      await rm(temp, { force: true });
    }
  };
  // A .xlsx-named OOXML package that is not a real workbook (or fails to
  // parse) is stored read-only like the other uneditable formats.
  const parseExcel = async (bytes) => {
    try {
      const workbook = await parseWorkbook(bytes);
      return workbook.sheets.length ? workbook : null;
    } catch {
      return null;
    }
  };
  // A .pptx-named OOXML package that is not a real presentation (or fails to
  // outline) is stored read-only like the other uneditable formats.
  const parsePptx = async (bytes) => {
    try {
      const deck = await parseDeck(bytes);
      return deck.slides.length ? deck : null;
    } catch {
      return null;
    }
  };
  // A %PDF file that fails to parse (corrupt, over the limits) is likewise
  // stored read-only; projection and ops require a parsed model.
  const parsePdfSafe = async (bytes) => {
    try {
      return await parsePdf(bytes);
    } catch {
      return null;
    }
  };
  const parse = (meta, bytes) =>
    meta.format === "docx"
      ? parseDocx(new Uint8Array(bytes), { expandAltChunks: false })
      : meta.format === "excel"
        ? parseExcel(bytes)
        : meta.format === "pptx"
          ? parsePptx(bytes)
        : meta.format === "pdf"
          ? parsePdfSafe(bytes)
          : null;
  const load = async (id) => {
    const meta = await metadata(id);
    const bytes = await read(
      join(dir(id), `${meta.revision}.${FORMAT_EXT[meta.format]}`),
    );
    return { meta, bytes, parsed: await parse(meta, bytes) };
  };
  const describe = async ({ meta, parsed }) => {
    // PPTX is an outline projection: slide texts/tables/notes, edited via ops.
    if (meta.format === "pptx" && parsed)
      return {
        ...meta,
        format: "pptx",
        blocks: [],
        ...projectDeck(parsed),
        warnings: [...PPTX_WARNINGS],
      };
    // XLSX projects sheets + cells; the calc engine supplies computed values
    // for formula cells when it can run the workbook.
    if (meta.format === "excel" && parsed) {
      const computed = await recalcWorkbook(parsed);
      return {
        ...meta,
        format: "xlsx",
        ...projectWorkbook(parsed, computed),
        calculated: computed !== null,
        warnings: computed ? [...XLSX_WARNINGS] : [XLSX_STALE_WARNING, ...XLSX_WARNINGS.slice(1)],
      };
    }
    // PDF is a final-form format: the projection carries page info, metadata,
    // extracted text and form fields; edits happen through validated ops that
    // write new revisions, never through the block editor.
    if (meta.format === "pdf" && parsed)
      return {
        ...meta,
        format: "pdf",
        ...projectPdf(parsed),
        warnings: [
          ...PDF_WARNINGS,
          ...(parsed.formSupported ? [] : [PDF_XFA_WARNING]),
        ],
      };
    if (!parsed)
      return {
        ...meta,
        blocks: [],
        warnings: [
          "この形式はまだ閲覧・編集できません。原本のダウンロードのみ利用できます。",
        ],
      };
    const emittedImages = new Set();
    let imageBudget = 2 * 1024 * 1024;
    const safeImage = (url) => {
      if (!/^data:image\/(?:png|jpeg|gif|webp);base64,/.test(url || "")) return undefined;
      if (emittedImages.has(url) || url.length > imageBudget) return undefined;
      emittedImages.add(url);
      imageBudget -= url.length;
      return url;
    };
    return ({
    ...meta,
    format: "docx",
    blocks: parsed.blocks
      .filter((b) => !b.hidden)
      .map((b) => {
        const isEditable = editable(b, parsed);
        const model = ["paragraph", "heading", "listItem"].includes(b.type) ? modelOf(b) : null;
        return {
        id: b.id,
        type: b.type,
        level: b.level,
        list: b.list ? { kind: b.list.kind, ilvl: b.list.ilvl, numId: b.list.numId } : undefined,
        align: model?.align,
        editable: isEditable,
        required: isRequiredBlock(b) || undefined,
        text: (b.runs || []).filter((r) => !r.vanish).map((r) => r.text).join(""),
        runs: (b.runs || []).filter((r) => !r.vanish).map((r) => ({
          text: r.text,
          bold: r.bold,
          italic: r.italic,
          underline: r.underline,
          href: typeof r.link?.href === "string" ? r.link.href : undefined,
          color: r.color,
          sizeHalfPoints: r.sizeHalfPoints,
        })),
        label: b.label,
        previewText: b.previewText,
        imageDataUrl: safeImage(b.imageDataUrl),
        table: b.table
          ? {
              rows: b.table.rows.map((row) => ({
                cells: row.map((cell) => ({
                  text: cell.paras.join("\n"),
                  colSpan: cell.colSpan,
                })),
              })),
            }
          : undefined,
        };
      }),
    warnings: [
      "表示は編集用のプレビューです。Wordの改ページ・印刷レイアウトと一致するとは限りません。",
      ...(parsed.blocks.some((b) => !b.hidden && !editable(b, parsed))
        ? [
            "表・画像・フィールド等は原本のまま保持します。",
          ]
        : []),
    ],
    });
  };
  const create = (name, bytes) =>
    serial(async () => {
      await ensure();
      if (!validName(name)) throw fail("ファイル名が不正です。");
      if (!bytes || bytes.length > OFFICE_LIMITS.uploadBytes)
        throw fail("ファイルは12MB以下で選択してください。");
      const format = formatForName(name);
      const sniffed = sniffFormat(bytes);
      if (format === "pdf" ? sniffed !== "pdf" : sniffed !== "ooxml")
        throw fail("ファイルの内容が拡張子と一致しません。");
      if (
        (await readdir(rootDir)).filter(uuid).length >= OFFICE_LIMITS.documents
      )
        throw fail("Office文書数の上限です。");
      const parsed =
        format === "docx"
          ? await parseDocx(new Uint8Array(bytes), { expandAltChunks: false })
          : format === "excel"
            ? await parseExcel(bytes)
            : format === "pptx"
              ? await parsePptx(bytes)
            : format === "pdf"
              ? await parsePdfSafe(bytes)
              : null;
      if (
        format === "docx" &&
        (parsed.blocks.length > OFFICE_LIMITS.blocks ||
          parsed.protection?.enforced ||
          Boolean(parsed.writeProtection?.hash))
      )
        throw fail("文書が大きすぎるか、編集が制限されています。");
      const id = randomUUID();
      const revision = randomUUID();
      const now = new Date().toISOString();
      const meta = {
        id,
        name,
        format,
        revision,
        createdAt: now,
        updatedAt: now,
        history: [{ revision, createdAt: now, source: "original" }],
        originalHash: hash(bytes),
      };
      await mkdir(dir(id), { mode: 0o700 });
      try {
        await atomic(
          join(dir(id), `${revision}.${FORMAT_EXT[format]}`),
          bytes,
        );
        await atomic(join(dir(id), "metadata.json"), JSON.stringify(meta));
      } catch (error) {
        await rm(dir(id), { recursive: true, force: true });
        throw error;
      }
      return describe({ meta, parsed });
    });
  const writeMeta = (id, meta) =>
    atomic(join(dir(id), "metadata.json"), JSON.stringify(meta));
  // Newest activity first: last opened, else last saved/created.
  const recency = (meta) =>
    Math.max(Date.parse(meta.openedAt || 0) || 0, Date.parse(meta.updatedAt) || 0);
  // Shared tail of both save paths: coalesce with a recent edit revision,
  // prune history, write the new revision + metadata, drop pruned files.
  const commitEdit = async (data, bytes, parsed) => {
    const id = data.meta.id;
    const next = randomUUID();
    const now = new Date().toISOString();
    const history = [...data.meta.history];
    const last = history[history.length - 1];
    const replaced = [];
    if (
      last.source === "edit" &&
      history.length > 1 &&
      Date.now() - Date.parse(last.createdAt) < COALESCE_MS
    )
      replaced.push(history.pop().revision);
    history.push({ revision: next, createdAt: replaced.length ? last.createdAt : now, source: "edit" });
    while (history.length > OFFICE_LIMITS.revisions) {
      const at = history.findIndex((h, i) => i > 0 && h.source === "edit" && h.revision !== next);
      if (at === -1) throw fail("履歴が上限に達しました。別文書として保存してください。");
      replaced.push(history.splice(at, 1)[0].revision);
    }
    const meta = { ...data.meta, revision: next, updatedAt: now, history };
    const ext = FORMAT_EXT[data.meta.format];
    await atomic(join(dir(id), `${next}.${ext}`), bytes);
    await writeMeta(id, meta);
    for (const old of replaced)
      await rm(join(dir(id), `${old}.${ext}`), { force: true });
    return { meta, parsed };
  };
  return {
    create,
    blank: async (name) => create(name, await buildBlankDocx()),
    list: async () => {
      await ensure();
      const docs = await Promise.all(
        (await readdir(rootDir)).filter(uuid).map(metadata),
      );
      return docs.sort((a, b) => recency(b) - recency(a));
    },
    get: async (id) => describe(await load(id)),
    /** Open = read + remember when it was opened (drives the document list order). */
    open: (id) =>
      serial(async () => {
        const data = await load(id);
        const meta = { ...data.meta, openedAt: new Date().toISOString() };
        await writeMeta(id, meta);
        return describe({ meta, parsed: data.parsed });
      }),
    rename: (id, name) =>
      serial(async () => {
        if (typeof name !== "string") throw fail("文書名が不正です。");
        const trimmed = name.trim();
        const meta0 = await metadata(id);
        const renamedFormat = formatForName(trimmed);
        if (renamedFormat && renamedFormat !== meta0.format)
          throw fail("文書名が不正です。");
        const full = renamedFormat
          ? trimmed
          : `${trimmed}.${FORMAT_EXT[meta0.format]}`;
        if (!validName(full)) throw fail("文書名が不正です。");
        const meta = { ...meta0, name: full };
        await writeMeta(id, meta);
        return meta;
      }),
    remove: (id) =>
      serial(async () => {
        await metadata(id);
        await rm(dir(id), { recursive: true, force: true });
        return { id, deleted: true };
      }),
    download: async (id, revision) => {
      const meta = await metadata(id);
      const ref = revision || meta.revision;
      if (!meta.history.some((h) => h.revision === ref))
        throw fail("履歴が見つかりません。", 404);
      return {
        meta,
        bytes: await read(
          join(dir(id), `${ref}.${FORMAT_EXT[meta.format]}`),
        ),
      };
    },
    validate: async (id, revision, edits) => {
      const data = await load(id);
      if (!data.parsed)
        throw fail("この形式はまだ編集できません。");
      if (data.meta.revision !== revision)
        throw fail("文書が更新されています。再読み込みしてください。", 409);
      if (data.meta.format !== "docx")
        throw fail("この文書形式はまだ保存できません。");
      return validateEdits(data.parsed, edits);
    },
    /**
     * XLSX counterpart of validate(): check cell edits ({cell, text}) against
     * the current revision without writing anything. Returns the normalized
     * addresses the apply step shows to the user.
     */
    validateCells: async (id, revision, edits) => {
      const data = await load(id);
      if (!data.parsed || data.meta.format !== "excel")
        throw fail("この文書形式はまだ保存できません。");
      if (data.meta.revision !== revision)
        throw fail("文書が更新されています。再読み込みしてください。", 409);
      return applyCellEdits(data.parsed, edits).applied;
    },
    validateShapes: async (id, revision, shapes) => {
      const data = await load(id);
      if (data.meta.revision !== revision)
        throw fail("文書が更新されています。再読み込みしてください。", 409);
      return validateShapeEdits(data.parsed, shapes);
    },
    /**
     * PPTX editing ops (AI proposals and the deck editor share this path):
     * validated against the outline of the exact revision they address —
     * nothing is written here.
     */
    validateOps: async (id, revision, ops) => {
      const data = await load(id);
      if (data.meta.revision !== revision)
        throw fail("文書が更新されています。再読み込みしてください。", 409);
      if (data.meta.format !== "pptx" || !data.parsed)
        throw fail("この文書形式はまだ編集できません。");
      return validateDeckOps(data.parsed, ops);
    },
    /**
     * AI shaping proposals for PDF (metadata edits + stamps only) are
     * validated against the parsed model — like docx shapes, validation only;
     * the editor applies each returned op through pdfOp after review.
     */
    validatePdfShapes: async (id, revision, ops) => {
      const data = await load(id);
      if (data.meta.revision !== revision)
        throw fail("文書が更新されています。再読み込みしてください。", 409);
      if (data.meta.format !== "pdf" || !data.parsed)
        throw fail("この文書形式はまだ編集できません。");
      return validatePdfShapeOps(data.parsed, ops);
    },
    restore: (id, revision, target) =>
      serial(async () => {
        const meta = await metadata(id);
        if (!["docx", "excel", "pptx", "pdf"].includes(meta.format))
          throw fail("この形式はまだ編集できません。");
        if (meta.revision !== revision)
          throw fail("文書が更新されています。再読み込みしてください。", 409);
        if (
          !meta.history.some((h) => h.revision === target) ||
          meta.history.length >= OFFICE_LIMITS.revisions
        )
          throw fail("履歴を復元できません。");
        const bytes = await read(
          join(dir(id), `${target}.${FORMAT_EXT[meta.format]}`),
        );
        const parsed = await parse(meta, bytes);
        const next = randomUUID();
        const now = new Date().toISOString();
        const restored = {
          ...meta,
          revision: next,
          updatedAt: now,
          history: [
            ...meta.history,
            { revision: next, createdAt: now, source: "restore" },
          ],
        };
        await atomic(
          join(dir(id), `${next}.${FORMAT_EXT[meta.format]}`),
          bytes,
        );
        await writeMeta(id, restored);
        return describe({ meta: restored, parsed });
      }),
    /**
     * Save the whole document from the editor's ordered block list.
     * The original revision is never touched. A save shortly after the previous
     * edit replaces that edit revision (autosave), and when history is full the
     * oldest edit revisions after the original are pruned.
     */
    save: (id, revision, blocks) =>
      serial(async () => {
        const data = await load(id);
        if (!data.parsed)
          throw fail("この形式はまだ編集できません。");
        if (data.meta.revision !== revision)
          throw fail("文書が更新されています。再読み込みしてください。", 409);
        // XLSX is read-only in this track; the editor save path stays DOCX-only.
        if (data.meta.format !== "docx")
          throw fail("この文書形式はまだ保存できません。");
        const { finalBlocks, options } = await planDocumentSave(
          data.parsed,
          blocks,
          OFFICE_LIMITS,
        );
        const bytes = await saveDocx(data.parsed, finalBlocks, options);
        const parsed = await parseDocx(bytes, { expandAltChunks: false });
        if (
          parsed.blocks.length > OFFICE_LIMITS.blocks ||
          bytes.length > OFFICE_LIMITS.uploadBytes
        )
          throw fail("編集後の文書が上限を超えます。");
        return describe(await commitEdit(data, bytes, parsed));
      }),
    /**
     * Apply one validated PDF operation (page ops, form fill, stamp,
     * metadata) as a new edit revision — same history/coalescing rules as
     * the docx save path. Body text is never touched in place.
     */
    pdfOp: (id, revision, op) =>
      serial(async () => {
        const data = await load(id);
        if (data.meta.format !== "pdf" || !data.parsed)
          throw fail("この文書形式はまだ編集できません。");
        if (data.meta.revision !== revision)
          throw fail("文書が更新されています。再読み込みしてください。", 409);
        const validated = validatePdfOp(data.parsed, op);
        const bytes = await applyPdfOp(data.bytes, validated);
        if (bytes.length > OFFICE_LIMITS.uploadBytes)
          throw fail("編集後の文書が上限を超えます。");
        const parsed = await parsePdfSafe(bytes);
        if (!parsed) throw fail("編集後の文書が上限を超えます。");
        return describe(await commitEdit(data, bytes, parsed));
      }),
    /**
     * Save pptx editing ops from the deck editor (or an applied AI proposal):
     * validate against the current revision, apply to the stored bytes and
     * commit as a new edit revision with the same coalescing rules as save().
     */
    saveOps: (id, revision, ops) =>
      serial(async () => {
        const data = await load(id);
        if (data.meta.format !== "pptx" || !data.parsed)
          throw fail("この文書形式はまだ編集できません。");
        if (data.meta.revision !== revision)
          throw fail("文書が更新されています。再読み込みしてください。", 409);
        const valid = validateDeckOps(data.parsed, ops);
        const bytes = await applyDeckOps(data.bytes, valid);
        const parsed = await parseDeck(bytes);
        if (bytes.length > OFFICE_LIMITS.uploadBytes)
          throw fail("編集後の文書が上限を超えます。");
        return describe(await commitEdit(data, bytes, parsed));
      }),
    /**
     * Save grid cell edits ({cell, text}) as a new revision. The edits are
     * applied to the parsed model, which is serialized back over the
     * original bytes so styles and unrelated parts keep their bytes; the
     * result is re-parsed and recalculated before being described.
     */
    saveCells: (id, revision, edits) =>
      serial(async () => {
        const data = await load(id);
        if (!data.parsed || data.meta.format !== "excel")
          throw fail("この文書形式はまだ保存できません。");
        if (data.meta.revision !== revision)
          throw fail("文書が更新されています。再読み込みしてください。", 409);
        const { model } = applyCellEdits(data.parsed, edits);
        const bytes = await writeWorkbook(model, new Uint8Array(data.bytes));
        const parsed = await parseWorkbook(bytes);
        if (bytes.length > OFFICE_LIMITS.uploadBytes)
          throw fail("編集後の文書が上限を超えます。");
        return describe(await commitEdit(data, bytes, parsed));
      }),
  };
}
