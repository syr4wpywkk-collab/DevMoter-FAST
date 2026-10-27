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

test("API Chat welcome and composer use a restrained workspace treatment", async () => {
  const api = await readFile(new URL("../src/api-chat.ts", import.meta.url), "utf8");
  assert.match(api, /<h1>API Chat<\/h1>/);
  assert.match(api, /接続先を選んでメッセージを入力/);
  assert.doesNotMatch(api, /api-spark|どのAPIで考える/);

  const css = await readFile(new URL("../src/api-chat-surface.css", import.meta.url), "utf8");
  assert.match(css, /\.api-app \.api-welcome h1[^\n]*color: var\(--api-text\)/);
  assert.doesNotMatch(css, /\.api-app \.api-welcome h1[^\n]*linear-gradient/);
  assert.match(css, /\.api-app \.api-composer \{[^}]*border-radius: 14px/);
  assert.match(css, /\.api-app \.api-picker-row select[^\n]*border-radius: 8px/);
  assert.match(css, /\.api-app #apiSend \{ background: var\(--api-accent\); color: #fff; \}/);
});

test("global workspace navigation uses neutral state cues instead of backend brand colors", async () => {
  const shell = await readFile(new URL("../src/app-shell.ts", import.meta.url), "utf8");
  assert.match(shell, /<strong>開発ツール<\/strong>/);
  assert.match(shell, /<small>作業環境と機能<\/small>/);
  assert.match(shell, /<h2>Chat workspaces<\/h2>/);
  assert.match(shell, /aria-label="Chat workspaces"/);
  assert.match(shell, /button\.setAttribute\("aria-pressed", String\(active\)\)/);

  const css = await readFile(new URL("../src/app-shell.css", import.meta.url), "utf8");
  assert.doesNotMatch(css, /\.dm-shell-menu-trigger\[data-backend=/);
  assert.doesNotMatch(css, /backdrop-filter: blur\(22px\)/);
  assert.match(css, /\.dm-shell-menu-trigger \{[\s\S]*?border-radius: 10px/);
});

test("Tools assistant reads like a project inspection utility instead of a chat prompt", async () => {
  const tools = await readFile(new URL("../src/tools-ai.ts", import.meta.url), "utf8");
  assert.match(tools, /プロジェクトを調べる/);
  assert.match(tools, /読み取り専用で調べます/);
  assert.match(tools, /調査を開始/);
  assert.doesNotMatch(tools, /tools-ai-spark|何をしたいですか|AIに頼めます/);

  const css = await readFile(new URL("../src/app-shell.css", import.meta.url), "utf8");
  assert.match(css, /\.tools-ai-welcome \{ padding: 18px 4px 14px; text-align: left; \}/);
  assert.doesNotMatch(css, /\.tools-ai-composer \{[^}]*linear-gradient/);
  assert.match(css, /\.tools-ai-composer \{[^}]*border-radius: 12px/);
});
