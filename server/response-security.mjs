// Baseline security headers for every HTTP response, including JSON, SSE,
// redirects and error bodies written by feature modules. Routes that need a
// different policy (static assets, live preview) override them in writeHead.
export const BASELINE_SECURITY_HEADERS = Object.freeze({
  "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "no-referrer",
  "cross-origin-resource-policy": "same-origin"
});

export const HSTS_HEADER_VALUE = "max-age=15552000";

function servedOverHttps(req, publicOrigin) {
  if (publicOrigin) {
    try {
      return new URL(publicOrigin).protocol === "https:";
    } catch {
      return false;
    }
  }
  return Boolean(req?.socket?.encrypted);
}

export function applyBaselineSecurityHeaders(req, res, { publicOrigin = "" } = {}) {
  for (const [name, value] of Object.entries(BASELINE_SECURITY_HEADERS)) {
    res.setHeader(name, value);
  }
  // Client-supplied forwarded headers are never consulted: HSTS is emitted only
  // for the operator-configured public origin or a directly encrypted socket.
  if (servedOverHttps(req, publicOrigin)) {
    res.setHeader("strict-transport-security", HSTS_HEADER_VALUE);
  }
}
