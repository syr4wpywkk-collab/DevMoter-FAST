import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = path => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("API Chat header keeps a visible, accessible identity and model label", async () => {
  const source = await read("src/api-chat.ts");
  const header = source.match(/<header class="api-topbar">([\s\S]*?)<\/header>/);
  assert.ok(header, "API Chat header markup exists");
  const markup = header[1];
  assert.match(markup, /<div class="api-brand">\s*<strong>API Chat<\/strong>\s*<small id="apiModelTopLabel">/);
  assert.doesNotMatch(markup.match(/<div class="api-brand">[\s\S]*?<\/div>/)[0], /aria-hidden|hidden|inert/);
  assert.match(markup, /id="apiMenu"[^>]*aria-label=/);
  assert.match(markup, /<div class="api-header-actions">[\s\S]*id="apiSettingsTop"[^>]*aria-label=/);
  assert.match(source, /t\("apiChat\.topModelUnset"\)/);
});

test("narrow-screen rules cannot hide the API Chat identity", async () => {
  const [surface, extras] = await Promise.all([read("src/api-chat-surface.css"), read("src/styles/chat-extras.css")]);
  // Legacy unscoped rules hide .api-brand (≤520px) and its model line (≤680px).
  // The .api-app-scoped rules (higher specificity) must keep both displayed.
  assert.match(extras, /@media \(max-width: 520px\)\s*\{\s*\.api-brand \{\s*display: none;/);
  assert.match(surface, /\.api-app \.api-brand \{[^}]*display: grid;[^}]*min-width: 0;/);
  assert.match(surface, /\.api-app \.api-brand small \{[^}]*display: block;[^}]*overflow: hidden;[^}]*white-space: nowrap;[^}]*text-overflow: ellipsis;/);
  assert.doesNotMatch(surface, /\.api-app \.api-brand(?: small)? \{[^}]*display: none/);
  assert.match(surface, /\.api-app \.api-topbar \{[^}]*grid-template-columns: 44px minmax\(0, 1fr\) auto;/);
});

test("task-first theme colors the API Chat identity with chat text tokens", async () => {
  const unified = await read("src/unified-workspace-chat.css");
  assert.match(unified, /:is\([^)]*\.api-app \.api-brand\) \{\s*color: var\(--dw-chat-text\);/);
  assert.match(unified, /:is\([^)]*\.api-app #apiModelTopLabel\) \{\s*color: var\(--dw-chat-muted\);/);
});
