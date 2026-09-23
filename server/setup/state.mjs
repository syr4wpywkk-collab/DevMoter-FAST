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

const INSTALL_SUPPORT = new Set(["supported", "blocked"]);
const INSTALL_SOURCE_CLASSES = new Set(["A", "B", "C", "D"]);
const INSTALL_STATUSES = new Set(["candidate", "confirmation-required", "manual-review", "blocked"]);
const PRIVILEGE_LEVELS = new Set(["user", "administrator", "unknown"]);

function publicInstallMetadata(adapter) {
  const installSource = adapter.installSource || {};
  const safeText = value => typeof value === "string" ? value.slice(0, 180) : "";
  return {
    installSupport: INSTALL_SUPPORT.has(adapter.installSupport) ? adapter.installSupport : "blocked",
    installSourceClass: INSTALL_SOURCE_CLASSES.has(adapter.installSourceClass) ? adapter.installSourceClass : null,
    requiresPrivilege: PRIVILEGE_LEVELS.has(adapter.requiresPrivilege) ? adapter.requiresPrivilege : "unknown",
    installStatus: INSTALL_STATUSES.has(adapter.installStatus) ? adapter.installStatus : "blocked",
    source: {
      type: safeText(installSource.type),
      publisher: safeText(installSource.publisher),
      label: safeText(installSource.label)
    },
    changes: Array.isArray(adapter.installChanges) ? adapter.installChanges.filter(value => typeof value === "string").slice(0, 8).map(safeText) : [],
    verification: Array.isArray(adapter.installVerification) ? adapter.installVerification.filter(value => typeof value === "string").slice(0, 8).map(safeText) : [],
    notes: Array.isArray(adapter.notes) ? adapter.notes.filter(value => typeof value === "string").slice(0, 8).map(safeText) : []
  };
}

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
    install: publicInstallMetadata(adapter),
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
