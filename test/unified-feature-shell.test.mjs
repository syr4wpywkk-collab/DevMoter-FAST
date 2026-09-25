import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

async function source(path) {
  return readFile(new URL("../" + path, import.meta.url), "utf8");
}

test("unified feature shell exposes the major implemented surfaces", async () => {
  const shell = await source("src/app-shell.ts");
  for (const label of [
    "Terminal", "Git", "Review", "Agent mode", "Session Control",
    "Projects & GitHub", "Developer workflows", "Files & Preview",
    "Safety", "Project Index", "Hosts", "Automation", "Passkeys",
    "API Vault", "Trusted devices", "Notifications", "Diagnostics",
    "Settings", "Setup Wizard"
  ]) assert.ok(shell.includes(label), label);
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

test("settings deep-link event accepts a target page", async () => {
  const settings = await source("src/settings.ts");
  assert.ok(settings.includes("CustomEvent<{ page?: SettingsPage }>"));
  assert.ok(settings.includes('open(requested || "root")'));
});

test("main mounts unified shell only after the terminal control center exists", async () => {
  const main = await source("src/main.ts");
  const control = main.indexOf("const controlCenterReady");
  const shell = main.indexOf("mountUnifiedFeatureShell");
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
