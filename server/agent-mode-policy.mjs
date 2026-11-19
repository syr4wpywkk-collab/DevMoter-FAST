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

export function sessionIdFromOpenCodePath(value) {
  const match = pathnameOnly(value).match(/^\/api\/session\/([^/]+)(?:\/|$)/);
  return match ? decodeURIComponent(match[1]) : null;
}

export function isDirectMutationRoute(value) {
  return /^\/api\/session\/[^/]+\/(?:shell|command)$/.test(pathnameOnly(value));
}

// Session operations whose OpenCode routes differ by generation. DevMoter
// serves them itself (server/opencode-adapter.mjs); the generic proxy must
// never forward them, or a client could bypass mode and sandbox policy.
export function isAdapterOwnedRoute(value) {
  return /^\/api\/session\/[^/]+\/(?:prompt|prompt_async|message|interrupt|abort|context|permission|permissions|question|form)(?:\/|$)/
    .test(pathnameOnly(value));
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
