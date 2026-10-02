import test from "node:test";
import assert from "node:assert/strict";
import { STATIC_SECURITY_HEADERS, staticSecurityHeaders } from "../server/security-headers.mjs";

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
