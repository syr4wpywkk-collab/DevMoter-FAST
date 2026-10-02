import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { createServer } from "vite";
const vite = await createServer({ server: { middlewareMode: true }, appType: "custom" });
const { mountUnifiedFeatureShell } = await vite.ssrLoadModule("/src/app-shell.ts"); await vite.close();
const tick = () => new Promise(r => setTimeout(r, 20));
function setup(fetchImpl) {
  const dom = new JSDOM("<!doctype html><body></body>", { url: "http://localhost", pretendToBeVisual: true });
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, CustomEvent: dom.window.CustomEvent, localStorage: dom.window.localStorage, fetch: fetchImpl });
  const calls = [];
  mountUnifiedFeatureShell({ switchBackend: backend => calls.push(backend), openHome() {} });
  const $ = selector => dom.window.document.querySelector(selector);
  return { dom, $, calls };
}
const project = { id: "p1", name: "Project A", path: "/a" };
const context = { projects: [project, { id: "p2", name: "Project B", path: "/b" }], providers: [{ id: "planner", name: "Configured provider", ready: true, models: ["configured-model"] }] };
const baseRun = { runId: "01234567-0123-0123-0123-012345678901", rawGoal: "今の変更を調べて", status: "planning", updatedAt: 1, context: { project, hostId: "local", backend: "tools-ai-read" }, planner: { providerId: "planner", providerName: "Configured provider", model: "configured-model" }, steps: [], failure: null, cancellation: { requested: false }, explanation: null };
const response = body => new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });

test("AI is default, selected target is captured, close/reopen restores the SAME run and manual 20 tools remain", async () => {
  let current = structuredClone(baseRun); let sent;
  const { dom, $, calls } = setup(async (url, options) => {
    if (url.endsWith("/context")) return response(context);
    if (options.method === "POST" && url.endsWith("/runs")) { sent = JSON.parse(options.body); return response(current); }
    if (url.endsWith("/stop")) { current = { ...current, status: "stop_requested", updatedAt: 2, cancellation: { requested: true } }; return response(current); }
    return response(current);
  });
  try {
    $(".dm-shell-menu-trigger").click(); await tick();
    assert.equal($("[data-manual-tools]").open, false);
    assert.equal(dom.window.document.querySelectorAll("[data-tools-item]").length, 20);
    assert.match($("[data-ai-availability]").textContent, /Configured provider.*configured-model/);
    $("[data-ai-goal]").value = "今の変更を調べて";
    $("[data-ai-form]").dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true })); await tick();
    assert.equal(sent.projectId, "p1"); assert.equal(sent.providerId, "planner");
    $("[data-ai-project]").value = "p2"; $("[data-ai-project]").dispatchEvent(new dom.window.Event("change"));
    assert.match($("[data-ai-progress]").textContent, /今回の対象: Project A/);
    assert.equal($("[data-ai-stop]").closest(".dm-shell-sidebar-head") !== null, true);
    $("[data-shell-close]").click(); $(".dm-shell-menu-trigger").click(); await tick();
    assert.equal(dom.window.localStorage.getItem("devmoter-tools-ai-run"), current.runId);
    assert.match($("[data-ai-progress]").textContent, /Project A/);
    $("[data-ai-manual]").click(); assert.equal($("[data-manual-tools]").open, true);
    $("[data-ai-stop]").click(); await tick(); assert.match($("[data-ai-progress]").textContent, /停止要求済み/);
    $("[data-ai-settings]").click(); assert.equal(calls.at(-1), "api");
  } finally { dom.window.close(); }
});
test("unconfigured planner keeps explicit settings/manual paths and no submission", async () => {
  let posts = 0;
  const { dom, $, calls } = setup(async (_url, options) => {
    if (options.method === "POST") posts++;
    return response({ ...context, providers: [] });
  });
  try {
    $(".dm-shell-menu-trigger").click(); await tick();
    assert.equal($("[data-ai-submit]").disabled, false);
    assert.equal($("[data-ai-setup-notice]").hidden, false);
    assert.match($("[data-ai-setup-message]").textContent, /API Chat.*設定.*Codex.*OpenCode/);
    $("[data-ai-goal]").value = "今の変更を調べて";
    $("[data-ai-submit]").click(); await tick();
    assert.equal(posts, 0);
    assert.equal($(".tools-ai-settings").open, true);
    assert.equal($("[data-ai-error]").hidden, false);
    $("[data-ai-configure]").click(); assert.equal(calls.at(-1), "api");
    $("[data-ai-manual]").click(); assert.equal($("[data-manual-tools]").open, true);
    assert.ok($("[data-ai-settings]"));
  } finally { dom.window.close(); }
});

