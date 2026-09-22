import http from "node:http";
import { mkdir, readFile, readdir, realpath, stat, writeFile } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join, normalize, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { CodexBridge } from "./server/codex-bridge.mjs";
import { fetchGithubRepo, githubStatus, listGithubBranches, listGithubRepos, openGithubRepo } from "./server/github.mjs";
import { assertSafeMarkdownRelativePath, createUploadPath, decodeUploadDataUrl, isInsideHome, isAllowedCodexRpc, normalizeNewProjectPath } from "./server/security-helpers.mjs";
import { createOperationRegistry } from "./server/operation-registry.mjs";
import { listContextEntries, resolveContextReferences } from "./server/context-references.mjs";
import { createUploadRegistry } from "./server/upload-registry.mjs";
import { listContextEntries, resolveContextReferences } from "./server/context-references.mjs";
import { createUploadRegistry } from "./server/upload-registry.mjs";

const OPENCODE_URL = process.env.OPENCODE_URL || "http://127.0.0.1:49374";
const OPENCODE_USERNAME = process.env.OPENCODE_SERVER_USERNAME || "opencode";
const OPENCODE_PASSWORD = process.env.OPENCODE_SERVER_PASSWORD || "";
const OPENCODE_DIRECTORY =
  process.env.OPENCODE_DIRECTORY ||
  process.env.CODEX_CWD ||
  process.env.HOME ||
  process.cwd();
const PORT = Number(process.env.POCKET_PORT || 8787);
const HOST = process.env.POCKET_HOST || "127.0.0.1";
const DIST = fileURLToPath(new URL("./dist/", import.meta.url));
const HOME_DIR = process.env.HOME || process.cwd();
const UPLOAD_DIR = process.env.POCKET_UPLOAD_DIR || join(HOME_DIR, ".local", "state", "opencode-pocket", "uploads");
const PROJECT_CONFIG_DIR = join(HOME_DIR, ".config", "opencode-pocket");
const PROJECTS_FILE = join(PROJECT_CONFIG_DIR, "projects.json");
const PROJECT_FILE_LIMIT = 1024 * 1024;
const PROJECT_SCAN_LIMIT = 200;
const OPERATION_TTL_MS = 10 * 60 * 1000;
const OPERATION_MAX_ENTRIES = 1000;
const operationRegistry = createOperationRegistry({
  ttlMs: OPERATION_TTL_MS,
  maxEntries: OPERATION_MAX_ENTRIES
});
const uploadRegistry = createUploadRegistry();
const DEVMOTER_API_VERSION = 1;
const uploadRegistry = createUploadRegistry();
const DEVMOTER_VERSION = "0.2.0";
const AUTOMATION_API_VERSION = 1;
const codex = new CodexBridge({
  bin: process.env.CODEX_BIN || "codex",
  cwd: process.env.CODEX_CWD || process.cwd()
});


const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webmanifest": "application/manifest+json"
};

function json(res, status, body) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  res.end(JSON.stringify(body));
}

function operationId(req) {
  const value = req.headers["x-pocket-operation-id"];
  if (Array.isArray(value)) return String(value[0] || "").slice(0, 160);
  return typeof value === "string" ? value.slice(0, 160) : "";
}

function claimOperation(req, res, scope) {
  const id = operationId(req);
  if (!id) return true;

  if (!operationRegistry.claim(scope, id)) {
    json(res, 409, {
      error: "Duplicate operation suppressed",
      duplicate: true,
      operationId: id
    });
    return false;
  }

  return true;
}

function openCodeHeaders(extra = {}) {
  const headers = {
    "x-opencode-directory": OPENCODE_DIRECTORY,
    ...extra
  };
  if (OPENCODE_PASSWORD) {
    const token = Buffer.from(`${OPENCODE_USERNAME}:${OPENCODE_PASSWORD}`).toString("base64");
    headers.authorization = `Basic ${token}`;
  }
  return headers;
}

async function openCodeHeadersForRequest(req, extra = {}) {
  const projectId = String(req.headers["x-pocket-project-id"] || "").trim();
  let directory = OPENCODE_DIRECTORY;
  const requestPath = String(req.url || "").split("?", 1)[0];
  const isExistingSession = /^\/api\/opencode\/session\/[^/]+/.test(requestPath) || /^\/api\/session\/[^/]+/.test(requestPath);
  if (projectId && !isExistingSession) directory = (await getProjectById(projectId)).path;
  return openCodeHeaders({ "x-opencode-directory": directory, ...extra });
}

async function readJson(req, limit = 1024 * 1024) {
  const chunks = [];
  let size = 0;

  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error("Request body too large");
    chunks.push(chunk);
  }

  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function readProjectRegistry() {
  await mkdir(PROJECT_CONFIG_DIR, { recursive: true, mode: 0o700 });

  try {
    const parsed = JSON.parse(await readFile(PROJECTS_FILE, "utf8"));
    if (Array.isArray(parsed?.projects)) return parsed.projects;
  } catch {
    // Bootstrap the registry below.
  }

  const candidates = [process.env.CODEX_CWD, process.cwd()]
    .filter(Boolean)
    .map(value => resolve(String(value)))
    .filter(value => value !== resolve(HOME_DIR));

  const projects = [];
  for (const candidate of [...new Set(candidates)]) {
    try {
      const actual = await realpath(candidate);
      const info = await stat(actual);
      if (!info.isDirectory()) continue;
      projects.push({
        id: randomUUID(),
        name: basename(actual) || actual,
        path: actual,
        addedAt: Date.now()
      });
    } catch {
      // Ignore unavailable bootstrap paths.
    }
  }

  await writeProjectRegistry(projects);
  return projects;
}

async function writeProjectRegistry(projects) {
  await mkdir(PROJECT_CONFIG_DIR, { recursive: true, mode: 0o700 });
  await writeFile(
    PROJECTS_FILE,
    JSON.stringify({ version: 1, projects }, null, 2),
    { mode: 0o600 }
  );
}

async function normalizeExistingProjectPath(input) {
  if (!input) throw new Error("Project path is required");
  const candidate = resolve(String(input).replace(/^~(?=\/|$)/, HOME_DIR));
  const actual = await realpath(candidate);
  const info = await stat(actual);
  if (!info.isDirectory()) throw new Error("Project path is not a directory");
  if (!isInsideHome(HOME_DIR, actual)) throw new Error("Projects must be inside your home directory");
  if (actual === await realpath(HOME_DIR)) {
    throw new Error("Choose a project folder, not your whole home directory");
  }
  return actual;
}

