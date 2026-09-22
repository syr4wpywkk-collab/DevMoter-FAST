import { appendFile, lstat, mkdir, open, readFile, readdir, realpath, rename, stat, writeFile } from "node:fs/promises";
import { constants as FS_CONSTANTS } from "node:fs";
import { extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { randomUUID } from "node:crypto";

const DEFAULT_LOCK_TTL_MS = 5 * 60_000;
const MAX_EVENT_PAYLOAD_BYTES = 256 * 1024;
const MAX_INDEX_FILES = 2500;
const MAX_INDEX_FILE_BYTES = 512 * 1024;
const IGNORE_DIRS = new Set([".git", "node_modules", "dist", "build", ".next", ".venv", "coverage", "target"]);
const SOURCE_EXTENSIONS = new Set([".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx", ".py", ".go", ".rs", ".java", ".kt", ".swift", ".rb", ".php"]);

function cleanId(value, fallback = "default") {
  const id = String(value ?? "").trim().replace(/[^a-zA-Z0-9._:-]/g, "_").slice(0, 120);
  return id || fallback;
}

function jsonBytes(value) {
  return Buffer.byteLength(JSON.stringify(value ?? null), "utf8");
}

async function readJsonFile(path, fallback) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return structuredClone(fallback);
    throw new Error("Shared control-plane state is unreadable or malformed: " + path);
  }
}

async function writeJsonFile(path, value) {
  const dir = resolve(path, "..");
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const temp = path + "." + process.pid + "." + randomUUID() + ".tmp";
  await writeFile(temp, JSON.stringify(value, null, 2), { mode: 0o600 });
  await rename(temp, path);
}

function normalizeProjectRelativePath(value) {
  const raw = String(value || "").trim().replaceAll("\\", "/");
  if (!raw || raw.includes("\0") || raw.startsWith("/") || /^[A-Za-z]:\//.test(raw)) {
    throw new Error("Path must be project-relative");
  }
  const parts = [];
  for (const part of raw.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") throw new Error("Path must stay inside the project");
    parts.push(part);
  }
  if (!parts.length) throw new Error("Path must identify a project file");
  return parts.join("/");
}

function assertInside(root, target) {
  const rel = relative(root, target);
  if (rel === "") return;
  if (rel === ".." || rel.startsWith(".." + sep) || isAbsolute(rel)) {
    throw new Error("Path escapes the registered project");
  }
}

export function createPolicyEngine(initialRules = []) {
  let rules = [...initialRules];
  return {
    setRules(next) { rules = Array.isArray(next) ? [...next] : []; },
    getRules() { return [...rules]; },
    decide(input = {}) {
      const matches = rules.filter(rule => {
        if (rule.enabled === false) return false;
        for (const key of ["tool", "path", "command", "network", "mode", "action"]) {
          if (rule[key] == null) continue;
          const actual = String(input[key] ?? "");
          const expected = String(rule[key]);
          if (expected.endsWith("*")) {
            if (!actual.startsWith(expected.slice(0, -1))) return false;
          } else if (actual !== expected) return false;
        }
        return true;
      });
      const deny = matches.find(rule => rule.effect === "deny");
      const ask = matches.find(rule => rule.effect === "ask");
      const allow = matches.find(rule => rule.effect === "allow");
      const selected = deny || ask || allow;
      return {
        decision: selected?.effect || "ask",
        reason: selected?.reason || (selected ? `matched policy ${selected.id || "rule"}` : "no matching rule"),
        ruleId: selected?.id || null
      };
    }
  };
}

