import test from "node:test";
import assert from "node:assert/strict";
import {
  buildProxyResponseHeaders,
  PROXY_SECURITY_HEADERS,
  sanitizeProxyContentType,
  STATIC_SECURITY_HEADERS,
  staticSecurityHeaders
} from "../server/security-headers.mjs";

test("static security headers block common browser attack surfaces", () => {
  assert.match(STATIC_SECURITY_HEADERS["content-security-policy"], /script-src 'self'/);
  assert.match(STATIC_SECURITY_HEADERS["content-security-policy"], /script-src-attr 'none'/);
  assert.match(STATIC_SECURITY_HEADERS["content-security-policy"], /frame-ancestors 'none'/);
  assert.equal(STATIC_SECURITY_HEADERS["x-content-type-options"], "nosniff");
  assert.equal(STATIC_SECURITY_HEADERS["x-frame-options"], "DENY");
  assert.equal(STATIC_SECURITY_HEADERS["referrer-policy"], "no-referrer");
});

test("staticSecurityHeaders preserves the requested content type", () => {
  const headers = staticSecurityHeaders("text/html; charset=utf-8");
  assert.equal(headers["content-type"], "text/html; charset=utf-8");
  assert.equal(headers["x-content-type-options"], "nosniff");
});

test("proxy security headers enforce restrictive sandbox CSP and nosniff", () => {
  assert.match(PROXY_SECURITY_HEADERS["content-security-policy"], /default-src 'none'/);
  assert.match(PROXY_SECURITY_HEADERS["content-security-policy"], /frame-ancestors 'none'/);
  assert.match(PROXY_SECURITY_HEADERS["content-security-policy"], /\bsandbox\b/);
  assert.equal(PROXY_SECURITY_HEADERS["x-content-type-options"], "nosniff");
  assert.equal(PROXY_SECURITY_HEADERS["x-frame-options"], "DENY");
  assert.equal(PROXY_SECURITY_HEADERS["referrer-policy"], "no-referrer");
});

test("sanitizeProxyContentType allows expected API types and downgrades HTML/SVG/active types", () => {
  assert.equal(sanitizeProxyContentType("application/json"), "application/json");
  assert.equal(sanitizeProxyContentType("Application/JSON; charset=UTF-8"), "application/json; charset=utf-8");
  assert.equal(sanitizeProxyContentType("application/problem+json; charset=utf-8"), "application/problem+json; charset=utf-8");
  assert.equal(sanitizeProxyContentType("text/event-stream; charset=utf-8"), "text/event-stream; charset=utf-8");
  assert.equal(sanitizeProxyContentType("text/plain; charset=utf-8"), "text/plain; charset=utf-8");

  for (const unsafe of [
    "text/html",
    "text/html; charset=utf-8",
    "image/svg+xml",
    "application/xhtml+xml",
    "application/javascript",
    "text/javascript",
    "text/html, application/json",
    "application/xml"
  ]) {
    assert.equal(sanitizeProxyContentType(unsafe), "application/octet-stream", unsafe);
  }
  assert.equal(sanitizeProxyContentType(""), null);
});

test("buildProxyResponseHeaders uses an allowlist and drops upstream cookies and internal headers", () => {
  const upstream = new Headers({
    "content-type": "text/html; charset=utf-8",
    "set-cookie": "upstream_sid=secret-session; HttpOnly",
    "x-powered-by": "Express",
    "server": "internal-upstream",
    "x-internal-token": "internal-123",
    "location": "https://evil.example/",
    "www-authenticate": "Basic",
    "retry-after": "5",
    "cache-control": "public, max-age=3600"
  });

  const { headers, mediaType } = buildProxyResponseHeaders(upstream, 200);
  assert.equal(headers["set-cookie"], undefined);
  assert.equal(headers["x-powered-by"], undefined);
  assert.equal(headers.server, undefined);
  assert.equal(headers["x-internal-token"], undefined);
  assert.equal(headers.location, undefined);
  assert.equal(headers["www-authenticate"], undefined);
  assert.equal(headers["retry-after"], "5");
  assert.equal(headers["content-type"], "application/octet-stream");
  assert.equal(mediaType, "application/octet-stream");
  assert.equal(headers["cache-control"], "no-store");
  assert.equal(headers["x-content-type-options"], "nosniff");
  assert.match(headers["content-security-policy"], /default-src 'none'/);
  assert.match(headers["content-security-policy"], /\bsandbox\b/);

  const sse = buildProxyResponseHeaders(new Headers({ "content-type": "text/event-stream; charset=utf-8" }), 200);
  assert.equal(sse.headers["content-type"], "text/event-stream; charset=utf-8");
  assert.equal(sse.headers["cache-control"], "no-cache, no-transform");

  const noContent = buildProxyResponseHeaders(new Headers(), 204);
  assert.equal(noContent.headers["content-type"], undefined);
});

test("proxy Content-Type drops secret-bearing parameters and JSON subtypes", () => {
  const secret = "sentinel-credential";
  const redact = value => value.replaceAll(secret, "[REDACTED]");
  for (const [contentType, expected] of [
    [`text/plain; charset=${secret}`, "text/plain"],
    [`application/${secret}+json`, "application/json"]
  ]) {
    const result = buildProxyResponseHeaders(new Headers({ "content-type": contentType }), 200, redact);
    assert.equal(result.headers["content-type"], expected);
    assert.equal(result.mediaType, expected);
  }
});
