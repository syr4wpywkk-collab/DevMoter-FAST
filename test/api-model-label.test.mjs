import test from "node:test";
import assert from "node:assert/strict";
import { apiModelLabel } from "../src/api-model-label.mjs";

test("API Chat model labels drop resource prefixes in display only", () => {
  assert.equal(apiModelLabel("models/gemini-2.5-flash"), "gemini-2.5-flash");
  assert.equal(apiModelLabel("publishers/google/models/gemini-2.5-pro"), "gemini-2.5-pro");
  assert.equal(apiModelLabel("accounts/fireworks/models/llama-v3p1-70b-instruct"), "llama-v3p1-70b-instruct");
  // Vendor-routed ids keep the vendor; plain ids are untouched.
  assert.equal(apiModelLabel("openai/gpt-4o"), "openai/gpt-4o");
  assert.equal(apiModelLabel("gpt-4.1-mini"), "gpt-4.1-mini");
  assert.equal(apiModelLabel("claude-sonnet-4-5"), "claude-sonnet-4-5");
  // Only a whole "models/" path segment counts, and an empty remainder keeps the id.
  assert.equal(apiModelLabel("mymodels/x"), "mymodels/x");
  assert.equal(apiModelLabel("models/"), "models/");
  assert.equal(apiModelLabel(""), "");
  assert.equal(apiModelLabel(undefined), "");
  const long = "models/" + "x".repeat(200);
  assert.equal(apiModelLabel(long).length, 200);
});

test("API Chat keeps the full model id as the option value", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(new URL("../src/api-chat.ts", import.meta.url), "utf8");
  assert.match(source, /option\.value = model;\n\s*option\.textContent = apiModelLabel\(model\);/);
});

test("accent-filled API buttons use an on-accent text color in every theme", async () => {
  const { readFile } = await import("node:fs/promises");
  const [extras, surface, unified] = await Promise.all([
    readFile(new URL("../src/styles/chat-extras.css", import.meta.url), "utf8"),
    readFile(new URL("../src/api-chat-surface.css", import.meta.url), "utf8"),
    readFile(new URL("../src/unified-workspace-chat.css", import.meta.url), "utf8")
  ]);
  // "+ APIを追加" (.api-settings-toolbar .primary) and 更新 (.api-auto-connect-button) were white on a near-white accent.
  assert.doesNotMatch(extras, /background: var\(--api-accent\);\n\s*color: white;/);
  assert.match(extras, /\.api-settings-toolbar button\.primary,\n\.api-provider-form-actions button\.primary \{[^}]*color: var\(--api-on-accent, #fff\)/);
  assert.match(extras, /\.api-auto-connect-button \{[^}]*color: var\(--api-on-accent, #fff\)/);
  assert.match(unified, /--api-on-accent: var\(--dw-chat-bg\)/);
  assert.match(surface, /--api-on-accent: #13151a/);
});