test("missing credential, model, and Vault project binding produce actionable preflight without a run", async () => {
  for (const [provider, reason] of [
    [{ ...context.providers[0], ready: false }, /credentialが未設定/],
    [{ ...context.providers[0], models: [] }, /modelが未設定/],
    [{ ...context.providers[0], projectId: "p2" }, /紐付いたProject/]
  ]) {
    let posts = 0;
    const { dom, $ } = setup(async (_url, options) => { if (options.method === "POST") posts++; return response({ ...context, providers: [provider] }); });
    try {
      $(".dm-shell-menu-trigger").click(); await tick();
      assert.match($("[data-ai-setup-message]").textContent, reason);
      $("[data-ai-goal]").value = "今の変更を調べて"; $("[data-ai-submit]").click(); await tick();
      assert.equal(posts, 0); assert.match($("[data-ai-error]").textContent, reason);
      assert.equal($(".tools-ai-settings").open, true);
      assert.equal($("[data-ai-configure]").hidden, false);
    } finally { dom.window.close(); }
  }
});

test("failed context load can be retried; a configured send then reaches the run API", async () => {
  let attempts = 0; let posts = 0;
  const { dom, $ } = setup(async (url, options) => {
    if (url.endsWith("/context")) { if (++attempts === 1) throw new TypeError("Network offline"); return response(context); }
    if (options.method === "POST") posts++;
    return response({ ...baseRun, status: "completed" });
  });
  try {
    $(".dm-shell-menu-trigger").click(); await tick();
    assert.equal($("[data-ai-retry]").hidden, false);
    assert.match($("[data-ai-setup-message]").textContent, /取得できません/);
    $("[data-ai-submit]").click(); assert.equal(posts, 0);
    $("[data-ai-retry]").click(); await tick();
    assert.equal($("[data-ai-setup-notice]").hidden, true);
    $("[data-ai-goal]").value = "今の変更を調べて"; $("[data-ai-submit]").click(); await tick();
    assert.equal(posts, 1); assert.equal($("[data-ai-submit]").disabled, false);
  } finally { dom.window.close(); }
});

test("context timeout releases loading and exposes retry instead of leaving Send inert", async () => {
  let timeout;
  const { dom, $ } = setup((_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
  }));
  const original = dom.window.setTimeout.bind(dom.window);
  dom.window.setTimeout = (callback, ms, ...args) => { if (ms === 10000) timeout = callback; return original(callback, ms, ...args); };
  try {
    $(".dm-shell-menu-trigger").click(); assert.equal($("[data-ai-submit]").disabled, true);
    timeout(); await tick();
    assert.equal($("[data-ai-submit]").disabled, false);
    assert.equal($("[data-ai-retry]").hidden, false);
    assert.match($("[data-ai-error]").textContent, /タイムアウト/);
  } finally { dom.window.close(); }
});

test("empty goal gets feedback and stale context errors cannot undo a newer ready context", async () => {
  let rejectOld; let attempts = 0; let posts = 0;
  const { dom, $ } = setup((url, options) => {
    if (url.endsWith("/context") && ++attempts === 1) return new Promise((_resolve, reject) => { rejectOld = reject; });
    if (options.method === "POST") posts++;
    return Promise.resolve(response(context));
  });
  try {
    $(".dm-shell-menu-trigger").click(); $("[data-shell-close]").click(); $(".dm-shell-menu-trigger").click(); await tick();
    rejectOld(new TypeError("Old request failed")); await tick();
    assert.equal($("[data-ai-submit]").disabled, false);
    assert.equal($("[data-ai-setup-notice]").hidden, true);
    $("[data-ai-submit]").click(); await tick();
    assert.equal(posts, 0); assert.match($("[data-ai-error]").textContent, /入力してください/);
    assert.equal(document.activeElement, $("[data-ai-goal]"));
  } finally { dom.window.close(); }
});
test("result cards use safe source rendering, preserve builtAt/redaction, and show restart unknown honestly", async () => {
  const current = { ...structuredClone(baseRun), status: "unknown", updatedAt: 3, failure: "Host restart: unknown",
    steps: [{ operationId: "project.search", status: "completed", result: { type: "search", source: "saved-project-index", builtAt: 1234, sharing: { excluded: true, truncated: true }, data: { query: "auth", results: [{ path: "auth.ts", line: 1, snippet: "<script>evil()</script>" }] } } }],
    explanation: { rawText: "**取得済み**\n<script>evil()</script>" } };
  const { dom, $ } = setup(async url => response(url.endsWith("/context") ? context : current));
  try {
    dom.window.localStorage.setItem("devmoter-tools-ai-run", current.runId);
    $(".dm-shell-menu-trigger").click(); await tick();
    assert.match($("[data-ai-results]").textContent, /builtAt: 1234/);
    assert.match($("[data-ai-results]").textContent, /共有対象から除外/);
    assert.equal($("[data-ai-results] script"), null);
    assert.equal($("[data-ai-stop]").disabled, true);
    assert.match($("[data-ai-progress]").textContent, /結果不明/);
  } finally { dom.window.close(); }
});

