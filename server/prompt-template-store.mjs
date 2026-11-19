import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { chmod, mkdir, open, realpath, rename, rm, writeFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";

export const PROMPT_TEMPLATE_BACKUP_FORMAT = "devmoter-prompt-templates";
export const PROMPT_TEMPLATE_BACKUP_VERSION = 1;
export const MAX_TEMPLATE_BODY_BYTES = 16 * 1024;
export const MAX_TEMPLATES = 200;
// Room for every template at its size limit with worst-case JSON escaping (6 bytes per byte).
export const MAX_BACKUP_BYTES = MAX_TEMPLATES * (MAX_TEMPLATE_BODY_BYTES * 6 + 8 * 1024);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TEMPLATE_KEYS = new Set(["id", "name", "description", "body", "projectId", "createdAt", "updatedAt"]);
const IMPORT_CONFLICT_MODES = new Set(["skip", "overwrite"]);

function fail(message, status = 400) { throw Object.assign(new Error(message), { status }); }

function validId(value) {
  if (typeof value !== "string" || !UUID.test(value)) fail("Invalid template ID");
  return value.toLowerCase();
}
function validName(value) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > 120 || /[\0\r\n]/.test(value)) fail("Name must be 1–120 characters on one line");
  return value.trim();
}
function validDescription(value) {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string" || value.length > 500 || value.includes("\0")) fail("Description must be 500 characters or fewer");
  return value.trim();
}
function validBody(value) {
  if (typeof value !== "string" || !value.trim() || value.includes("\0")) fail("Template body is required");
  if (Buffer.byteLength(value, "utf8") > MAX_TEMPLATE_BODY_BYTES) fail("Template body is too large", 413);
  return value;
}
function validProjectIdShape(value) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || value.length > 200 || /[\0\r\n]/.test(value)) fail("Invalid project ID");
  return value;
}
function validTimestamp(value) {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) fail("Invalid template timestamp");
  return new Date(value).toISOString();
}
function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

// Strict shape check shared by the on-disk file and imported backups: unknown
// keys and wrong types reject the whole document instead of being dropped.
function validStoredTemplate(value) {
  if (!isPlainObject(value)) fail("Template entry must be an object");
  for (const key of Object.keys(value)) if (!TEMPLATE_KEYS.has(key)) fail(`Unknown template field: ${key.slice(0, 40)}`);
  return {
    id: validId(value.id),
    name: validName(value.name),
    description: validDescription(value.description),
    body: validBody(value.body),
    projectId: validProjectIdShape(value.projectId),
    createdAt: validTimestamp(value.createdAt),
    updatedAt: validTimestamp(value.updatedAt)
  };
}

export function validatePromptTemplateBackup(backup) {
  if (!isPlainObject(backup)) fail("Backup must be a JSON object");
  if (backup.format !== PROMPT_TEMPLATE_BACKUP_FORMAT) fail("Not a DevMoter prompt template backup");
  if (backup.version !== PROMPT_TEMPLATE_BACKUP_VERSION) fail("Unsupported backup version");
  if (!Array.isArray(backup.templates)) fail("Backup templates must be a list");
  if (backup.templates.length > MAX_TEMPLATES) fail("Backup holds too many templates", 413);
  const templates = backup.templates.map(validStoredTemplate);
  if (new Set(templates.map(item => item.id)).size !== templates.length) fail("Backup contains duplicate template IDs");
  return templates;
}

