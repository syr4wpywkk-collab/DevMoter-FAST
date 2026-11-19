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

/**
 * Canonical shape for proxy route matching: query-free, with trailing
 * slashes stripped (never to empty). "/api/session/{id}/agent/" is the same
 * route as "/api/session/{id}/agent" and must not slip past the guards that
 * match on it (#591 audit).
 */
export function normalizeProxyRoutePath(value) {
  return pathnameOnly(value).replace(/\/+$/, "") || "/";
}

export function isSessionCreateRoute(value) {
  return normalizeProxyRoutePath(value) === "/api/session";
}

export function isSessionAgentRoute(value) {
  return /^\/api\/session\/[^/]+\/agent$/.test(normalizeProxyRoutePath(value));
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
