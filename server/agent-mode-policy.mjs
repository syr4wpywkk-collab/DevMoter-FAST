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

export function isPromptRoute(value) {
  return /^\/api\/session\/[^/]+\/(?:prompt|prompt_async|message)$/.test(pathnameOnly(value));
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