async function getProjectById(id) {
  const projects = await readProjectRegistry();
  const project = projects.find(item => item.id === id);
  if (!project) throw new Error("Project not found");

  const actual = await normalizeExistingProjectPath(project.path);
  return { ...project, path: actual };
}


function publicProject(project, available = true) {
  return {
    id: String(project.id),
    name: String(project.name || "Project"),
    available: Boolean(available)
  };
}

async function resolveRegisteredProject(value) {
  const needle = String(value || "").trim();
  if (!needle) {
    const error = new Error("Project is required");
    error.status = 400;
    throw error;
  }

  const projects = await readProjectRegistry();
  const byId = projects.find(project => String(project.id) === needle);
  if (byId) return getProjectById(byId.id);

  const matches = projects.filter(
    project => String(project.name || "").toLowerCase() === needle.toLowerCase()
  );
  if (matches.length > 1) {
    const error = new Error("Project name is ambiguous; use the project ID");
    error.status = 409;
    throw error;
  }
  if (!matches.length) {
    const error = new Error("Project not found");
    error.status = 404;
    throw error;
  }
  return getProjectById(matches[0].id);
}

function attachmentById(id) {
  return uploadRegistry.get(String(id || ""));
}

function replaceAttachmentTokens(text) {
  return String(text || "").replace(
    /@attachment:([0-9a-f-]{20,})/gi,
    (_, id) => attachmentById(id).path
  );
}

function resolveCodexAttachmentInput(value) {
  if (Array.isArray(value)) return value.map(resolveCodexAttachmentInput);
  if (!value || typeof value !== "object") return value;

  const next = { ...value };
  if (next.attachmentId && (next.type === "localImage" || next.type === "mention")) {
    const attachment = attachmentById(next.attachmentId);
    delete next.attachmentId;
    next.path = attachment.path;
  }

  for (const [key, child] of Object.entries(next)) {
    if (key === "path") continue;
    next[key] = resolveCodexAttachmentInput(child);
  }
  return next;
}

