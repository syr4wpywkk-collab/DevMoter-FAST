import http from "node:http";
import { mkdir, readFile, readdir, realpath, stat, writeFile } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join, normalize, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { CodexBridge } from "./server/codex-bridge.mjs";
import { fetchGithubRepo, githubStatus, listGithubBranches, listGithubRepos, openGithubRepo } from "./server/github.mjs";
import { assertSafeMarkdownRelativePath, createUploadPath, decodeUploadDataUrl, isInsideHome, isAllowedCodexRpc, normalizeNewProjectPath } from "./server/security-helpers.mjs";
import { createOperationRegistry } from "./server/operation-registry.mjs";
import { getFileDiff, getGitStatus, listChangedFiles } from "./server/git-workspace.mjs";
import { createSessionControl } from "./server/session-control.mjs";
import { createTaskWorkflow } from "./server/task-workflow.mjs";
import { createDevWorkflowService } from "./server/dev-workflows.mjs";
import { createAdvancedApi } from "./server/advanced-api.mjs";
import { createTerminalManager } from "./server/terminal.mjs";
import { createProjectIndex } from "./server/project-index.mjs";
import { createSafetyService } from "./server/safety.mjs";
import { createSystemFeatures } from "./server/system-features.mjs";
import { createAutomationApi, AUTOMATION_API_VERSION } from "./server/automation-api.mjs";
import { createUploadRegistry } from "./server/upload-registry.mjs";
import { ControlPlane } from "./server/control-plane.mjs";
import { createWorkspaceControl, handleWorkspaceControlRequest } from "./server/workspace-control.mjs";
import { PasskeyAuth } from "./server/passkey-auth.mjs";
import { applyModeToPrompt, isDirectMutationRoute, isPromptRoute, isReadOnlyMode, parseAgentMode, sessionIdFromOpenCodePath } from "./server/agent-mode-policy.mjs";
import { assertAuthPassword, authorizeBasicRequest, requireSameOriginMutation } from "./server/auth.mjs";
import { redactSecretsInText } from "./server/secret-redaction.mjs";
import { antigravityRemoteAction, launchIntegration, listIntegrations, publicIntegrationError } from "./server/integrations.mjs";

const OPENCODE_URL = process.env.OPENCODE_URL || "http://127.0.0.1:49374";
const OPENCODE_USERNAME = process.env.OPENCODE_SERVER_USERNAME || "opencode";
const OPENCODE_PASSWORD = process.env.OPENCODE_SERVER_PASSWORD || "";
const DEVMOTER_AUTH_USERNAME = process.env.DEVMOTER_AUTH_USERNAME || "devmoter";
const DEVMOTER_AUTH_PASSWORD = assertAuthPassword(process.env.DEVMOTER_AUTH_PASSWORD || "");
const DEVMOTER_PUBLIC_ORIGIN = process.env.DEVMOTER_PUBLIC_ORIGIN || "";
const PASSKEY_REQUIRED = process.env.DEVMOTER_PASSKEY_REQUIRED === "1";
const AUTH_CONFIG = {
  username: DEVMOTER_AUTH_USERNAME,
  password: DEVMOTER_AUTH_PASSWORD
};
const REDACTED_SECRETS = [OPENCODE_PASSWORD, DEVMOTER_AUTH_PASSWORD].filter(Boolean);
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
const openCodeSessionModes = new Map();
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
    }).catch(error => {
      console.error("Control-plane lifecycle dispatch failed", redactText(error instanceof Error ? error.message : String(error)));
    });
  }
});
const workspaceControl = createWorkspaceControl({
  stateDir: PROJECT_CONFIG_DIR,
  resolveProject: getProjectById
});
const advancedApi = createAdvancedApi({
  homeDir: HOME_DIR,
  configDir: PROJECT_CONFIG_DIR,
  getProjectById
});
const taskWorkflow = createTaskWorkflow({ homeDir: HOME_DIR, getProjectById });
const devWorkflows = createDevWorkflowService({
  homeDir: HOME_DIR,
  codex,
  projectResolver: getProjectById,
  configDir: PROJECT_CONFIG_DIR
});
const SAFETY_PERMISSION_FILE = join(PROJECT_CONFIG_DIR, "remembered-approvals.json");
const PROJECT_INDEX_DIR = join(HOME_DIR, ".local", "state", "opencode-pocket", "project-indexes");
const safety = createSafetyService({
  permissionFile: SAFETY_PERMISSION_FILE,
  loopThreshold: Number(process.env.DEVMOTER_LOOP_THRESHOLD || 3),
  loopWindow: Number(process.env.DEVMOTER_LOOP_WINDOW || 20),
  summarizerModel: process.env.DEVMOTER_CONTEXT_SUMMARIZER_MODEL || null
});
const projectIndex = createProjectIndex({
  stateDir: PROJECT_INDEX_DIR,
  resolveProject: getProjectById
});
const terminal = createTerminalManager({
  resolveProject: getProjectById,
  authPassword: DEVMOTER_AUTH_PASSWORD,
  shell: process.env.SHELL
});
const systemFeatures = createSystemFeatures({
  stateDir: PROJECT_CONFIG_DIR,
  appRoot: process.cwd(),
  getProjects: readProjectRegistry,
  getBackendHealth: async () => {
    const [openCode, codexHealth] = await Promise.all([opencodeHealth(), codex.health()]);
    return { opencode: openCode, codex: codexHealth };
  },
  host: HOST,
  version: process.env.DEVMOTER_VERSION || "0.2.0"
});
const automationApi = createAutomationApi({
  readProjectRegistry,
  getProjectById,
  normalizeExistingProjectPath,
  fetchOpenCodeJson,
  codex,
  json,
  readJson,
  operationId,
  claimOperation,
  publicOrigin: DEVMOTER_PUBLIC_ORIGIN
});

function codexThreadIdFromEvent(params = {}) {
  return String(
    params?.threadId ||
    params?.turn?.threadId ||
    params?.thread?.id ||
    params?.item?.threadId ||
    ""
  ).slice(0, 200);
}

function notifyAgentState(payload) {
  void systemFeatures.notifyAgentState(payload).catch(error => {
    console.error("Push notification dispatch failed", error);
  });
}