export function createLockManager({ now = () => Date.now(), defaultTtlMs = DEFAULT_LOCK_TTL_MS } = {}) {
  const locks = new Map();
  const prune = () => {
    const stamp = now();
    for (const [key, lock] of locks) if (lock.expiresAt <= stamp) locks.delete(key);
  };
  const keyFor = (projectId, path) => {
    const normalizedPath = normalizeProjectRelativePath(path);
    return {
      projectId: cleanId(projectId),
      path: normalizedPath,
      key: cleanId(projectId) + ":" + normalizedPath
    };
  };
  return {
    list() { prune(); return [...locks.values()]; },
    acquire({ projectId, path, owner, reason = "edit", ttlMs = defaultTtlMs }) {
      prune();
      const normalized = keyFor(projectId, path);
      const normalizedOwner = cleanId(owner, "agent");
      const current = locks.get(normalized.key);
      if (current && current.owner !== normalizedOwner) return { ok: false, conflict: current };
      const lock = {
        id: current?.id || randomUUID(),
        key: normalized.key,
        projectId: normalized.projectId,
        path: normalized.path,
        owner: normalizedOwner,
        reason: String(reason).slice(0, 240),
        acquiredAt: current?.acquiredAt || now(),
        expiresAt: now() + Math.max(5_000, Math.min(Number(ttlMs) || defaultTtlMs, 60 * 60_000))
      };
      locks.set(normalized.key, lock);
      return { ok: true, lock };
    },
    release({ projectId, path, owner, force = false }) {
      prune();
      const normalized = keyFor(projectId, path);
      const current = locks.get(normalized.key);
      if (!current) return { ok: true, released: false };
      if (!force && current.owner !== cleanId(owner, "agent")) return { ok: false, conflict: current };
      locks.delete(normalized.key);
      return { ok: true, released: true };
    }
  };
}

