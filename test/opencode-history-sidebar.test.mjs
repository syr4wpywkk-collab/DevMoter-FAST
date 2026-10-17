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

test("OpenCode history remains history-first with only direct escape switches", async () => {
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
  assert.ok(sidebar.includes('aria-label="Switch AI workspace"'));
  assert.ok(sidebar.indexOf("ocxQuickCodex") < sidebar.indexOf('id="ocxSessions"'), "switch is visible above history");
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

  assert.ok(opencode.includes("window.visualViewport?.height ?? window.innerHeight"));
  assert.ok(opencode.includes('root.style.setProperty("--ocx-history-viewport-height"'));
  assert.ok(opencode.includes('window.visualViewport?.addEventListener("resize", syncHistoryViewportHeight'));
  assert.ok(opencode.includes('window.visualViewport?.addEventListener("scroll", syncHistoryViewportHeight'));
  assert.ok(css.includes("height: var(--ocx-history-viewport-height, 100dvh)"));
  assert.ok(css.includes("-webkit-overflow-scrolling: touch"));
});

test("Codex and API Chat remain available globally and through direct OpenCode escape callbacks", async () => {
  const [main, shell] = await Promise.all([
    source("src/main.ts"),
    source("src/app-shell.ts")
  ]);

  assert.ok(main.includes("mountOpenCodeRemote(openCodeMount, {"));
  assert.ok(main.includes('onCodex: () => setBackend("codex")'));
  assert.ok(main.includes('onApi: () => setBackend("api")'));
  assert.ok(shell.includes('data-backend="codex"'));
  assert.ok(shell.includes('data-backend="api"'));
});
