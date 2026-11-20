import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { apiErrorMessage, requestErrorMessage } from "../src/api-error.mjs";
import { translate, translateServerMessage } from "../src/i18n-core.mjs";

test("server error text is translated, bounded to one line and never an object or page", () => {
  assert.equal(apiErrorMessage({ error: "Custom upstream refusal" }, 400, "en"), "Custom upstream refusal");
  assert.equal(apiErrorMessage({ error: "Project not found" }, 404, "ja"), translateServerMessage("Project not found", "ja"));
  assert.notEqual(translateServerMessage("Project not found", "ja"), "Project not found", "known server text is localized");
  assert.equal(apiErrorMessage({ error: { message: "Bad model" } }, 400, "en"), "Bad model");
  assert.equal(apiErrorMessage({ message: "Plain message" }, 400, "en"), "Plain message");
  assert.equal(apiErrorMessage({ error: "boom\n    at handler (/srv/server.mjs:10:3)" }, 500, "en"), "boom", "stack lines are dropped");
  assert.equal(Array.from(apiErrorMessage({ error: "x".repeat(5000) }, 500, "en")).length, 300);
  assert.equal(apiErrorMessage({ error: "<!doctype html><html>…" }, 502, "en"), translate("en", "common.error.server", { status: 502 }));
  assert.equal(apiErrorMessage({ error: { code: 7 } }, 400, "en"), translate("en", "common.error.requestFailed", { status: 400 }));
  assert.doesNotMatch(apiErrorMessage({ error: {} }, 400, "en"), /object Object/);
});

test("missing server text falls back to a status-specific message in every language", () => {
  const cases = [[401, "unauthorized"], [403, "forbidden"], [404, "notFound"], [408, "timeout"], [504, "timeout"], [413, "tooLarge"], [429, "rateLimited"], [500, "server"], [503, "server"], [400, "requestFailed"], [0, "requestFailed"]];
  for (const language of ["en", "ja", "zh-Hans", "zh-Hant"]) {
    for (const [status, key] of cases) {
      const text = apiErrorMessage({}, status, language);
      assert.equal(text, translate(language, `common.error.${key}`, { status }));
      assert.notEqual(text, `common.error.${key}`, `${language} has ${key}`);
    }
  }
  assert.equal(apiErrorMessage(null, 503, "ja"), "サーバーで問題が発生しました (HTTP 503)。もう一度お試しください。");
});

test("network and unknown failures get a plain message; real errors keep theirs", () => {
  assert.equal(requestErrorMessage(new TypeError("Failed to fetch"), "en"), translate("en", "common.error.network"));
  assert.equal(requestErrorMessage(Object.assign(new Error("t"), { name: "TimeoutError" }), "en"), translate("en", "common.error.timeout"));
  assert.equal(requestErrorMessage(new Error("Upload refused"), "en"), "Upload refused");
  assert.equal(requestErrorMessage({ weird: true }, "en"), translate("en", "common.error.unknown"));
});

test("client API helpers share the one error formatter", async () => {
  for (const file of ["api-chat", "codex", "dev-workflows-ui", "integrations", "prompt-templates", "qwen-chat", "qwen-model-picker", "workflow", "session-control"]) {
    const source = await readFile(new URL(`../src/${file}.ts`, import.meta.url), "utf8");
    assert.match(source, /apiErrorMessage\(payload, (res|response)\.status\)/, file);
    assert.doesNotMatch(source, /translateServerMessage\(payload\?\.error \|\| t\("common\.httpError"/, file);
  }
});
