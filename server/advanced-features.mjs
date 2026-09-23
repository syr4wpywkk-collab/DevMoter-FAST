import { access, lstat, mkdir, readFile, readdir, realpath, stat, writeFile } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { basename, extname, isAbsolute, relative, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";

export const TEXT_PREVIEW_LIMIT = 1024 * 1024;
export const IMAGE_PREVIEW_LIMIT = 8 * 1024 * 1024;
const SAFE_IMAGE_MIME = new Map([
  [".png", "image/png"], [".jpg", "image/jpeg"], [".jpeg", "image/jpeg"],
  [".gif", "image/gif"], [".webp", "image/webp"], [".avif", "image/avif"]
]);
const TEXT_EXTENSIONS = new Set([
  ".txt", ".md", ".mdx", ".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx",
  ".json", ".css", ".scss", ".html", ".htm", ".xml", ".svg", ".yml", ".yaml",
  ".toml", ".ini", ".env", ".sh", ".bash", ".zsh", ".py", ".rb", ".go", ".rs",
  ".java", ".kt", ".kts", ".swift", ".c", ".h", ".cc", ".cpp", ".hpp", ".sql",
  ".graphql", ".gql", ".vue", ".svelte"
]);

function inside(root, target) {
  const rel = relative(root, target);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function normalizeRelative(input) {
  const value = String(input || "").replaceAll("\\", "/");
  if (!value || value.includes("\0") || value.startsWith("/") || value.split("/").includes("..")) {
    throw new Error("Path must be a relative path inside the approved root");
  }
  return value.replace(/^\.\//, "");
}

export async function resolveInsideRoot(rootInput, relativePath, { mustExist = true } = {}) {
  const root = await realpath(rootInput);
  const safeRelative = normalizeRelative(relativePath);
  const candidate = resolve(root, safeRelative);
  if (!inside(root, candidate)) throw new Error("Path escapes the approved root");
  if (!mustExist) return { root, target: candidate, relativePath: safeRelative };
  const target = await realpath(candidate);
  if (!inside(root, target)) throw new Error("Symlink escapes the approved root");
  return { root, target, relativePath: safeRelative };
}

function looksBinary(buffer) {
  const sample = buffer.subarray(0, Math.min(buffer.length, 8192));
  for (const byte of sample) if (byte === 0) return true;
  return false;
}

export function languageForPath(path) {
  const ext = extname(path).toLowerCase();
  return ({
    ".js": "javascript", ".mjs": "javascript", ".cjs": "javascript", ".jsx": "javascript",
    ".ts": "typescript", ".tsx": "typescript", ".json": "json", ".css": "css", ".scss": "scss",
    ".html": "html", ".htm": "html", ".xml": "xml", ".svg": "xml", ".md": "markdown",
    ".mdx": "markdown", ".yml": "yaml", ".yaml": "yaml", ".toml": "toml", ".sh": "shell",
    ".bash": "shell", ".zsh": "shell", ".py": "python", ".rb": "ruby", ".go": "go",
    ".rs": "rust", ".java": "java", ".kt": "kotlin", ".kts": "kotlin", ".swift": "swift",
    ".c": "c", ".h": "c", ".cc": "cpp", ".cpp": "cpp", ".hpp": "cpp", ".sql": "sql",
    ".graphql": "graphql", ".gql": "graphql", ".vue": "vue", ".svelte": "svelte"
  })[ext] || "text";
}

export async function previewFile(root, relativePath) {
  const resolved = await resolveInsideRoot(root, relativePath);
  const info = await stat(resolved.target);
  if (!info.isFile()) throw new Error("Preview target is not a file");
  const ext = extname(resolved.target).toLowerCase();
  const imageMime = SAFE_IMAGE_MIME.get(ext);

  if (imageMime) {
    if (info.size > IMAGE_PREVIEW_LIMIT) {
      return { kind: "binary", name: basename(resolved.target), path: resolved.relativePath, size: info.size, reason: "image-too-large" };
    }
    const data = await readFile(resolved.target);
    return { kind: "image", name: basename(resolved.target), path: resolved.relativePath, size: info.size, mime: imageMime, data: data.toString("base64") };
  }

  if (info.size > TEXT_PREVIEW_LIMIT) {
    return { kind: "binary", name: basename(resolved.target), path: resolved.relativePath, size: info.size, reason: "file-too-large" };
  }
  const data = await readFile(resolved.target);
  if (looksBinary(data) || (!TEXT_EXTENSIONS.has(ext) && ext !== "")) {
    return { kind: "binary", name: basename(resolved.target), path: resolved.relativePath, size: info.size, reason: "binary-or-unsupported" };
  }
  return {
    kind: "text", name: basename(resolved.target), path: resolved.relativePath, size: info.size,
    language: languageForPath(resolved.target), content: data.toString("utf8")
  };
}

const FILE_BROWSER_LIMIT = 250;
const FILE_BROWSER_LARGE = 1024 * 1024;
const SENSITIVE_BROWSER_NAME = /^(?:\.env(?:\.|$)|\.git$|id_[a-z0-9_-]+(?:\.pub)?$|.*(?:secret|credential|credentials|private[_-]?key).*)/i;

function normalizeBrowserRelative(input) {
  const value = String(input || "").replaceAll("\\", "/").replace(/^\.\//, "").replace(/\/+$/, "");
  if (value.includes("\0") || value.startsWith("/") || value.split("/").includes("..")) {
    throw new Error("Browser path must stay inside the registered project");
  }
  return value;
}

export async function listProjectDirectory(rootInput, relativePath = "", options = {}) {
  const root = await realpath(rootInput);
  const safeRelative = normalizeBrowserRelative(relativePath);
  const candidate = safeRelative ? resolve(root, safeRelative) : root;
  const target = await realpath(candidate);
  if (!inside(root, target)) throw new Error("Browser path escapes the registered project");
  const targetInfo = await lstat(target);
  if (targetInfo.isSymbolicLink() || !targetInfo.isDirectory()) throw new Error("Browser path is not a regular project directory");

  const includeHidden = options.includeHidden === true;
  const entries = await readdir(target, { withFileTypes: true });
  const output = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name)).slice(0, FILE_BROWSER_LIMIT + 1)) {
    if (output.length >= FILE_BROWSER_LIMIT) break;
    if (entry.isSymbolicLink()) continue;
    const hidden = entry.name.startsWith(".");
    if (SENSITIVE_BROWSER_NAME.test(entry.name)) continue;
    if (hidden && !includeHidden) continue;

    const relativeEntry = safeRelative ? safeRelative + "/" + entry.name : entry.name;
    const full = resolve(target, entry.name);
    const info = await lstat(full);
    if (info.isSymbolicLink()) continue;
    const actual = await realpath(full);
    if (!inside(root, actual)) continue;

    if (info.isDirectory()) {
      output.push({ name: entry.name, path: relativeEntry, kind: "directory", hidden, size: null });
      continue;
    }
    if (!info.isFile()) continue;

    const ext = extname(entry.name).toLowerCase();
    let kind = "binary";
    if (info.size > FILE_BROWSER_LARGE) kind = "large";
    else if (TEXT_EXTENSIONS.has(ext) || ext === "") {
      try {
        const sample = await readFile(actual);
        kind = looksBinary(sample.subarray(0, Math.min(sample.length, 8192))) ? "binary" : "text";
      } catch {
        kind = "binary";
      }
    } else if (SAFE_IMAGE_MIME.has(ext)) {
      kind = "image";
    }
    output.push({
      name: entry.name,
      path: relativeEntry,
      kind,
      hidden,
      size: info.size,
      language: kind === "text" ? languageForPath(entry.name) : null,
      previewable: kind === "text" || kind === "image"
    });
  }
  return {
    path: safeRelative,
    parent: safeRelative.includes("/") ? safeRelative.slice(0, safeRelative.lastIndexOf("/")) : (safeRelative ? "" : null),
    entries: output,
    truncated: entries.length > FILE_BROWSER_LIMIT
  };
}

async function readJsonFile(path, fallback) {
  try { return JSON.parse(await readFile(path, "utf8")); } catch { return fallback; }
}

async function writeJsonFile(path, value) {
  await mkdir(resolve(path, ".."), { recursive: true, mode: 0o700 });
  await writeFile(path, JSON.stringify(value, null, 2), { mode: 0o600 });
}

export function createGrantRegistry({ file, homeDir, allowExternal = false }) {
  async function list() {
    const data = await readJsonFile(file, { version: 1, grants: [] });
    return Array.isArray(data.grants) ? data.grants : [];
  }
  async function add(pathInput, mode = "read") {
    if (!new Set(["read", "read-write"]).has(mode)) throw new Error("Grant mode must be read or read-write");
    const canonical = await realpath(String(pathInput || ""));
    const info = await stat(canonical);
    if (!info.isDirectory()) throw new Error("Grant path must be a directory");
    const home = await realpath(homeDir);
    if (!allowExternal && !inside(home, canonical)) throw new Error("External directory grants are disabled");
    const grants = await list();
    const existing = grants.find(item => item.path === canonical && item.mode === mode);
    if (existing) return existing;
    const grant = { id: randomUUID(), path: canonical, mode, createdAt: Date.now() };
    grants.push(grant);
    await writeJsonFile(file, { version: 1, grants });
    return grant;
  }
  async function revoke(id) {
    const grants = await list();
    const next = grants.filter(item => item.id !== id);
    if (next.length === grants.length) return false;
    await writeJsonFile(file, { version: 1, grants: next });
    return true;
  }
  async function resolveGrant(id, relativePath) {
    const grant = (await list()).find(item => item.id === id);
    if (!grant) throw new Error("Directory grant not found");
    const resolved = await resolveInsideRoot(grant.path, relativePath);
    return { ...resolved, grant };
  }
  return { list, add, revoke, resolveGrant };
}

export function createArtifactRegistry({ file }) {
  async function list(sessionId, projectId) {
    const data = await readJsonFile(file, { version: 1, artifacts: [] });
    const items = Array.isArray(data.artifacts) ? data.artifacts : [];
    return items.filter(item => (!sessionId || item.sessionId === sessionId) && (!projectId || item.projectId === projectId));
  }
  async function register({ sessionId, projectId, root, relativePath }) {
    const resolved = await resolveInsideRoot(root, relativePath);
    const info = await stat(resolved.target);
    if (!info.isFile()) throw new Error("Artifact must be a file");
    const all = await list();
    const artifact = {
      id: randomUUID(), sessionId: String(sessionId || "default"), projectId,
      root: resolved.root, path: resolved.relativePath, name: basename(resolved.target),
      size: info.size, createdAt: Date.now()
    };
    all.push(artifact);
    await writeJsonFile(file, { version: 1, artifacts: all.slice(-1000) });
    return artifact;
  }
  async function get(id) {
    const data = await readJsonFile(file, { version: 1, artifacts: [] });
    const artifact = (data.artifacts || []).find(item => item.id === id);
    if (!artifact) throw new Error("Artifact not found");
    const resolved = await resolveInsideRoot(artifact.root, artifact.path);
    return { artifact, resolved };
  }
  return { list, register, get };
}

function parseCapabilities(raw = "") {
  const set = new Set(String(raw).split(",").map(x => x.trim()).filter(Boolean));
  return {
    vision: set.has("vision"), tools: set.has("tools"), reasoning: set.has("reasoning"),
    context: [...set].map(x => x.match(/^context:(\d+)$/)?.[1]).filter(Boolean).map(Number)[0] || null
  };
}

export function providerConfigFromEnv(env = process.env) {
  const providers = [];
  const ollamaBase = String(env.DEVMOTER_OLLAMA_URL || "").trim().replace(/\/$/, "");
  if (ollamaBase) providers.push({
    id: "ollama", type: "ollama", label: "Ollama", baseUrl: ollamaBase,
    local: /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(?::|\/|$)/i.test(ollamaBase),
    configuredModels: String(env.DEVMOTER_OLLAMA_MODELS || "").split(",").map(x => x.trim()).filter(Boolean),
    defaultCapabilities: parseCapabilities(env.DEVMOTER_OLLAMA_CAPABILITIES || "tools")
  });

  const compatibleBase = String(env.DEVMOTER_OPENAI_COMPAT_BASE_URL || "").trim().replace(/\/$/, "");
  if (compatibleBase) providers.push({
    id: "openai-compatible", type: "openai-compatible",
    label: String(env.DEVMOTER_OPENAI_COMPAT_LABEL || "OpenAI-compatible"),
    baseUrl: compatibleBase,
    local: /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(?::|\/|$)/i.test(compatibleBase),
    apiKey: String(env.DEVMOTER_OPENAI_COMPAT_API_KEY || ""),
    configuredModels: String(env.DEVMOTER_OPENAI_COMPAT_MODELS || "").split(",").map(x => x.trim()).filter(Boolean),
    defaultCapabilities: parseCapabilities(env.DEVMOTER_OPENAI_COMPAT_CAPABILITIES || "tools")
  });
  return providers;
}

async function fetchJson(fetchImpl, url, options = {}, timeoutMs = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, { ...options, signal: controller.signal });
    const text = await res.text();
    let body;
    try { body = text ? JSON.parse(text) : null; } catch { body = { raw: text }; }
    return { res, body };
  } finally { clearTimeout(timer); }
}

