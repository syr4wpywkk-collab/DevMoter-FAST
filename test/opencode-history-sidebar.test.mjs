import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

async function source(path) {
  return readFile(new URL("../" + path, import.meta.url), "utf8");
}

function sidebarMarkup(opencode) {
  const start = opencode.indexOf('<aside id="ocxSidebar"');
  const end = opencode.indexOf("</aside>", start);
  assert.ok(start >= 0 && end > start, "OpenCode sidebar markup exists");
  return opencode.slice(start, end);
}

test("OpenCode hamburger is conversation-history first", async () => {
  const opencode = await source("src/opencode.ts");
  const sidebar = sidebarMarkup(opencode);

  assert.ok(sidebar.includes("CONVERSATION HISTORY"));
  assert.ok(sidebar.includes('id="ocxSessions"'));
  assert.ok(sidebar.includes('placeholder="Search conversation history"'));
  assert.ok(sidebar.includes('aria-label="Sort conversation history"'));
  assert.ok(sidebar.includes('id="ocxNewSessionSide"'));
  assert.ok(sidebar.includes('id="ocxRefresh"'));
  assert.ok(sidebar.includes('id="ocxSideStatus"'));
});

test("OpenCode history stays history-first with only direct workspace exits", async () => {
  const opencode = await source("src/opencode.ts");
  const sidebar = sidebarMarkup(opencode);

  for (const forbidden of [
    "ocxAgentSwitchButton",
    "ocxAgentSwitchMenu",
    "ocxBackendCodex",
    "ocxBackendApi",
    "ocxAgentsNav",
    "ocxCommandsNav",
    "ocxSkillsNav",
    "ocxModelsNav",
    "ocxCodexNav",
    "Codex UI",
    "ocxApiNav",
    "ocxIntegrationsNav",
    "Integrations",
    "ocxSettingsNav",
    "ocxSessionToolsNav",
    "Session tools"
  ]) assert.ok(!sidebar.includes(forbidden), forbidden);
  assert.ok(sidebar.includes('id="ocxQuickCodex"'));
  assert.ok(sidebar.includes('id="ocxQuickApi"'));
  assert.ok(sidebar.indexOf('class="ocx-quick-switch"') < sidebar.indexOf('class="ocx-sidebar-scroll"'), "quick exits must remain visible outside scrollable history");
});

test("OpenCode history rows emphasize conversation metadata instead of agent identity", async () => {
  const opencode = await source("src/opencode.ts");
  assert.ok(opencode.includes("const historyTime = Number(session.time?.updated ?? session.time?.created ?? 0)"));
  assert.ok(opencode.includes('count ? String(count) + " msgs" : ""'));
  assert.ok(!opencode.includes('session.agent || "session"'));
});

test("OpenCode history drawer follows the iOS visual viewport", async () => {
  // The shared stylesheet now imports ordered functional modules. Assert
  // against the assembled CSS, rather than the import-only entrypoint.
  const [opencode, ...cssModules] = await Promise.all([
    source("src/opencode.ts"),
    ...["base", "workspace", "tools", "chat-extras"].map(name => source(`src/styles/${name}.css`))
  ]);
  const css = cssModules.join("");

  // One shared visualViewport listener (src/visual-viewport.mjs) replaces per-surface copies.
  const main = await source("src/main.ts");
  assert.ok(main.includes("startViewportSync(window)"));
  assert.ok(!opencode.includes("visualViewport"), "OpenCode keeps no private viewport listener");
  assert.ok(css.includes("height: var(--dm-viewport-height, 100dvh)"));
  assert.ok(css.includes("-webkit-overflow-scrolling: touch"));
});

test("Codex and API Chat remain available globally and via direct OpenCode exits", async () => {
  const [main, shell] = await Promise.all([
    source("src/main.ts"),
    source("src/app-shell.ts")
  ]);

  assert.ok(main.includes("mountOpenCodeRemote(openCodeMount, {"));
  assert.ok(main.includes('onCodex: () => {'));
  assert.ok(main.includes('onApi: () => {'));
  const nav = await source("src/unified-workspace-nav.ts");
  assert.ok(nav.includes('<option value="codex">Codex</option>'));
  assert.ok(nav.includes('<option value="api">API Chat</option>'));
  assert.ok(!shell.includes("data-backend="), "the Tools sidebar no longer duplicates the backend switcher");
});
