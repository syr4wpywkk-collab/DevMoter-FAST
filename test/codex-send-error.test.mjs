import test from "node:test";
import assert from "node:assert/strict";
import { normalizeCodexSendError } from "../src/codex-send-error.mjs";

test("Codex send errors preserve a useful native reason and classify it", () => {
  assert.deepEqual(normalizeCodexSendError({
    code: "rate_limit_exceeded",
    message: "Too many requests; retry later"
  }), {
    category: "Rate limit",
    reason: "Too many requests; retry later",
    code: "rate_limit_exceeded"
  });
});

test("Codex send errors redact credentials, paths, and stack-like multiline text", () => {
  const result = normalizeCodexSendError({
    message: "API_KEY=private sk-1234567890123456 https://alice:private@api.example/run?access_token=private in /home/alice/.config/codex\n at /srv/app/index.js:4"
  });
  assert.equal(result.reason.includes("private"), false);
  assert.equal(result.reason.includes("1234567890123456"), false);
  assert.equal(result.reason.includes("alice"), false);
  assert.equal(result.reason.includes("index.js"), false);
  assert.equal(result.reason.includes("api.example"), true);
  assert.ok(result.reason.length <= 320);
});

test("missing native reason receives a safe fallback", () => {
  assert.equal(normalizeCodexSendError({}).reason, "Codex did not provide a reason.");
});

test("native Codex structured error category and code are retained", () => {
  assert.deepEqual(normalizeCodexSendError({
    error: {
      message: "The request could not be completed",
      codexErrorInfo: { category: "Usage limit", code: "quota_exceeded" }
    }
  }), {
    category: "Usage limit",
    reason: "The request could not be completed",
    code: "quota_exceeded"
  });
});

test("short and quoted credential assignments are hidden while the explanation remains", () => {
  const result = normalizeCodexSendError({
    message: 'Sign in failed for "api_key": "abc" and token=a; please reconnect'
  });
  assert.equal(result.reason.includes("abc"), false);
  assert.equal(result.reason.includes("token=a"), false);
  assert.match(result.reason, /Sign in failed/);
  assert.match(result.reason, /please reconnect/);
});

test("object-shaped Codex error info does not leak as JavaScript object text", () => {
  const result = normalizeCodexSendError({
    message: "Request could not connect",
    codexErrorInfo: { category: { httpConnectionFailed: { httpStatusCode: 503 } } }
  });
  assert.equal(result.category, "Connection");
  assert.doesNotMatch(result.category + result.reason + result.code, /\[object Object\]/);
});
