import http from "node:http";
import { mkdir, readFile, readdir, realpath, stat, writeFile } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join, normalize, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { CodexBridge } from "./server/codex-bridge.mjs";
import { fetchGithubRepo, githubStatus, listGithubBranches, listGithubRepos, openGithubRepo } from "./server/github.mjs";
import { assertSafeMarkdownRelativePath, createUploadPath, decodeUploadDataUrl, isInsideHome, isAllowedCodexRpc, normalizeNewProjectPath } from "./server/security-helpers.mjs";
import { createOperationRegistry } from "./server/operation-registry.mjs";
import { ControlPlane } from "./server/control-plane.mjs";
import { PasskeyAuth } from "./server/passkey-auth.mjs";

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
const PASSKEY_REQUIRED = process.env.DEVMOTER_PASSKEY_REQUIRED === "1";
const PROJECTS_FILE = join(PROJECT_CONFIG_DIR, "projects.json");
const PROJECT_FILE_LIMIT = 1024 * 1024;
const PROJECT_SCAN_LIMIT = 200;
const OPERATION_TTL_MS = 10 * 60 * 1000;
const OPERATION_MAX_ENTRIES = 1000;
const operationRegistry = createOperationRegistry({
  ttlMs: OPERATION_TTL_MS,
  maxEntries: OPERATION_MAX_ENTRIES
});
const codex = new CodexBridge({
  bin: process.env.CODEX_BIN || "codex",
  cwd: process.env.CODEX_CWD || process.cwd()
});

const passkeys = new PasskeyAuth({ configDir: PROJECT_CONFIG_DIR });
const controlPlane = new ControlPlane({
  configDir: PROJECT_CONFIG_DIR,
  executeTask: executeControlTask,
  onLifecycle: ({ event, run }) => {
    void controlPlane.dispatchEvent("devmoter.lifecycle", event, {
      runId: run?.id ?? null,
      kind: run?.kind ?? null,
      status: run?.status ?? null,
      endedAt: run?.endedAt ?? null
    });
  }
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

async function readRaw(req, limit = 1024 * 1024) {
  const chunks = [];
  let size = 0;

  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error("Request body too large");
    chunks.push(chunk);
  }

  return Buffer.concat(chunks);
}

async function readJson(req, limit = 1024 * 1024) {
  const raw = await readRaw(req, limit);
  if (raw.length === 0) return {};
  return JSON.parse(raw.toString("utf8"));
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
        hostId: "local",
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
        sanitized.push({ ...project, hostId: project.hostId || "local", path: actual, available: true });
      } catch {
        sanitized.push({ ...project, hostId: project.hostId || "local", available: false });
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
      hostId: "local",
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

function taskTimeoutMs(context = {}) {
  const defaultMs = 30 * 60 * 1000;
  if (!context.deadline) return defaultMs;
  return Math.max(1_000, Math.min(defaultMs, Number(context.deadline) - Date.now()));
}

function taskModel(model) {
  const value = String(model || "").trim();
  if (!value.includes("/")) return null;
  const [providerID, ...rest] = value.split("/");
  const modelID = rest.join("/");
  if (!providerID || !modelID) return null;
  return { providerID, modelID };
}

function waitForCodexTurn(threadId, turnId, context = {}) {
  const timeoutMs = taskTimeoutMs(context);
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      codex.off("notification", onNotification);
      codex.off("offline", onOffline);
      if (error) reject(error);
      else resolve(result);
    };
    const onOffline = event => finish(new Error(event?.error || "Codex went offline"));
    const onNotification = event => {
      const method = event?.method;
      if (method !== "turn/completed") return;
      const params = event?.params ?? {};
      const eventThreadId = params?.threadId ?? params?.thread?.id;
      const eventTurnId = params?.turn?.id ?? params?.turnId;
      if (eventThreadId && String(eventThreadId) !== String(threadId)) return;
      if (eventTurnId && String(eventTurnId) !== String(turnId)) return;
      const status = String(params?.turn?.status || "completed");
      if (status === "failed") {
        finish(new Error(params?.turn?.error?.message || params?.error?.message || "Codex turn failed"));
        return;
      }
      finish(null, {
        complete: true,
        summary: "Codex turn " + turnId + " finished with status " + status + ".",
        cost: Number(params?.turn?.cost || 0)
      });
    };
    const timer = setTimeout(() => finish(new Error("Agent task timed out at its configured boundary")), timeoutMs);
    timer.unref?.();
    codex.on("notification", onNotification);
    codex.on("offline", onOffline);
  });
}

