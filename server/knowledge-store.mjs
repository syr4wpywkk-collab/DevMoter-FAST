import { DatabaseSync } from "node:sqlite";
import { constants as fsConstants } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { chmod, mkdir, lstat, open, readFile, readdir, realpath, rename, rm, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, sep } from "node:path";

export const MAX_NOTE_BYTES = 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const META_START = "<!-- devmoter-knowledge ";
const META_END = " -->";

function fail(message, status = 400) { throw Object.assign(new Error(message), { status }); }
function digest(value) { return createHash("sha256").update(value, "utf8").digest("hex"); }
function validId(value) {
  const id = String(value || "");
  if (!UUID.test(id)) fail("Invalid note ID", 400);
  return id.toLowerCase();
}
function validateTitle(value) {
  if (typeof value !== "string" || !value.trim() || value.length > 300 || /[\0\r\n]/.test(value)) fail("Title must be 1–300 characters on one line");
  return value.trim();
}
function validateContent(value) {
  if (typeof value !== "string") fail("Content must be a string");
  const bytes = Buffer.byteLength(value, "utf8");
  if (bytes > MAX_NOTE_BYTES) fail(`Note content exceeds ${MAX_NOTE_BYTES} bytes`, 413);
  return value;
}
function parseMarkdown(text, fallbackId) {
  const first = text.indexOf("\n");
  const metaLine = first >= 0 ? text.slice(0, first).replace(/\r$/, "") : "";
  if (metaLine.startsWith(META_START) && metaLine.endsWith(META_END)) {
    try {
      const metadata = JSON.parse(metaLine.slice(META_START.length, -META_END.length));
      if (metadata && validId(metadata.id) === fallbackId && typeof metadata.title === "string" &&
          typeof metadata.createdAt === "string" && Number.isFinite(Date.parse(metadata.createdAt)) &&
          typeof metadata.updatedAt === "string" && Number.isFinite(Date.parse(metadata.updatedAt))) {
        return { metadata, content: text.slice(first + 1).replace(/^\r?\n/, "") };
      }
    } catch { /* Recover from damaged metadata using the stable ID in the canonical filename. */ }
  }
  const now = new Date().toISOString();
  return { metadata: { id: fallbackId, title: `Recovered note ${fallbackId.slice(0, 8)}`, projectId: null, createdAt: now, updatedAt: now, pinned: false }, content: text };
}

