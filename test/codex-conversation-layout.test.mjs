import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const css = await readFile(new URL("../src/unified-workspace-chat.css", import.meta.url), "utf8");

test("Codex turns pair the prompt with its reply", () => {
  assert.match(css, /body\.dm-task-first-enabled \.cx-app \.cx-message-row\.user \{ margin-bottom: 12px; \}/);
  assert.match(css, /:is\(\.cx-app \.cx-message-row, \.ocx-app \.ocx-message-row, \.api-app \.api-message\) \{[^}]*margin-bottom: 20px;/, "turns stay 20px apart");
});

test("Codex command and status rows are compact secondary rows that still wrap", () => {
  const rule = css.match(/body\.dm-task-first-enabled \.cx-app \.cx-message\.system \{([^}]*)\}/);
  assert.ok(rule, "system rows have a Codex rule");
  assert.match(rule[1], /width: fit-content;/);
  assert.match(rule[1], /max-width: 100%;/, "long commands never overflow the transcript");
  assert.match(rule[1], /font-size: var\(--font-size-caption, 12px\);/);
  assert.ok(!/!important/.test(rule[1]));
});