async function executeControlTask(definition, context = {}) {
  const project = definition?.projectId ? await getProjectById(definition.projectId) : null;
  const task = String(definition?.task || "").trim();
  if (!task) throw new Error("Task is required");

  if (definition?.backend === "opencode") {
    const directory = project?.path || OPENCODE_DIRECTORY;
    const headers = { "content-type": "application/json", "x-opencode-directory": directory };
    const body = {};
    if (definition?.agent) body.agent = String(definition.agent);
    const model = taskModel(definition?.model);
    if (model) body.model = { id: model.modelID, providerID: model.providerID };

    const session = await fetchOpenCodeJson("/api/session", {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(Math.min(10_000, taskTimeoutMs(context)))
    });
    const sessionId = session?.id;
    if (!sessionId) throw new Error("OpenCode did not return a session id");

    const cancel = async () => {
      try {
        await fetchOpenCodeJson("/api/session/" + encodeURIComponent(sessionId) + "/interrupt", {
          method: "POST",
          headers,
          body: "{}",
          signal: AbortSignal.timeout(5_000)
        });
      } catch {
      }
    };
    context.setCancel?.(cancel);

    await fetchOpenCodeJson("/api/session/" + encodeURIComponent(sessionId) + "/prompt", {
      method: "POST",
      headers,
      body: JSON.stringify({ text: task }),
      signal: AbortSignal.timeout(taskTimeoutMs(context))
    });

    return {
      complete: true,
      summary: "OpenCode session " + sessionId + " completed the requested turn.",
      cost: 0,
      cancel
    };
  }

  const threadParams = {};
  if (project?.path) threadParams.cwd = project.path;
  if (definition?.model) threadParams.model = String(definition.model);
  const threadResult = await codex.request("thread/start", threadParams, { timeoutMs: 10_000 });
  const threadId = threadResult?.thread?.id;
  if (!threadId) throw new Error("Codex did not return a thread id");

  const operationId = randomUUID();
  const turnParams = {
    threadId,
    input: [{ type: "text", text: task }],
    clientUserMessageId: operationId
  };
  if (definition?.model) turnParams.model = String(definition.model);
  const turnResult = await codex.request("turn/start", turnParams, { timeoutMs: 10_000 });
  const turnId = turnResult?.turn?.id;
  if (!turnId) throw new Error("Codex did not return a turn id");

  const cancel = async () => {
    try {
      await codex.request("turn/interrupt", { threadId, turnId }, { timeoutMs: 5_000 });
    } catch {
    }
  };
  context.setCancel?.(cancel);
  const result = await waitForCodexTurn(threadId, turnId, context);
  return { ...result, cancel };
}

async function passkeyRoute(req, res, url) {
  if (!url.pathname.startsWith("/api/auth/passkey/")) return false;
  try {
    if (req.method === "GET" && url.pathname === "/api/auth/passkey/status") {
      json(res, 200, await passkeys.status(req)); return true;
    }
    if (req.method === "POST" && url.pathname === "/api/auth/passkey/register/options") {
      json(res, 200, await passkeys.registrationOptions(req)); return true;
    }
    if (req.method === "POST" && url.pathname === "/api/auth/passkey/register/verify") {
      const result = await passkeys.verifyRegistration(req, await readJson(req, 256 * 1024));
      res.setHeader("set-cookie", result.cookie); json(res, 200, { ok: true }); return true;
    }
    if (req.method === "POST" && url.pathname === "/api/auth/passkey/login/options") {
      json(res, 200, await passkeys.loginOptions(req)); return true;
    }
    if (req.method === "POST" && url.pathname === "/api/auth/passkey/login/verify") {
      const result = await passkeys.verifyLogin(req, await readJson(req, 256 * 1024));
      res.setHeader("set-cookie", result.cookie); json(res, 200, { ok: true }); return true;
    }
    if (req.method === "POST" && url.pathname === "/api/auth/passkey/logout") {
      res.setHeader("set-cookie", await passkeys.logout(req)); json(res, 200, { ok: true }); return true;
    }
    json(res, 404, { error: "Unknown passkey endpoint" });
  } catch (error) {
    json(res, 400, { error: error instanceof Error ? error.message : String(error) });
  }
  return true;
}