export async function discoverProviderModels(provider, fetchImpl = fetch) {
  try {
    if (provider.type === "ollama") {
      const { res, body } = await fetchJson(fetchImpl, provider.baseUrl + "/api/tags");
      if (!res.ok) throw new Error("Ollama discovery failed (" + res.status + ")");
      return (body?.models || []).map(item => ({
        id: item.name || item.model, label: item.name || item.model, providerId: provider.id,
        local: provider.local, available: true, capabilities: provider.defaultCapabilities
      })).filter(item => item.id);
    }
    if (provider.type === "openai-compatible") {
      const headers = provider.apiKey ? { authorization: "Bearer " + provider.apiKey } : {};
      const { res, body } = await fetchJson(fetchImpl, provider.baseUrl + "/models", { headers });
      if (!res.ok) throw new Error("Model discovery failed (" + res.status + ")");
      return (body?.data || []).map(item => ({
        id: item.id, label: item.id, providerId: provider.id, local: provider.local,
        available: true, capabilities: provider.defaultCapabilities
      })).filter(item => item.id);
    }
  } catch (error) {
    return provider.configuredModels.map(id => ({
      id, label: id, providerId: provider.id, local: provider.local, available: false,
      capabilities: provider.defaultCapabilities, limitation: error instanceof Error ? error.message : String(error)
    }));
  }
  return [];
}

