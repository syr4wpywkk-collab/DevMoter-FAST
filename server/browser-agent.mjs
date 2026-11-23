import { createHash, randomBytes, randomUUID } from "node:crypto";
import { appendFile, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { isLoopbackAddress, isLoopbackHost } from "./auth.mjs";
import { BROWSER_ACT_ACTIONS, BROWSER_READ_ACTIONS } from "./browser-session.mjs";

export const BROWSER_AGENT_CAPABILITIES = Object.freeze(["browser.read", "browser.act"]);
export const BROWSER_AGENT_TOKEN_PREFIX = "dmba_";
export const DEFAULT_AGENT_TOKEN_TTL_MS = 30 * 60 * 1000;
export const MAX_AGENT_TOKEN_TTL_MS = 2 * 60 * 60 * 1000;
export const MAX_MANUAL_TOKEN_TTL_MS = 60 * 60 * 1000;
const MAX_LIVE_TOKENS = 64;
const MAX_BODY_BYTES = 64 * 1024;
const TOKEN_PATTERN = /^dmba_[0-9a-f]{64}$/;
const ACTION_CLASS = new Map([
  ...BROWSER_READ_ACTIONS.map(type => [type, "browser.read"]),
  ...BROWSER_ACT_ACTIONS.map(type => [type, "browser.act"])
]);
// Built-in decisions used when no workspace policy rule matches.
const DEFAULT_DECISIONS = Object.freeze({ "browser.read": "allow", "browser.act": "allow" });

function httpError(message, statusCode, code) {
  return Object.assign(new Error(message), { statusCode, code });
}

function hashToken(token) {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function capabilitiesForAccess(access) {
  if (access === "act") return ["browser.read", "browser.act"];
  if (access === "read") return ["browser.read"];
  return [];
}

/** The policy class of a browser action type: browser.read, browser.act or browser.evaluate (always denied). */
export function browserActionClass(type) {
  return ACTION_CLASS.get(String(type || "")) || "browser.evaluate";
}

/**
 * Short-lived agent tokens for the browser MCP. Only a SHA-256 hash is kept,
 * in memory: a host restart revokes every token. Each token is bound to one
 * project, a capability set, an optional Agent Run and the issuing device.
 */
// An Agent Run with no device owns its sessions as that agent; it never shares a device's.
export function browserAgentOwner(record) {
  return record?.deviceId ? undefined : "agent:" + (record?.runId || record?.id);
}

// Revoking a token ends what it was doing, not just future requests.
export function bindBrowserAgentRevocation(tokens, getManager) {
  return tokens.onRevoke(record => {
    const manager = getManager();
    if (typeof manager?.revokeAgent !== "function") return;
    void Promise.resolve(manager.revokeAgent({
      projectId: record.projectId,
      agentId: browserAgentOwner(record) ?? null,
      deviceId: record.deviceId ?? null,
      tokenId: record.id
    })).catch(() => {});
  });
}

export function createBrowserAgentTokens({ now = Date.now, maxLive = MAX_LIVE_TOKENS } = {}) {
  const records = new Map();
  const listeners = new Set();

  function prune() {
    const current = now();
    for (const [hash, record] of records) {
      if (record.expiresAt <= current) {
        records.delete(hash);
        for (const listener of listeners) listener(record, "expired");
      }
    }
  }

  function issue({ projectId, capabilities, runId = null, deviceId = null, ttlMs = DEFAULT_AGENT_TOKEN_TTL_MS, label = "" } = {}) {
    prune();
    const project = String(projectId || "").trim();
    if (!project) throw httpError("A registered project is required", 400, "project_required");
    const caps = [...new Set((Array.isArray(capabilities) ? capabilities : []).map(String))];
    if (!caps.length || caps.some(cap => !BROWSER_AGENT_CAPABILITIES.includes(cap))) {
      throw httpError("Browser capabilities must be browser.read and/or browser.act", 400, "invalid_capabilities");
    }
    if (caps.includes("browser.act") && !caps.includes("browser.read")) caps.unshift("browser.read");
    const ttl = Math.min(Math.max(Math.floor(Number(ttlMs) || DEFAULT_AGENT_TOKEN_TTL_MS), 1000), MAX_AGENT_TOKEN_TTL_MS);
    if (records.size >= maxLive) throw httpError("Too many browser agent tokens are active", 429, "token_limit");
    const token = BROWSER_AGENT_TOKEN_PREFIX + randomBytes(32).toString("hex");
    const record = {
      id: randomUUID(),
      projectId: project,
      capabilities: Object.freeze(caps),
      runId: runId ? String(runId) : null,
      deviceId: deviceId ? String(deviceId) : null,
      label: String(label || "").slice(0, 80),
      issuedAt: now(),
      expiresAt: now() + ttl,
      sessionId: null,
      startedSessionId: null
    };
    records.set(hashToken(token), record);
    return { token, record: publicRecord(record) };
  }

  function verify(token) {
    if (typeof token !== "string" || !TOKEN_PATTERN.test(token)) return null;
    prune();
    return records.get(hashToken(token)) || null;
  }

  function revokeWhere(predicate, reason) {
    let count = 0;
    for (const [hash, record] of records) {
      if (!predicate(record)) continue;
      records.delete(hash);
      count += 1;
      for (const listener of listeners) listener(record, reason);
    }
    return count;
  }

  function publicRecord(record) {
    return {
      id: record.id,
      projectId: record.projectId,
      capabilities: [...record.capabilities],
      runId: record.runId,
      label: record.label,
      issuedAt: record.issuedAt,
      expiresAt: record.expiresAt
    };
  }

  return {
    issue,
    verify,
    publicRecord,
    revoke: (id, reason = "revoked") => revokeWhere(record => record.id === id, reason),
    revokeRun: (runId, reason = "run_ended") => revokeWhere(record => record.runId === String(runId), reason),
    revokeDevice: (deviceId, reason = "device_revoked") => revokeWhere(record => record.deviceId === deviceId, reason),
    revokeProject: (projectId, reason = "project_changed") => revokeWhere(record => record.projectId === String(projectId), reason),
    revokeAll: (reason = "shutdown") => revokeWhere(() => true, reason),
    list: ({ deviceId } = {}) => {
      prune();
      return [...records.values()].filter(record => deviceId === undefined || record.deviceId === deviceId).map(publicRecord);
    },
    onRevoke(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    get size() { prune(); return records.size; }
  };
}

function safePath(url) {
  try {
    const parsed = new URL(String(url || ""), "http://preview.invalid");
    return parsed.pathname.slice(0, 200);
  } catch {
    return null;
  }
}

/**
 * The only action fields that reach the audit log. Typed text, selectors,
 * query strings and fragments can carry passwords or tokens and are never
 * recorded; only their shape is.
 */
export function auditActionDetail(action) {
  if (!action || typeof action !== "object") return {};
  const type = String(action.type || "").slice(0, 40);
  switch (type) {
    case "navigate": return { type, path: safePath(action.url) };
    case "click": return { type, by: action.selector ? "selector" : "point" };
    case "type": return { type, length: typeof action.text === "string" ? action.text.length : 0 };
    case "press": return { type, key: /^[A-Za-z]{1,20}$/.test(String(action.key || "")) ? String(action.key) : "other" };
    case "scroll": return { type };
    default: return { type };
  }
}

/** Append-only JSONL audit of browser starts, stops, driver changes and actions (0600). */
export function createBrowserAudit({ filePath, now = Date.now, onError = () => {} } = {}) {
  let chain = Promise.resolve();
  const ALLOWED = ["actor", "event", "projectId", "sessionId", "deviceId", "tokenId", "runId", "capability", "decision", "ok", "code", "driverGeneration", "reason", "transport"];
  function record(entry = {}) {
    const line = { at: now() };
    for (const key of ALLOWED) {
      const value = entry[key];
      if (value === undefined || value === null) continue;
      line[key] = typeof value === "string" ? value.slice(0, 120) : value;
    }
    if (entry.action) line.action = auditActionDetail(entry.action);
    if (!filePath) return Promise.resolve();
    chain = chain
      .then(async () => {
        await mkdir(join(filePath, ".."), { recursive: true, mode: 0o700 });
        await appendFile(filePath, JSON.stringify(line) + "\n", { mode: 0o600 });
      })
      .catch(error => onError(error));
    return chain;
  }
  return { record, flush: () => chain };
}

/**
 * Decides one agent browser action: token capability first, then workspace
 * policy rules (tool "browser", action "browser.read" | "browser.act"), then
 * the built-in defaults. "ask" cannot be answered by an agent, so it denies.
 */
export function decideBrowserAction({ record, type, decide }) {
  const capability = browserActionClass(type);
  if (capability === "browser.evaluate") {
    return { capability, decision: "deny", code: "action_denied", reason: "Arbitrary script evaluation and unknown actions are never allowed" };
  }
  if (!record.capabilities.includes(capability)) {
    return { capability, decision: "deny", code: "capability_denied", reason: `This agent token does not grant ${capability}` };
  }
  if (typeof decide !== "function") return { capability, decision: DEFAULT_DECISIONS[capability] || "deny" };
  let policy;
  try {
    policy = decide({ tool: "browser", action: capability, mode: "agent" });
  } catch {
    return { capability, decision: "deny", code: "policy_error", reason: "Workspace policy could not be evaluated" };
  }
  // Only a policy that says it matched nothing falls back to the defaults;
  // an explicit deny/ask is honored and anything unrecognized fails closed.
  const noMatch = policy === null || policy === undefined ||
    (typeof policy === "object" && policy.matched === false && !policy.ruleId);
  if (noMatch) return { capability, decision: DEFAULT_DECISIONS[capability] || "deny" };
  if (typeof policy !== "object" || !["allow", "deny", "ask"].includes(policy.decision)) {
    return { capability, decision: "deny", code: "policy_invalid", reason: "Workspace policy returned an unrecognized decision" };
  }
  if (policy.decision === "allow") return { capability, decision: "allow", ruleId: policy.ruleId };
  return {
    capability,
    decision: "deny",
    ruleId: policy.ruleId,
    code: policy.decision === "ask" ? "approval_unavailable" : "policy_denied",
    reason: policy.decision === "ask" ? `${capability} requires approval, which agents cannot request` : `${capability} is denied by workspace policy`
  };
}

function sendJson(res, status, value) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(value));
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw httpError("Request body is too large", 413, "body_too_large");
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("not an object");
    return value;
  } catch {
    throw httpError("Request body must be a JSON object", 400, "invalid_json");
  }
}

