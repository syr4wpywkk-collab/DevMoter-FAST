import { appendFile, lstat, mkdir, readFile, readdir, realpath, stat, writeFile } from "node:fs/promises";
import { extname, isAbsolute, join, normalize, relative, resolve, sep } from "node:path";
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
  try { return JSON.parse(await readFile(path, "utf8")); } catch { return fallback; }
}

async function writeJsonFile(path, value) {
  await mkdir(resolve(path, ".."), { recursive: true, mode: 0o700 });
  await writeFile(path, JSON.stringify(value, null, 2), { mode: 0o600 });
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

function normalizeLockPath(value) {
  const raw = String(value || "").replaceAll("\\", "/");
  if (raw.includes("\0") || isAbsolute(raw)) throw new Error("Lock path must be project-relative");
  const path = normalize(raw).replaceAll("\\", "/").replace(/^\.\//, "");
  if (!path || path === "." || path === ".." || path.startsWith("../")) {
    throw new Error("Lock path must identify a file inside the project");
  }
  return path;
}

export function createLockManager({ now = () => Date.now(), defaultTtlMs = DEFAULT_LOCK_TTL_MS } = {}) {
  const locks = new Map();
  const prune = () => {
    const stamp = now();
    for (const [key, lock] of locks) if (lock.expiresAt <= stamp) locks.delete(key);
  };
  return {
    list() { prune(); return [...locks.values()]; },
    acquire({ projectId, path, owner, reason = "edit", ttlMs = defaultTtlMs }) {
      prune();
      const normalizedPath = normalizeLockPath(path);
      const key = `${cleanId(projectId)}:${normalizedPath}`;
      const current = locks.get(key);
      if (current && current.owner !== owner) return { ok: false, conflict: current };
      const lock = {
        id: randomUUID(),
        key,
        projectId: cleanId(projectId),
        path: normalizedPath,
        owner: cleanId(owner, "agent"),
        reason: String(reason),
        acquiredAt: now(),
        expiresAt: now() + Math.max(5_000, Math.min(Number(ttlMs) || defaultTtlMs, 60 * 60_000))
      };
      locks.set(key, lock);
      return { ok: true, lock };
    },
    release({ projectId, path, owner, force = false }) {
      prune();
      const normalizedPath = normalizeLockPath(path);
      const key = `${cleanId(projectId)}:${normalizedPath}`;
      const current = locks.get(key);
      if (!current) return { ok: true, released: false };
      if (!force && current.owner !== cleanId(owner, "agent")) return { ok: false, conflict: current };
      locks.delete(key);
      return { ok: true, released: true };
    }
  };
}

export function createEventStore({ stateDir }) {
  const counters = new Map();
  const memory = new Map();
  const queues = new Map();

  async function hydrate(sessionId) {
    if (memory.has(sessionId)) return;
    const file = join(stateDir, "events", `${cleanId(sessionId)}.jsonl`);
    let rows = [];
    try {
      rows = (await readFile(file, "utf8")).split("\n").filter(Boolean).map(line => JSON.parse(line));
    } catch {}
    memory.set(sessionId, rows);
    counters.set(sessionId, rows.at(-1)?.seq || 0);
  }

  function serialize(sessionId, task) {
    const previous = queues.get(sessionId) || Promise.resolve();
    const next = previous.catch(() => {}).then(task);
    queues.set(sessionId, next);
    return next.finally(() => {
      if (queues.get(sessionId) === next) queues.delete(sessionId);
    });
  }

  async function waitForWrites(sessionId) {
    const pending = queues.get(sessionId);
    if (pending) await pending.catch(() => {});
  }

  async function appendUnlocked(sessionId, event = {}) {
    if (jsonBytes(event.payload) > MAX_EVENT_PAYLOAD_BYTES) throw new Error("Event payload too large");
    await hydrate(sessionId);
    const seq = (counters.get(sessionId) || 0) + 1;
    counters.set(sessionId, seq);
    const record = {
      version: 1,
      id: event.id || randomUUID(),
      sessionId,
      seq,
      cursor: `${sessionId}:${seq}`,
      type: cleanId(event.type, "event"),
      timestamp: Number(event.timestamp) || Date.now(),
      backend: event.backend ? cleanId(event.backend) : null,
      operationId: event.operationId ? cleanId(event.operationId) : null,
      parentId: event.parentId ? cleanId(event.parentId) : null,
      payload: event.payload ?? null
    };
    memory.get(sessionId).push(record);
    const dir = join(stateDir, "events");
    await mkdir(dir, { recursive: true, mode: 0o700 });
    await appendFile(join(dir, `${sessionId}.jsonl`), `${JSON.stringify(record)}\n`, { mode: 0o600 });
    return record;
  }

  return {
    append(sessionId, event = {}) {
      sessionId = cleanId(sessionId);
      return serialize(sessionId, () => appendUnlocked(sessionId, event));
    },

    async after(sessionId, after = 0, limit = 500) {
      sessionId = cleanId(sessionId);
      await waitForWrites(sessionId);
      await hydrate(sessionId);
      const seq = Number(String(after).includes(":") ? String(after).split(":").at(-1) : after) || 0;
      const events = memory.get(sessionId)
        .filter(item => item.seq > seq)
        .slice(0, Math.max(1, Math.min(Number(limit) || 500, 2000)));
      return {
        sessionId,
        after: seq,
        events,
        cursor: events.at(-1)?.cursor || `${sessionId}:${seq}`
      };
    },

    compact(sessionId, { keepRecent = 80 } = {}) {
      sessionId = cleanId(sessionId);
      return serialize(sessionId, async () => {
        await hydrate(sessionId);
        const source = [...memory.get(sessionId)];
        const protectedTypes = new Set(["system", "policy", "approval", "question", "microtask", "failure", "completion"]);
        const protectedEvents = source.filter(item => protectedTypes.has(item.type));
        const recent = source.slice(-Math.max(20, Math.min(Number(keepRecent) || 80, 500)));
        const unique = new Map([...protectedEvents, ...recent].map(item => [item.id, item]));
        const view = [...unique.values()].sort((a, b) => a.seq - b.seq);
        const event = await appendUnlocked(sessionId, {
          type: "compaction",
          payload: {
            sourceEvents: source.length,
            retainedEvents: view.length,
            strategy: "protected+recent",
            approximate: true
          }
        });
        return { event, view };
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

async function walkProjectFiles(rootInput) {
  const root = await realpath(rootInput);
  const files = [];
  async function walk(dir) {
    if (files.length >= MAX_INDEX_FILES) return;
    let entries = [];
    try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (files.length >= MAX_INDEX_FILES) break;
      if (entry.isSymbolicLink()) continue;
      const full = join(dir, entry.name);
      try {
        const info = await lstat(full);
        if (info.isSymbolicLink()) continue;
        if (info.isDirectory()) {
          if (!IGNORE_DIRS.has(entry.name)) await walk(full);
        } else if (info.isFile() && SOURCE_EXTENSIONS.has(extname(entry.name).toLowerCase()) && info.size <= MAX_INDEX_FILE_BYTES) {
          const actual = await realpath(full);
          const rel = relative(root, actual);
          if (!rel.startsWith("..") && !isAbsolute(rel)) files.push(actual);
        }
      } catch {}
    }
  }
  await walk(root);
  return { root, files };
}

export async function structuralSearch(projectRoot, query, { limit = 50 } = {}) {
  const root = await realpath(projectRoot);
  const needle = String(query || "").trim().toLowerCase();
  if (!needle) {
    return { query: needle, symbols: [], filesScanned: 0, parser: "lightweight-structural-v1" };
  }

  const walked = await walkProjectFiles(root);
  const files = walked.files;
  const matches = [];
  for (const full of files) {
    let source = "";
    let rel = "";
    let actual = "";
    try {
      const entry = await lstat(full);
      if (entry.isSymbolicLink() || !entry.isFile()) continue;
      actual = await realpath(full);
      rel = relative(walked.root, actual).split(sep).join("/");
      if (!rel || rel.startsWith("..") || isAbsolute(rel)) continue;
      const info = await stat(actual);
      if (!info.isFile() || info.size > MAX_INDEX_FILE_BYTES) continue;
      source = await readFile(actual, "utf8");
    } catch { continue; }
    for (const symbol of parseSymbols(source, extname(actual).toLowerCase(), rel)) {
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
    parser: "lightweight-structural-v1",
    fallback: "repo-map/full-text"
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

export function createControlPlane({ stateDir, resolveProject, policyRules = [] }) {
  const policy = createPolicyEngine(policyRules);
  const locks = createLockManager();
  const events = createEventStore({ stateDir });
  const settingsFile = join(stateDir, "control-plane.json");
  const microtasksFile = join(stateDir, "microtasks.json");
  const auditFile = join(stateDir, "policy-audit.jsonl");
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

export async function handleControlPlaneRequest(req, res, url, control) {
  const path = url.pathname;
  if (path !== "/api/control" && !path.startsWith("/api/control/")) return false;

  try {
    if (req.method === "GET" && path === "/api/control") {
      sendJson(res, 200, await control.getOverview());
      return true;
    }

    if (req.method === "POST" && path === "/api/control/policy/decide") {
      sendJson(res, 200, await control.decide(await readRequestJson(req)));
      return true;
    }

    if (req.method === "PUT" && path === "/api/control/policy") {
      const payload = await readRequestJson(req);
      sendJson(res, 200, { rules: await control.updatePolicy(payload.rules) });
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

    if (req.method === "GET" && path === "/api/control/locks") {
      sendJson(res, 200, { locks: control.locks.list() });
      return true;
    }

    if (req.method === "POST" && path === "/api/control/locks/acquire") {
      const result = control.locks.acquire(await readRequestJson(req));
      sendJson(res, result.ok ? 200 : 409, result);
      return true;
    }

    if (req.method === "POST" && path === "/api/control/locks/release") {
      const result = control.locks.release(await readRequestJson(req));
      sendJson(res, result.ok ? 200 : 409, result);
      return true;
    }

    if (req.method === "GET" && path === "/api/control/events") {
      const sessionId = url.searchParams.get("sessionId") || "default";
      const after = url.searchParams.get("after") || 0;
      const limit = url.searchParams.get("limit") || 500;
      sendJson(res, 200, await control.events.after(sessionId, after, limit));
      return true;
    }

    if (req.method === "POST" && path === "/api/control/events") {
      const payload = await readRequestJson(req, MAX_EVENT_PAYLOAD_BYTES + 16 * 1024);
      const sessionId = payload.sessionId || "default";
      sendJson(
        res,
        201,
        { event: await control.events.append(sessionId, payload.event || payload) }
      );
      return true;
    }

    if (req.method === "POST" && path === "/api/control/events/compact") {
      const payload = await readRequestJson(req);
      sendJson(
        res,
        200,
        await control.events.compact(payload.sessionId || "default", payload)
      );
      return true;
    }

    if (req.method === "GET" && path === "/api/control/microtasks") {
      const parentId = url.searchParams.get("parentId") || "default";
      sendJson(res, 200, { plan: await control.listMicrotasks(parentId) });
      return true;
    }

    if (req.method === "PUT" && path === "/api/control/microtasks") {
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

    if (req.method === "GET" && path === "/api/control/search/symbols") {
      const projectId = url.searchParams.get("projectId");
      const query = url.searchParams.get("q");
      if (!projectId) throw new Error("projectId is required");
      sendJson(res, 200, await control.structuralSearch(projectId, query));
      return true;
    }

    if (req.method === "POST" && path === "/api/control/deploy/preview") {
      sendJson(res, 200, await control.previewDeployment(await readRequestJson(req)));
      return true;
    }

    if (req.method === "POST" && path === "/api/control/deploy") {
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