export async function buildModelRegistry(env = process.env, fetchImpl = fetch) {
  const providers = providerConfigFromEnv(env);
  const discovered = await Promise.all(providers.map(provider => discoverProviderModels(provider, fetchImpl)));
  return {
    providers: providers.map(({ apiKey, ...provider }) => ({ ...provider, secretConfigured: Boolean(apiKey) })),
    models: discovered.flat()
  };
}

export function parseRoutingRules(env = process.env) {
  try {
    const raw = JSON.parse(env.DEVMOTER_MODEL_ROUTES || "[]");
    return Array.isArray(raw) ? raw : [];
  } catch { return []; }
}

function modelMeets(model, requirements = {}) {
  const caps = model.capabilities || {};
  if (requirements.vision && !caps.vision) return false;
  if (requirements.tools && !caps.tools) return false;
  if (requirements.reasoning && !caps.reasoning) return false;
  if (requirements.context && (!caps.context || caps.context < Number(requirements.context))) return false;
  return true;
}

export function chooseModel({ models, rules, role, requirements = {}, override }) {
  if (override?.providerId && override?.model) {
    const exact = models.find(m => m.providerId === override.providerId && m.id === override.model);
    if (!exact) throw new Error("Requested model override is not available");
    if (!modelMeets(exact, requirements)) throw new Error("Requested model does not meet capability requirements");
    return { model: exact, reason: "user-override" };
  }
  for (const rule of rules || []) {
    if (rule.role && rule.role !== role) continue;
    const candidate = models.find(m => m.providerId === rule.providerId && m.id === rule.model && modelMeets(m, requirements));
    if (candidate) return { model: candidate, reason: "rule:" + (rule.name || role || "default") };
  }
  const candidate = models.find(m => modelMeets(m, requirements));
  if (!candidate) throw new Error("No configured model satisfies the requested capabilities");
  return { model: candidate, reason: "first-compatible" };
}