export function createEventStore({ stateDir }) {
  const counters = new Map();
  const memory = new Map();
  const queues = new Map();

  async function serialized(sessionId, task) {
    const id = cleanId(sessionId);
    const previous = queues.get(id) || Promise.resolve();
    let release;
    const gate = new Promise(resolveGate => { release = resolveGate; });
    const queued = previous.catch(() => {}).then(() => gate);
    queues.set(id, queued);
    await previous.catch(() => {});
    try {
      return await task(id);
    } finally {
      release();
      if (queues.get(id) === queued) queues.delete(id);
    }
  }

  async function hydrateUnlocked(sessionId) {
    if (memory.has(sessionId)) return;
    const file = join(stateDir, "shared-events", sessionId + ".jsonl");
    let rows = [];
    try {
      const body = await readFile(file, "utf8");
      rows = body.split("\n").filter(Boolean).map((line, index) => {
        try {
          return JSON.parse(line);
        } catch {
          throw new Error("Malformed canonical event log at line " + (index + 1));
        }
      });
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    let previous = 0;
    for (const row of rows) {
      if (!Number.isInteger(row?.seq) || row.seq !== previous + 1) {
        throw new Error("Canonical event log sequence is invalid");
      }
      previous = row.seq;
    }
    memory.set(sessionId, rows);
    counters.set(sessionId, previous);
  }

  async function appendUnlocked(sessionId, event = {}) {
    if (jsonBytes(event.payload) > MAX_EVENT_PAYLOAD_BYTES) throw new Error("Event payload too large");
    await hydrateUnlocked(sessionId);
    const seq = (counters.get(sessionId) || 0) + 1;
    const record = {
      version: 1,
      id: event.id || randomUUID(),
      sessionId,
      seq,
      cursor: sessionId + ":" + seq,
      type: cleanId(event.type, "event"),
      timestamp: Number(event.timestamp) || Date.now(),
      backend: event.backend ? cleanId(event.backend) : null,
      operationId: event.operationId ? cleanId(event.operationId) : null,
      parentId: event.parentId ? cleanId(event.parentId) : null,
      payload: event.payload ?? null
    };
    const dir = join(stateDir, "shared-events");
    await mkdir(dir, { recursive: true, mode: 0o700 });
    await appendFile(join(dir, sessionId + ".jsonl"), JSON.stringify(record) + "\n", { mode: 0o600 });
    memory.get(sessionId).push(record);
    counters.set(sessionId, seq);
    return record;
  }

  return {
    append(sessionId, event = {}) {
      return serialized(sessionId, id => appendUnlocked(id, event));
    },

    after(sessionId, after = 0, limit = 500) {
      return serialized(sessionId, async id => {
        await hydrateUnlocked(id);
        const seq = Number(String(after).includes(":") ? String(after).split(":").at(-1) : after) || 0;
        const events = memory.get(id)
          .filter(item => item.seq > seq)
          .slice(0, Math.max(1, Math.min(Number(limit) || 500, 2000)));
        return {
          sessionId: id,
          after: seq,
          events,
          cursor: events.at(-1)?.cursor || id + ":" + seq
        };
      });
    },

    compact(sessionId, { keepRecent = 80, backend = null, mode = "manual" } = {}) {
      return serialized(sessionId, async id => {
        await hydrateUnlocked(id);
        const source = memory.get(id);
        const protectedTypes = new Set([
          "system", "policy", "approval", "question", "microtask",
          "failure", "completion", "context.compacted"
        ]);
        const protectedEvents = source.filter(item => protectedTypes.has(item.type));
        const recent = source.slice(-Math.max(20, Math.min(Number(keepRecent) || 80, 500)));
        const unique = new Map([...protectedEvents, ...recent].map(item => [item.id, item]));
        const view = [...unique.values()].sort((a, b) => a.seq - b.seq);
        const event = await appendUnlocked(id, {
          type: "context.compacted",
          backend,
          payload: {
            sourceEvents: source.length,
            retainedEvents: view.length,
            strategy: "protected+recent",
            approximate: true,
            mode
          }
        });
        return { event, view, sourceEvents: source.length, retainedEvents: view.length };
      });
    }
  };
}

export function parseSymbols(source, extension, file = "") {
  const lines = String(source).split(/\r?\n/);
  const out = [];
  const add = (line, kind, name, signature) =>
    out.push({ file, line: line + 1, endLine: line + 1, kind, name, signature: signature.trim().slice(0, 300) });

  lines.forEach((text, index) => {
    let m;
    if ([".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx"].includes(extension)) {
      if ((m = text.match(/^\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(([^)]*)\)/))) add(index, "function", m[1], text);
      else if ((m = text.match(/^\s*(?:export\s+)?class\s+([A-Za-z_$][\w$]*)/))) add(index, "class", m[1], text);
      else if ((m = text.match(/^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\(/))) add(index, "function", m[1], text);
      else if ((m = text.match(/^\s*(?:export\s+)?(?:interface|type)\s+([A-Za-z_$][\w$]*)/))) add(index, "type", m[1], text);
    } else if (extension === ".py") {
      if ((m = text.match(/^\s*(?:async\s+)?def\s+([A-Za-z_]\w*)\s*\(/))) add(index, "function", m[1], text);
      else if ((m = text.match(/^\s*class\s+([A-Za-z_]\w*)/))) add(index, "class", m[1], text);
    } else if (extension === ".go") {
      if ((m = text.match(/^\s*func\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)\s*\(/))) add(index, "function", m[1], text);
      else if ((m = text.match(/^\s*type\s+([A-Za-z_]\w*)\s+(?:struct|interface)/))) add(index, "type", m[1], text);
    } else if (extension === ".rs") {
      if ((m = text.match(/^\s*(?:pub\s+)?(?:async\s+)?fn\s+([A-Za-z_]\w*)\s*\(/))) add(index, "function", m[1], text);
      else if ((m = text.match(/^\s*(?:pub\s+)?(?:struct|enum|trait)\s+([A-Za-z_]\w*)/))) add(index, "type", m[1], text);
    } else {
      if ((m = text.match(/^\s*(?:public\s+|private\s+|protected\s+)?(?:class|interface|enum)\s+([A-Za-z_]\w*)/))) add(index, "type", m[1], text);
    }
  });
  return out;
}

const structuralCache = new Map();

async function secureSourceFile(projectRoot, candidate) {
  const root = await realpath(projectRoot);
  const lexical = resolve(candidate);
  assertInside(root, lexical);
  const before = await lstat(lexical);
  if (before.isSymbolicLink() || !before.isFile()) throw new Error("Structural search source is not a regular file");
  const actual = await realpath(lexical);
  assertInside(root, actual);

  const flags = FS_CONSTANTS.O_RDONLY | (FS_CONSTANTS.O_NOFOLLOW || 0);
  const handle = await open(actual, flags);
  try {
    const info = await handle.stat();
    if (!info.isFile()) throw new Error("Structural search source changed type");
    const current = await realpath(lexical);
    assertInside(root, current);
    if (current !== actual) throw new Error("Structural search source changed during validation");
    if (info.size > MAX_INDEX_FILE_BYTES) return null;
    const source = await handle.readFile("utf8");
    return { root, actual, info, source };
  } finally {
    await handle.close();
  }
}

async function walkProjectFiles(projectRoot) {
  const root = await realpath(projectRoot);
  const files = [];

  async function walk(dir) {
    if (files.length >= MAX_INDEX_FILES) return;
    const actualDir = await realpath(dir);
    assertInside(root, actualDir);
    let entries = [];
    try { entries = await readdir(actualDir, { withFileTypes: true }); } catch { return; }

    for (const entry of entries) {
      if (files.length >= MAX_INDEX_FILES) break;
      if (entry.isSymbolicLink()) continue;
      const full = join(actualDir, entry.name);
      if (entry.isDirectory()) {
        if (!IGNORE_DIRS.has(entry.name)) await walk(full);
        continue;
      }
      if (!entry.isFile() || !SOURCE_EXTENSIONS.has(extname(entry.name).toLowerCase())) continue;
      try {
        const info = await lstat(full);
        if (!info.isFile() || info.isSymbolicLink() || info.size > MAX_INDEX_FILE_BYTES) continue;
        const actual = await realpath(full);
        assertInside(root, actual);
        files.push({
          full,
          actual,
          rel: relative(root, actual).split(sep).join("/"),
          size: info.size,
          mtimeMs: info.mtimeMs
        });
      } catch {
        // A changed/unavailable entry is omitted from this bounded scan.
      }
    }
  }

  await walk(root);
  return { root, files };
}

export async function structuralSearch(projectRoot, query, { limit = 50 } = {}) {
  const needle = String(query || "").trim().toLowerCase();
  if (!needle) {
    return {
      query: needle,
      symbols: [],
      filesScanned: 0,
      parser: "lightweight-structural-v2",
      fallback: "repo-map/full-text",
      incremental: true
    };
  }

  const { root, files } = await walkProjectFiles(projectRoot);
  let cache = structuralCache.get(root);
  if (!cache) {
    cache = new Map();
    structuralCache.set(root, cache);
  }
  const live = new Set(files.map(item => item.rel));
  for (const key of cache.keys()) if (!live.has(key)) cache.delete(key);

  const matches = [];
  for (const file of files) {
    let indexed = cache.get(file.rel);
    if (!indexed || indexed.size !== file.size || indexed.mtimeMs !== file.mtimeMs) {
      let secured;
      try { secured = await secureSourceFile(root, file.full); } catch { continue; }
      if (!secured) continue;
      indexed = {
        size: secured.info.size,
        mtimeMs: secured.info.mtimeMs,
        symbols: parseSymbols(secured.source, extname(file.rel).toLowerCase(), file.rel)
      };
      cache.set(file.rel, indexed);
    }

    for (const symbol of indexed.symbols) {
      if (
        symbol.name.toLowerCase().includes(needle) ||
        symbol.signature.toLowerCase().includes(needle)
      ) {
        matches.push(symbol);
      }
      if (matches.length >= limit) break;
    }
    if (matches.length >= limit) break;
  }

  return {
    query: needle,
    symbols: matches,
    filesScanned: files.length,
    parser: "lightweight-structural-v2",
    fallback: "repo-map/full-text",
    incremental: true
  };
}

function defaultCatalog() {
  return [
    {
      id: "core.markdown",
      name: "Safe Markdown",
      version: "1.0.0",
      source: "devmoter-core",
      signed: true,
      permissions: ["transcript:render"],
      builtin: true
    },
    {
      id: "core.structural-search",
      name: "Structural Search",
      version: "1.0.0",
      source: "devmoter-core",
      signed: true,
      permissions: ["project:read"],
      builtin: true
    }
  ];
}

export function createSharedControlPlane({ stateDir, resolveProject, policyRules = [], compactBackend = async () => ({ supported: false }), inspectContext = async () => ({}) }) {
  const policy = createPolicyEngine(policyRules);
  const locks = createLockManager();
  const events = createEventStore({ stateDir });
  const settingsFile = join(stateDir, "shared-control-plane.json");
  const microtasksFile = join(stateDir, "shared-microtasks.json");
  const auditFile = join(stateDir, "shared-policy-audit.jsonl");
  const deployAdapters = new Map();

  async function settings() {
    return readJsonFile(settingsFile, {
      extensions: {},
      policyRules,
      context: { threshold: 0.82, maxTokens: 128000 }
    });
  }

  async function saveSettings(next) {
    await writeJsonFile(settingsFile, next);
    policy.setRules(next.policyRules || []);
    return next;
  }

  async function audit(input, decision) {
    await mkdir(stateDir, { recursive: true, mode: 0o700 });
    await appendFile(
      auditFile,
      `${JSON.stringify({ at: Date.now(), input, ...decision })}\n`,
      { mode: 0o600 }
    );
  }

  return {
    policy,
    locks,
    events,

    async getOverview() {
      const current = await settings();
      policy.setRules(current.policyRules || []);
      return {
        version: 1,
        extensions: {
          catalog: defaultCatalog(),
          installed: current.extensions || {}
        },
        policyRules: policy.getRules(),
        locks: locks.list(),
        context: current.context || {},
        deploymentAdapters: [...deployAdapters.values()].map(({ run, ...manifest }) => manifest)
      };
    },

    async decide(input) {
      const result = policy.decide(input);
      await audit(input, result);
      return result;
    },

    async updatePolicy(rules) {
      const current = await settings();
      current.policyRules = Array.isArray(rules) ? rules : [];
      await saveSettings(current);
      return current.policyRules;
    },

    async installExtension(id) {
      const item = defaultCatalog().find(entry => entry.id === id);
      if (!item) throw new Error("Extension is not in the approved catalog");
      if (!item.signed) throw new Error("Unsigned extension blocked by policy");
      const current = await settings();
      current.extensions[id] = {
        version: item.version,
        installedAt: Date.now(),
        permissions: item.permissions
      };
      await saveSettings(current);
      return current.extensions[id];
    },

    async removeExtension(id) {
      const current = await settings();
      delete current.extensions[id];
      await saveSettings(current);
      return { ok: true };
    },

    registerDeploymentAdapter(manifest, run) {
      if (!manifest?.id || typeof run !== "function") throw new Error("Invalid deployment adapter");
      deployAdapters.set(String(manifest.id), { ...manifest, run });
    },

    async previewDeployment({ adapterId, projectId, environment }) {
      const adapter = deployAdapters.get(String(adapterId));
      if (!adapter) throw new Error("Deployment adapter not installed");
      const project = await resolveProject(projectId);
      return {
        adapter: {
          id: adapter.id,
          name: adapter.name,
          permissions: adapter.permissions || [],
          credentials: adapter.credentials || []
        },
        project: { id: project.id, name: project.name },
        environment: String(environment || "preview"),
        automatic: false
      };
    },

    async deploy(input) {
      const adapter = deployAdapters.get(String(input.adapterId));
      if (!adapter) throw new Error("Deployment adapter not installed");
      const decision = await this.decide({
        action: "deploy",
        tool: `deploy:${adapter.id}`,
        mode: "explicit"
      });
      if (decision.decision !== "allow") {
        return {
          ok: false,
          approvalRequired: decision.decision === "ask",
          decision
        };
      }
      const project = await resolveProject(input.projectId);
      return adapter.run({
        project,
        environment: String(input.environment || "preview"),
        input
      });
    },

    async listMicrotasks(parentId) {
      const all = await readJsonFile(microtasksFile, {});
      return all[cleanId(parentId)] || null;
    },

    async saveMicrotasks(parentId, value) {
      const all = await readJsonFile(microtasksFile, {});
      all[cleanId(parentId)] = {
        ...value,
        parentId: cleanId(parentId),
        updatedAt: Date.now()
      };
      await writeJsonFile(microtasksFile, all);
      return all[cleanId(parentId)];
    },

    async updateContextSettings(input = {}) {
      const current = await settings();
      const threshold = Number(input.threshold);
      const maxTokens = Number(input.maxTokens);
      current.context = {
        threshold: Number.isFinite(threshold)
          ? Math.min(0.95, Math.max(0.5, threshold))
          : Number(current.context?.threshold || 0.82),
        maxTokens: Number.isFinite(maxTokens)
          ? Math.min(2_000_000, Math.max(8_000, Math.floor(maxTokens)))
          : Number(current.context?.maxTokens || 128000)
      };
      await saveSettings(current);
      return current.context;
    },

    async contextStatus({ backend, sessionId } = {}) {
      const current = await settings();
      const normalizedBackend = String(backend || "");
      const normalizedSession = cleanId(sessionId);
      if (!["codex", "opencode"].includes(normalizedBackend)) {
        throw new Error("backend must be codex or opencode");
      }
      if (!normalizedSession || normalizedSession === "default") throw new Error("sessionId is required");
      const telemetry = await inspectContext(normalizedBackend, normalizedSession);
      const tokens = Number(telemetry?.tokens);
      const maxTokens = Number(current.context?.maxTokens || 128000);
      return {
        backend: normalizedBackend,
        sessionId: normalizedSession,
        tokens: Number.isFinite(tokens) && tokens >= 0 ? tokens : 0,
        approximate: telemetry?.tokensApproximate !== false,
        maxTokens,
        threshold: Number(current.context?.threshold || 0.82),
        ratio: Number.isFinite(tokens) && maxTokens > 0 ? Math.min(1, Math.max(0, tokens / maxTokens)) : 0,
        status: telemetry?.status || "unknown",
        active: Boolean(telemetry?.active)
      };
    },

    async compactSession(input = {}) {
      const sessionId = cleanId(input.sessionId);
      const backend = String(input.backend || "");
      if (!["codex", "opencode"].includes(backend)) throw new Error("backend must be codex or opencode");
      const backendResult = await compactBackend({
        backend,
        sessionId,
        mode: String(input.mode || "manual")
      });
      if (backendResult?.ok === false) {
        throw new Error(String(backendResult.error || "Backend compaction failed"));
      }
      const compacted = await events.compact(sessionId, {
        keepRecent: input.keepRecent,
        backend,
        mode: String(input.mode || "manual")
      });
      return { backend, backendResult, ...compacted };
    },

    async structuralSearch(projectId, query) {
      const project = await resolveProject(projectId);
      return structuralSearch(project.path, query);
    }
  };
}

async function readRequestJson(req, limit = 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error("Request body too large");
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function sendJson(res, status, body) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  res.end(JSON.stringify(body));
}

export async function handleSharedControlPlaneRequest(req, res, url, control) {
  const path = url.pathname;
  if (path !== "/api/shared-control" && !path.startsWith("/api/shared-control/")) return false;

  try {
    if (req.method === "GET" && path === "/api/shared-control") {
      sendJson(res, 200, await control.getOverview());
      return true;
    }

    if (req.method === "POST" && path === "/api/shared-control/policy/decide") {
      sendJson(res, 200, await control.decide(await readRequestJson(req)));
      return true;
    }

    if (req.method === "PUT" && path === "/api/shared-control/policy") {
      const payload = await readRequestJson(req);
      sendJson(res, 200, { rules: await control.updatePolicy(payload.rules) });
      return true;
    }

    if (req.method === "PUT" && path === "/api/shared-control/context") {
      sendJson(res, 200, { context: await control.updateContextSettings(await readRequestJson(req)) });
      return true;
    }

    if (req.method === "GET" && path === "/api/shared-control/context/status") {
      sendJson(res, 200, await control.contextStatus({
        backend: url.searchParams.get("backend"),
        sessionId: url.searchParams.get("sessionId")
      }));
      return true;
    }

    const extension = path.match(/^\/api\/control\/extensions\/([^/]+)$/);
    if (extension && req.method === "POST") {
      sendJson(
        res,
        200,
        { installed: await control.installExtension(decodeURIComponent(extension[1])) }
      );
      return true;
    }
    if (extension && req.method === "DELETE") {
      sendJson(res, 200, await control.removeExtension(decodeURIComponent(extension[1])));
      return true;
    }

    if (req.method === "GET" && path === "/api/shared-control/locks") {
      sendJson(res, 200, { locks: control.locks.list() });
      return true;
    }

    if (req.method === "POST" && path === "/api/shared-control/locks/acquire") {
      const result = control.locks.acquire(await readRequestJson(req));
      sendJson(res, result.ok ? 200 : 409, result);
      return true;
    }

    if (req.method === "POST" && path === "/api/shared-control/locks/release") {
      const result = control.locks.release(await readRequestJson(req));
      sendJson(res, result.ok ? 200 : 409, result);
      return true;
    }

    if (req.method === "GET" && path === "/api/shared-control/events") {
      const sessionId = url.searchParams.get("sessionId") || "default";
      const after = url.searchParams.get("after") || 0;
      const limit = url.searchParams.get("limit") || 500;
      sendJson(res, 200, await control.events.after(sessionId, after, limit));
      return true;
    }

    if (req.method === "POST" && path === "/api/shared-control/events") {
      const payload = await readRequestJson(req, MAX_EVENT_PAYLOAD_BYTES + 16 * 1024);
      const sessionId = payload.sessionId || "default";
      sendJson(
        res,
        201,
        { event: await control.events.append(sessionId, payload.event || payload) }
      );
      return true;
    }

    if (req.method === "POST" && path === "/api/shared-control/events/compact") {
      const payload = await readRequestJson(req);
      sendJson(res, 200, await control.compactSession(payload));
      return true;
    }

    if (req.method === "GET" && path === "/api/shared-control/microtasks") {
      const parentId = url.searchParams.get("parentId") || "default";
      sendJson(res, 200, { plan: await control.listMicrotasks(parentId) });
      return true;
    }

    if (req.method === "PUT" && path === "/api/shared-control/microtasks") {
      const payload = await readRequestJson(req);
      const plan = await control.saveMicrotasks(payload.parentId || "default", {
        title: String(payload.title || "Task"),
        current: Math.max(0, Number(payload.current) || 0),
        status: String(payload.status || "running"),
        steps: Array.isArray(payload.steps)
          ? payload.steps.map((step, index) => ({
              id: cleanId(step?.id, `step-${index + 1}`),
              title: String(step?.title || `Step ${index + 1}`).slice(0, 180),
              verification: String(step?.verification || "").slice(0, 1000),
              status: ["pending", "running", "waiting", "done", "failed", "stopped"].includes(String(step?.status))
                ? String(step.status)
                : "pending"
            }))
          : []
      });
      sendJson(res, 200, { plan });
      return true;
    }

    if (req.method === "GET" && path === "/api/shared-control/search/symbols") {
      const projectId = url.searchParams.get("projectId");
      const query = url.searchParams.get("q");
      if (!projectId) throw new Error("projectId is required");
      sendJson(res, 200, await control.structuralSearch(projectId, query));
      return true;
    }

    if (req.method === "POST" && path === "/api/shared-control/deploy/preview") {
      sendJson(res, 200, await control.previewDeployment(await readRequestJson(req)));
      return true;
    }

    if (req.method === "POST" && path === "/api/shared-control/deploy") {
      const result = await control.deploy(await readRequestJson(req));
      sendJson(res, result.ok === false ? 403 : 200, result);
      return true;
    }

    sendJson(res, 404, { error: "Unknown control-plane endpoint" });
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = message === "Request body too large" ? 413 : 400;
    sendJson(res, status, { error: message });
    return true;
  }
}


export const sharedControlInternals = {
  normalizeProjectRelativePath,
  secureSourceFile
};
