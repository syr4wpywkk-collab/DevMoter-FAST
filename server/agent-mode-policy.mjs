const MODES = new Set(["build", "plan"]);

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

export function parseAgentMode(value) {
  const mode = String(value || "").trim().toLowerCase();
  return MODES.has(mode) ? mode : null;
}

export function isReadOnlyMode(mode) {
  return mode === "plan";
}

export function sessionIdFromOpenCodePath(pathname) {
  const match = String(pathname || "").match(/^\/api\/session\/([^/]+)(?:\/|$)/);
  return match ? decodeURIComponent(match[1]) : null;
}

export function isDirectMutationRoute(pathname) {
  return /^\/api\/session\/[^/]+\/(?:shell|command)$/.test(String(pathname || ""));
}

export function isPromptRoute(pathname) {
  return /^\/api\/session\/[^/]+\/(?:prompt|prompt_async|message)$/.test(String(pathname || ""));
}

export function applyModeToPrompt(payload, mode) {
  if (!isReadOnlyMode(mode) || !payload || typeof payload !== "object" || Array.isArray(payload)) {
    return payload;
  }

  return {
    ...payload,
    tools: { ...READ_ONLY_TOOLS }
  };
}