function bearerToken(req) {
  const match = /^Bearer\s+(\S+)$/i.exec(String(req.headers.authorization || ""));
  return match ? match[1] : "";
}

/**
 * Agent requests come from a host-local MCP process, never a browser or a
 * reverse proxy: loopback peer and Host, no Origin, no forwarding headers.
 */
export function isHostLocalAgentRequest(req) {
  if (!isLoopbackAddress(req.socket?.remoteAddress) || !isLoopbackHost(req.headers.host)) return false;
  for (const header of ["origin", "forwarded", "x-forwarded-for", "x-forwarded-host", "x-real-ip", "cookie"]) {
    if (req.headers[header] !== undefined) return false;
  }
  return true;
}

export const BROWSER_AGENT_PATH = "/api/browser/agent";

/**
 * /api/browser/agent routes for `devmoter browser-mcp`. Authenticated only by
 * a short-lived agent token (no owner password, no device cookie); every
 * request is scoped to the token's project and capabilities and audited.
 */
export async function handleBrowserAgentRequest(req, res, url, { manager, tokens, audit, decide } = {}) {
  const path = url.pathname;
  if (path !== BROWSER_AGENT_PATH && !path.startsWith(BROWSER_AGENT_PATH + "/")) return false;
  const log = entry => audit?.record({ actor: "agent", ...entry });
  try {
    if (!isHostLocalAgentRequest(req)) {
      sendJson(res, 403, { error: "Browser agent access is host-local only", code: "agent_not_local" });
      return true;
    }
    const record = tokens.verify(bearerToken(req));
    if (!record) {
      sendJson(res, 401, { error: "A valid browser agent token is required", code: "agent_token_invalid" });
      return true;
    }
    const base = { projectId: record.projectId, tokenId: record.id, runId: record.runId };
    const deviceId = record.deviceId ?? null;
    const agentId = browserAgentOwner(record);
    const owner = { deviceId, agentId };
    const current = () => {
      // Skip the synchronous browser-binary probe on the per-action path.
      const status = manager.status(record.projectId, { ...owner, capability: false });
      const session = status.session;
      if (session && record.sessionId && session.id !== record.sessionId) {
        record.sessionId = null;
        record.generation = null;
      }
      return { status, session };
    };
    const requireOpen = () => {
      const { session } = current();
      if (!session || !session.active) throw httpError("No browser session is open for this project; call browser_open first", 404, "session_not_open");
      record.sessionId = session.id;
      return session;
    };
    const view = session => ({
      projectId: record.projectId,
      capabilities: [...record.capabilities],
      expiresAt: record.expiresAt,
      session: session || null,
      agentDriving: Boolean(session && session.driver.holder === "agent" && record.generation === session.driver.generation)
    });

    if (req.method === "GET" && path === BROWSER_AGENT_PATH) {
      const { status, session } = current();
      sendJson(res, 200, { ...view(session), otherDeviceSession: status.otherDeviceSession });
      return true;
    }
    if (req.method !== "POST") {
      sendJson(res, 405, { error: "Method not allowed" });
      return true;
    }
    const payload = await readJson(req);
    // The token may have been revoked while the body was arriving.
    if (!tokens.verify(bearerToken(req))) {
      sendJson(res, 401, { error: "A valid browser agent token is required", code: "agent_token_invalid" });
      return true;
    }

    if (path === BROWSER_AGENT_PATH + "/open") {
      const decision = decideBrowserAction({ record, type: "navigate", decide });
      if (decision.decision !== "allow") {
        log({ ...base, event: "open", capability: decision.capability, decision: "deny", code: decision.code });
        throw httpError(decision.reason, 403, decision.code);
      }
      let { session } = current();
      if (!session) {
        const started = await manager.start(record.projectId, { viewport: payload.viewport, ...owner, driver: "agent", tokenId: record.id });
        if (!tokens.verify(bearerToken(req))) {
          await manager.stop(started.session.id, "agent_revoked").catch(() => {});
          sendJson(res, 401, { error: "A valid browser agent token is required", code: "agent_token_invalid" });
          return true;
        }
        session = started.session;
        record.startedSessionId = session.id;
        record.generation = session.driver.generation;
        log({ ...base, event: "start", sessionId: session.id, decision: "allow", ok: true, driverGeneration: record.generation });
      } else if (session.driver.holder !== "user") {
        const driver = manager.acquireDriver(session.id, { holder: "agent", ...owner, tokenId: record.id });
        record.generation = driver.generation;
        session = manager.get(session.id, owner);
        log({ ...base, event: "driver_acquire", sessionId: session.id, decision: "allow", ok: true, driverGeneration: driver.generation });
      }
      record.sessionId = session.id;
      sendJson(res, 200, view(session));
      return true;
    }

    if (path === BROWSER_AGENT_PATH + "/driver") {
      const session = requireOpen();
      if (payload.op === "acquire") {
        const decision = decideBrowserAction({ record, type: "navigate", decide });
        if (decision.decision !== "allow") {
          log({ ...base, event: "driver_acquire", sessionId: session.id, capability: decision.capability, decision: "deny", code: decision.code });
          throw httpError(decision.reason, 403, decision.code);
        }
        try {
          const driver = manager.acquireDriver(session.id, { holder: "agent", ...owner, tokenId: record.id });
          record.generation = driver.generation;
          log({ ...base, event: "driver_acquire", sessionId: session.id, decision: "allow", ok: true, driverGeneration: driver.generation });
        } catch (error) {
          log({ ...base, event: "driver_acquire", sessionId: session.id, decision: "allow", ok: false, code: error?.code });
          throw error;
        }
      } else if (payload.op === "release") {
        manager.releaseDriver(session.id, { holder: "agent", generation: record.generation, ...owner });
        record.generation = null;
        log({ ...base, event: "driver_release", sessionId: session.id, ok: true });
      } else {
        throw httpError("Driver op must be acquire or release", 400, "invalid_driver");
      }
      sendJson(res, 200, view(manager.get(session.id, owner)));
      return true;
    }

    if (path === BROWSER_AGENT_PATH + "/actions") {
      const action = payload.action && typeof payload.action === "object" && !Array.isArray(payload.action) ? payload.action : {};
      const decision = decideBrowserAction({ record, type: action.type, decide });
      if (decision.decision !== "allow") {
        log({ ...base, event: "action", sessionId: record.sessionId, action, capability: decision.capability, decision: "deny", code: decision.code });
        throw httpError(decision.reason, 403, decision.code);
      }
      const session = requireOpen();
      try {
        const result = await manager.act(session.id, action, { holder: "agent", generation: record.generation ?? -1, ...owner, authorize: () => Boolean(tokens.verify(bearerToken(req))) });
        log({ ...base, event: "action", sessionId: session.id, action, capability: decision.capability, decision: "allow", ok: result.ok !== false, code: result.ok === false ? String(result.error || "") : undefined, driverGeneration: record.generation });
        if (Buffer.isBuffer(result.data)) result.data = result.data.toString("base64");
        sendJson(res, 200, result);
      } catch (error) {
        log({ ...base, event: "action", sessionId: session.id, action, capability: decision.capability, decision: "allow", ok: false, code: error?.code || "action_failed" });
        throw error;
      }
      return true;
    }

    if (path === BROWSER_AGENT_PATH + "/close") {
      const { session } = current();
      let stopped = false;
      const ownsDriver = session && session.driver.holder === "agent" && record.generation === session.driver.generation;
      if (session && record.startedSessionId === session.id && (ownsDriver || session.driver.holder === null)) {
        await manager.stop(session.id, "agent_closed", owner);
        stopped = true;
      } else if (ownsDriver) {
        manager.releaseDriver(session.id, { holder: "agent", generation: record.generation, ...owner });
      }
      log({ ...base, event: "close", sessionId: session?.id, ok: true, reason: stopped ? "stopped" : "released" });
      record.sessionId = null;
      record.generation = null;
      sendJson(res, 200, { ok: true, stopped });
      return true;
    }

    sendJson(res, 404, { error: "Browser agent route not found" });
    return true;
  } catch (error) {
    const status = Number(error?.statusCode || error?.status || 500);
    sendJson(res, status >= 400 && status < 600 ? status : 500, {
      error: String(error?.message || "Browser agent request failed").slice(0, 300),
      code: error?.code || undefined
    });
    return true;
  }
}

