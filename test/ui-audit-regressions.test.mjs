import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("audit-facing placeholders and Usage labels stay honest", async () => {
  const codex = await readFile(new URL("../src/codex.ts", import.meta.url), "utf8");
  assert.doesNotMatch(codex, /cxUsageLabel">0 tok/);
  assert.match(codex, /cxUsageLabel">Usage/);
  // The Library placeholder and the Settings / DevMoter tools rows (duplicated by ☰) left the Codex drawer.
  assert.doesNotMatch(codex, /ライブラリ · 準備中|id="cxLibraryNav"|id="cxSettingsNav"|id="cxToolsNav"/);

  const integrations = await readFile(new URL("../src/integrations.ts", import.meta.url), "utf8");
  assert.doesNotMatch(integrations, /claude:\/\/code/);
  // The disabled "Claudeアプリ（準備中）" placeholder and the intro/Project copy are gone.
  assert.doesNotMatch(integrations, /Claudeアプリ（準備中）|開発ツールをひとつの場所から|ON\/OFFは表示設定|id="ixProject"/);
});

test("chat history cannot strand global navigation after switching surfaces", async () => {
  const shellCss = await readFile(new URL("../src/app-shell.css", import.meta.url), "utf8");
  assert.match(shellCss, /body\.api-mode:has\(\.api-sidebar\.open\) \.dm-shell-menu-trigger/);
  assert.match(shellCss, /body\.codex-mode:has\(\.cx-sidebar\.open\) \.dm-shell-menu-trigger/);
  assert.match(shellCss, /body\.opencode-mode:has\(\.ocx-modal:not\(\.hidden\)\) \.dm-shell-menu-trigger/);
  assert.match(shellCss, /body\.opencode-mode:has\(\.ocx-sidebar\.open\) \.dm-shell-menu-trigger/);
  assert.doesNotMatch(shellCss, /\.devmoter-system-modal:not\(\.hidden\),\s*\.api-sidebar\.open/);

  const opencode = await readFile(new URL("../src/opencode.ts", import.meta.url), "utf8");
  // The drawer's own 開発ツール button left with its footer row; the global shell's in-flow Tools entry remains.
  assert.doesNotMatch(opencode, /id="ocxToolsNav"/);
  const shell = await readFile(new URL("../src/app-shell.ts", import.meta.url), "utf8");
  assert.match(shell, /#ocxSidebar \.ocx-sidebar-head/);
  assert.match(shell, /dataset\.openTools/);

});

test("theme overrides keep history and workspace controls readable", async () => {
  const codexCss = await readFile(new URL("../src/codex-chat.css", import.meta.url), "utf8");
  assert.match(codexCss, /data-devmoter-theme="light"[^\n]*\.cx-app \.cx-nav-item/);
  assert.match(codexCss, /data-devmoter-theme="light"[^\n]*\.cx-app \.cx-thread-row/);
  assert.match(codexCss, /data-devmoter-theme="light"[^\n]*\.cx-app \.cx-search input/);

  const openCodeCss = await readFile(new URL("../src/opencode-chat.css", import.meta.url), "utf8");
  assert.doesNotMatch(openCodeCss, /dm-controlbar|WorkspaceControlsMount/, "the docked workspace button group is gone");
  assert.match(openCodeCss, /background: var\(--oc-panel-2\)/);

  const apiCss = await readFile(new URL("../src/api-chat-surface.css", import.meta.url), "utf8");
  assert.doesNotMatch(apiCss, /dm-controlbar|WorkspaceControlsMount/);
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
  // Text on the accent fill follows --api-on-accent so it stays readable when the accent is near-white (dark).
  assert.match(css, /\.api-app #apiSend \{ background: var\(--api-accent\); color: var\(--api-on-accent, #fff\); \}/);
});

test("global workspace navigation uses neutral state cues instead of backend brand colors", async () => {
  const shell = await readFile(new URL("../src/app-shell.ts", import.meta.url), "utf8");
  assert.match(shell, /<strong>開発ツール<\/strong>/);
  assert.doesNotMatch(shell, /作業環境と機能|Chat workspaces/, "Tools header is name-only and has no duplicate backend grid");

  const css = await readFile(new URL("../src/app-shell.css", import.meta.url), "utf8");
  assert.doesNotMatch(css, /\.dm-shell-menu-trigger\[data-backend=/);
  assert.doesNotMatch(css, /backdrop-filter: blur\(22px\)/);
  assert.match(css, /\.dm-shell-menu-trigger \{[\s\S]*?border-radius: 10px/);
});

test("Tools assistant reads like a project inspection utility instead of a chat prompt", async () => {
  const tools = await readFile(new URL("../src/tools-ai.ts", import.meta.url), "utf8");
  assert.match(tools, /調査を開始/);
  assert.match(tools, /例：現在の変更点を整理/);
  assert.doesNotMatch(tools, /読み取り専用で調べます|読み取り専用の調査|依頼と必要なProject内容|ツールを直接開く|data-ai-suggestion/);
  assert.doesNotMatch(tools, /tools-ai-spark|何をしたいですか|AIに頼めます/);

  const css = await readFile(new URL("../src/app-shell.css", import.meta.url), "utf8");
  assert.doesNotMatch(css, /\.tools-ai-welcome|\.tools-ai-suggestions|\.tools-ai-settings/);
  assert.doesNotMatch(css, /\.tools-ai-composer \{[^}]*linear-gradient/);
  assert.match(css, /\.tools-ai-composer \{[^}]*border-radius: 12px/);
});
