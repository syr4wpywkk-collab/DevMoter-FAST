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

test("OpenCode history drawer contains no provider or tool navigation", async () => {
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
    "API Chat",
    "ocxIntegrationsNav",
    "Integrations",
    "ocxSettingsNav",
    "ocxSessionToolsNav",
    "Session tools"
  ]) assert.ok(!sidebar.includes(forbidden), forbidden);
});

test("OpenCode history rows emphasize conversation metadata instead of agent identity", async () => {
  const opencode = await source("src/opencode.ts");
  assert.ok(opencode.includes("const historyTime = Number(session.time?.updated ?? session.time?.created ?? 0)"));
  assert.ok(opencode.includes('count ? String(count) + " msgs" : ""'));
  assert.ok(!opencode.includes('session.agent || "session"'));
});

test("OpenCode history drawer follows the iOS visual viewport", async () => {
  const [opencode, css] = await Promise.all([
    source("src/opencode.ts"),
    source("src/style.css")
  ]);

  assert.ok(opencode.includes("window.visualViewport?.height ?? window.innerHeight"));
  assert.ok(opencode.includes('root.style.setProperty("--ocx-history-viewport-height"'));
  assert.ok(opencode.includes('window.visualViewport?.addEventListener("resize", syncHistoryViewportHeight'));
  assert.ok(opencode.includes('window.visualViewport?.addEventListener("scroll", syncHistoryViewportHeight'));
  assert.ok(css.includes("height: var(--ocx-history-viewport-height, 100dvh)"));
  assert.ok(css.includes("-webkit-overflow-scrolling: touch"));
});

test("Codex and API Chat remain available globally, not inside OpenCode history", async () => {
  const [main, shell] = await Promise.all([
    source("src/main.ts"),
    source("src/app-shell.ts")
  ]);

  assert.ok(main.includes("mountOpenCodeRemote(openCodeMount)"));
  assert.ok(shell.includes('data-backend="codex"'));
  assert.ok(shell.includes('data-backend="api"'));
});