/**
 * Issues tokens for Agent Runs and builds the Codex MCP server config that
 * points `devmoter browser-mcp` at a 0600 token file. The token is revoked
 * and the file deleted when the run ends.
 */
export function createBrowserAgentLauncher({ tokens, stateDir, baseUrl, cliPath, nodePath = process.execPath, enabled = () => true }) {
  const tokenDir = join(stateDir, "browser-agent-tokens");
  const files = new Map();
  const ready = rm(tokenDir, { recursive: true, force: true }).catch(() => {});

  tokens.onRevoke(record => {
    const file = files.get(record.id);
    if (!file) return;
    files.delete(record.id);
    void rm(file, { force: true }).catch(() => {});
  });

  async function forRun({ runId, projectId, access, deviceId = null, ttlMs = DEFAULT_AGENT_TOKEN_TTL_MS }) {
    const capabilities = capabilitiesForAccess(access);
    if (!capabilities.length || !baseUrl || !enabled()) return null;
    await ready;
    const { token, record } = tokens.issue({ projectId, capabilities, runId, deviceId, ttlMs, label: "agent-run" });
    await mkdir(tokenDir, { recursive: true, mode: 0o700 });
    const file = join(tokenDir, record.id + ".token");
    try {
      await writeFile(file, token + "\n", { mode: 0o600, flag: "wx" });
    } catch (error) {
      tokens.revoke(record.id);
      throw error;
    }
    files.set(record.id, file);
    return {
      tokenId: record.id,
      capabilities: record.capabilities,
      config: {
        // Codex thread/start config overrides use dotted keys, like `codex -c`.
        "mcp_servers.devmoter_browser": {
          command: nodePath,
          args: [cliPath, "browser-mcp", "--url", baseUrl, "--token-file", file],
          startup_timeout_sec: 20,
          tool_timeout_sec: 60
        }
      }
    };
  }

  return {
    forRun,
    revokeRun: runId => tokens.revokeRun(runId),
    revokeAllRuns: () => {
      for (const record of tokens.list()) if (record.runId) tokens.revoke(record.id, "shutdown");
    }
  };
}

/** Client snippets for registering `devmoter browser-mcp` with a manually issued token. */
export function browserMcpClientConfig({ baseUrl, cliPath, nodePath = process.execPath }) {
  const args = [cliPath, "browser-mcp", "--url", baseUrl];
  return {
    env: "DEVMOTER_BROWSER_TOKEN",
    codex: { mcp_servers: { devmoter_browser: { command: nodePath, args, env: { DEVMOTER_BROWSER_TOKEN: "<token>" } } } },
    opencode: { mcp: { "devmoter-browser": { type: "local", command: [nodePath, ...args], environment: { DEVMOTER_BROWSER_TOKEN: "<token>" }, enabled: true } } }
  };
}
