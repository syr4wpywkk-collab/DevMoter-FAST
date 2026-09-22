import { chmod, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

const ALLOWED_IMAGE_TYPES = new Map([
  ["image/jpeg", ".jpg"],
  ["image/png", ".png"],
  ["image/webp", ".webp"],
  ["image/gif", ".gif"]
]);

const ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function safeDisplayName(value) {
  return String(value || "image")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[\\/]+/g, "_")
    .slice(0, 160) || "image";
}

function assertId(value) {
  const id = String(value || "");
  if (!ID_PATTERN.test(id)) throw new Error("Invalid attachment id");
  return id;
}

export function createMultiApiAttachmentStore({
  directory,
  maxBytes = 15 * 1024 * 1024,
  maxAgeMs = 24 * 60 * 60 * 1000
} = {}) {
  if (!directory) throw new Error("attachment directory is required");

  async function ensureDirectory() {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await chmod(directory, 0o700).catch(() => {});
  }

  function paths(id, extension) {
    return {
      image: join(directory, `${id}${extension}`),
      metadata: join(directory, `${id}.json`)
    };
  }

  async function save({ name, mime, buffer }) {
    const normalizedMime = String(mime || "").split(";", 1)[0].trim().toLowerCase();
    const extension = ALLOWED_IMAGE_TYPES.get(normalizedMime);
    if (!extension) throw new Error("Only JPEG, PNG, WebP, and GIF images are supported");
    if (!Buffer.isBuffer(buffer) || buffer.length === 0) throw new Error("Image is empty");
    if (buffer.length > maxBytes) throw new Error("Image is larger than 15MB");

    await ensureDirectory();
    const id = randomUUID();
    const createdAt = Date.now();
    const record = {
      id,
      name: safeDisplayName(name),
      mime: normalizedMime,
      size: buffer.length,
      extension,
      createdAt
    };
    const target = paths(id, extension);

    await writeFile(target.image, buffer, { mode: 0o600 });
    await chmod(target.image, 0o600).catch(() => {});
    await writeFile(target.metadata, JSON.stringify(record), { mode: 0o600 });
    await chmod(target.metadata, 0o600).catch(() => {});

    return {
      id: record.id,
      name: record.name,
      mime: record.mime,
      size: record.size,
      createdAt: record.createdAt
    };
  }

  async function read(idValue) {
    const id = assertId(idValue);
    await ensureDirectory();
    const metadataPath = join(directory, `${id}.json`);
    const record = JSON.parse(await readFile(metadataPath, "utf8"));

    if (record?.id !== id || !ALLOWED_IMAGE_TYPES.has(record?.mime)) {
      throw new Error("Invalid attachment metadata");
    }
    const expectedExtension = ALLOWED_IMAGE_TYPES.get(record.mime);
    if (record.extension !== expectedExtension) throw new Error("Invalid attachment extension");

    const imagePath = join(directory, `${id}${expectedExtension}`);
    const info = await stat(imagePath);
    if (!info.isFile() || info.size <= 0 || info.size > maxBytes) {
      throw new Error("Invalid attachment file");
    }

    return {
      id,
      name: safeDisplayName(record.name),
      mime: record.mime,
      size: info.size,
      createdAt: Number(record.createdAt) || 0,
      buffer: await readFile(imagePath)
    };
  }

  async function remove(idValue) {
    const id = assertId(idValue);
    let record = null;
    try {
      record = JSON.parse(await readFile(join(directory, `${id}.json`), "utf8"));
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }

    const extension = ALLOWED_IMAGE_TYPES.get(record?.mime);
    if (extension) await rm(join(directory, `${id}${extension}`), { force: true });
    await rm(join(directory, `${id}.json`), { force: true });
    return { ok: true };
  }

  async function cleanup() {
    await ensureDirectory();
    const { readdir } = await import("node:fs/promises");
    const entries = await readdir(directory, { withFileTypes: true });
    const now = Date.now();

    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
      const id = entry.name.slice(0, -5);
      if (!ID_PATTERN.test(id)) continue;
      try {
        const record = JSON.parse(await readFile(join(directory, entry.name), "utf8"));
        if (now - Number(record?.createdAt || 0) <= maxAgeMs) continue;
        await remove(id);
      } catch {
        await rm(join(directory, entry.name), { force: true }).catch(() => {});
      }
    }
  }

  return { save, read, remove, cleanup, directory };
}
