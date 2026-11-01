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