async function projectContextList(id, query, res) {
  try {
    const project = await getProjectById(id);
    const entries = await listContextEntries(project.path, query || "");
    json(res, 200, { project: publicProject(project), entries });
  } catch (error) {
    json(res, error?.status || 400, {
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

async function projectContextResolve(id, req, res) {
  try {
    const payload = await readJson(req, 256 * 1024);
    const project = await getProjectById(id);
    const resolved = await resolveContextReferences(project.path, payload?.references);
    json(res, 200, {
      project: publicProject(project),
      ...resolved
    });
  } catch (error) {
    json(res, error?.status || 400, {
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

async function automationProjects(res) {
  try {
    const projects = await readProjectRegistry();
    const output = [];
    for (const project of projects) {
      try {
        await normalizeExistingProjectPath(project.path);
        output.push(publicProject(project, true));
      } catch {
        output.push(publicProject(project, false));
      }
    }
    json(res, 200, { version: DEVMOTER_API_VERSION, projects: output });
  } catch (error) {
    json(res, 500, { error: error instanceof Error ? error.message : String(error) });
  }
}

async function automationOpen(req, url, res) {
  try {
    const project = await resolveRegisteredProject(url.searchParams.get("project"));
    json(res, 200, {
      version: DEVMOTER_API_VERSION,
      project: publicProject(project),
      path: "/?project=" + encodeURIComponent(project.id)
    });
  } catch (error) {
    json(res, error?.status || 400, {
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

function sessionStatus(value) {
  const raw =
    value?.status?.type ||
    value?.status ||
    value?.state ||
    (value?.time?.completed ? "completed" : "");
  return raw ? String(raw) : "unknown";
}

async function automationSessions(url, res) {
  try {
    const projectFilter = url.searchParams.get("project");
    const agentFilter = String(url.searchParams.get("agent") || "").toLowerCase();
    const statusFilter = String(url.searchParams.get("status") || "").toLowerCase();
    const backendFilter = String(url.searchParams.get("backend") || "").toLowerCase();
    const project = projectFilter ? await resolveRegisteredProject(projectFilter) : null;
    const sessions = [];

    if (!backendFilter || backendFilter === "opencode") {
      try {
        const data = await fetchOpenCodeJson("/api/session?limit=100&order=desc");
        for (const item of Array.isArray(data) ? data : []) {
          const itemDirectory =
            typeof item?.location === "string"
              ? item.location
              : item?.location?.directory || item?.directory || "";
          if (project && resolve(String(itemDirectory || "")) !== resolve(project.path)) continue;

          const status = sessionStatus(item);
          const agent = String(item?.agent || "");
          if (agentFilter && agent.toLowerCase() !== agentFilter) continue;
          if (statusFilter && status.toLowerCase() !== statusFilter) continue;
          sessions.push({
            backend: "opencode",
            id: String(item?.id || ""),
            title: String(item?.title || "Untitled session"),
            projectId: project?.id || null,
            agent: agent || null,
            status
          });
        }
      } catch {}
    }

    if (!backendFilter || backendFilter === "codex") {
      try {
        const result = await codex.request("thread/list", { limit: 100 });
        const items = Array.isArray(result?.data) ? result.data : [];
        for (const item of items) {
          const cwd = String(item?.cwd || "");
          if (project && resolve(cwd) !== resolve(project.path)) continue;

          const status = sessionStatus(item);
          const agent = "codex";
          if (agentFilter && agent !== agentFilter) continue;
          if (statusFilter && status.toLowerCase() !== statusFilter) continue;
          sessions.push({
            backend: "codex",
            id: String(item?.id || ""),
            title: String(item?.name || item?.preview || "Codex thread"),
            projectId: project?.id || null,
            agent,
            status
          });
        }
      } catch {}
    }

    json(res, 200, { version: DEVMOTER_API_VERSION, sessions });
  } catch (error) {
    json(res, error?.status || 400, {
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

function openCodeTaskModel(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const slash = raw.indexOf("/");
  if (slash <= 0 || slash === raw.length - 1) {
    throw new Error("OpenCode model must be provider/model");
  }
  return {
    providerID: raw.slice(0, slash),
    id: raw.slice(slash + 1)
  };
}

function extractOpenCodeOutput(payload) {
  if (typeof payload === "string") return payload;
  if (typeof payload?.text === "string") return payload.text;
  const parts = Array.isArray(payload?.parts)
    ? payload.parts
    : Array.isArray(payload?.content)
      ? payload.content
      : [];
  return parts
    .filter(part => part?.type === "text" && typeof part?.text === "string")
    .map(part => part.text)
    .join("");
}

async function runOpenCodeTask(project, payload) {
  const headers = { "x-opencode-directory": project.path };
  const sessionBody = { agent: payload.agent };
  const model = openCodeTaskModel(payload.model);
  if (model) sessionBody.model = model;

  const session = await fetchOpenCodeJson("/api/session", {
    method: "POST",
    headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify(sessionBody),
    signal: AbortSignal.timeout(15000)
  });
  if (!session?.id) throw new Error("OpenCode did not return a session id");

  const response = await fetchOpenCodeJson(
    "/api/session/" + encodeURIComponent(session.id) + "/prompt",
    {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({ text: String(payload.task) }),
      signal: AbortSignal.timeout(30 * 60 * 1000)
    }
  );

  return {
    version: DEVMOTER_API_VERSION,
    backend: "opencode",
    status: "completed",
    sessionId: String(session.id),
    output: extractOpenCodeOutput(response),
    events: [
      { type: "session.created", data: { sessionId: String(session.id) } },
      { type: "task.completed", data: { sessionId: String(session.id) } }
    ]
  };
}

async function runCodexTask(project, payload, operation) {
  const params = { cwd: project.path };
  if (payload.model) params.model = String(payload.model);
  const started = await codex.request("thread/start", params);
  const threadId = String(started?.thread?.id || "");
  if (!threadId) throw new Error("Codex did not return a thread id");

  let turnId = "";
  let output = "";
  const events = [{ type: "session.created", data: { sessionId: threadId } }];

  return await new Promise(async (resolveTask, rejectTask) => {
    const cleanup = () => {
      clearTimeout(timeout);
      codex.off("notification", onNotification);
      codex.off("server-request", onServerRequest);
    };

    const fail = error => {
      cleanup();
      rejectTask(error);
    };

    const onNotification = event => {
      const method = event?.method;
      const params = event?.params || {};
      const eventThread = String(params?.threadId || params?.thread?.id || "");
      if (eventThread && eventThread !== threadId) return;

      if (method === "turn/started") {
        turnId = String(params?.turn?.id || params?.turnId || turnId);
        events.push({ type: "turn.started", data: { sessionId: threadId, turnId } });
        return;
      }

      if (method === "item/agentMessage/delta") {
        const delta = typeof params?.delta === "string" ? params.delta : "";
        if (delta) {
          output += delta;
          events.push({ type: "output.delta", data: { delta } });
        }
        return;
      }

      if (method === "turn/completed") {
        const status = String(params?.turn?.status || "completed");
        events.push({ type: "task.completed", data: { status } });
        cleanup();
        resolveTask({
          version: DEVMOTER_API_VERSION,
          backend: "codex",
          status: status === "failed" ? "failed" : "completed",
          sessionId: threadId,
          turnId: String(params?.turn?.id || turnId || ""),
          output,
          events
        });
      }
    };

    const onServerRequest = request => {
      const params = request?.params || {};
      if (params?.threadId && String(params.threadId) !== threadId) return;
      fail(new Error("Headless Codex task requires interactive approval"));
    };

    const timeout = setTimeout(
      () => fail(new Error("Headless Codex task timed out")),
      30 * 60 * 1000
    );

    codex.on("notification", onNotification);
    codex.on("server-request", onServerRequest);

    try {
      const turn = await codex.request("turn/start", {
        threadId,
        input: [{ type: "text", text: String(payload.task) }],
        clientUserMessageId: operation || randomUUID(),
        ...(payload.model ? { model: String(payload.model) } : {})
      });
      turnId = String(turn?.turn?.id || turnId || "");
    } catch (error) {
      fail(error);
    }
  });
}

async function automationTask(req, res) {
  try {
    const payload = await readJson(req, 2 * 1024 * 1024);
    const project = await resolveRegisteredProject(payload?.project);
    const backend = String(payload?.backend || "opencode");
    const agent = String(payload?.agent || "").trim();
    const task = String(payload?.task || "").trim();
    if (!agent || !task) throw new Error("agent and task are required");
    if (backend !== "opencode" && backend !== "codex") {
      throw new Error("backend must be opencode or codex");
    }

    const result = backend === "codex"
      ? await runCodexTask(project, payload, operationId(req))
      : await runOpenCodeTask(project, payload);

    json(res, 200, {
      ...result,
      project: publicProject(project)
    });
  } catch (error) {
    const status = error?.status || 400;
    json(res, status, {
      version: DEVMOTER_API_VERSION,
      status: "failed",
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

async function resolveProjectMarkdownPath(project, relativePath, { mustExist = false } = {}) {
  const safeRelative = assertSafeMarkdownRelativePath(relativePath);
  const root = await realpath(project.path);
  const target = resolve(root, safeRelative);
  const rel = relative(root, target);

  if (rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error("File must stay inside the project");
  }

  const parent = dirname(target);
  const actualParent = await realpath(parent);
  const parentRel = relative(root, actualParent);
  if (parentRel.startsWith("..") || isAbsolute(parentRel)) {
    throw new Error("File parent escapes the project");
  }

  if (mustExist) {
    const actualTarget = await realpath(target);
    const targetRel = relative(root, actualTarget);
    if (targetRel.startsWith("..") || isAbsolute(targetRel)) {
      throw new Error("File escapes the project");
    }
  }

  return { root, target, relativePath: safeRelative };
}

async function scanMarkdownFiles(project) {
  const root = await realpath(project.path);
  const ignored = new Set([".git", "node_modules", "dist", "build", ".next", ".venv"]);
  const results = [];

  async function walk(current, prefix, depth) {
    if (depth > 3 || results.length >= PROJECT_SCAN_LIMIT) return;

    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      return;
    }

    entries.sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
      if (results.length >= PROJECT_SCAN_LIMIT) break;
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (ignored.has(entry.name)) continue;
        await walk(join(current, entry.name), join(prefix, entry.name), depth + 1);
        continue;
      }
      if (!entry.isFile() || extname(entry.name).toLowerCase() !== ".md") continue;

      const relativePath = join(prefix, entry.name).split(sep).join("/");
      const full = join(current, entry.name);
      let info = null;
      try {
        info = await stat(full);
      } catch {
        // Keep the file listed even if metadata fails.
      }

      results.push({
        path: relativePath,
        name: entry.name,
        size: info?.size ?? null,
        updatedAt: info?.mtimeMs ?? null,
        kind:
          entry.name.toUpperCase() === "AGENTS.MD" ? "agents" :
          entry.name.toUpperCase() === "HANDOFF.MD" ? "handoff" :
          entry.name.toUpperCase() === "README.MD" ? "readme" :
          "markdown"
      });
    }
  }

  await walk(root, "", 0);

  const priority = { agents: 0, handoff: 1, readme: 2, markdown: 3 };
  return results.sort((a, b) =>
    priority[a.kind] - priority[b.kind] || a.path.localeCompare(b.path)
  );
}

async function projectsList(res) {
  try {
    const projects = await readProjectRegistry();
    const sanitized = [];

    for (const project of projects) {
      try {
        const actual = await normalizeExistingProjectPath(project.path);
        sanitized.push({ ...project, path: actual, available: true });
      } catch {
        sanitized.push({ ...project, available: false });
      }
    }

    json(res, 200, { projects: sanitized });
  } catch (error) {
    json(res, 500, { error: error instanceof Error ? error.message : String(error) });
  }
}

async function projectsCreateOrAdd(req, res) {
  try {
    const payload = await readJson(req);
    const action = payload?.action === "create" ? "create" : "add";
    const projects = await readProjectRegistry();

    let projectPath;
    if (action === "create") {
      projectPath = normalizeNewProjectPath(payload?.path, HOME_DIR);
      await mkdir(projectPath, { recursive: false, mode: 0o700 });
      projectPath = await normalizeExistingProjectPath(projectPath);
    } else {
      projectPath = await normalizeExistingProjectPath(payload?.path);
    }

    const existing = projects.find(project => resolve(project.path) === projectPath);
    if (existing) {
      json(res, 200, { project: existing, existed: true });
      return;
    }

    const project = {
      id: randomUUID(),
      name: String(payload?.name || basename(projectPath) || projectPath).slice(0, 120),
      path: projectPath,
      addedAt: Date.now()
    };

    projects.unshift(project);
    await writeProjectRegistry(projects);
    json(res, 201, { project, existed: false });
  } catch (error) {
    json(res, 400, { error: error instanceof Error ? error.message : String(error) });
  }
}

async function projectRemove(id, res) {
  try {
    const projects = await readProjectRegistry();
    const next = projects.filter(project => project.id !== id);
    if (next.length === projects.length) {
      json(res, 404, { error: "Project not found" });
      return;
    }
    await writeProjectRegistry(next);
    json(res, 200, { ok: true });
  } catch (error) {
    json(res, 500, { error: error instanceof Error ? error.message : String(error) });
  }
}

async function projectDocs(id, res) {
  try {
    const project = await getProjectById(id);
    const files = await scanMarkdownFiles(project);
    json(res, 200, { project, files });
  } catch (error) {
    json(res, 400, { error: error instanceof Error ? error.message : String(error) });
  }
}

async function projectReadFile(id, path, res) {
  try {
    const project = await getProjectById(id);
    const resolved = await resolveProjectMarkdownPath(project, path, { mustExist: true });
    const info = await stat(resolved.target);
    if (info.size > PROJECT_FILE_LIMIT) throw new Error("Markdown file is larger than 1MB");
    const content = await readFile(resolved.target, "utf8");
    json(res, 200, {
      projectId: id,
      path: resolved.relativePath,
      content,
      size: info.size,
      updatedAt: info.mtimeMs
    });
  } catch (error) {
    json(res, 400, { error: error instanceof Error ? error.message : String(error) });
  }
}

async function projectWriteFile(id, req, res) {
  try {
    const payload = await readJson(req, PROJECT_FILE_LIMIT + 64 * 1024);
    const project = await getProjectById(id);
    const resolved = await resolveProjectMarkdownPath(project, payload?.path);
    const content = String(payload?.content ?? "");

    if (Buffer.byteLength(content, "utf8") > PROJECT_FILE_LIMIT) {
      throw new Error("Markdown file is larger than 1MB");
    }

    await writeFile(resolved.target, content, { encoding: "utf8", mode: 0o600 });
    const info = await stat(resolved.target);
    json(res, 200, {
      ok: true,
      path: resolved.relativePath,
      size: info.size,
      updatedAt: info.mtimeMs
    });
  } catch (error) {
    json(res, 400, { error: error instanceof Error ? error.message : String(error) });
  }
}


function httpError(message, status = 400, code = "bad_request") {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

async function resolveRegisteredProject(selector) {
  const value = String(selector || "").trim();
  if (!value) throw httpError("Project is required", 400, "project_required");

  const projects = await readProjectRegistry();
  const byId = projects.find(project => project.id === value);
  if (byId) return getProjectById(byId.id);

  const matches = projects.filter(
    project => String(project.name || "").toLowerCase() === value.toLowerCase()
  );
  if (!matches.length) throw httpError("Project not found", 404, "project_not_found");
  if (matches.length > 1) {
    throw httpError("Project name is ambiguous; use its project ID", 409, "project_ambiguous");
  }
  return getProjectById(matches[0].id);
}

async function automationProjects(res) {
  const projects = await readProjectRegistry();
  const safe = [];
  for (const project of projects) {
    let available = false;
    try {
      await normalizeExistingProjectPath(project.path);
      available = true;
    } catch {}
    safe.push({
      id: project.id,
      name: project.name,
      addedAt: project.addedAt ?? null,
      available
    });
  }
  json(res, 200, { apiVersion: AUTOMATION_API_VERSION, projects: safe });
}

async function automationOpen(req, url, res) {
  try {
    const project = await resolveRegisteredProject(url.searchParams.get("project"));
    const forwarded = String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim();
    const protocol = forwarded === "https" ? "https" : "http";
    const publicOrigin = String(process.env.DEVMOTER_PUBLIC_ORIGIN || "").trim();
    const origin = publicOrigin || (protocol + "://" + String(req.headers.host || (HOST + ":" + PORT)));
    const target = new URL("/?project=" + encodeURIComponent(project.id), origin).toString();
    json(res, 200, {
      apiVersion: AUTOMATION_API_VERSION,
      project: { id: project.id, name: project.name },
      url: target
    });
  } catch (error) {
    json(res, error?.status || 400, {
      error: error instanceof Error ? error.message : String(error),
      code: error?.code || "open_failed"
    });
  }
}

function projectIdForPath(projects, value) {
  const path = String(value || "");
  if (!path) return null;
  const found = projects.find(project => resolve(project.path) === resolve(path));
  return found?.id || null;
}

function normalizeSessionStatus(value) {
  const status = String(value || "").trim().toLowerCase();
  return status || "unknown";
}

async function automationSessions(url, res) {
  try {
    const selector = url.searchParams.get("project");
    const requestedProject = selector ? await resolveRegisteredProject(selector) : null;
    const agentFilter = String(url.searchParams.get("agent") || "").toLowerCase();
    const statusFilter = String(url.searchParams.get("status") || "").toLowerCase();
    const backendFilter = String(url.searchParams.get("backend") || "").toLowerCase();
    if (backendFilter && !["opencode", "codex"].includes(backendFilter)) {
      throw httpError("backend must be opencode or codex", 400, "invalid_backend");
    }

    const projects = await readProjectRegistry();
    const sessions = [];
    const errors = [];

    if (!backendFilter || backendFilter === "opencode") {
      try {
        const headers = requestedProject
          ? { "x-opencode-directory": requestedProject.path }
          : {};
        const payload = await fetchOpenCodeJson("/api/session?limit=100&order=desc", { headers });
        const list = Array.isArray(payload) ? payload : Array.isArray(payload?.data) ? payload.data : [];
        for (const session of list) {
          const location = typeof session?.location === "string"
            ? session.location
            : session?.location?.directory;
          const projectId = requestedProject?.id || projectIdForPath(projects, location);
          sessions.push({
            backend: "opencode",
            id: String(session?.id || ""),
            title: String(session?.title || "Untitled session"),
            agent: String(session?.agent || ""),
            status: normalizeSessionStatus(session?.status || session?.state),
            projectId,
            updatedAt: session?.time?.updated ?? null
          });
        }
      } catch (error) {
        errors.push({ backend: "opencode", error: error instanceof Error ? error.message : String(error) });
      }
    }

    if (!backendFilter || backendFilter === "codex") {
      try {
        const payload = await codex.request("thread/list", { limit: 100 }, { timeoutMs: 8000 });
        const list = Array.isArray(payload?.data) ? payload.data : Array.isArray(payload?.threads) ? payload.threads : [];
        for (const thread of list) {
          const projectId = projectIdForPath(projects, thread?.cwd);
          if (requestedProject && projectId !== requestedProject.id) continue;
          sessions.push({
            backend: "codex",
            id: String(thread?.id || ""),
            title: String(thread?.name || thread?.preview || "Untitled thread"),
            agent: "codex",
            status: normalizeSessionStatus(thread?.status || thread?.state),
            projectId,
            updatedAt: thread?.updatedAt ?? thread?.updated_at ?? null
          });
        }
      } catch (error) {
        errors.push({ backend: "codex", error: error instanceof Error ? error.message : String(error) });
      }
    }

    const filtered = sessions.filter(session =>
      (!agentFilter || session.agent.toLowerCase() === agentFilter) &&
      (!statusFilter || session.status.toLowerCase() === statusFilter)
    );

    json(res, 200, {
      apiVersion: AUTOMATION_API_VERSION,
      sessions: filtered,
      errors
    });
  } catch (error) {
    json(res, error?.status || 400, {
      error: error instanceof Error ? error.message : String(error),
      code: error?.code || "sessions_failed"
    });
  }
}

function parseOpenCodeModel(value) {
  const text = String(value || "").trim();
  if (!text) return null;
  const slash = text.indexOf("/");
  if (slash <= 0 || slash === text.length - 1) {
    throw httpError("OpenCode model must be provider/model", 400, "invalid_model");
  }
  return { providerID: text.slice(0, slash), modelID: text.slice(slash + 1) };
}

function extractOpenCodeOutput(payload) {
  if (typeof payload === "string") return payload;
  if (typeof payload?.text === "string") return payload.text;
  if (typeof payload?.message === "string") return payload.message;
  if (Array.isArray(payload?.parts)) {
    return payload.parts
      .filter(part => part?.type === "text" && typeof part.text === "string")
      .map(part => part.text)
      .join("");
  }
  return "";
}

async function runOpenCodeAutomationTask(project, { agent, task, model }) {
  const headers = {
    "content-type": "application/json",
    "x-opencode-directory": project.path
  };
  const agentsPayload = await fetchOpenCodeJson("/api/agent", { headers });
  const agents = Array.isArray(agentsPayload) ? agentsPayload : Array.isArray(agentsPayload?.data) ? agentsPayload.data : [];
  if (!agents.some(item => String(item?.id || "") === agent && item?.hidden !== true)) {
    throw httpError("OpenCode agent is unavailable", 400, "unsupported_agent");
  }

  const selectedModel = parseOpenCodeModel(model);
  const sessionBody = { agent };
  if (selectedModel) {
    sessionBody.model = {
      id: selectedModel.modelID,
      providerID: selectedModel.providerID
    };
  }

  const session = await fetchOpenCodeJson("/api/session", {
    method: "POST",
    headers,
    body: JSON.stringify(sessionBody)
  });
  if (!session?.id) throw httpError("OpenCode did not return a session ID", 502, "backend_error");

  const result = await fetchOpenCodeJson("/api/session/" + encodeURIComponent(session.id) + "/prompt", {
    method: "POST",
    headers,
    body: JSON.stringify({ text: task }),
    signal: AbortSignal.timeout(10 * 60 * 1000)
  });

  return {
    apiVersion: AUTOMATION_API_VERSION,
    backend: "opencode",
    status: "completed",
    project: { id: project.id, name: project.name },
    sessionId: String(session.id),
    output: extractOpenCodeOutput(result),
    events: [
      { type: "session.created", data: { sessionId: String(session.id), backend: "opencode" } },
      { type: "task.completed", data: { sessionId: String(session.id) } }
    ]
  };
}

async function runCodexAutomationTask(project, { agent, task, model }, req) {
  if (!["codex", "default"].includes(String(agent || "").toLowerCase())) {
    throw httpError("Codex supports the codex agent only", 400, "unsupported_agent");
  }

  const startParams = { cwd: project.path };
  if (model) startParams.model = model;
  const started = await codex.request("thread/start", startParams);
  const thread = started?.thread ?? started;
  const threadId = String(thread?.id || "");
  if (!threadId) throw httpError("Codex did not return a thread ID", 502, "backend_error");

  const clientMessageId = operationId(req) || randomUUID();
  const events = [
    { type: "session.created", data: { sessionId: threadId, backend: "codex" } }
  ];

  return new Promise((resolveTask, rejectTask) => {
    let settled = false;
    let turnId = "";
    let output = "";

    const cleanup = () => {
      codex.off("notification", onNotification);
      codex.off("server-request", onServerRequest);
      clearTimeout(timeout);
    };

    const finish = result => {
      if (settled) return;
      settled = true;
      cleanup();
      resolveTask(result);
    };

    const fail = error => {
      if (settled) return;
      settled = true;
      cleanup();
      rejectTask(error);
    };

    const onNotification = event => {
      const method = String(event?.method || "");
      const params = event?.params ?? {};
      if (params?.threadId && String(params.threadId) !== threadId) return;

      if (method === "item/agentMessage/delta") {
        const delta = typeof params?.delta === "string" ? params.delta : "";
        if (delta) {
          output += delta;
          events.push({ type: "output.delta", data: { text: delta } });
        }
        return;
      }

      if (method === "turn/completed") {
        const statusRaw = String(params?.turn?.status || "completed").toLowerCase();
        const status = ["completed", "success", "succeeded"].includes(statusRaw) ? "completed" : "failed";
        events.push({ type: "task." + status, data: { turnId: turnId || params?.turn?.id || null, status: statusRaw } });
        finish({
          apiVersion: AUTOMATION_API_VERSION,
          backend: "codex",
          status,
          project: { id: project.id, name: project.name },
          sessionId: threadId,
          turnId: turnId || String(params?.turn?.id || ""),
          output,
          events
        });
      }
    };

    const onServerRequest = event => {
      const params = event?.params ?? {};
      if (params?.threadId && String(params.threadId) !== threadId) return;
      const method = String(event?.method || "");
      if (
        method !== "item/commandExecution/requestApproval" &&
        method !== "item/fileChange/requestApproval"
      ) return;

      events.push({
        type: "task.blocked",
        data: {
          reason: "approval_required",
          approvalType: method.includes("fileChange") ? "file_change" : "command"
        }
      });
      finish({
        apiVersion: AUTOMATION_API_VERSION,
        backend: "codex",
        status: "blocked",
        message: "Task is waiting for approval in DevMoter",
        project: { id: project.id, name: project.name },
        sessionId: threadId,
        turnId,
        output,
        events
      });
    };

    const timeout = setTimeout(() => {
      fail(httpError("Codex task timed out", 504, "task_timeout"));
    }, 10 * 60 * 1000);

    codex.on("notification", onNotification);
    codex.on("server-request", onServerRequest);

    const turnParams = {
      threadId,
      input: [{ type: "text", text: task }],
      clientUserMessageId: clientMessageId
    };
    if (model) turnParams.model = model;

    codex.request("turn/start", turnParams)
      .then(result => {
        turnId = String(result?.turn?.id || result?.turnId || "");
        events.push({ type: "task.started", data: { turnId: turnId || null } });
      })
      .catch(fail);
  });
}

async function automationTask(req, res) {
  try {
    const payload = await readJson(req, 512 * 1024);
    const project = await resolveRegisteredProject(payload?.project);
    const agent = String(payload?.agent || "").trim();
    const task = String(payload?.task || "").trim();
    const backend = String(payload?.backend || "opencode").trim().toLowerCase();
    const model = String(payload?.model || "").trim();

    if (!agent) throw httpError("Agent is required", 400, "agent_required");
    if (!task) throw httpError("Task is required", 400, "task_required");
    if (Buffer.byteLength(task, "utf8") > 256 * 1024) {
      throw httpError("Task is too large", 413, "task_too_large");
    }
    if (!["opencode", "codex"].includes(backend)) {
      throw httpError("backend must be opencode or codex", 400, "invalid_backend");
    }

    const result = backend === "opencode"
      ? await runOpenCodeAutomationTask(project, { agent, task, model })
      : await runCodexAutomationTask(project, { agent, task, model }, req);
    json(res, 200, result);
  } catch (error) {
    json(res, error?.status || 502, {
      error: error instanceof Error ? error.message : String(error),
      code: error?.code || "task_failed"
    });
  }
}

async function projectContextList(id, url, res) {
  try {
    const project = await getProjectById(id);
    const entries = await listContextEntries(project.path, url.searchParams.get("q") || "");
    json(res, 200, { projectId: id, entries });
  } catch (error) {
    json(res, error?.status || 400, {
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

async function projectContextResolve(id, req, res) {
  try {
    const payload = await readJson(req, 128 * 1024);
    const project = await getProjectById(id);
    const result = await resolveContextReferences(project.path, payload?.references);
    json(res, 200, { projectId: id, ...result });
  } catch (error) {
    json(res, error?.status || 400, {
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

async function materializeCodexUploadInputs(method, params) {
  if (method !== "turn/start" || !Array.isArray(params?.input)) return params;
  const input = params.input.map(item => {
    if (!item || typeof item !== "object") return item;
    if (item.uploadId) {
      const upload = uploadRegistry.get(item.uploadId);
      const next = { ...item, path: upload.path };
      delete next.uploadId;
      return next;
    }
    if ((item.type === "localImage" || item.type === "mention") && item.path) {
      throw httpError("Direct attachment paths are not accepted; upload the file first", 400, "unsafe_attachment_path");
    }
    return item;
  });
  return { ...params, input };
}

async function githubProjectsApi() {
  return { read: readProjectRegistry, write: writeProjectRegistry };
}

async function githubOpen(req, res) {
  const payload = await readJson(req);
  const owner = String(payload?.owner || "");
  const repo = String(payload?.repo || "");
  const branch = String(payload?.branch || "");
  const result = await openGithubRepo(HOME_DIR, await githubProjectsApi(), owner, repo, branch);
  json(res, 200, result);
}

async function githubFetch(req, res) {
  const payload = await readJson(req);
  json(res, 200, await fetchGithubRepo(HOME_DIR, payload?.owner, payload?.repo));
}

async function fetchOpenCodeJson(path, init = {}) {
  const upstream = await fetch(new URL(path, OPENCODE_URL), {
    ...init,
    headers: openCodeHeaders({
      accept: "application/json",
      ...(init.headers || {})
    }),
    signal: init.signal || AbortSignal.timeout(4000)
  });

  const text = await upstream.text();
  const contentType = upstream.headers.get("content-type") || "";

  let payload = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      const preview = text.slice(0, 160).replace(/\s+/g, " ");
      const error = new Error(
        `OpenCode returned non-JSON for ${path} (HTTP ${upstream.status}, ${contentType || "unknown content-type"}): ${preview}`
      );
      error.status = upstream.status;
      error.contentType = contentType;
      throw error;
    }
  }

  if (!upstream.ok) {
    const error = new Error(
      payload?.error?.data?.message ||
      payload?.error?.message ||
      payload?.message ||
      `OpenCode HTTP ${upstream.status} for ${path}`
    );
    error.status = upstream.status;
    throw error;
  }

  return payload;
}

async function opencodeHealth() {
  try {
    const payload = await fetchOpenCodeJson("/api/location", {
      signal: AbortSignal.timeout(2500)
    });

    const location = payload?.location ?? payload;
    const directory = location?.directory ?? null;

    if (!directory) {
      throw new Error("OpenCode /api/location returned no directory");
    }

    return {
      online: true,
      status: 200,
      directory,
      project: location?.project ?? null
    };
  } catch (error) {
    return {
      online: false,
      status: error?.status ?? null,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

async function opencodeProviders(res) {
  const unwrapList = payload => {
    if (Array.isArray(payload)) return payload;
    if (Array.isArray(payload?.data)) return payload.data;
    return [];
  };

  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

  try {
    let providers = [];
    let models = [];
    let modelSource = null;

    for (let attempt = 1; attempt <= 8; attempt++) {
      const providerPayload = await fetchOpenCodeJson("/api/provider");
      providers = unwrapList(providerPayload);

      models = [];
      modelSource = null;

      for (const candidate of ["/api/model", "/api/catalog/model"]) {
        try {
          const modelPayload = await fetchOpenCodeJson(candidate);
          const list = unwrapList(modelPayload);
          if (list.length > 0) {
            models = list;
            modelSource = candidate;
            break;
          }
        } catch {
          // Try the next v2 model endpoint.
        }
      }

      if (providers.length > 0 && models.length > 0) break;
      if (attempt < 8) await sleep(250);
    }

    const grouped = new Map();
    for (const model of models) {
      const providerID =
        model?.providerID ??
        model?.provider?.id ??
        model?.provider?.providerID;
      const modelID = model?.id ?? model?.modelID;
      if (!providerID || !modelID) continue;

      if (!grouped.has(String(providerID))) grouped.set(String(providerID), {});
      grouped.get(String(providerID))[String(modelID)] = {
        id: String(modelID),
        modelID: String(model?.modelID ?? modelID),
        providerID: String(providerID),
        name: model?.name ?? String(modelID),
        family: model?.family ?? null,
        status: model?.status ?? null,
        enabled: model?.enabled !== false,
        capabilities: model?.capabilities ?? null,
        variants: Array.isArray(model?.variants)
          ? model.variants.map(variant => ({
              id: String(variant?.id ?? ""),
            })).filter(variant => variant.id)
          : [],
        limit: model?.limit ?? null
      };
    }

    const normalized = providers.map(provider => ({
      id: String(provider.id),
      name: provider.name ?? String(provider.id),
      activation: provider.activation ?? null,
      integrationID: provider.integrationID ?? null,
      models: grouped.get(String(provider.id)) ?? {}
    }));

    const connected = normalized
      .filter(provider => provider.disabled !== true && provider.enabled !== false)
      .map(provider => provider.id);

    json(res, 200, {
      apiVersion: "v2",
      source: "/api/provider",
      modelSource,
      directory: OPENCODE_DIRECTORY,
      all: normalized,
      default: {},
      connected
    });
    return;
  } catch (v2Error) {
    try {
      const payload = await fetchOpenCodeJson("/provider");
      json(res, 200, {
        apiVersion: "v1",
        source: "/provider",
        all: Array.isArray(payload?.all) ? payload.all : [],
        default: payload?.default ?? {},
        connected: Array.isArray(payload?.connected) ? payload.connected : []
      });
      return;
    } catch (v1Error) {
      json(res, 502, {
        error: "OpenCode provider discovery failed",
        v2: v2Error instanceof Error ? v2Error.message : String(v2Error),
        v1: v1Error instanceof Error ? v1Error.message : String(v1Error),
        directory: OPENCODE_DIRECTORY
      });
    }
  }
}

function materializeOpenCodeUploadBody(body, contentType) {
  if (!body || !String(contentType || "").includes("application/json")) return body;
  let payload;
  try { payload = JSON.parse(Buffer.from(body).toString("utf8")); } catch { return body; }
  if (typeof payload?.text !== "string" || !payload.text.includes("devmoter-upload:")) return body;
  payload.text = payload.text.replace(/devmoter-upload:([0-9a-f-]{36})/gi, (_match, id) => {
    const upload = uploadRegistry.get(id);
    return upload.path;
  });
  return Buffer.from(JSON.stringify(payload));
}
async function proxy(req, res) {
  const pocketPath = req.url.replace(/^\/api\/opencode/, "") || "/";
  const upstreamPath = pocketPath.startsWith("/api/")
    ? pocketPath
    : `/api${pocketPath}`;
  const url = new URL(upstreamPath, OPENCODE_URL);

  let body =
    req.method === "GET" || req.method === "HEAD"
      ? undefined
      : await new Promise((resolve, reject) => {
          const chunks = [];
          req.on("data", chunk => chunks.push(chunk));
          req.on("end", () => resolve(Buffer.concat(chunks)));
          req.on("error", reject);
        });

  body = materializeOpenCodeUploadBody(body, req.headers["content-type"] || "");

  const upstream = await fetch(url, {
    method: req.method,
    headers: await openCodeHeadersForRequest(req, {
      "content-type": req.headers["content-type"] || "application/json",
      "accept": req.headers["accept"] || "*/*"
    }),
    body
  });

  const headers = {};
  for (const [key, value] of upstream.headers.entries()) {
    if (![ "content-encoding", "content-length", "transfer-encoding", "connection" ].includes(key)) {
      headers[key] = value;
    }
  }

  res.writeHead(upstream.status, headers);

  if (!upstream.body) {
    res.end();
    return;
  }

  const reader = upstream.body.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    res.write(Buffer.from(value));
  }
  res.end();
}

async function codexRpc(req, res) {
  try {
    const payload = await readJson(req, 2 * 1024 * 1024);
    const method = payload?.method;
    const params = payload?.params ?? {};

    if (!isAllowedCodexRpc(method)) {
      json(res, 400, { error: "Codex RPC method is not allowed" });
      return;
    }

    const inventoryMethod = new Set([
      "plugin/installed",
      "plugin/list",
      "mcpServerStatus/list",
      "skills/list"
    ]).has(method);

    const safeParams = await materializeCodexUploadInputs(method, params);
    const result = await codex.request(
      method,
      safeParams,
      inventoryMethod ? { timeoutMs: 8000 } : {}
    );
    json(res, 200, { result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = error?.status || (message === "Request body too large" ? 413 : 502);
    json(res, status, {
      error: message,
      data: error?.data ?? null
    });
  }
}

async function codexUpload(req, res) {
  try {
    const payload = await readJson(req, 24 * 1024 * 1024);
    const name = String(payload?.name || "attachment");
    const mime = String(payload?.type || "application/octet-stream");
    const data = String(payload?.data || "");

    const { buffer } = decodeUploadDataUrl(data);

    await mkdir(UPLOAD_DIR, { recursive: true, mode: 0o700 });
    const { path } = createUploadPath(UPLOAD_DIR, name);
    await writeFile(path, buffer, { mode: 0o600 });

    const uploadId = uploadRegistry.add({ path, name, type: mime, size: buffer.length });
    json(res, 200, {
      ok: true,
      uploadId,
      name,
      type: mime,
      size: buffer.length
    });
  } catch (error) {
    json(res, 400, {
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

async function codexApproval(req, res) {
  try {
    const payload = await readJson(req);
    codex.respondApproval(payload?.id, payload?.decision);
    json(res, 200, { ok: true });
  } catch (error) {
    json(res, 400, {
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

async function codexEvents(req, res) {
  const health = await codex.health();
  if (!health.online) {
    json(res, 503, health);
    return;
  }

  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    "connection": "keep-alive",
    "x-accel-buffering": "no"
  });

  const send = (event, data) => {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  const onNotification = event => send("notification", event);
  const onServerRequest = event => send("server-request", event);
  const onOffline = event => send("offline", event);
  const onOnline = event => send("online", event);

  codex.on("notification", onNotification);
  codex.on("server-request", onServerRequest);
  codex.on("offline", onOffline);
  codex.on("online", onOnline);

  send("ready", { online: true });

  const heartbeat = setInterval(() => {
    res.write(": heartbeat\n\n");
  }, 20000);

  req.on("close", () => {
    clearInterval(heartbeat);
    codex.off("notification", onNotification);
    codex.off("server-request", onServerRequest);
    codex.off("offline", onOffline);
    codex.off("online", onOnline);
  });
}


async function serveStatic(req, res) {
  let path = req.url === "/" ? "/index.html" : req.url.split("?")[0];
  path = normalize(path).replace(/^(\.\.[/\\])+/, "");
  const full = join(DIST, path);

  try {
    const info = await stat(full);
    if (!info.isFile()) throw new Error("not file");
    const data = await readFile(full);
    res.writeHead(200, { "content-type": MIME[extname(full)] || "application/octet-stream" });
    res.end(data);
  } catch {
    try {
      const data = await readFile(join(DIST, "index.html"));
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(data);
    } catch {
      json(res, 404, { error: "Not built yet. Run npm run build." });
    }
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

    if (req.method === "GET" && url.pathname === "/api/projects") {
      await projectsList(res);
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/automation/projects") {
      await automationProjects(res);
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/automation/open") {
      await automationOpen(req, url, res);
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/automation/sessions") {
      await automationSessions(url, res);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/automation/tasks") {
      if (!claimOperation(req, res, `${req.method}:${url.pathname}`)) return;
      await automationTask(req, res);
      return;
    }

    const contextMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/context(?:\/(resolve))?$/);
    if (contextMatch) {
      const projectId = decodeURIComponent(contextMatch[1]);
      if (req.method === "GET" && !contextMatch[2]) {
        await projectContextList(projectId, url, res);
        return;
      }
      if (req.method === "POST" && contextMatch[2] === "resolve") {
        if (!claimOperation(req, res, `${req.method}:${url.pathname}`)) return;
        await projectContextResolve(projectId, req, res);
        return;
      }
    }

    if (req.method === "GET" && url.pathname === "/api/github/status") {
      json(res, 200, await githubStatus(HOME_DIR));
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/github/repos") {
      json(res, 200, await listGithubRepos(
        HOME_DIR,
        url.searchParams.get("q"),
        url.searchParams.get("page"),
        url.searchParams.get("visibility")
      ));
      return;
    }

    const githubBranchMatch = url.pathname.match(/^\/api\/github\/repos\/([^/]+)\/([^/]+)\/branches$/);
    if (req.method === "GET" && githubBranchMatch) {
      json(res, 200, await listGithubBranches(HOME_DIR, decodeURIComponent(githubBranchMatch[1]), decodeURIComponent(githubBranchMatch[2])));
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/github/open") {
      if (!claimOperation(req, res, `${req.method}:${url.pathname}`)) return;
      await githubOpen(req, res);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/github/fetch") {
      if (!claimOperation(req, res, `${req.method}:${url.pathname}`)) return;
      await githubFetch(req, res);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/projects") {
      if (!claimOperation(req, res, `${req.method}:${url.pathname}`)) return;
      await projectsCreateOrAdd(req, res);
      return;
    }

    const projectMatch = url.pathname.match(/^\/api\/projects\/([^/]+)(?:\/(docs|file))?$/);
    if (projectMatch) {
      const projectId = decodeURIComponent(projectMatch[1]);
      const action = projectMatch[2] || "";

      if (req.method === "DELETE" && !action) {
        if (!claimOperation(req, res, `${req.method}:${url.pathname}`)) return;
        await projectRemove(projectId, res);
        return;
      }

      if (req.method === "GET" && action === "docs") {
        await projectDocs(projectId, res);
        return;
      }

      if (req.method === "GET" && action === "file") {
        await projectReadFile(projectId, url.searchParams.get("path"), res);
        return;
      }

      if (req.method === "PUT" && action === "file") {
        if (!claimOperation(req, res, `${req.method}:${url.pathname}`)) return;
        await projectWriteFile(projectId, req, res);
        return;
      }
    }

    if (req.method === "GET" && url.pathname === "/api/health") {
      const [openCode, codexHealth] = await Promise.all([
        opencodeHealth(),
        codex.health()
      ]);
      json(res, 200, {
        version: DEVMOTER_VERSION,
        apiVersion: AUTOMATION_API_VERSION,
        online: openCode.online || codexHealth.online,
        backends: {
          opencode: openCode,
          codex: codexHealth
        }
      });
      return;
    }


    if (req.method === "GET" && url.pathname === "/api/opencode/pocket/providers") {
      await opencodeProviders(res);
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/codex/health") {
      const health = await codex.health();
      json(res, health.online ? 200 : 503, health);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/codex/rpc") {
      if (!claimOperation(req, res, `${req.method}:${url.pathname}`)) return;
      await codexRpc(req, res);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/codex/approval") {
      if (!claimOperation(req, res, `${req.method}:${url.pathname}`)) return;
      await codexApproval(req, res);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/codex/upload") {
      if (!claimOperation(req, res, `${req.method}:${url.pathname}`)) return;
      await codexUpload(req, res);
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/codex/events") {
      await codexEvents(req, res);
      return;
    }

    if (url.pathname.startsWith("/api/opencode")) {
      if (
        req.method !== "GET" &&
        req.method !== "HEAD" &&
        !claimOperation(req, res, `${req.method}:${url.pathname}`)
      ) return;
      await proxy(req, res);
      return;
    }

    await serveStatic(req, res);
  } catch (error) {
    console.error(error);
    json(res, error?.status || 500, {
      error: error instanceof Error ? error.message : "DevMoter server error",
      code: error?.code || "server_error"
    });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`DevMoter FAST: http://${HOST}:${PORT}`);
  console.log(`OpenCode upstream: ${OPENCODE_URL}`);
  console.log(`OpenCode directory: ${OPENCODE_DIRECTORY}`);
  console.log(`Codex binary: ${process.env.CODEX_BIN || "codex"}`);
  console.log(`Codex cwd: ${process.env.CODEX_CWD || process.cwd()}`);
});
