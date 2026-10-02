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

test("chat history cannot strand global navigation after switching to OpenCode", async () => {
  const shellCss = await readFile(new URL("../src/app-shell.css", import.meta.url), "utf8");
  assert.match(shellCss, /body\.api-mode:has\(\.api-sidebar\.open\) \.dm-shell-menu-trigger/);
  assert.match(shellCss, /body\.codex-mode:has\(\.cx-sidebar\.open\) \.dm-shell-menu-trigger/);
  assert.match(shellCss, /body\.opencode-mode:has\(\.ocx-sidebar\.open\) \.dm-shell-menu-trigger/);
  assert.doesNotMatch(
    shellCss,
    /\.devmoter-system-modal:not\(\.hidden\),\s*\.api-sidebar\.open,\s*\.cx-sidebar\.open,\s*\.ocx-sidebar\.open/
  );

  const opencode = await readFile(new URL("../src/opencode.ts", import.meta.url), "utf8");
  assert.match(opencode, /id="ocxToolsNav"/);
  assert.match(opencode, /#ocxToolsNav/);
  assert.match(opencode, /devmoter:open-global-nav/);

  const codex = await readFile(new URL("../src/codex.ts", import.meta.url), "utf8");
  assert.match(codex, /devmoter:surface-changed", closeSidebar/);
});