export function isRetryableProviderFailure(error) {
  const status = Number(error?.status || 0);
  return Boolean(error?.retryable) || status === 408 || status === 409 || status === 425 || status === 429 || status >= 500 || status === 0;
}

async function invokeProvider(provider, model, messages, fetchImpl = fetch) {
  if (provider.type === "ollama") {
    const { res, body } = await fetchJson(fetchImpl, provider.baseUrl + "/api/chat", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ model, messages, stream: false })
    }, 120000);
    if (!res.ok) {
      const e = new Error(body?.error || "Ollama request failed (" + res.status + ")");
      e.status = res.status;
      throw e;
    }
    return { text: body?.message?.content ?? "", raw: body };
  }
  const headers = { "content-type": "application/json" };
  if (provider.apiKey) headers.authorization = "Bearer " + provider.apiKey;
  const { res, body } = await fetchJson(fetchImpl, provider.baseUrl + "/chat/completions", {
    method: "POST", headers, body: JSON.stringify({ model, messages, stream: false })
  }, 120000);
  if (!res.ok) {
    const e = new Error(body?.error?.message || "Provider request failed (" + res.status + ")");
    e.status = res.status;
    throw e;
  }
  return { text: body?.choices?.[0]?.message?.content ?? "", raw: body };
}

export async function runWithRouting({ env = process.env, fetchImpl = fetch, messages, role, requirements, override, failover = true }) {
  const privateProviders = providerConfigFromEnv(env);
  const registry = await buildModelRegistry(env, fetchImpl);
  const decision = chooseModel({ models: registry.models, rules: parseRoutingRules(env), role, requirements, override });
  const configuredChain = String(env.DEVMOTER_PROVIDER_FAILOVER || "").split(",").map(x => x.trim()).filter(Boolean);
  const candidates = [
    decision.model,
    ...registry.models.filter(m =>
      configuredChain.includes(m.providerId + "/" + m.id) &&
      !(m.providerId === decision.model.providerId && m.id === decision.model.id) &&
      modelMeets(m, requirements)
    )
  ];
  const attempts = [];

  for (let index = 0; index < candidates.length; index++) {
    const candidate = candidates[index];
    const provider = privateProviders.find(p => p.id === candidate.providerId);
    if (!provider) continue;
    try {
      const result = await invokeProvider(provider, candidate.id, messages, fetchImpl);
      return { ...result, providerId: candidate.providerId, model: candidate.id, routeReason: decision.reason, attempts };
    } catch (error) {
      const entry = {
        providerId: candidate.providerId, model: candidate.id, status: Number(error?.status || 0),
        error: error instanceof Error ? error.message : String(error)
      };
      attempts.push(entry);
      if (!failover || !isRetryableProviderFailure(error) || index === candidates.length - 1) {
        error.attempts = attempts;
        throw error;
      }
    }
  }
  throw new Error("No provider could handle the request");
}

