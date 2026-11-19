const MODES = new Set(["build", "plan", "ask"]);

export const READ_ONLY_TOOLS = Object.freeze({
  "*": false,
  read: true,
  glob: true,
  grep: true,
  list: true,
  webfetch: true,
  websearch: true,
  lsp: true
});

function pathnameOnly(value) {
  return String(value || "").split("?", 1)[0];
}

export function parseAgentMode(value) {
  const mode = String(value || "").trim().toLowerCase();
  return MODES.has(mode) ? mode : null;
}

export function isReadOnlyMode(mode) {
  return mode === "plan" || mode === "ask";
}

/** Map an agent identifier (e.g. "plan", "ask", "build", "coder") to its mode, or null if blank. */
export function modeFromAgent(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return null;
  return parseAgentMode(trimmed) || "build";
}

/**
 * Resolve the effective mode given the server-side session mode and an
 * optional mode taken from an explicit operation parameter (a create/agent
 * request body or a prompt's agent). The parameter may preserve or lower
 * privileges (e.g. build -> plan/ask), never escalate read-only -> build.
 */
export function resolveEffectiveAgentMode(sessionMode, requestedMode) {
  const serverMode = parseAgentMode(sessionMode) || "build";
  const clientMode = parseAgentMode(requestedMode);
  if (!clientMode) return serverMode;
  if (isReadOnlyMode(serverMode)) {
    return isReadOnlyMode(clientMode) ? clientMode : serverMode;
  }
  return clientMode;
}

export function sessionIdFromOpenCodePath(value) {
  const match = pathnameOnly(value).match(/^\/api\/session\/([^/]+)(?:\/|$)/);
  return match ? decodeURIComponent(match[1]) : null;
}

// Route matchers consume the canonical policyPath built by the proxy target builder.
export function isSessionCreateRoute(value) {
  return value === "/api/session";
}

export function isSessionAgentRoute(value) {
  return /^\/api\/session\/[^/]+\/agent$/.test(value);
}

export function isDirectMutationRoute(value) {
  return /^\/api\/session\/[^/]+\/(?:shell|command)$/.test(value);
}

// Session operations whose OpenCode routes differ by generation. DevMoter
// serves them itself (server/opencode-adapter.mjs); the generic proxy must
// never forward them, or a client could bypass mode and sandbox policy.
export function isAdapterOwnedRoute(value) {
  return /^\/api\/session\/[^/]+\/(?:prompt|prompt_async|message|interrupt|abort|context|permission|permissions|question|form)(?:\/|$)/
    .test(value);
}

/** The tool allowlist a read-only mode imposes on a run, or null. */
export function readOnlyToolsFor(mode) {
  return isReadOnlyMode(mode) ? { ...READ_ONLY_TOOLS } : null;
}

/**
 * Bounded session-mode store with TTL expiry and oldest-first (LRU) eviction
 * so OpenCode session modes cannot grow memory without bound.
 *
 * Expiry is intentionally sliding: get() renews an entry's TTL because an
 * actively used session's mode must not expire mid-conversation (that would
 * silently drop its read-only restriction). Memory stays bounded regardless:
 * prune() enforces maxEntries on every set(), expired entries are dropped on
 * access, and session deletion removes entries explicitly.
 */
export function createSessionModeMap({ maxEntries = 1000, ttlMs = 24 * 60 * 60 * 1000, now = () => Date.now() } = {}) {
  const entries = new Map();

  function expiryFor(timestamp) {
    return Number.isFinite(ttlMs) && ttlMs > 0 ? timestamp + ttlMs : Number.POSITIVE_INFINITY;
  }

  function prune(timestamp) {
    for (const [key, entry] of entries) {
      if (entry.expiresAt <= timestamp) entries.delete(key);
    }
    while (entries.size > maxEntries) {
      const oldest = entries.keys().next().value;
      if (oldest === undefined) break;
      entries.delete(oldest);
    }
  }

  return {
    has(sessionId, timestamp = now()) {
      const entry = entries.get(sessionId);
      if (!entry) return false;
      if (entry.expiresAt <= timestamp) {
        entries.delete(sessionId);
        return false;
      }
      return true;
    },
    get(sessionId, timestamp = now()) {
      if (!sessionId) return undefined;
      const entry = entries.get(sessionId);
      if (!entry) return undefined;
      if (entry.expiresAt <= timestamp) {
        entries.delete(sessionId);
        return undefined;
      }
      entries.delete(sessionId);
      entries.set(sessionId, { mode: entry.mode, expiresAt: expiryFor(timestamp) });
      return entry.mode;
    },
    set(sessionId, mode, timestamp = now()) {
      if (!sessionId || !mode) return this;
      entries.delete(sessionId);
      entries.set(sessionId, { mode, expiresAt: expiryFor(timestamp) });
      prune(timestamp);
      return this;
    },
    delete(sessionId) {
      return entries.delete(sessionId);
    },
    clear() {
      entries.clear();
    },
    get size() {
      prune(now());
      return entries.size;
    }
  };
}