export function createKnowledgeStore({ rootDir, getProjectById = async () => null, now = () => new Date().toISOString() } = {}) {
  if (!rootDir || !isAbsolute(rootDir)) throw new Error("Knowledge rootDir must be an absolute server-owned path");
  const root = rootDir;
  const notesDir = join(root, "notes");
  const dbPath = join(root, "index.sqlite");
  let db;
  let ready;

  async function initialize() {
    if (ready) return ready;
    ready = (async () => {
      await mkdir(notesDir, { recursive: true, mode: 0o700 });
      const canonical = await realpath(root);
      if (canonical !== root) fail("Knowledge root must resolve to its configured canonical path", 500);
      const rootInfo = await lstat(root);
      const notesInfo = await lstat(notesDir);
      if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink() || !notesInfo.isDirectory() || notesInfo.isSymbolicLink()) fail("Knowledge storage directories must be real directories", 403);
      await chmod(root, 0o700);
      await chmod(notesDir, 0o700);
      try {
        const dbInfo = await lstat(dbPath).catch(error => error?.code === "ENOENT" ? null : Promise.reject(error));
        if (dbInfo?.isSymbolicLink() || (dbInfo && !dbInfo.isFile())) fail("Knowledge index is not a regular file", 403);
        db = new DatabaseSync(dbPath);
        db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS notes (id TEXT PRIMARY KEY, title TEXT NOT NULL, path TEXT NOT NULL, project_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, pinned INTEGER NOT NULL, content_hash TEXT NOT NULL, revision TEXT NOT NULL, metadata_json TEXT NOT NULL)");
        await chmod(dbPath, 0o600);
      } catch (error) {
        db?.close();
        db = null;
        if (!/malformed|not a database|disk image is malformed|SQLITE_CORRUPT/i.test(String(error?.message || ""))) throw error;
        for (const suffix of ["", "-wal", "-shm"]) await rm(dbPath + suffix, { force: true });
        db = new DatabaseSync(dbPath);
        db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS notes (id TEXT PRIMARY KEY, title TEXT NOT NULL, path TEXT NOT NULL, project_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, pinned INTEGER NOT NULL, content_hash TEXT NOT NULL, revision TEXT NOT NULL, metadata_json TEXT NOT NULL)");
        await chmod(dbPath, 0o600);
      }
    })();
    return ready;
  }
  async function checkedFile(id, allowMissing = false) {
    await initialize();
    const target = join(notesDir, validId(id) + ".md");
    const rootReal = await realpath(notesDir);
    const relativeTarget = relative(rootReal, target);
    if (rootReal !== notesDir || !relativeTarget || relativeTarget.startsWith(".." + sep) || relativeTarget === ".." || isAbsolute(relativeTarget)) fail("Knowledge path escaped its root", 403);
    try {
      const info = await lstat(target);
      if (info.isSymbolicLink() || !info.isFile()) fail("Knowledge note path is not a regular file", 403);
      const actual = await realpath(target);
      if (actual !== target || !actual.startsWith(rootReal + sep)) fail("Knowledge note path escaped its root", 403);
    } catch (error) {
      if (error?.code === "ENOENT" && allowMissing) return target;
      if (error?.code === "ENOENT") fail("Note not found", 404);
      throw error;
    }
    return target;
  }
  function row(metadata, markdown) {
    const rel = "notes/" + metadata.id + ".md";
    const body = `# ${metadata.title}\n\n${markdown}`;
    const contentHash = digest(body);
    const metadataJson = JSON.stringify({ ...metadata, contentHash, revision: contentHash, canonicalPath: rel });
    return { id: metadata.id, title: metadata.title, canonicalPath: rel, projectId: metadata.projectId ?? null,
      createdAt: metadata.createdAt, updatedAt: metadata.updatedAt, pinned: Boolean(metadata.pinned),
      contentHash, revision: contentHash, metadata: metadataJson };
  }
  function upsert(record) {
    db.prepare(`INSERT INTO notes(id,title,path,project_id,created_at,updated_at,pinned,content_hash,revision,metadata_json)
      VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title,path=excluded.path,
      project_id=excluded.project_id,created_at=excluded.created_at,updated_at=excluded.updated_at,
      pinned=excluded.pinned,content_hash=excluded.content_hash,revision=excluded.revision,metadata_json=excluded.metadata_json`)
      .run(record.id, record.title, record.canonicalPath, record.projectId, record.createdAt, record.updatedAt,
        record.pinned ? 1 : 0, record.contentHash, record.revision, record.metadata);
  }
  function publicRecord(record) {
    return { id: record.id, title: record.title, canonicalPath: record.canonicalPath, projectId: record.projectId,
      createdAt: record.createdAt, updatedAt: record.updatedAt, pinned: Boolean(record.pinned),
      contentHash: record.contentHash, revision: record.revision };
  }
  async function write(id, metadata, content) {
    const target = await checkedFile(id, true);
    const serialized = `${META_START}${JSON.stringify(metadata)}${META_END}\n\n${content}`;
    if (Buffer.byteLength(serialized, "utf8") > MAX_NOTE_BYTES + 4096) fail("Note content exceeds size limit", 413);
    const temp = join(notesDir, `.${id}.${randomUUID()}.tmp`);
    try {
      await writeFile(temp, serialized, { encoding: "utf8", flag: "wx", mode: 0o600 });
      await rename(temp, target);
    } catch (error) {
      await rm(temp, { force: true }).catch(() => {});
      throw error;
    }
    const record = row(metadata, content);
    upsert(record);
    return record;
  }
  async function validateProject(projectId) {
    if (projectId == null || projectId === "") return null;
    if (typeof projectId !== "string" || projectId.length > 200) fail("Invalid project ID");
    const project = await getProjectById(projectId);
    if (!project || project.id !== projectId) fail("Unknown project ID", 404);
    return project.id;
  }
  function encodeUtf8(buffer) {
    const text = buffer.toString("utf8");
    if (!Buffer.from(text, "utf8").equals(buffer)) fail("Note is not valid UTF-8", 422);
    return text;
  }
  async function load(id) {
    const safe = validId(id);
    const path = await checkedFile(safe);
    const info = await lstat(path);
    if (info.size > MAX_NOTE_BYTES + 4096) fail("Stored note exceeds size limit", 413);
    const handle = await open(path, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW || 0));
    let buffer;
    try {
      const openedInfo = await handle.stat();
      if (!openedInfo.isFile() || openedInfo.size > MAX_NOTE_BYTES + 4096) fail("Stored note exceeds size limit", 413);
      buffer = await handle.readFile();
    } finally { await handle.close(); }
    const text = encodeUtf8(buffer);
    const { metadata, content } = parseMarkdown(text, safe);
    const record = row(metadata, content);
    upsert(record);
    return { ...publicRecord(record), content };
  }
  async function list() {
    await initialize();
    await rebuild();
    return db.prepare("SELECT * FROM notes ORDER BY updated_at DESC, id").all().map(publicRecord);
  }
  async function create(input = {}) {
    await initialize();
    const id = randomUUID();
    const metadata = { id, title: validateTitle(input.title), projectId: await validateProject(input.projectId),
      createdAt: now(), updatedAt: now(), pinned: input.pinned === true };
    const record = await write(id, metadata, validateContent(input.content ?? ""));
    return { ...publicRecord(record), content: input.content ?? "" };
  }
  async function update(id, input = {}) {
    const current = await load(id);
    const metadata = { id: current.id, title: input.title === undefined ? current.title : validateTitle(input.title),
      projectId: input.projectId === undefined ? current.projectId : await validateProject(input.projectId),
      createdAt: current.createdAt, updatedAt: now(), pinned: input.pinned === undefined ? current.pinned : input.pinned === true };
    const content = input.content === undefined ? current.content : validateContent(input.content);
    const record = await write(id, metadata, content);
    return { ...publicRecord(record), content };
  }
  async function remove(id) {
    const safe = validId(id);
    const path = await checkedFile(safe);
    await rm(path);
    db.prepare("DELETE FROM notes WHERE id=?").run(safe);
    return { ok: true, id: safe, semantics: "permanent" };
  }
  async function rebuild() {
    await initialize();
    const entries = await readdir(notesDir, { withFileTypes: true });
    const seen = new Set();
    let recovered = 0;
    db.exec("BEGIN IMMEDIATE");
    try {
      for (const entry of entries) {
        const match = entry.name.match(/^([0-9a-f-]{36})\.md$/i);
        if (!match) continue;
        const id = validId(match[1]);
        const file = await checkedFile(id);
        const info = await lstat(file);
        if (info.size > MAX_NOTE_BYTES + 4096) continue;
        const parsed = parseMarkdown(encodeUtf8(await readFile(file)), id);
        if (!parsed.metadata.title || typeof parsed.metadata.title !== "string") parsed.metadata.title = `Recovered note ${id.slice(0, 8)}`;
        if (!parsed.metadata.createdAt) parsed.metadata.createdAt = now();
        if (!parsed.metadata.updatedAt) parsed.metadata.updatedAt = now();
        if (parsed.metadata.projectId) {
          try { parsed.metadata.projectId = await validateProject(parsed.metadata.projectId); }
          catch { parsed.metadata.projectId = null; }
        }
        const record = row(parsed.metadata, parsed.content);
        upsert(record);
        seen.add(id);
        if (parsed.content === (await readFile(file)).toString("utf8") || parsed.metadata.title.startsWith("Recovered note ")) recovered++;
      }
      const rows = db.prepare("SELECT id FROM notes").all();
      for (const item of rows) if (!seen.has(item.id)) db.prepare("DELETE FROM notes WHERE id=?").run(item.id);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    return { ok: true, notes: seen.size, recovered };
  }
  return { initialize, list, create, read: load, update, remove, rebuild, close() { db?.close(); db = null; ready = null; }, rootDir: root };
}
