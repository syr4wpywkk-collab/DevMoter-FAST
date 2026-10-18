import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { shouldUseUnifiedWorkspace } from "../src/unified-ui-mode.mjs";

const file = async path => readFile(new URL("../" + path, import.meta.url), "utf8");

test("unified UI is the default on the existing local/Tailscale URL, no extra query flag", () => {
  for (const search of [
    "", "?surface=home", "?surface=codex", "?surface=opencode",
    "?surface=api", "?surface=integrations",
    "?backend=codex&session=real-session", "?unifiedUI=1",
    "?surface=opencode&unifiedUI=1"
  ]) {
    assert.equal(shouldUseUnifiedWorkspace(search), true, search || "bare URL");
  }
});

test("explicit opt-out restores legacy presentation without changing route or session", () => {
  for (const search of [
    "?unifiedUI=0", "?surface=home&unifiedUI=0",
    "?surface=codex&unifiedUI=0",
    "?surface=opencode&unifiedUI=0",
    "?surface=api&session=s1&unifiedUI=0"
  ]) {
    assert.equal(shouldUseUnifiedWorkspace(search), false, search);
  }
  const oldURL = new URL("https://example.ts.net/?surface=codex&session=keep");
  const original = oldURL.href;
  assert.equal(shouldUseUnifiedWorkspace(oldURL.search), true);
  assert.equal(oldURL.href, original, "selector must not mutate browser URL");
  assert.equal(oldURL.searchParams.get("session"), "keep");
});

test("only the existing shell activates unified presentation; failed dynamic import returns to native UI", async () => {
  const [shell, nav, main, css] = await Promise.all([
    file("src/app-shell.ts"),
    file("src/unified-workspace-nav.ts"),
    file("src/main.ts"),
    file("src/unified-workspace-nav.css")
  ]);
  assert.match(shell, /shouldUseUnifiedWorkspace\(window\.location\.search\)/);
  assert.match(shell, /import\("\.\/unified-workspace-nav"\)/);
  assert.ok(shell.includes('document.body.classList.remove("dm-task-first-enabled")'));
  assert.ok(shell.includes('document.getElementById("dmTaskFirstWorkspace")?.remove()'));
  assert.ok(shell.includes('label.hidden = true'), "restore native history identity on import error");
  assert.ok(shell.includes("notify("), "report fallback rather than blank canvas");
  assert.ok(nav.includes('document.body.classList.add("dm-task-first-enabled")'));
  assert.ok(!main.includes("shouldUseUnifiedWorkspace"), "avoid a second UI owner in main");
  assert.ok(!main.includes('import "./unified-workspace-nav.css"'), "no eager CSS in legacy entry");
  assert.ok(css.includes("body.dm-task-first-enabled"), "style only enabled when navigator mounts");
  assert.ok(!shell.includes("location.replace("), "do not redirect users to other URLs");
});

test("the default UI preserves provider ownership and a recoverable legacy route", async () => {
  const [nav, shell, openCode, codex, api] = await Promise.all([
    file("src/unified-workspace-nav.ts"),
    file("src/app-shell.ts"),
    file("src/opencode.ts"),
    file("src/codex.ts"),
    file("src/api-chat.ts")
  ]);
  assert.ok(nav.includes('switchBackend: (backend: ChatBackend) => void'));
  assert.ok(nav.includes('selectTab("chat", "push", next)'));
  assert.ok(nav.includes('actions.switchBackend(backend || currentBackend)'));
  assert.ok(nav.includes("openNativeHistory()"));
  for (const [source, formId] of [[openCode,"ocxPromptForm"],[codex,"cxPromptForm"],[api,"apiForm"]]) {
    assert.ok(source.includes('id="' + formId + '"'), "real composer must remain mounted");
  }
  assert.ok(shell.includes('getAppDefinition(appId)') || shell.includes("getAppDefinition("));
  assert.equal(shouldUseUnifiedWorkspace("?unifiedUI=0"), false);
});