export function createPromptTemplateStore({ rootDir, getProjectById = async () => null, now = () => new Date().toISOString() } = {}) {
  if (!rootDir || !isAbsolute(rootDir)) throw new Error("Prompt template rootDir must be an absolute server-owned path");
  const filePath = join(rootDir, "templates.json");
  let cache = null;
  let queue = Promise.resolve();

  async function ensureRoot() {
    await mkdir(rootDir, { recursive: true, mode: 0o700 });
    if (await realpath(rootDir) !== rootDir) fail("Prompt template root must not be a symlink", 500);
    await chmod(rootDir, 0o700);
  }

  async function load() {
    if (cache) return cache;
    await ensureRoot();
    let text;
    let handle;
    try {
      // Check and read through one descriptor, refusing symlinks, so the file cannot be swapped in between.
      handle = await open(filePath, constants.O_RDONLY | constants.O_NOFOLLOW);
      if (!(await handle.stat()).isFile()) fail("Prompt template store is not a regular file", 500);
      text = await handle.readFile("utf8");
    } catch (error) {
      if (error?.code === "ENOENT") { cache = []; return cache; }
      if (error?.code === "ELOOP") fail("Prompt template store is not a regular file", 500);
      throw error;
    } finally {
      await handle?.close();
    }
    let parsed;
    try { parsed = JSON.parse(text); } catch { fail("Prompt template store is corrupted", 500); }
    try { cache = validatePromptTemplateBackup(parsed); }
    catch { fail("Prompt template store is corrupted", 500); }
    return cache;
  }

  async function persist(templates) {
    await ensureRoot();
    const temporary = join(rootDir, `.templates-${randomUUID()}.tmp`);
    const document = { format: PROMPT_TEMPLATE_BACKUP_FORMAT, version: PROMPT_TEMPLATE_BACKUP_VERSION, templates };
    try {
      await writeFile(temporary, JSON.stringify(document, null, 2) + "\n", { mode: 0o600, flag: "wx" });
      await rename(temporary, filePath);
    } catch (error) {
      await rm(temporary, { force: true });
      throw error;
    }
    cache = templates;
  }

  // Serialize every read-modify-write so concurrent requests cannot lose updates.
  function exclusive(task) {
    const run = queue.then(task, task);
    queue = run.catch(() => {});
    return run;
  }

  async function registeredProjectId(value) {
    const projectId = validProjectIdShape(value);
    if (projectId === null) return null;
    let project = null;
    try { project = await getProjectById(projectId); } catch { project = null; }
    if (!project) fail("Project is not registered", 404);
    return projectId;
  }

  function sorted(templates) {
    return [...templates].sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  }

  return {
    // Without a project only global templates are returned; with one, global
    // plus that project's. Templates of other projects never appear.
    async list({ projectId = null, all = false } = {}) {
      const templates = await exclusive(load);
      if (all) return sorted(templates);
      const scope = validProjectIdShape(projectId);
      return sorted(templates.filter(item => item.projectId === null || item.projectId === scope));
    },
    async read(id) {
      const key = validId(id);
      const found = (await exclusive(load)).find(item => item.id === key);
      if (!found) fail("Template not found", 404);
      return { ...found };
    },
    async create(input = {}) {
      if (!isPlainObject(input)) fail("Template must be an object");
      const template = {
        id: randomUUID(),
        name: validName(input.name),
        description: validDescription(input.description),
        body: validBody(input.body),
        projectId: await registeredProjectId(input.projectId),
        createdAt: now(),
        updatedAt: ""
      };
      template.updatedAt = template.createdAt;
      return exclusive(async () => {
        const templates = await load();
        if (templates.length >= MAX_TEMPLATES) fail("Template limit reached", 409);
        await persist([...templates, template]);
        return { ...template };
      });
    },
    async update(id, input = {}) {
      const key = validId(id);
      if (!isPlainObject(input)) fail("Template must be an object");
      const patch = {};
      if (Object.hasOwn(input, "name")) patch.name = validName(input.name);
      if (Object.hasOwn(input, "description")) patch.description = validDescription(input.description);
      if (Object.hasOwn(input, "body")) patch.body = validBody(input.body);
      if (Object.hasOwn(input, "projectId")) patch.projectId = await registeredProjectId(input.projectId);
      return exclusive(async () => {
        const templates = await load();
        const index = templates.findIndex(item => item.id === key);
        if (index < 0) fail("Template not found", 404);
        const updated = { ...templates[index], ...patch, updatedAt: now() };
        await persist(templates.map((item, position) => position === index ? updated : item));
        return { ...updated };
      });
    },
    async remove(id) {
      const key = validId(id);
      return exclusive(async () => {
        const templates = await load();
        if (!templates.some(item => item.id === key)) fail("Template not found", 404);
        await persist(templates.filter(item => item.id !== key));
        return { ok: true, id: key };
      });
    },
    async exportBackup() {
      const templates = await exclusive(load);
      return { format: PROMPT_TEMPLATE_BACKUP_FORMAT, version: PROMPT_TEMPLATE_BACKUP_VERSION, exportedAt: now(), templates: sorted(templates) };
    },
    // The whole backup is validated before anything is written. An existing
    // template is only replaced when the caller explicitly asks for "overwrite".
    async importBackup(backup, { conflict = "skip" } = {}) {
      if (!IMPORT_CONFLICT_MODES.has(conflict)) fail("Invalid conflict mode");
      const incoming = validatePromptTemplateBackup(backup);
      const knownProjects = new Map();
      for (const item of incoming) {
        if (item.projectId === null || knownProjects.has(item.projectId)) continue;
        let project = null;
        try { project = await getProjectById(item.projectId); } catch { project = null; }
        knownProjects.set(item.projectId, Boolean(project));
      }
      return exclusive(async () => {
        const next = [...await load()];
        const imported = [];
        const overwritten = [];
        const skipped = [];
        for (const item of incoming) {
          if (item.projectId !== null && !knownProjects.get(item.projectId)) {
            skipped.push({ id: item.id, name: item.name, reason: "unknown-project" });
            continue;
          }
          const index = next.findIndex(existing => existing.id === item.id);
          if (index >= 0) {
            if (conflict !== "overwrite") { skipped.push({ id: item.id, name: item.name, reason: "exists" }); continue; }
            next[index] = item;
            overwritten.push(item.id);
            continue;
          }
          next.push(item);
          imported.push(item.id);
        }
        if (next.length > MAX_TEMPLATES) fail("Template limit reached", 409);
        if (imported.length || overwritten.length) await persist(next);
        return { imported: imported.length, overwritten: overwritten.length, skipped };
      });
    }
  };
}
