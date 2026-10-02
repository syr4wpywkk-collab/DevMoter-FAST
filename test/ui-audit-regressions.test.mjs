import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("audit-facing placeholders and Usage labels stay honest", async () => {
  const codex = await readFile(new URL("../src/codex.ts", import.meta.url), "utf8");
  assert.doesNotMatch(codex, /cxUsageLabel">0 tok/);
  assert.match(codex, /cxUsageLabel">Usage/);
  assert.match(codex, /ライブラリ · 準備中/);

  const integrations = await readFile(new URL("../src/integrations.ts", import.meta.url), "utf8");
  assert.doesNotMatch(integrations, /claude:\/\/code/);
  assert.match(integrations, /Claudeアプリ（準備中）/);
});

test("chat history cannot strand global navigation after switching surfaces", async () => {
  const shellCss = await readFile(new URL("../src/app-shell.css", import.meta.url), "utf8");
  assert.match(shellCss, /body\.api-mode:has\(\.api-sidebar\.open\) \.dm-shell-menu-trigger/);
  assert.match(shellCss, /body\.codex-mode:has\(\.cx-sidebar\.open\) \.dm-shell-menu-trigger/);
  assert.match(shellCss, /body\.opencode-mode:has\(\.ocx-modal:not\(\.hidden\)\) \.dm-shell-menu-trigger/);
  assert.match(shellCss, /body\.opencode-mode:has\(\.ocx-sidebar\.open\) \.dm-shell-menu-trigger/);
  assert.doesNotMatch(shellCss, /\.devmoter-system-modal:not\(\.hidden\),\s*\.api-sidebar\.open/);

  const opencode = await readFile(new URL("../src/opencode.ts", import.meta.url), "utf8");
  assert.match(opencode, /id="ocxToolsNav"/);
  assert.match(opencode, /devmoter:open-global-nav/);

  const codex = await readFile(new URL("../src/codex.ts", import.meta.url), "utf8");
  assert.match(codex, /devmoter:surface-changed", closeSidebar/);
});

test("theme overrides keep history and workspace controls readable", async () => {
  const codexCss = await readFile(new URL("../src/codex-chat.css", import.meta.url), "utf8");
  assert.match(codexCss, /data-devmoter-theme="light"[^\n]*\.cx-app \.cx-nav-item/);
  assert.match(codexCss, /data-devmoter-theme="light"[^\n]*\.cx-app \.cx-thread-row/);
  assert.match(codexCss, /data-devmoter-theme="light"[^\n]*\.cx-app \.cx-search input/);

  const openCodeCss = await readFile(new URL("../src/opencode-chat.css", import.meta.url), "utf8");
  assert.match(openCodeCss, /data-devmoter-theme="dark"[^\n]*#ocxWorkspaceControlsMount \.dm-controlbar > \.dm-theme/);
  assert.match(openCodeCss, /background: var\(--oc-panel-2\)/);

  const apiCss = await readFile(new URL("../src/api-chat-surface.css", import.meta.url), "utf8");
  assert.match(apiCss, /data-devmoter-theme="dark"[^\n]*#apiWorkspaceControlsMount \.dm-controlbar > \.dm-theme/);
  assert.match(apiCss, /background: var\(--api-composer-surface\)/);
});
