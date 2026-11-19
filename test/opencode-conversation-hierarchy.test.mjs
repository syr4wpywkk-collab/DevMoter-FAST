import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const css = await readFile(new URL("../src/unified-workspace-chat.css", import.meta.url), "utf8");

test("OpenCode thinking and tool steps are a quiet trail, not cards competing with the reply", () => {
  const rule = css.match(/body\.dm-task-first-enabled \.ocx-app :is\(\.ocx-tool-card, \.ocx-reasoning\) \{([^}]*)\}/);
  assert.ok(rule, "OpenCode trail rule exists");
  for (const declaration of ["border: 0;", "border-left: 1px solid var(--dw-chat-line);", "background: transparent;", "color: var(--dw-chat-muted);", "padding-left: var(--space-3);"]) {
    assert.ok(rule[1].includes(declaration), declaration);
  }
  assert.ok(!/!important/.test(rule[1]));
  assert.ok(!/:is\(\.cx-app \.cx-message\.system, \.ocx-app \.ocx-tool-card/.test(css), "OpenCode trail no longer shares the Codex card rule");
});

test("tool status colors and 44px summaries are left to opencode-chat.css", async () => {
  const base = await readFile(new URL("../src/opencode-chat.css", import.meta.url), "utf8");
  assert.match(base, /\.ocx-reasoning > summary \{ min-height: 44px;/);
  assert.match(base, /\.ocx-tool-card\.error > summary \{ color: var\(--oc-red\); \}/);
});
