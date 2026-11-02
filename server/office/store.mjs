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

export const OFFICE_LIMITS = Object.freeze({
  uploadBytes: 12 * 1024 * 1024,
  documents: 100,
  blocks: 2000,
  edits: 100,
  textBytes: 16000,
  revisions: 50,
});
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
// Autosave writes often; saves within this window replace the latest edit
// revision instead of adding one, so history stays meaningful.
const COALESCE_MS = 10 * 60 * 1000;
const validName = (name) =>
  typeof name === "string" &&
  name.toLowerCase().endsWith(".docx") &&
  name.length <= 160 &&
  name.trim().length > 5 &&
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
  const load = async (id) => {
    const meta = await metadata(id);
    const bytes = await read(join(dir(id), `${meta.revision}.docx`));
    return {
      meta,
      bytes,
      parsed: await parseDocx(new Uint8Array(bytes), {
        expandAltChunks: false,
      }),
    };
  };
  const describe = ({ meta, parsed }) => {
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
      if (!validName(name)) throw fail("DOCXファイル名が不正です。");
      if (!bytes || bytes.length > OFFICE_LIMITS.uploadBytes)
        throw fail("DOCXは12MB以下で選択してください。");
      if (
        (await readdir(rootDir)).filter(uuid).length >= OFFICE_LIMITS.documents
      )
        throw fail("Office文書数の上限です。");
      const parsed = await parseDocx(new Uint8Array(bytes), {
        expandAltChunks: false,
      });
      if (
        parsed.blocks.length > OFFICE_LIMITS.blocks ||
        parsed.protection?.enforced ||
        Boolean(parsed.writeProtection?.hash)
      )
        throw fail("文書が大きすぎるか、編集が制限されています。");
      const id = randomUUID();
      const revision = randomUUID();
      const now = new Date().toISOString();
      const meta = {
        id,
        name,
        revision,
        createdAt: now,
        updatedAt: now,
        history: [{ revision, createdAt: now, source: "original" }],
        originalHash: hash(bytes),
      };
      await mkdir(dir(id), { mode: 0o700 });
      try {
        await atomic(join(dir(id), `${revision}.docx`), bytes);
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
        const full = /\.docx$/i.test(trimmed) ? trimmed : `${trimmed}.docx`;
        if (!validName(full)) throw fail("文書名が不正です。");
        const meta = { ...(await metadata(id)), name: full };
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
      return { meta, bytes: await read(join(dir(id), `${ref}.docx`)) };
    },
    validate: async (id, revision, edits) => {
      const data = await load(id);
      if (data.meta.revision !== revision)
        throw fail("文書が更新されています。再読み込みしてください。", 409);
      return validateEdits(data.parsed, edits);
    },
    restore: (id, revision, target) =>
      serial(async () => {
        const meta = await metadata(id);
        if (meta.revision !== revision)
          throw fail("文書が更新されています。再読み込みしてください。", 409);
        if (
          !meta.history.some((h) => h.revision === target) ||
          meta.history.length >= OFFICE_LIMITS.revisions
        )
          throw fail("履歴を復元できません。");
        const bytes = await read(join(dir(id), `${target}.docx`));
        const parsed = await parseDocx(new Uint8Array(bytes), {
          expandAltChunks: false,
        });
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
        await atomic(join(dir(id), `${next}.docx`), bytes);
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
        if (data.meta.revision !== revision)
          throw fail("文書が更新されています。再読み込みしてください。", 409);
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
        await atomic(join(dir(id), `${next}.docx`), bytes);
        await writeMeta(id, meta);
        for (const old of replaced)
          await rm(join(dir(id), `${old}.docx`), { force: true });
        return describe({ meta, parsed });
      }),
  };
}
