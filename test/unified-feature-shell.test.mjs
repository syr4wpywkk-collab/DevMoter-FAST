import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

async function source(path) {
  return readFile(new URL("../" + path, import.meta.url), "utf8");
}

test("unified feature shell exposes the major implemented surfaces", async () => {
  const [shell, registry] = await Promise.all([source("src/app-shell.ts"), source("src/app-registry.ts")]);
  for (const label of [
    "getAppDefinition(appId)", "Terminal", "Git", "Review", "Agents", "Sessions / Activity",
    "Projects", "Developer Workflows", "Files & Preview",
    "Safety", "Project Index", "Hosts", "Automation", "Passkeys",
    "API Vault", "Trusted devices", "Notifications", "Diagnostics",
    "Settings", "Setup Wizard"
  ]) assert.ok(shell.includes(label) || registry.includes(label), label);
});

test("unified feature shell targets real mounted launchers and navigation IDs", async () => {
  const [shell, control, git, workflow, agent, sessions, advanced, remote, settings, codex] = await Promise.all([
    source("src/app-shell.ts"), source("src/control-center.ts"), source("src/workspace-tools.ts"),
    source("src/workflow.ts"), source("src/agent-console.ts"), source("src/session-control.ts"),
    source("src/advanced.ts"), source("src/remote-control.ts"), source("src/settings.ts"), source("src/codex.ts")
  ]);
  assert.ok(shell.includes(".dm-tools-launcher") && control.includes("dm-tools-launcher"));
  assert.ok(shell.includes(".pocket-git-trigger") && git.includes("pocket-git-trigger"));
  assert.ok(shell.includes("#wfLaunch") && workflow.includes('id="wfLaunch"'));
  assert.ok(shell.includes("#devmoterAgentLauncher") && agent.includes("devmoterAgentLauncher"));
  assert.ok(shell.includes(".sc-fab") && sessions.includes("sc-fab"));
  assert.ok(shell.includes(".adv-fab") && advanced.includes("adv-fab"));
  assert.ok(shell.includes(".dm-control-trigger") && remote.includes("dm-control-trigger"));
  assert.ok(settings.includes("devmoter:open-settings"));
  assert.ok(shell.includes("#cxProjectsNav") && codex.includes('id="cxProjectsNav"'));
  assert.ok(shell.includes("#cxDevWorkflowsNav") && codex.includes('id="cxDevWorkflowsNav"'));
});

test("Home is a first-class surface and sidebar entry without replacing existing launchers", async () => {
  const [main, home, shell, css] = await Promise.all([
    source("src/main.ts"), source("src/home.ts"), source("src/app-shell.ts"), source("src/home.css")
  ]);
  assert.ok(main.includes('id="devmoterHomeView"'));
  assert.ok(main.includes("createSurfaceNavigation"));
  assert.ok(main.includes("mountHomeSurface"));
  assert.ok(home.includes('data-home-app-grid'));
  assert.ok(home.includes('data-home-continue'));
  assert.ok(shell.includes('data-home-nav'));
  assert.ok(shell.includes('homeLink.setAttribute("aria-current", "page")'));
  assert.ok(shell.includes('button.classList.toggle("active", active)'));
  assert.ok(shell.includes('button.setAttribute("aria-pressed", String(active))'));
  assert.ok(shell.includes('options.openHome()'));
  assert.ok(css.includes("env(safe-area-inset-top)"));
  assert.ok(css.includes("env(safe-area-inset-bottom)"));
  assert.ok(css.includes("100svh") && css.includes("100dvh"));
  assert.ok(css.includes("prefers-reduced-motion"));
});

test("Settings remains a temporary overlay and closes if main surface history changes", async () => {
  const [settings, main] = await Promise.all([source("src/settings.ts"), source("src/main.ts")]);
  assert.ok(settings.includes('window.addEventListener("devmoter:surface-changed", close)'));
  assert.ok(main.includes('new CustomEvent("devmoter:surface-changed"'));
  assert.ok(!settings.includes("history.pushState"));
});

test("main surface changes dismiss transient overlays and terminal sockets", async () => {
  const files = ["src/control-center.ts", "src/workspace-tools.ts", "src/advanced.ts", "src/remote-control.ts", "src/agent-console.ts", "src/session-control.ts", "src/system-panel.ts"];
  const contents = await Promise.all(files.map(source));
  for (const content of contents) assert.ok(content.includes('"devmoter:surface-changed"'));
  assert.ok(contents[0].includes("disconnectTerminalSocket()"));
});

test("Home and existing backend surfaces are connected through URL history state", async () => {
  const main = await source("src/main.ts");
  assert.ok(main.includes("surfaceNavigation.navigate(next)"));
  assert.ok(main.includes('onSurface: applySurface'));
  assert.ok(main.includes("window.dispatchEvent(new CustomEvent(\"devmoter:backend-changed\""));
  assert.ok(main.includes("applySurface(surfaceNavigation.current())"));
});

test("settings deep-link event accepts a target page", async () => {
  const settings = await source("src/settings.ts");
  assert.ok(settings.includes("CustomEvent<{ page?: SettingsPage }>"));
  assert.ok(settings.includes('open(requested || "root")'));
});

test("main mounts unified shell only after the terminal control center exists", async () => {
  const main = await source("src/main.ts");
  const control = main.indexOf("const controlCenterReady");
  const shell = main.lastIndexOf("mountUnifiedFeatureShell");
  assert.ok(control >= 0);
  assert.ok(shell > control);
  assert.ok(main.includes("controlCenterReady.then"));
});

test("legacy floating launchers are visually retired but remain mounted for compatibility", async () => {
  const css = await source("src/app-shell.css");
  for (const selector of [
    ".dm-tools-launcher", ".pocket-git-trigger", "#wfLaunch", "#devmoterAgentLauncher",
    ".sc-fab", ".adv-fab", ".dm-control-trigger", ".devmoter-settings-trigger", ".devmoter-system-button"
  ]) assert.ok(css.includes(selector), selector);
});

test("mobile navigation is sidebar-first and no bottom dock remains", async () => {
  const [shell, css] = await Promise.all([
    source("src/app-shell.ts"),
    source("src/app-shell.css")
  ]);
  assert.ok(shell.includes("dm-shell-menu-trigger"));
  assert.ok(shell.includes("dm-shell-sidebar"));
  assert.ok(shell.includes('appActionButtons(["terminal", "git", "review"])'));
  assert.ok(shell.includes('case "terminal": openToolsTab("terminal")'));
  assert.ok(shell.includes('case "git": clickExisting(".pocket-git-trigger")'));
  assert.ok(shell.includes('case "review": clickExisting("#wfLaunch")'));
  assert.ok(shell.includes('data-backend="opencode"'));
  assert.ok(!shell.includes("dm-shell-dock"));
  assert.ok(!css.includes(".dm-shell-dock"));
  assert.ok(css.includes("transform: translateX(-105%)"));
  assert.ok(css.includes(".dm-shell-sidebar.open"));
});

test("sidebar remains keyboard dismissible and reports expanded state", async () => {
  const shell = await source("src/app-shell.ts");
  assert.ok(shell.includes('aria-expanded="false"'));
  assert.ok(shell.includes('trigger.setAttribute("aria-expanded", "true")'));
  assert.ok(shell.includes('trigger.setAttribute("aria-expanded", "false")'));
  assert.ok(shell.includes('if (event.key === "Escape") closeSidebar()'));
});
