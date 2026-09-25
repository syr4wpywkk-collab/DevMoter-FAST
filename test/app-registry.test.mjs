import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const EXPECTED_APPS = [
  "chat", "projects", "knowledge", "terminal", "git", "review", "agents",
  "sessions", "browser", "automation", "developer-workflows"
];

async function source(path) {
  return readFile(new URL(`../src/${path}`, import.meta.url), "utf8");
}

test("App Registry has unique fixed IDs and all initial Apps", async () => {
  const registry = await source("app-registry.ts");
  const ids = [...registry.matchAll(/\{ id: "([a-z-]+)"/g)].map(match => match[1]);
  assert.equal(new Set(ids).size, ids.length);
  assert.deepEqual([...ids].sort(), [...EXPECTED_APPS].sort());
  assert.match(registry, /export const APP_IDS = \[/);
  assert.match(registry, /export function isAppId\(value: unknown\): value is AppId/);
  for (const systemOnly of ["trusted-devices", "passkeys", "api-vault", "safety", "diagnostics", "notifications", "settings"]) {
    assert.ok(!ids.includes(systemOnly), systemOnly);
  }
});

test("Knowledge and Browser are truthful previews and System entries stay separate", async () => {
  const [registry, shell] = await Promise.all([source("app-registry.ts"), source("app-shell.ts")]);
  assert.match(registry, /id: "knowledge"[^\n]+availability: "preview"[^\n]+previewMessage: "Knowledge is not available yet/);
  assert.match(registry, /id: "browser"[^\n]+availability: "preview"[^\n]+previewMessage: "Browser does not have a separate app surface/);
  assert.ok(shell.includes('systemActionButton("🔐", "API Vault"'));
  assert.ok(shell.includes('systemActionButton("▣", "Trusted devices"'));
  assert.ok(shell.includes('systemActionButton("●", "Notifications"'));
  assert.ok(!registry.includes('title: "Settings"'));
});

test("Home cards are rendered from the Registry with accessible availability state", async () => {
  const home = await source("home.ts");
  assert.ok(home.includes("APP_REGISTRY.map(app =>"));
  assert.ok(home.includes('data-home-app="${app.id}"'));
  assert.ok(home.includes("aria-label=\"${app.title}"));
  assert.ok(home.includes("aria-disabled=\\\"true\\\""));
  assert.ok(home.includes("${state ? `<em class=\"dm-home-app-state\">${state}</em>` : \"\"}"));
  assert.ok(home.includes("options.onPreviewApp(app.id, app.previewMessage"));
});

test("Sidebar app-like labels come from Registry and launches are fixed allowlisted behavior", async () => {
  const shell = await source("app-shell.ts");
  assert.ok(shell.includes("getAppDefinition(appId)"));
  assert.ok(shell.includes('data-shell-app="${appId}"'));
  assert.ok(shell.includes("appActionButtons([\"terminal\", \"git\", \"review\"] )") || shell.includes('appActionButtons(["terminal", "git", "review"])'));
  assert.ok(shell.includes('if (!isAppId(id)) throw new Error("This app is not registered.")'));
  assert.ok(shell.includes('case "terminal": openToolsTab("terminal")'));
  assert.ok(shell.includes('case "git": clickExisting(".pocket-git-trigger")'));
  assert.ok(shell.includes('case "review": clickExisting("#wfLaunch")'));
  assert.ok(!shell.includes('terminal: () =>'));
  assert.ok(!shell.includes('projects: () =>'));
});

test("Existing Chat, Projects, Home active-state and History API contracts remain intact", async () => {
  const [main, navigationTests, shellTests] = await Promise.all([
    readFile(new URL("../src/main.ts", import.meta.url), "utf8"),
    readFile(new URL("surface-navigation.test.mjs", import.meta.url), "utf8"),
    readFile(new URL("unified-feature-shell.test.mjs", import.meta.url), "utf8")
  ]);
  assert.ok(main.includes('case "chat":'));
  assert.ok(main.includes('lastBackend === "codex" || lastBackend === "api" ? lastBackend : "opencode"'));
  assert.ok(main.includes('case "projects":'));
  assert.ok(main.includes('setBackend("codex")'));
  assert.ok(main.includes('"#cxProjectsNav"'));
  assert.ok(shellTests.includes('homeLink.setAttribute("aria-current", "page")'));
  assert.ok(navigationTests.includes("Home to surface to Home updates Back and Forward"));
});