async function controlRoute(req, res, url) {
  if (!url.pathname.startsWith("/api/control/")) return false;
  try {
    const localAddress = url.protocol + "//" + (req.headers.host || "localhost");
    if (req.method === "GET" && url.pathname === "/api/control/hosts") {
      json(res, 200, { hosts: await controlPlane.listHosts(localAddress) }); return true;
    }
    if (req.method === "GET" && url.pathname === "/api/control/hosts/status") {
      json(res, 200, { hosts: await controlPlane.listHostStatuses(localAddress, { force: url.searchParams.get("force") === "1" }) }); return true;
    }
    if (req.method === "POST" && url.pathname === "/api/control/hosts") {
      if (!claimOperation(req, res, req.method + ":" + url.pathname)) return true;
      json(res, 201, { host: await controlPlane.addHost(await readJson(req)) }); return true;
    }
    const hostMatch = url.pathname.match(/^\/api\/control\/hosts\/([^/]+)$/);
    if (req.method === "DELETE" && hostMatch) {
      if (!claimOperation(req, res, req.method + ":" + url.pathname)) return true;
      await controlPlane.removeHost(decodeURIComponent(hostMatch[1])); json(res, 200, { ok: true }); return true;
    }

    if (req.method === "GET" && url.pathname === "/api/control/schedules") {
      json(res, 200, { schedules: await controlPlane.listSchedules() }); return true;
    }
    if (req.method === "POST" && url.pathname === "/api/control/schedules") {
      if (!claimOperation(req, res, req.method + ":" + url.pathname)) return true;
      json(res, 201, { schedule: await controlPlane.createSchedule(await readJson(req)) }); return true;
    }
    const scheduleMatch = url.pathname.match(/^\/api\/control\/schedules\/([^/]+)$/);
    if (scheduleMatch && req.method === "PATCH") {
      if (!claimOperation(req, res, req.method + ":" + url.pathname)) return true;
      const payload = await readJson(req);
      json(res, 200, { schedule: await controlPlane.setScheduleEnabled(decodeURIComponent(scheduleMatch[1]), payload?.enabled) }); return true;
    }
    if (scheduleMatch && req.method === "DELETE") {
      if (!claimOperation(req, res, req.method + ":" + url.pathname)) return true;
      await controlPlane.deleteSchedule(decodeURIComponent(scheduleMatch[1])); json(res, 200, { ok: true }); return true;
    }

    if (req.method === "GET" && url.pathname === "/api/control/triggers") {
      json(res, 200, { triggers: await controlPlane.listTriggers() }); return true;
    }
    if (req.method === "POST" && url.pathname === "/api/control/triggers") {
      if (!claimOperation(req, res, req.method + ":" + url.pathname)) return true;
      json(res, 201, await controlPlane.createTrigger(await readJson(req))); return true;
    }
    const triggerMatch = url.pathname.match(/^\/api\/control\/triggers\/([^/]+)$/);
    if (triggerMatch && req.method === "DELETE") {
      if (!claimOperation(req, res, req.method + ":" + url.pathname)) return true;
      await controlPlane.deleteTrigger(decodeURIComponent(triggerMatch[1])); json(res, 200, { ok: true }); return true;
    }

    if (req.method === "GET" && url.pathname === "/api/control/runs") {
      json(res, 200, { runs: await controlPlane.listRuns() }); return true;
    }
    if (req.method === "POST" && url.pathname === "/api/control/autopilot") {
      if (!claimOperation(req, res, req.method + ":" + url.pathname)) return true;
      json(res, 202, { run: await controlPlane.startAutopilot(await readJson(req)) }); return true;
    }
    const autopilotMatch = url.pathname.match(/^\/api\/control\/autopilot\/([^/]+)\/(pause|cancel)$/);
    if (autopilotMatch && req.method === "POST") {
      if (!claimOperation(req, res, req.method + ":" + url.pathname)) return true;
      const id = decodeURIComponent(autopilotMatch[1]);
      const run = autopilotMatch[2] === "pause" ? await controlPlane.pauseAutopilot(id) : await controlPlane.cancelAutopilot(id);
      json(res, 200, { run }); return true;
    }

    if (req.method === "POST" && url.pathname === "/api/control/events/github") {
      const raw = await readRaw(req, 64 * 1024);
      const payload = raw.length ? JSON.parse(raw.toString("utf8")) : {};
      const event = String(req.headers["x-github-event"] || "");
      if (!event) throw new Error("Missing x-github-event header");
      const signature = String(req.headers["x-hub-signature-256"] || "");
      const runIds = await controlPlane.dispatchEvent("github.webhook", event, payload, { rawBody: raw, signature });
      json(res, 202, { accepted: runIds.length, runIds }); return true;
    }

    json(res, 404, { error: "Unknown control endpoint" });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    json(res, message === "Request body too large" ? 413 : 400, { error: message });
  }
  return true;
}

async function proxy(req, res) {
  const pocketPath = req.url.replace(/^\/api\/opencode/, "") || "/";
  const upstreamPath = pocketPath.startsWith("/api/")
    ? pocketPath
    : `/api${pocketPath}`;
  const url = new URL(upstreamPath, OPENCODE_URL);

  const body =
    req.method === "GET" || req.method === "HEAD"
      ? undefined
      : await new Promise((resolve, reject) => {
          const chunks = [];
          req.on("data", chunk => chunks.push(chunk));
          req.on("end", () => resolve(Buffer.concat(chunks)));
          req.on("error", reject);
        });

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

    const result = await codex.request(
      method,
      params,
      inventoryMethod ? { timeoutMs: 8000 } : {}
    );
    json(res, 200, { result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = message === "Request body too large" ? 413 : 502;
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

    json(res, 200, {
      ok: true,
      name,
      type: mime,
      size: buffer.length,
      path
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
    json(res, 500, { error: "DevMoter server error" });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`DevMoter FAST: http://${HOST}:${PORT}`);
  console.log(`OpenCode upstream: ${OPENCODE_URL}`);
  console.log(`OpenCode directory: ${OPENCODE_DIRECTORY}`);
  console.log(`Codex binary: ${process.env.CODEX_BIN || "codex"}`);
  console.log(`Codex cwd: ${process.env.CODEX_CWD || process.cwd()}`);
});