export function sandboxStatus({ env = process.env, spawn = spawnSync } = {}) {
  const requested = String(env.DEVMOTER_SANDBOX || "preferred").toLowerCase();
  const mode = ["off", "preferred", "required"].includes(requested) ? requested : "preferred";
  let probe = { status: 127, stdout: "" };
  try {
    probe = spawn("bwrap", ["--version"], { encoding: "utf8", timeout: 3000 }) || probe;
  } catch {
    probe = { status: 127, stdout: "" };
  }
  const available = probe.status === 0;
  return {
    mode,
    backend: "bwrap",
    available,
    enforced: mode !== "off" && available,
    scope: mode !== "off" && available ? "devmoter-owned-agent-tools" : "none",
    externalBackends: mode === "required" ? "blocked" : "backend-native",
    version: available ? String(probe.stdout || "").trim() : null
  };
}

export function externalBackendSandboxPolicy(backend, { env = process.env, spawn = spawnSync } = {}) {
  const status = sandboxStatus({ env, spawn });
  const allowed = status.mode !== "required";
  return {
    backend: String(backend || "external"),
    allowed,
    mode: status.mode,
    reason: allowed
      ? (status.mode === "preferred"
          ? "External backend execution uses its native sandbox; DevMoter bwrap is enforced only for DevMoter-owned agent tools."
          : "OS sandbox enforcement is disabled.")
      : "DEVMOTER_SANDBOX=required blocks external backend agent execution because DevMoter cannot guarantee its commands are wrapped by bwrap."
  };
}

