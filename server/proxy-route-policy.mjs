// Deny-by-default route allowlist for the generic OpenCode proxy (#588).
//
// proxy() in server.mjs forwards /api/opencode/* requests to the fixed
// OpenCode upstream. Character validation alone lets any upstream route
// through, including mutation routes DevMoter has never heard of (e.g. ones
// added by a future OpenCode release). This table is the contract: only the
// method + path pairs listed here are forwarded; everything else is rejected
// by proxy() WITHOUT contacting upstream. In read-only modes (plan/ask),
// every "write" entry is rejected for session-scoped routes.
//
// Inventory sources (keep in sync — the drift-guard test in
// test/proxy-route-policy-588.integration.test.mjs scans the client):
//   - src/opencode.ts api() call sites (the browser client's proxy traffic)
//   - src/session-control.ts oc() call sites (a subset of the same routes)
//   - proxy integration tests (test/opencode-proxy-ssrf.test.mjs expects the
//     API root and the session reads below to keep forwarding)
// Adapter-owned session subroutes (prompt, prompt_async, message, interrupt,
// abort, context, permission(s), question, form — see isAdapterOwnedRoute in
// server/agent-mode-policy.mjs) are deliberately NOT listed: DevMoter serves
// them itself and proxy() rejects them before classification. The dedicated
// GET /api/opencode/pocket/providers handler also runs before proxy(); its
// upstream path is listed so the contract stays complete if that handler is
// ever removed. /api/pocket/runtime is deliberately absent (no client uses
// it; the PWA backend test expects it to 404).
//
// Templates are policyPath values (the "/api/..." path buildOpenCodeUpstreamTarget
// derives after stripping the /api/opencode prefix). "{id}" matches exactly
// one path segment.

const ID_SEGMENT = "[^/]+";

function compileTemplate(template) {
  const source = template
    .split("/")
    .map(segment =>
      segment === "{id}"
        ? ID_SEGMENT
        : segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    )
    .join("/");
  return new RegExp(`^${source}$`);
}

const ROUTE_TABLE = [
  // Reads.
  { method: "GET", template: "/api/", kind: "read" },
  { method: "GET", template: "/api/session", kind: "read" },
  { method: "GET", template: "/api/session/{id}", kind: "read" },
  { method: "GET", template: "/api/agent", kind: "read" },
  { method: "GET", template: "/api/command", kind: "read" },
  { method: "GET", template: "/api/skill", kind: "read" },
  { method: "GET", template: "/api/location", kind: "read" },
  { method: "GET", template: "/api/pocket/providers", kind: "read" },
  // Writes.
  { method: "POST", template: "/api/session", kind: "write" },
  { method: "POST", template: "/api/session/{id}/agent", kind: "write" },
  { method: "POST", template: "/api/session/{id}/model", kind: "write" },
  { method: "POST", template: "/api/session/{id}/shell", kind: "write" },
  { method: "POST", template: "/api/session/{id}/command", kind: "write" }
].map(entry => ({ ...entry, pattern: compileTemplate(entry.template) }));

/** The allowlist as plain data (method, template, kind), for tests/tooling. */
export const PROXY_ROUTE_TABLE = Object.freeze(
  ROUTE_TABLE.map(({ method, template, kind }) => Object.freeze({ method, template, kind }))
);

/**
 * Classify a proxied request. Returns the matching table entry
 * ({ method, template, kind }) or null when the route is not allowlisted.
 */
export function classifyProxyRoute(method, policyPath) {
  const normalizedMethod = String(method || "").toUpperCase();
  const path = String(policyPath || "").split("?", 1)[0];
  for (const entry of ROUTE_TABLE) {
    if (entry.method === normalizedMethod && entry.pattern.test(path)) {
      return { method: entry.method, template: entry.template, kind: entry.kind };
    }
  }
  return null;
}

/** Write-classified entries (with compiled patterns), for contract tests. */
export function listWriteRoutePatterns() {
  return ROUTE_TABLE
    .filter(entry => entry.kind === "write")
    .map(({ method, template, kind, pattern }) => ({ method, template, kind, pattern }));
}
