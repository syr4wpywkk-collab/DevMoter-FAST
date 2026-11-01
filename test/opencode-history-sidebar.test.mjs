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
  assert.ok(sidebar.includes('id="ocxRefresh"'), "refresh stays in the drawer, next to the history label");
  assert.ok(sidebar.includes('id="ocxSideStatus"'), "a quiet sync status stays in the drawer header");
  assert.ok(sidebar.indexOf('id="ocxRefresh"') > sidebar.indexOf("CONVERSATION HISTORY"));
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
  // PR #500 item M: the Codex / API Chat buttons and the footer row (language / theme / tools /
  // settings / refresh / connected) left the drawer. The header AI dropdown switches mode,
  // ☰ holds theme, Tools, Settings and language; refresh sits beside the history label.
  for (const removed of [
    "ocxQuickCodex",
    "ocxQuickApi",
    "ocx-quick-switch",
    "ocx-sidebar-foot",
    "data-language-select",
    "ocxTheme",
    "ocxToolsNav",
    "ocxPrefs",
    "Connected"
  ]) assert.ok(!sidebar.includes(removed), removed);
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

test("Codex and API Chat stay reachable from the header AI dropdown, and from the Tools sidebar without it", async () => {
  const [main, shell] = await Promise.all([
    source("src/main.ts"),
    source("src/app-shell.ts")
  ]);

  assert.ok(main.includes("mountOpenCodeRemote(openCodeMount)"), "OpenCode no longer takes its own switch callbacks");
  const nav = await source("src/unified-workspace-nav.ts");
  assert.ok(nav.includes('<option value="codex">Codex</option>'));
  assert.ok(nav.includes('<option value="api">API Chat</option>'));
  assert.ok(nav.includes("data-language-select"), "language lives in the ☰ menu");
  assert.ok(!shell.includes("data-backend="), "the Tools sidebar no longer duplicates the backend switcher");
  // ?unifiedUI=0 has no header dropdown: the fallback Tools sidebar carries the AI switch and language.
  assert.ok(shell.includes("data-fallback-backend"));
  assert.ok(shell.includes("data-language-select"));
});
