import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

async function source(path) {
  return readFile(new URL("../" + path, import.meta.url), "utf8");
}

test("global Tools navigation leaves provider-local history controls reachable", async () => {
  const [shell, shellCss, codex, opencode] = await Promise.all([
    source("src/app-shell.ts"),
    source("src/app-shell.css"),
    source("src/codex.ts"),
    source("src/opencode.ts")
  ]);

  assert.ok(shell.includes('new CustomEvent("devmoter:close-chat-history")'));
  assert.ok(shell.includes('window.addEventListener("devmoter:close-global-nav", closeSidebar)'));
  assert.ok(codex.includes('aria-label="会話履歴を開く"'));
  assert.ok(opencode.includes('aria-label="セッション履歴を開く"'));
  assert.ok(codex.includes('new CustomEvent("devmoter:close-global-nav")'));
  assert.ok(opencode.includes('new CustomEvent("devmoter:close-global-nav")'));
  assert.ok(codex.includes('window.addEventListener("devmoter:close-chat-history", closeSidebar)'));
  assert.ok(opencode.includes('window.addEventListener("devmoter:close-chat-history", closeSidebar)'));
  assert.ok(shellCss.includes(".cx-sidebar.open"));
  assert.ok(shellCss.includes(".ocx-sidebar.open"));
  assert.ok(shellCss.includes("padding-left: calc(max(8px, env(safe-area-inset-left)) + 58px)"));
  assert.ok(shellCss.includes("padding-left: calc(max(12px, env(safe-area-inset-left)) + 58px)"));
});

test("Codex and OpenCode lock prompt submission before asynchronous guards run", async () => {
  const [codex, opencode] = await Promise.all([
    source("src/codex.ts"),
    source("src/opencode.ts")
  ]);

  for (const sourceText of [codex, opencode]) {
    assert.ok(sourceText.includes("let submitInFlight = false"));
    assert.ok(sourceText.includes("if (submitInFlight) return"));
    assert.ok(sourceText.includes("submitInFlight = true"));
    assert.ok(sourceText.includes("await sendMessageUnlocked()"));
    assert.ok(sourceText.includes("submitInFlight = false"));
  }
});

test("saved chat identity is preserved instead of silently falling back to a new chat", async () => {
  const [codex, opencode] = await Promise.all([
    source("src/codex.ts"),
    source("src/opencode.ts")
  ]);

  assert.ok(codex.includes("restoreSavedThread"));
  assert.ok(codex.includes('"thread/read"'));
  assert.ok(codex.includes("Preserve the current identity instead of silently falling back to a new chat"));
  assert.ok(!codex.includes('localStorage.removeItem("opencode-pocket-codex-thread");'));

  assert.ok(opencode.includes("restoreSavedSession"));
  assert.ok(opencode.includes('"/session/" + encodeURIComponent(sessionId)'));
  assert.ok(opencode.includes("Keep the identity and try the canonical session endpoint"));
  assert.ok(!opencode.includes('localStorage.removeItem("opencode-pocket-opencode-session");'));
});

test("mobile lifecycle resume reconnects to canonical chat state with bounded cursor replay", async () => {
  const [codex, opencode] = await Promise.all([
    source("src/codex.ts"),
    source("src/opencode.ts")
  ]);

  for (const sourceText of [codex, opencode]) {
    assert.ok(sourceText.includes('document.addEventListener("visibilitychange"'));
    assert.ok(sourceText.includes('window.addEventListener("pageshow"'));
    assert.ok(sourceText.includes('window.addEventListener("online"'));
    assert.ok(sourceText.includes("/api/workspace-control/events?sessionId="));
    assert.ok(sourceText.includes("&limit=500"));
    assert.ok(sourceText.includes("Background replay gap detected"));
    assert.ok(sourceText.includes("await refresh()"));
  }

  assert.ok(codex.includes("eventBelongsToActiveThread"));
  assert.ok(codex.includes("requestThreadId && requestThreadId !== activeThreadId"));
});

test("background resume never auto-approves Codex; it only re-renders a persisted approval request", async () => {
  const codex = await source("src/codex.ts");
  const server = await source("server.mjs");

  assert.ok(server.includes("id: request?.id ?? null"));
  assert.ok(codex.includes("renderApprovalRequest"));
  assert.ok(codex.includes('type === "approval"'));
  assert.ok(!codex.includes("autoApproveOnResume"));
});
