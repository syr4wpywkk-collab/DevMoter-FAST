import { diagnostic } from "./diagnostics.mjs";

export const SETUP_STATES = Object.freeze([
  "unknown",
  "missing",
  "installed",
  "auth_required",
  "ready",
  "broken",
  "unsupported"
]);

export function normalizeToolResult(result, adapter) {
  const state = SETUP_STATES.includes(result?.state) ? result.state : "unknown";
  return {
    id: adapter.id,
    displayName: adapter.displayName,
    state,
    installed: result?.installed === true,
    version: typeof result?.version === "string" ? result.version.slice(0, 80) : null,
    authenticated: typeof result?.authenticated === "boolean" ? result.authenticated : null,
    authState: result?.authState || "unknown",
    ...(adapter.id === "opencode" ? { providerAuth: result?.providerAuth || "unknown" } : {}),
    diagnostics: Array.isArray(result?.diagnostics) ? result.diagnostics.slice(0, 4) : []
  };
}

export function publicToolResult(result, adapter) {
  const normalized = normalizeToolResult(result, adapter);
  const authStates = new Set(["unknown", "authenticated", "required"]);
  const providerStates = new Set(["unknown", "configured", "none"]);
  return {
    ...normalized,
    authState: authStates.has(normalized.authState) ? normalized.authState : "unknown",
    ...(adapter.id === "opencode" ? { providerAuth: providerStates.has(normalized.providerAuth) ? normalized.providerAuth : "unknown" } : {}),
    diagnostics: normalized.diagnostics.map(item => diagnostic(item?.code))
  };
}
