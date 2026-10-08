import {
  mkdir,
  readFile,
  writeFile,
  rename,
  lstat,
  readdir,
  rm,
} from "node:fs/promises";
import { join } from "node:path";
import { randomUUID, createHash } from "node:crypto";
import {
  parseDocx,
  saveDocx,
  patchParagraphTexts,
  buildBlankDocx,
} from "./engine.mjs";

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
const editable = (block, parsed) =>
  ["paragraph", "heading", "listItem"].includes(block.type) &&
  block.docxIndex !== null &&
  !block.hidden &&
  !(block.runs || []).some((run) => run.vanish) &&
  typeof block.originalXml === "string" &&
  parsed.extras.elements[block.docxIndex]?.name === "w:p" &&
  parsed.internal.documentXml.slice(
    parsed.extras.elements[block.docxIndex].start,
    parsed.extras.elements[block.docxIndex].end,
  ) === block.originalXml &&
  !/<w:(?:fldChar|instrText|drawing|pict|object|sdt|ins|del|sectPr)\b/.test(
    block.originalXml,
  );
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
      /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(edit.text)
    )
      throw fail("本文の入力が不正です。");
    const block = parsed.blocks.find((item) => item.id === edit.blockId);
    if (!block || !editable(block, parsed) || seen.has(edit.blockId))
      throw fail("編集できない、または重複した本文です。");
    seen.add(edit.blockId);
    const escape = (text) =>
      text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const lines = edit.text.split("\n");
    if (lines.length > 100)
      throw fail("一度に追加できる段落は100段落までです。");
    let xml = patchParagraphTexts(block.originalXml, lines[0]);
    if (xml === null && !(block.runs || []).some((run) => run.text)) {
      const text = escape(lines[0]);
      const run = `<w:r><w:t xml:space="preserve">${text}</w:t></w:r>`;
      xml = /^<w:p(?:\s[^>]*)?\/>$/.test(block.originalXml)
        ? block.originalXml.replace(/\/>$/, `>${run}</w:p>`)
        : block.originalXml.replace(/<\/w:p>$/, `${run}</w:p>`);
      if (xml === block.originalXml && lines[0])
        throw fail("この空段落を安全に編集できません。");
    }
    if (xml === null)
      throw fail("この段落は書式を保持した編集に対応していません。");
    // Enter creates new paragraphs; original bookmarks/comments remain in the
    // first paragraph, never duplicated into the new paragraphs.
    xml += lines
      .slice(1)
      .map(
        (line) =>
          `<w:p>${block.rawPPr || ""}<w:r>${block.runs?.[0]?.rawRPr || ""}<w:t xml:space="preserve">${escape(line)}</w:t></w:r></w:p>`,
      )
      .join("");
    return {
      blockId: block.id,
      text: edit.text,
      xml,
      docxIndex: block.docxIndex,
    };
  });
}

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
  const read = async (path) => {
    const info = await lstat(path);
    if (
      !info.isFile() ||
      info.isSymbolicLink() ||
      (info.mode & 0o077) !== 0 ||
      info.size > OFFICE_LIMITS.uploadBytes
    )
      throw fail("文書を読み込めません。");
    return readFile(path);
  };
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
  const describe = ({ meta, parsed }) => ({
    ...meta,
    blocks: parsed.blocks
      .filter((b) => !b.hidden)
      .map((b) => ({
        id: b.id,
        type: b.type,
        level: b.level,
        list: b.list,
        align: b.format?.align,
        editable: editable(b, parsed),
        text: (b.runs || []).filter((r) => !r.vanish).map((r) => r.text).join(""),
        runs: (b.runs || []).filter((r) => !r.vanish).map((r) => ({
          text: r.text,
          bold: r.bold,
          italic: r.italic,
          underline: r.underline,
          color: r.color,
          sizeHalfPoints: r.sizeHalfPoints,
        })),
        label: b.label,
        previewText: b.previewText,
        imageDataUrl: /^data:image\/(?:png|jpeg|gif|webp);base64,/.test(
          b.imageDataUrl || "",
        )
          ? b.imageDataUrl
          : undefined,
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
      })),
    warnings: [
      "表示は編集用のプレビューです。Wordの改ページ・印刷レイアウトと一致するとは限りません。",
      ...(parsed.blocks.some((b) => !b.hidden && !editable(b, parsed))
        ? [
            "表・画像・フィールド等は原本を保持します。この初版では直接編集できません。",
          ]
        : []),
    ],
  });
  const create = (name, bytes) =>
    serial(async () => {
      await ensure();
      if (
        typeof name !== "string" ||
        !name.toLowerCase().endsWith(".docx") ||
        name.length > 160 ||
        /[\/\\\u0000-\u001f]/.test(name)
      )
        throw fail("DOCXファイル名が不正です。");
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
  return {
    create,
    blank: async (name) => create(name, await buildBlankDocx()),
    list: async () => {
      await ensure();
      return Promise.all((await readdir(rootDir)).filter(uuid).map(metadata));
    },
    get: async (id) => describe(await load(id)),
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
      return validateEdits(data.parsed, edits).map(({ blockId, text }) => ({
        blockId,
        text,
      }));
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
        await atomic(join(dir(id), "metadata.json"), JSON.stringify(restored));
        return describe({ meta: restored, parsed });
      }),
    save: (id, revision, edits) =>
      serial(async () => {
        const data = await load(id);
        if (data.meta.revision !== revision)
          throw fail("文書が更新されています。再読み込みしてください。", 409);
        if (data.meta.history.length >= OFFICE_LIMITS.revisions)
          throw fail("履歴が50件に達しました。別文書として保存してください。");
        const validated = validateEdits(data.parsed, edits);
        const blocks = data.parsed.blocks
          .filter((b) => !b.hidden)
          .map((b) => {
            const change = validated.find((e) => e.docxIndex === b.docxIndex);
            return change
              ? { kind: "xml", xml: change.xml, docxIndex: b.docxIndex }
              : { kind: "original", docxIndex: b.docxIndex };
          });
        const bytes = await saveDocx(data.parsed, blocks);
        const parsed = await parseDocx(bytes, { expandAltChunks: false });
        if (
          parsed.blocks.length > OFFICE_LIMITS.blocks ||
          bytes.length > OFFICE_LIMITS.uploadBytes
        )
          throw fail("編集後の文書が上限を超えます。");
        const next = randomUUID();
        const now = new Date().toISOString();
        const meta = {
          ...data.meta,
          revision: next,
          updatedAt: now,
          history: [
            ...data.meta.history,
            { revision: next, createdAt: now, source: "edit" },
          ],
        };
        await atomic(join(dir(id), `${next}.docx`), bytes);
        await atomic(join(dir(id), "metadata.json"), JSON.stringify(meta));
        return describe({ meta, parsed });
      }),
  };
}