test("lost start response is reconciled by original request ID, never assumed successful", async () => {
  let captured;
  const { dom, $ } = setup(async (url, options) => {
    if (url.endsWith("/context")) return response(context);
    if (options.method === "POST") { captured = JSON.parse(options.body); throw new TypeError("Lost response"); }
    return response(baseRun);
  });
  try {
    $(".dm-shell-menu-trigger").click(); await tick(); $("[data-ai-goal]").value = "今の変更を調べて";
    $("[data-ai-form]").dispatchEvent(new dom.window.Event("submit", { cancelable: true })); await tick();
    assert.equal(JSON.parse(dom.window.localStorage.getItem("devmoter-tools-ai-pending-request")).requestId, captured.requestId);
    assert.equal(dom.window.localStorage.getItem("devmoter-tools-ai-run"), null);
    $("[data-shell-close]").click(); $(".dm-shell-menu-trigger").click(); await tick();
    assert.equal(dom.window.localStorage.getItem("devmoter-tools-ai-run"), baseRun.runId);
    assert.equal(dom.window.localStorage.getItem("devmoter-tools-ai-pending-request"), null);
    assert.match($("[data-ai-progress]").textContent, /操作を選択中/);
  } finally { dom.window.close(); }
});

test("an old reconnect response cannot replace a newly submitted run", async () => {
  let release;
  const newer = { ...structuredClone(baseRun), runId: "99999999-0123-0123-0123-012345678901", updatedAt: 10 };
  const { dom, $ } = setup(async (url, options) => {
    if (url.endsWith("/context")) return response(context);
    if (options.method === "POST") return response(newer);
    if (url.includes(baseRun.runId)) return new Promise(resolve => { release = () => resolve(response({ ...baseRun, status: "completed" })); });
    return response(newer);
  });
  try {
    dom.window.localStorage.setItem("devmoter-tools-ai-run", baseRun.runId);
    $(".dm-shell-menu-trigger").click(); await tick();
    $("[data-ai-goal]").value = "new task";
    $("[data-ai-form]").dispatchEvent(new dom.window.Event("submit", { cancelable: true })); await tick();
    release(); await tick();
    assert.equal($("[data-ai-stop]").disabled, false);
    assert.equal(dom.window.localStorage.getItem("devmoter-tools-ai-run"), newer.runId);
    assert.match($("[data-ai-progress]").textContent, /操作を選択中/);
  } finally { dom.window.close(); }
});

test("conversation entry keeps settings quiet, chips only fill input, and summary precedes collapsed source data", async () => {
  let posts = 0;
  const current = { ...structuredClone(baseRun), status: "completed", updatedAt: 5,
    steps: [{ operationId: "git.inspect", status: "completed", result: { type: "git", source: "actual-git", builtAt: null, sharing: { excluded: false, truncated: false }, data: { status: { branch: "main" }, files: { total: 1, files: [{ path: "README.md", status: "modified" }] }, diffs: [{ path: "README.md", diff: "+ npm start" }] } } }],
    explanation: { rawText: "README.md に変更があります。" } };
  const { dom, $ } = setup(async (url, options) => { if (options.method === "POST") posts++; return response(url.endsWith("/context") ? context : current); });
  try {
    localStorage.setItem("opencode-pocket-project", "p2"); localStorage.setItem("devmoter-api-provider", "planner"); localStorage.setItem("devmoter-api-model:planner", "configured-model");
    localStorage.setItem("devmoter-tools-ai-run", current.runId);
    $(".dm-shell-menu-trigger").click(); await tick();
    assert.equal($(".tools-ai-settings").open, false);
    assert.equal($("[data-ai-project]").value, "p2");
    assert.equal($("[data-ai-provider]").value, "planner");
    assert.equal($("[data-ai-model]").value, "configured-model");
    const chips = [...document.querySelectorAll("[data-ai-suggestion]")]; assert.equal(chips.length, 5);
    for (const chip of chips) { chip.click(); assert.equal($("[data-ai-goal]").value, chip.textContent); }
    assert.equal(posts, 0); assert.equal(document.activeElement, $("[data-ai-goal]"));
    assert.equal($("[data-ai-results]").firstElementChild.classList.contains("tools-ai-explanation"), true);
    assert.equal($(".tools-ai-result-details").open, false);
    assert.match($(".tools-ai-result-details").textContent, /actual-git.*main/s);
    assert.match($(".tools-ai-result-details").textContent, /npm start/);
    assert.equal($(".tools-ai-run-details").open, false);
  } finally { dom.window.close(); }
});