export function assertExternalBackendExecutionAllowed(backend, options = {}) {
  const policy = externalBackendSandboxPolicy(backend, options);
  if (!policy.allowed) {
    const error = new Error(policy.reason);
    error.statusCode = 409;
    error.code = "DEVMOTER_SANDBOX_REQUIRED";
    throw error;
  }
  return policy;
}

export function buildBubblewrapCommand({ projectPath, grants = [], command, args = [], allowNetwork = false, env = process.env, spawn = spawnSync }) {
  const status = sandboxStatus({ env, spawn });
  if (status.mode === "off") return { sandboxed: false, command, args, policy: status };
  if (!status.available) {
    if (status.mode === "required") throw new Error("Sandbox is required but bubblewrap (bwrap) is unavailable");
    return { sandboxed: false, command, args, warning: "bubblewrap unavailable", policy: status };
  }
  if (!projectPath || !String(projectPath).startsWith("/")) {
    throw new Error("Sandboxed agent tools require an absolute registered project path");
  }
  const bwrapArgs = ["--die-with-parent", "--new-session", "--proc", "/proc", "--dev", "/dev", "--tmpfs", "/tmp"];
  if (!allowNetwork) bwrapArgs.push("--unshare-net");
  for (const systemPath of ["/usr", "/bin", "/lib", "/lib64", "/etc", "/run"]) bwrapArgs.push("--ro-bind-try", systemPath, systemPath);
  bwrapArgs.push("--bind", projectPath, projectPath, "--chdir", projectPath);
  for (const grant of grants) {
    if (!grant?.path || !String(grant.path).startsWith("/")) continue;
    bwrapArgs.push(grant.mode === "read-write" ? "--bind" : "--ro-bind", grant.path, grant.path);
  }
  bwrapArgs.push("--", command, ...args.map(value => String(value)));
  return { sandboxed: true, command: "bwrap", args: bwrapArgs, policy: status };
}

export async function assertReadable(path) {
  await access(path, fsConstants.R_OK);
  return true;
}