codex.on("notification", event => {
  const sessionId = codexThreadIdFromEvent(event.params);
  if (sessionId) {
    const method = String(event?.method || "");
    const type =
      method === "turn/completed" ? "completion" :
      /fail|error/i.test(method) ? "failure" :
      /agentMessage/i.test(method) ? "assistant" :
      "event";
    void workspaceControl.events.append(sessionId, {
      type,
      backend: "codex",
      payload: { method, params: event?.params ?? null }
    }).catch(error => {
      console.error("Workspace event append failed", redactText(error instanceof Error ? error.message : String(error)));
    });
  }

  if (event?.method === "turn/completed") {
    notifyAgentState({
      backend: "codex",
      sessionId,
      state: "completed"
    });
  }
});

codex.on("server-request", request => {
  const method = String(request?.method || "");
  const sessionId = codexThreadIdFromEvent(request?.params || {});
  if (!sessionId) return;

  const type =
    method === "item/commandExecution/requestApproval" || method === "item/fileChange/requestApproval"
      ? "approval"
      : /question|user.?input|request.?input/i.test(method)
        ? "question"
        : "event";
  void workspaceControl.events.append(sessionId, {
    type,
    backend: "codex",
    payload: { method, params: request?.params ?? null }
  }).catch(error => {
    console.error("Workspace request event append failed", redactText(error instanceof Error ? error.message : String(error)));
  });

  if (method === "item/commandExecution/requestApproval" || method === "item/fileChange/requestApproval") {
    notifyAgentState({ backend: "codex", sessionId, state: "waiting_for_approval" });
  } else if (/question|user.?input|request.?input/i.test(method)) {
    notifyAgentState({ backend: "codex", sessionId, state: "waiting_for_input" });
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

function redactText(value) {
  return redactSecretsInText(value, REDACTED_SECRETS);
}

function json(res, status, body) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  res.end(JSON.stringify(body, (_key, value) =>
    typeof value === "string" ? redactText(value) : value
  ));
}

async function featureJson(res, task, successStatus = 200) {
  try {
    json(res, successStatus, await task());
  } catch (error) {
    json(res, Number(error?.status || 400), {
      error: error instanceof Error ? error.message : String(error)
    });
  }
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
      error: "Duplicate operation suppressed; previous outcome is unknown",
      duplicate: true,
      outcome: "unknown",
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


async function projectGitStatus(id, res) {
  try {
    const project = await getProjectById(id);
    json(res, 200, await getGitStatus(project.path));
  } catch (error) {
    json(res, 400, { error: error instanceof Error ? error.message : String(error) });
  }
}

async function projectGitFiles(id, url, res) {
  try {
    const project = await getProjectById(id);
    const limit = Number(url.searchParams.get("limit") || 100);
    const offset = Number(url.searchParams.get("offset") || 0);
    json(res, 200, await listChangedFiles(project.path, { limit, offset }));
  } catch (error) {
    json(res, 400, { error: error instanceof Error ? error.message : String(error) });
  }
}

async function projectGitDiff(id, url, res) {
  try {
    const project = await getProjectById(id);
    const path = url.searchParams.get("path");
    const scope = url.searchParams.get("scope") === "staged" ? "staged" : "all";
    if (!path) throw new Error("Git diff path is required");
    json(res, 200, await getFileDiff(project.path, path, { scope }));
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

function controlStatus(value) {
  const raw =
    typeof value === "string"
      ? value
      : String(value?.type || value?.status || value?.state || "");
  const text = raw.toLowerCase();
  if (/wait|approval|question|input/.test(text)) return "waiting";
  if (/run|work|progress|active|start/.test(text)) return "running";
  if (/fail|error/.test(text)) return "failed";
  if (/interrupt|cancel|abort|stop/.test(text)) return "interrupted";
  if (/complete|success|done|finish/.test(text)) return "done";
  if (/idle|ready/.test(text)) return "idle";
  return "unknown";
}

function controlTokens(value) {
  if (!value || typeof value !== "object") return 0;
  for (const key of ["totalTokens", "total_tokens", "total"]) {
    const number = Number(value[key]);
    if (Number.isFinite(number) && number >= 0) return number;
  }

  const direct = [
    "inputTokens", "input_tokens", "input",
    "outputTokens", "output_tokens", "output",
    "reasoningTokens", "reasoning_tokens", "reasoning"
  ]
    .map(key => Number(value[key]))
    .filter(Number.isFinite);

  if (direct.length) return direct.reduce((sum, number) => sum + number, 0);

  let best = 0;
  for (const child of Object.values(value)) {
    best = Math.max(best, controlTokens(child));
  }
  return best;
}

async function inspectControlSession(backend, sessionId) {
  if (backend === "codex") {
    const payload = await codex.request("thread/read", {
      threadId: sessionId,
      includeTurns: true
    });
    const turns = payload?.thread?.turns ?? [];
    const latest = turns.at(-1);
    let status = controlStatus(payload?.thread?.status);
    if (status === "unknown") status = controlStatus(latest?.status);

    const activeTurn = [...turns]
      .reverse()
      .find(turn => ["running", "waiting"].includes(controlStatus(turn?.status)));

    return {
      active: ["running", "waiting"].includes(status) || Boolean(activeTurn),
      status,
      turns: turns.length,
      tokens: controlTokens(payload?.thread?.usage ?? payload?.thread),
      activeTurnId: activeTurn?.id ?? null
    };
  }

  const [activeRaw, contextRaw, metadata] = await Promise.all([
    fetchOpenCodeJson("/api/session/active").catch(() => ({})),
    fetchOpenCodeJson("/api/session/" + encodeURIComponent(sessionId) + "/context").catch(() => []),
    fetchOpenCodeJson("/api/session/" + encodeURIComponent(sessionId)).catch(() => ({}))
  ]);
  const active =
    activeRaw?.data && typeof activeRaw.data === "object"
      ? activeRaw.data
      : activeRaw;
  const context = Array.isArray(contextRaw)
    ? contextRaw
    : Array.isArray(contextRaw?.data)
      ? contextRaw.data
      : [];
  const turns = context.filter(item =>
    item?.type === "user" || item?.info?.role === "user"
  ).length;

  return {
    active: Boolean(active?.[sessionId]),
    status: active?.[sessionId] ? "running" : "idle",
    turns,
    tokens: Math.max(controlTokens(metadata), controlTokens(context)),
    activeTurnId: null
  };
}

async function dispatchControlQueued(backend, sessionId, text) {
  if (backend === "codex") {
    await codex.request("turn/start", {
      threadId: sessionId,
      input: [{ type: "text", text }],
      clientUserMessageId: randomUUID()
    });
    return;
  }

  await fetchOpenCodeJson(
    "/api/session/" + encodeURIComponent(sessionId) + "/prompt",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text })
    }
  );
}

async function interruptControlSession(backend, sessionId, snapshot = {}) {
  if (backend === "codex") {
    let turnId = snapshot.activeTurnId;
    if (!turnId) {
      turnId = (await inspectControlSession(backend, sessionId)).activeTurnId;
    }
    if (!turnId) throw new Error("No active Codex turn");
    await codex.request("turn/interrupt", {
      threadId: sessionId,
      turnId
    });
    return;
  }

  await fetchOpenCodeJson(
    "/api/session/" + encodeURIComponent(sessionId) + "/interrupt",
    {
      method: "POST",
      headers: { "content-type": "application/json" }
    }
  );
}

const sessionControl = createSessionControl({
  homeDir: HOME_DIR,
  inspectSession: inspectControlSession,
  dispatchQueued: dispatchControlQueued,
  interruptSession: interruptControlSession
});

const sessionControlTimer = setInterval(() => {
  sessionControl
    .reconcile()
    .catch(error => console.error("Session control reconcile failed", error));
}, 2500);
sessionControlTimer.unref?.();

const openCodeNotificationStates = new Map();
let openCodeNotificationPollInFlight = false;
async function pollOpenCodeNotificationStates() {
  if (openCodeNotificationPollInFlight) return;
  openCodeNotificationPollInFlight = true;
  try {
    const [sessionsRaw, activeRaw] = await Promise.all([
      fetchOpenCodeJson("/api/session?limit=40&order=desc"),
      fetchOpenCodeJson("/api/session/active")
    ]);
    const sessions = Array.isArray(sessionsRaw)
      ? sessionsRaw
      : Array.isArray(sessionsRaw?.data) ? sessionsRaw.data : [];
    const active = activeRaw?.data && typeof activeRaw.data === "object"
      ? activeRaw.data
      : (activeRaw && typeof activeRaw === "object" ? activeRaw : {});
    const seen = new Set();

    for (const session of sessions.slice(0, 40)) {
      const sessionId = String(session?.id || "");
      if (!sessionId) continue;
      seen.add(sessionId);
      const prior = openCodeNotificationStates.get(sessionId);
      let state = active?.[sessionId] ? "running" : "idle";

      if (active?.[sessionId] || prior === "running" || prior === "waiting_for_approval" || prior === "waiting_for_input") {
        const [permissionRaw, questionRaw] = await Promise.all([
          fetchOpenCodeJson("/api/session/" + encodeURIComponent(sessionId) + "/permission").catch(() => []),
          fetchOpenCodeJson("/api/session/" + encodeURIComponent(sessionId) + "/question").catch(() => [])
        ]);
        const permissions = Array.isArray(permissionRaw) ? permissionRaw : (Array.isArray(permissionRaw?.data) ? permissionRaw.data : []);
        const questions = Array.isArray(questionRaw) ? questionRaw : (Array.isArray(questionRaw?.data) ? questionRaw.data : []);
        if (permissions.length) state = "waiting_for_approval";
        else if (questions.length) state = "waiting_for_input";
      }

      if (prior !== undefined) {
        if (state !== prior) {
          void workspaceControl.events.append(sessionId, {
            type:
              prior === "running" && state === "idle" ? "completion" :
              state === "waiting_for_approval" ? "approval" :
              state === "waiting_for_input" ? "question" :
              "state",
            backend: "opencode",
            payload: { previous: prior, state }
          }).catch(() => {});
        }
        if ((state === "waiting_for_approval" || state === "waiting_for_input") && state !== prior) {
          notifyAgentState({ backend: "opencode", sessionId, state });
        } else if (prior === "running" && state === "idle") {
          notifyAgentState({ backend: "opencode", sessionId, state: "completed" });
        }
      }
      openCodeNotificationStates.set(sessionId, state);
    }

    for (const key of openCodeNotificationStates.keys()) {
      if (!seen.has(key) && openCodeNotificationStates.size > 80) openCodeNotificationStates.delete(key);
    }
  } catch {
    // OpenCode can be offline during startup/reconnect. A later poll will rehydrate without notifying.
  } finally {
    openCodeNotificationPollInFlight = false;
  }
}
const openCodeNotificationTimer = setInterval(() => void pollOpenCodeNotificationStates(), 2500);
openCodeNotificationTimer.unref?.();
void pollOpenCodeNotificationStates();

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
  return Math.max(1000, Math.min(defaultMs, Number(context.deadline) - Date.now()));
}

function taskModel(model) {
  const value = String(model || "").trim();
  if (!value.includes("/")) return null;
  const [providerID, ...rest] = value.split("/");
  const modelID = rest.join("/");
  return providerID && modelID ? { providerID, modelID } : null;
}

function waitForCodexTurn(threadId, turnId, context = {}) {
  const timeoutMs = taskTimeoutMs(context);
  return new Promise((resolve, reject) => {
    let settled = false;
    let assistantText = "";

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
      const params = event?.params ?? {};
      const eventThreadId = params?.threadId ?? params?.thread?.id;
      const eventTurnId = params?.turn?.id ?? params?.turnId;
      if (eventThreadId && String(eventThreadId) !== String(threadId)) return;
      if (eventTurnId && String(eventTurnId) !== String(turnId)) return;

      if (method === "item/agentMessage/delta" && typeof params?.delta === "string") {
        assistantText += params.delta;
        if (assistantText.length > 12000) assistantText = assistantText.slice(-12000);
        return;
      }
      if (method !== "turn/completed") return;

      const status = String(params?.turn?.status || "completed").toLowerCase();
      if (status === "failed") {
        finish(new Error(params?.turn?.error?.message || params?.error?.message || "Codex turn failed"));
        return;
      }
      if (["cancelled", "canceled", "interrupted", "aborted"].includes(status)) {
        finish(new Error("Codex turn was interrupted"));
        return;
      }

      finish(null, {
        complete: assistantText.includes("[DEVMOTER_AUTOPILOT_DONE]"),
        summary: assistantText.trim().slice(-4000) || ("Codex turn " + turnId + " finished with status " + status + "."),
        cost: Number.isFinite(Number(params?.turn?.cost)) ? Number(params.turn.cost) : null
      });
    };

    const timer = setTimeout(
      () => finish(new Error("Agent task timed out at its configured boundary")),
      timeoutMs
    );
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
    const saved = context?.backendContext?.backend === "opencode"
      && String(context.backendContext.projectId || "") === String(definition?.projectId || "")
      ? String(context.backendContext.sessionId || "")
      : "";

    let sessionId = saved;
    if (!sessionId) {
      const body = {};
      if (definition?.agent) body.agent = String(definition.agent);
      const model = taskModel(definition?.model);
      if (model) body.model = { id: model.modelID, providerID: model.providerID };
      const session = await fetchOpenCodeJson("/api/session", {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(Math.min(10000, taskTimeoutMs(context)))
      });
      sessionId = String(session?.id || "");
      if (!sessionId) throw new Error("OpenCode did not return a session id");
    }

    const backendContext = {
      backend: "opencode",
      projectId: String(definition?.projectId || ""),
      sessionId
    };
    context.setBackendContext?.(backendContext);

    const cancel = async () => {
      try {
        await fetchOpenCodeJson("/api/session/" + encodeURIComponent(sessionId) + "/interrupt", {
          method: "POST",
          headers,
          body: "{}",
          signal: AbortSignal.timeout(5000)
        });
      } catch {
      }
    };
    context.setCancel?.(cancel);

    const promptResult = await fetchOpenCodeJson("/api/session/" + encodeURIComponent(sessionId) + "/prompt", {
      method: "POST",
      headers,
      body: JSON.stringify({ text: task }),
      signal: AbortSignal.timeout(taskTimeoutMs(context))
    });
    const promptSummary = JSON.stringify(promptResult ?? {}).slice(-4000);
    return {
      complete: promptSummary.includes("[DEVMOTER_AUTOPILOT_DONE]"),
      summary: promptSummary || ("OpenCode session " + sessionId + " completed the requested turn."),
      cost: null,
      cancel,
      context: backendContext
    };
  }

  const saved = context?.backendContext?.backend === "codex"
    && String(context.backendContext.projectId || "") === String(definition?.projectId || "")
    ? String(context.backendContext.threadId || "")
    : "";
  let threadId = saved;
  if (!threadId) {
    const threadParams = {};
    if (project?.path) threadParams.cwd = project.path;
    if (definition?.model) threadParams.model = String(definition.model);
    const threadResult = await codex.request("thread/start", threadParams, { timeoutMs: 10000 });
    threadId = String(threadResult?.thread?.id || "");
    if (!threadId) throw new Error("Codex did not return a thread id");
  }

  const backendContext = {
    backend: "codex",
    projectId: String(definition?.projectId || ""),
    threadId
  };
  context.setBackendContext?.(backendContext);

  const turnParams = {
    threadId,
    input: [{ type: "text", text: task }],
    clientUserMessageId: randomUUID()
  };
  if (definition?.model) turnParams.model = String(definition.model);
  const turnResult = await codex.request("turn/start", turnParams, { timeoutMs: 10000 });
  const turnId = String(turnResult?.turn?.id || "");
  if (!turnId) throw new Error("Codex did not return a turn id");

  const cancel = async () => {
    try {
      await codex.request("turn/interrupt", { threadId, turnId }, { timeoutMs: 5000 });
    } catch {
    }
  };
  context.setCancel?.(cancel);
  const result = await waitForCodexTurn(threadId, turnId, context);
  return { ...result, cancel, context: backendContext };
}

async function passkeyRoute(req, res, url) {
  if (!url.pathname.startsWith("/api/auth/passkey/")) return false;
  try {
    if (req.method === "GET" && url.pathname === "/api/auth/passkey/status") {
      json(res, 200, await passkeys.status(req));
      return true;
    }
    if (req.method === "POST" && url.pathname === "/api/auth/passkey/register/options") {
      json(res, 200, await passkeys.registrationOptions(req));
      return true;
    }
    if (req.method === "POST" && url.pathname === "/api/auth/passkey/register/verify") {
      const result = await passkeys.verifyRegistration(req, await readJson(req, 256 * 1024));
      res.setHeader("set-cookie", result.cookie);
      json(res, 200, { ok: true });
      return true;
    }
    if (req.method === "POST" && url.pathname === "/api/auth/passkey/login/options") {
      json(res, 200, await passkeys.loginOptions(req));
      return true;
    }
    if (req.method === "POST" && url.pathname === "/api/auth/passkey/login/verify") {
      const result = await passkeys.verifyLogin(req, await readJson(req, 256 * 1024));
      res.setHeader("set-cookie", result.cookie);
      json(res, 200, { ok: true });
      return true;
    }
    if (req.method === "POST" && url.pathname === "/api/auth/passkey/logout") {
      res.setHeader("set-cookie", await passkeys.logout(req));
      json(res, 200, { ok: true });
      return true;
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
    const localAddress = DEVMOTER_PUBLIC_ORIGIN ||
      ((String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim() || url.protocol.replace(":", "")) +
        "://" +
        (String(req.headers["x-forwarded-host"] || "").split(",")[0].trim() || req.headers.host || "localhost"));

    if (req.method === "GET" && url.pathname === "/api/control/hosts") {
      json(res, 200, { hosts: await controlPlane.listHosts(localAddress) });
      return true;
    }
    if (req.method === "GET" && url.pathname === "/api/control/hosts/status") {
      json(res, 200, {
        hosts: await controlPlane.listHostStatuses(localAddress, {
          force: url.searchParams.get("force") === "1"
        })
      });
      return true;
    }
    if (req.method === "POST" && url.pathname === "/api/control/hosts") {
      if (!claimOperation(req, res, req.method + ":" + url.pathname)) return true;
      json(res, 201, { host: await controlPlane.addHost(await readJson(req)) });
      return true;
    }

    const hostMatch = url.pathname.match(/^\/api\/control\/hosts\/([^/]+)$/);
    if (req.method === "DELETE" && hostMatch) {
      if (!claimOperation(req, res, req.method + ":" + url.pathname)) return true;
      await controlPlane.removeHost(decodeURIComponent(hostMatch[1]));
      json(res, 200, { ok: true });
      return true;
    }

    if (req.method === "GET" && url.pathname === "/api/control/schedules") {
      json(res, 200, { schedules: await controlPlane.listSchedules() });
      return true;
    }
    if (req.method === "POST" && url.pathname === "/api/control/schedules") {
      if (!claimOperation(req, res, req.method + ":" + url.pathname)) return true;
      json(res, 201, { schedule: await controlPlane.createSchedule(await readJson(req)) });
      return true;
    }

    const scheduleMatch = url.pathname.match(/^\/api\/control\/schedules\/([^/]+)$/);
    if (scheduleMatch && req.method === "PATCH") {
      if (!claimOperation(req, res, req.method + ":" + url.pathname)) return true;
      const payload = await readJson(req);
      json(res, 200, {
        schedule: await controlPlane.setScheduleEnabled(
          decodeURIComponent(scheduleMatch[1]),
          payload?.enabled
        )
      });
      return true;
    }
    if (scheduleMatch && req.method === "DELETE") {
      if (!claimOperation(req, res, req.method + ":" + url.pathname)) return true;
      await controlPlane.deleteSchedule(decodeURIComponent(scheduleMatch[1]));
      json(res, 200, { ok: true });
      return true;
    }

    if (req.method === "GET" && url.pathname === "/api/control/triggers") {
      json(res, 200, { triggers: await controlPlane.listTriggers() });
      return true;
    }
    if (req.method === "POST" && url.pathname === "/api/control/triggers") {
      if (!claimOperation(req, res, req.method + ":" + url.pathname)) return true;
      json(res, 201, await controlPlane.createTrigger(await readJson(req)));
      return true;
    }

    const triggerMatch = url.pathname.match(/^\/api\/control\/triggers\/([^/]+)$/);
    if (triggerMatch && req.method === "DELETE") {
      if (!claimOperation(req, res, req.method + ":" + url.pathname)) return true;
      await controlPlane.deleteTrigger(decodeURIComponent(triggerMatch[1]));
      json(res, 200, { ok: true });
      return true;
    }

    if (req.method === "GET" && url.pathname === "/api/control/runs") {
      json(res, 200, { runs: await controlPlane.listRuns() });
      return true;
    }
    if (req.method === "POST" && url.pathname === "/api/control/autopilot") {
      if (!claimOperation(req, res, req.method + ":" + url.pathname)) return true;
      json(res, 202, { run: await controlPlane.startAutopilot(await readJson(req)) });
      return true;
    }

    const autopilotMatch = url.pathname.match(/^\/api\/control\/autopilot\/([^/]+)\/(pause|resume|cancel)$/);
    if (autopilotMatch && req.method === "POST") {
      if (!claimOperation(req, res, req.method + ":" + url.pathname)) return true;
      const id = decodeURIComponent(autopilotMatch[1]);
      const run = autopilotMatch[2] === "pause"
        ? await controlPlane.pauseAutopilot(id)
        : autopilotMatch[2] === "resume"
          ? await controlPlane.resumeAutopilot(id)
          : await controlPlane.cancelAutopilot(id);
      json(res, 200, { run });
      return true;
    }

    json(res, 404, { error: "Unknown control endpoint" });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    json(res, message === "Request body too large" ? 413 : 400, { error: message });
  }
  return true;
}

async function githubWebhookRoute(req, res) {
  try {
    const raw = await readRaw(req, 64 * 1024);
    const event = String(req.headers["x-github-event"] || "").trim();
    const signature = String(req.headers["x-hub-signature-256"] || "").trim();
    if (!event || !signature) {
      json(res, 400, { error: "Missing GitHub webhook authentication headers" });
      return;
    }
    const payload = raw.length ? JSON.parse(raw.toString("utf8")) : {};
    const runIds = await controlPlane.dispatchEvent(
      "github.webhook",
      event,
      payload,
      { rawBody: raw, signature }
    );
    json(res, 202, { accepted: runIds.length });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = Number(error?.status || (message === "Request body too large" ? 413 : 400));
    json(res, status, { error: "Webhook rejected" });
  }
}

function resolveUploadPath(id) {
  try {
    return uploadRegistry.get(id).path;
  } catch {
    const error = new Error("Upload id is unavailable or expired");
    error.status = 400;
    throw error;
  }
}

function materializeOpenCodeUploadBody(body, contentType, policyPath) {
  if (
    !body ||
    !isPromptRoute(policyPath) ||
    !String(contentType || "").includes("application/json")
  ) return body;

  let payload;
  try {
    payload = JSON.parse(Buffer.from(body).toString("utf8"));
  } catch {
    return body;
  }

  if (typeof payload?.text !== "string" || !payload.text.includes("devmoter-upload:")) {
    return body;
  }

  payload.text = payload.text.replace(
    /devmoter-upload:([0-9a-f-]{36})/gi,
    (_match, id) => resolveUploadPath(id)
  );
  return Buffer.from(JSON.stringify(payload));
}

async function materializeCodexUploadInputs(method, params) {
  if (method !== "turn/start" || !Array.isArray(params?.input)) return params;
  const input = params.input.map(item => {
    if (!item || typeof item !== "object") return item;

    if (item.uploadId) {
      const next = { ...item, path: resolveUploadPath(item.uploadId) };
      delete next.uploadId;
      return next;
    }

    if (
      (item.type === "localImage" || item.type === "mention") &&
      Object.prototype.hasOwnProperty.call(item, "path")
    ) {
      const error = new Error("Direct attachment paths are not accepted; upload the file first");
      error.status = 400;
      throw error;
    }
    return item;
  });
  return { ...params, input };
}

async function proxy(req, res) {
  const pocketPath = req.url.replace(/^\/api\/opencode/, "") || "/";
  const upstreamPath = pocketPath.startsWith("/api/")
    ? pocketPath
    : `/api${pocketPath}`;
  const url = new URL(upstreamPath, OPENCODE_URL);
  const policyPath = url.pathname;
  const sessionId = sessionIdFromOpenCodePath(policyPath);
  const requestedMode = parseAgentMode(req.headers["x-pocket-agent-mode"]);
  if (sessionId && requestedMode) openCodeSessionModes.set(sessionId, requestedMode);
  const mode = requestedMode || (sessionId ? openCodeSessionModes.get(sessionId) : null) || "build";

  if (isReadOnlyMode(mode) && isDirectMutationRoute(policyPath)) {
    json(res, 403, { error: `${mode} mode blocks direct shell and command mutations`, mode });
    return;
  }

  let body =
    req.method === "GET" || req.method === "HEAD"
      ? undefined
      : await new Promise((resolve, reject) => {
          const chunks = [];
          req.on("data", chunk => chunks.push(chunk));
          req.on("end", () => resolve(Buffer.concat(chunks)));
          req.on("error", reject);
        });

  if (body?.length && isPromptRoute(policyPath) && isReadOnlyMode(mode)) {
    try {
      const payload = JSON.parse(body.toString("utf8"));
      body = Buffer.from(JSON.stringify(applyModeToPrompt(payload, mode)));
    } catch {
      json(res, 400, { error: "Read-only mode requires a JSON prompt body" });
      return;
    }
  }

  body = materializeOpenCodeUploadBody(
    body,
    req.headers["content-type"] || "",
    policyPath
  );

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
  const upstreamContentType = upstream.headers.get("content-type") || "";
  headers["cache-control"] = upstreamContentType.includes("text/event-stream")
    ? "no-cache, no-transform"
    : "no-store";

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
    let params = payload?.params ?? {};

    if (!isAllowedCodexRpc(method)) {
      json(res, 400, { error: "Codex RPC method is not allowed" });
      return;
    }

    if (method === "thread/start") {
      if (!params || typeof params !== "object" || Array.isArray(params)) {
        json(res, 400, { error: "Codex thread/start params must be an object" });
        return;
      }
      if (Object.prototype.hasOwnProperty.call(params, "cwd")) {
        json(res, 400, { error: "Codex cwd must be selected by registered project id" });
        return;
      }

      const projectId = String(params.projectId || "").trim();
      const nextParams = { ...params };
      delete nextParams.projectId;

      if (projectId) {
        try {
          const project = await getProjectById(projectId);
          nextParams.cwd = project.path;
        } catch {
          json(res, 400, { error: "Registered project not found or unavailable" });
          return;
        }
      }

      params = nextParams;
    }

    const inventoryMethod = new Set([
      "plugin/installed",
      "plugin/list",
      "mcpServerStatus/list",
      "skills/list"
    ]).has(method);

    params = await materializeCodexUploadInputs(method, params);

    const result = await codex.request(
      method,
      params,
      inventoryMethod ? { timeoutMs: 8000 } : {}
    );
    json(res, 200, { result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = Number(error?.status || (message === "Request body too large" ? 413 : 502));
    json(res, status, {
      error: message
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

    const uploadId = uploadRegistry.add({
      path,
      name,
      type: mime,
      size: buffer.length
    });

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


async function devWorkflowAction(req, res, handler) {
  try {
    const payload = await readJson(req);
    json(res, 200, await handler(payload));
  } catch (error) {
    json(res, 400, {
      error: error instanceof Error ? error.message : String(error)
    });
  }
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

    if (req.method === "POST" && url.pathname === "/api/control/events/github") {
      await githubWebhookRoute(req, res);
      return;
    }

    if (!authorizeBasicRequest(req, res, AUTH_CONFIG)) return;
    if (!requireSameOriginMutation(req, res, DEVMOTER_PUBLIC_ORIGIN)) return;

    if (await passkeyRoute(req, res, url)) return;

    if (
      PASSKEY_REQUIRED &&
      url.pathname.startsWith("/api/") &&
      url.pathname !== "/api/health"
    ) {
      const gate = await passkeys.require(req);
      if (gate.required && !gate.authenticated) {
        json(res, 401, { error: "Passkey authentication required" });
        return;
      }
    }

    if (url.pathname === "/api/workspace-control" || url.pathname.startsWith("/api/workspace-control/")) {
      if (
        req.method !== "GET" &&
        req.method !== "HEAD" &&
        !claimOperation(req, res, `${req.method}:${url.pathname}`)
      ) return;
      if (await handleWorkspaceControlRequest(req, res, url, workspaceControl)) return;
    }

    if (await controlRoute(req, res, url)) return;
    if (await automationApi.handle(req, res, url)) return;

    const advancedCandidate =
      url.pathname.startsWith("/api/advanced/") ||
      /^\/api\/projects\/[^/]+\/(?:preview|artifacts|web-preview)$/.test(url.pathname) ||
      /^\/api\/artifacts\/[^/]+\/(?:preview|download)$/.test(url.pathname) ||
      /^\/api\/live-preview\/proxy\//.test(url.pathname);
    if (advancedCandidate) {
      if (
        req.method !== "GET" &&
        req.method !== "HEAD" &&
        !claimOperation(req, res, `${req.method}:${url.pathname}`)
      ) return;
      if (await advancedApi.handle(req, res, url)) return;
    }


    if (req.method === "GET" && url.pathname === "/api/dev/settings") {
      json(res, 200, { settings: await devWorkflows.getSettings() });
      return;
    }

    if (req.method === "PUT" && url.pathname === "/api/dev/settings") {
      if (!claimOperation(req, res, `${req.method}:${url.pathname}`)) return;
      await devWorkflowAction(req, res, async payload => ({
        settings: await devWorkflows.updateSettings(payload?.settings ?? payload)
      }));
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/dev/session-context") {
      try {
        json(res, 200, await devWorkflows.sessionContext(url.searchParams.get("projectId")));
      } catch (error) {
        json(res, 400, { error: error instanceof Error ? error.message : String(error) });
      }
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/dev/capabilities") {
      try {
        json(res, 200, await devWorkflows.capabilities(url.searchParams.get("projectId")));
      } catch (error) {
        json(res, 400, { error: error instanceof Error ? error.message : String(error) });
      }
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/dev/review") {
      if (!claimOperation(req, res, `${req.method}:${url.pathname}`)) return;
      await devWorkflowAction(req, res, payload => devWorkflows.review(payload));
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/dev/review/comment") {
      if (!claimOperation(req, res, `${req.method}:${url.pathname}`)) return;
      await devWorkflowAction(req, res, payload => devWorkflows.postReviewComment(payload));
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/dev/ci") {
      await devWorkflowAction(req, res, payload => devWorkflows.ciStatus(payload));
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/dev/verify") {
      if (!claimOperation(req, res, `${req.method}:${url.pathname}`)) return;
      await devWorkflowAction(req, res, payload => devWorkflows.runVerification(payload?.projectId));
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/dev/repair") {
      if (!claimOperation(req, res, `${req.method}:${url.pathname}`)) return;
      await devWorkflowAction(req, res, payload => devWorkflows.repair(payload));
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/dev/acp/probe") {
      await devWorkflowAction(req, res, payload => devWorkflows.probeAcp(payload));
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/dev/mcp/test") {
      await devWorkflowAction(req, res, payload => devWorkflows.testMcpServer(payload));
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/dev/mcp") {
      if (!claimOperation(req, res, `${req.method}:${url.pathname}`)) return;
      await devWorkflowAction(req, res, payload => devWorkflows.saveMcpServer(payload));
      return;
    }

    if (req.method === "PUT" && url.pathname === "/api/dev/mcp/enabled") {
      if (!claimOperation(req, res, `${req.method}:${url.pathname}`)) return;
      await devWorkflowAction(req, res, payload => devWorkflows.setMcpEnabled(payload));
      return;
    }

    if (req.method === "DELETE" && url.pathname === "/api/dev/mcp") {
      if (!claimOperation(req, res, `${req.method}:${url.pathname}`)) return;
      await devWorkflowAction(req, res, payload => devWorkflows.removeMcpServer(payload));
      return;
    }

    if (url.pathname.startsWith("/api/workflow/")) {
      if (
        req.method !== "GET" &&
        req.method !== "HEAD" &&
        !claimOperation(req, res, `${req.method}:${url.pathname}`)
      ) return;
      if (await taskWorkflow.handle(req, res, url)) return;
    }

    if (url.pathname.startsWith("/api/session-control")) {
      if (
        req.method !== "GET" &&
        req.method !== "HEAD" &&
        !claimOperation(req, res, `${req.method}:${url.pathname}`)
      ) return;
      if (await sessionControl.handle(req, res, url)) return;
    }

    if (req.method === "GET" && url.pathname === "/api/system/diagnostics") {
      await featureJson(res, () => systemFeatures.diagnostics());
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/devices/bootstrap") {
      if (!claimOperation(req, res, `${req.method}:${url.pathname}`)) return;
      const payload = await readJson(req);
      await featureJson(res, () => systemFeatures.bootstrapDevice(req, payload?.label), 201);
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/devices") {
      await featureJson(res, () => systemFeatures.listDevices(req));
      return;
    }

    const trustedDeviceMatch = url.pathname.match(/^\/api\/devices\/([^/]+)$/);
    if (req.method === "DELETE" && trustedDeviceMatch) {
      if (!claimOperation(req, res, `${req.method}:${url.pathname}`)) return;
      await featureJson(res, () => systemFeatures.revokeDevice(req, decodeURIComponent(trustedDeviceMatch[1])));
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/pairings") {
      if (!claimOperation(req, res, `${req.method}:${url.pathname}`)) return;
      await featureJson(res, () => systemFeatures.createPairing(req), 201);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/pairings/claim") {
      if (!claimOperation(req, res, `${req.method}:${url.pathname}`)) return;
      const payload = await readJson(req);
      await featureJson(res, () => systemFeatures.claimPairing(payload?.code, payload?.label), 201);
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/push/key") {
      await featureJson(res, () => systemFeatures.pushPublicKey());
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/push/subscriptions") {
      if (!claimOperation(req, res, `${req.method}:${url.pathname}`)) return;
      const payload = await readJson(req);
      await featureJson(res, () => systemFeatures.subscribePush(req, payload), 201);
      return;
    }

    if (req.method === "DELETE" && url.pathname === "/api/push/subscriptions") {
      if (!claimOperation(req, res, `${req.method}:${url.pathname}`)) return;
      const payload = await readJson(req);
      await featureJson(res, () => systemFeatures.unsubscribePush(req, payload));
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/push/visibility") {
      const payload = await readJson(req);
      await featureJson(res, () => systemFeatures.updateVisibility(req, payload));
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/push/pending") {
      const payload = await readJson(req);
      await featureJson(res, () => systemFeatures.takePendingPush(payload));
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/safety/status") {
      json(res, 200, safety.loopDetector.inspect(url.searchParams.get("runId") || "global"));
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/safety/command-scan") {
      const payload = await readJson(req);
      json(res, 200, safety.scanCommand(payload?.command));
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/safety/guard") {
      const payload = await readJson(req);
      json(res, 200, safety.guard(payload));
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/safety/actions") {
      const payload = await readJson(req);
      json(res, 200, safety.loopDetector.record(payload?.runId || "global", {
        action: payload?.action,
        tool: payload?.tool,
        details: payload?.details
      }));
      return;
    }

    const continueMatch = url.pathname.match(/^\/api\/safety\/actions\/([^/]+)\/continue$/);
    if (req.method === "POST" && continueMatch) {
      json(res, 200, safety.loopDetector.continueRun(decodeURIComponent(continueMatch[1])));
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/safety/permissions") {
      json(res, 200, { rules: await safety.permissions.list() });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/safety/permissions/match") {
      const payload = await readJson(req);
      json(res, 200, await safety.permissions.match(payload));
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/safety/permissions") {
      if (!claimOperation(req, res, `${req.method}:${url.pathname}`)) return;
      try {
        const payload = await readJson(req);
        json(res, 201, { rule: await safety.permissions.grant(payload) });
      } catch (error) {
        json(res, 400, { error: error instanceof Error ? error.message : String(error) });
      }
      return;
    }

    const permissionRuleMatch = url.pathname.match(/^\/api\/safety\/permissions\/([^/]+)$/);
    if (req.method === "DELETE" && permissionRuleMatch) {
      if (!claimOperation(req, res, `${req.method}:${url.pathname}`)) return;
      json(res, 200, { ok: await safety.permissions.revoke(decodeURIComponent(permissionRuleMatch[1])) });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/safety/compact") {
      const payload = await readJson(req, 2 * 1024 * 1024);
      json(res, 200, await safety.compact(payload?.messages, {
        maxItems: payload?.maxItems,
        summarizerModel: payload?.summarizerModel
      }));
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/terminal/sessions") {
      if (!claimOperation(req, res, `${req.method}:${url.pathname}`)) return;
      await terminal.create(req, res);
      return;
    }

    const terminalMatch = url.pathname.match(/^\/api\/terminal\/sessions\/([^/]+)(?:\/(input|stream))?$/);
    if (terminalMatch) {
      const terminalId = decodeURIComponent(terminalMatch[1]);
      const terminalAction = terminalMatch[2] || "";
      if (req.method === "GET" && terminalAction === "") {
        await terminal.info(req, res, terminalId);
        return;
      }
      if (req.method === "GET" && terminalAction === "stream") {
        await terminal.stream(req, res, terminalId, url.searchParams.get("after") || 0);
        return;
      }
      if (req.method === "POST" && terminalAction === "input") {
        if (!claimOperation(req, res, `${req.method}:${url.pathname}:${operationId(req)}`)) return;
        await terminal.input(req, res, terminalId);
        return;
      }
      if (req.method === "DELETE" && terminalAction === "") {
        if (!claimOperation(req, res, `${req.method}:${url.pathname}`)) return;
        await terminal.close(req, res, terminalId);
        return;
      }
    }

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


    const projectGitMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/git\/(status|files|diff)$/);
    if (projectGitMatch && req.method === "GET") {
      const projectId = decodeURIComponent(projectGitMatch[1]);
      const action = projectGitMatch[2];
      if (action === "status") await projectGitStatus(projectId, res);
      else if (action === "files") await projectGitFiles(projectId, url, res);
      else await projectGitDiff(projectId, url, res);
      return;
    }

    const projectIndexMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/index(?:\/(rebuild|status|search))?$/);
    if (projectIndexMatch) {
      const projectId = decodeURIComponent(projectIndexMatch[1]);
      const action = projectIndexMatch[2] || "";
      if (req.method === "POST" && action === "rebuild") {
        if (!claimOperation(req, res, `${req.method}:${url.pathname}`)) return;
        try {
          const payload = await readJson(req);
          json(res, 200, await projectIndex.rebuild(projectId, { exclude: payload?.exclude }));
        } catch (error) {
          json(res, 400, { error: error instanceof Error ? error.message : String(error) });
        }
        return;
      }
      if (req.method === "GET" && action === "status") {
        json(res, 200, await projectIndex.status(projectId));
        return;
      }
      if (req.method === "GET" && action === "search") {
        try {
          json(res, 200, await projectIndex.search(projectId, url.searchParams.get("q") || "", Number(url.searchParams.get("limit") || 30)));
        } catch (error) {
          json(res, 400, { error: error instanceof Error ? error.message : String(error) });
        }
        return;
      }
      if (req.method === "DELETE" && action === "") {
        if (!claimOperation(req, res, `${req.method}:${url.pathname}`)) return;
        json(res, 200, await projectIndex.remove(projectId));
        return;
      }
    }

    const projectMapMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/map$/);
    if (req.method === "GET" && projectMapMatch) {
      try {
        json(res, 200, await projectIndex.repoMap(decodeURIComponent(projectMapMatch[1])));
      } catch (error) {
        json(res, 400, { error: error instanceof Error ? error.message : String(error) });
      }
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

    if (req.method === "POST" && url.pathname === "/api/integrations/status") {
      if (!claimOperation(req, res, `${req.method}:${url.pathname}`)) return;
      try {
        json(res, 200, await listIntegrations());
      } catch {
        json(res, 500, { error: "Integration status unavailable" });
      }
      return;
    }

    const integrationLaunchMatch = url.pathname.match(/^\/api\/integrations\/(antigravity|claude)\/launch$/);
    if (req.method === "POST" && integrationLaunchMatch) {
      if (!claimOperation(req, res, `${req.method}:${url.pathname}`)) return;
      try {
        const payload = await readJson(req);
        const project = await getProjectById(String(payload?.projectId || ""));
        json(res, 200, await launchIntegration(integrationLaunchMatch[1], project.path));
      } catch (error) {
        const safe = publicIntegrationError(error);
        json(res, safe.status, { error: safe.error });
      }
      return;
    }

    const antigravityRemoteMatch = url.pathname.match(/^\/api\/integrations\/antigravity\/remote\/(start|stop)$/);
    if (req.method === "POST" && antigravityRemoteMatch) {
      if (!claimOperation(req, res, `${req.method}:${url.pathname}`)) return;
      try {
        json(res, 200, await antigravityRemoteAction(antigravityRemoteMatch[1]));
      } catch (error) {
        const safe = publicIntegrationError(error);
        json(res, safe.status, { error: safe.error });
      }
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/health") {
      const [openCode, codexHealth] = await Promise.all([
        opencodeHealth(),
        codex.health()
      ]);
      json(res, 200, {
        version: "0.2.0",
        automationApiVersion: AUTOMATION_API_VERSION,
        online: openCode.online || codexHealth.online,
        backends: {
          opencode: openCode,
          codex: codexHealth
        },
        terminalAuthConfigured: terminal.configured
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
    console.error(redactText(error instanceof Error ? error.stack || error.message : String(error)));
    json(res, 500, { error: "DevMoter server error" });
  }
});

server.on("close", () => {
  controlPlane.stop();
  terminal.shutdown();
});

server.listen(PORT, HOST, () => {
  console.log(`DevMoter FAST: http://${HOST}:${PORT}`);
  console.log(`DevMoter auth: enabled for ${DEVMOTER_AUTH_USERNAME}`);
  console.log(`OpenCode upstream: ${OPENCODE_URL}`);
  console.log(`OpenCode directory: ${OPENCODE_DIRECTORY}`);
  console.log(`Codex binary: ${process.env.CODEX_BIN || "codex"}`);
  console.log(`Codex cwd: ${process.env.CODEX_CWD || process.cwd()}`);
  controlPlane.start();
  void controlPlane.dispatchEvent("devmoter.lifecycle", "server.started", {
    startedAt: Date.now(),
    host: HOST,
    port: PORT
  }).catch(error => {
    console.error("Control-plane startup event failed", redactText(error instanceof Error ? error.message : String(error)));
  });
});
