import test from "node:test";
import assert from "node:assert/strict";
import * as i18nCore from "../src/i18n-core.mjs";
import { readFile } from "node:fs/promises";
import ts from "typescript";
import { JSDOM } from "jsdom";
import * as execution from "../src/execution-state.mjs";
import * as events from "../src/opencode-event-compat.mjs";
import * as sessions from "../src/session-tools.mjs";
import * as pricing from "../src/model-pricing.mjs";
import * as reconnect from "../src/reconnect-policy.mjs";
import * as latestRequest from "../src/latest-request.mjs";
import * as turnState from "../src/opencode-turn-state.mjs";
import * as reconnectAfterSync from "../src/reconnect-after-sync.mjs";
import * as sessionList from "../src/opencode-session-list.mjs";
import * as eventRecovery from "../src/event-recovery.mjs";
import * as fetchTimeout from "../src/fetch-with-timeout.mjs";
import * as providerCatalog from "../src/opencode-provider-catalog.mjs";
import * as sessionTitle from "../src/opencode-session-title.mjs";
import * as modelLabel from "../src/opencode-model-label.mjs";
import { renderChatMarkdown } from "../src/chat-markdown.mjs";
import * as chatDraft from "../src/chat-draft.mjs";
import * as transcriptActions from "../src/chat-transcript-actions.mjs";
import { loadPureTypeScript } from "./helpers/ts-pure-modules.mjs";

const compile = source => ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
}).outputText;
const compiled = compile(await readFile(new URL("../src/opencode.ts", import.meta.url), "utf8"));
const compiledBounds = compile(await readFile(new URL("../src/bounded-transcript.ts", import.meta.url), "utf8"));
const settle = () => new Promise(resolve => setImmediate(resolve));

async function harness(t, initialContext = [], { listFailures = 0 } = {}) {
  const listFailuresAtStart = listFailures;
  const dom = new JSDOM('<!doctype html><main id="root"></main>', {
    url: "https://devmoter.example/chat", runScripts: "outside-only"
  });
  t.after(() => dom.window.close());
  const { window } = dom;
  const root = window.document.querySelector("#root");
  const copied = [];
  const timers = new Map();
  let timerId = 0;
  let context = initialContext;
  let source;
  const session = { id: "session-1", title: "Test session", agent: "build" };
  window.Headers = Headers;
  window.requestAnimationFrame = callback => { callback(); return 1; };
  window.setTimeout = (callback, delay) => {
    timers.set(++timerId, { callback, delay });
    return timerId;
  };
  window.clearTimeout = id => timers.delete(id);
  Object.defineProperty(window.navigator, "clipboard", {
    value: { writeText: async text => copied.push(text) }
  });
  window.localStorage.setItem("opencode-pocket-opencode-session", session.id);
  window.EventSource = class {
    constructor() { source = this; }
    close() {}
  };
  const requests = [];
  window.fetch = async (input, init = {}) => {
    const url = new URL(String(input), window.location.href);
    const path = url.pathname;
    let payload = [];
    requests.push({ path, method: init.method || "GET" });
    if (path === "/api/opencode/session" && listFailures > 0) {
      listFailures -= 1;
      return new Response(JSON.stringify({ error: "list unavailable" }), { status: 503, headers: { "content-type": "application/json" } });
    }
    if (path.endsWith("/context") && context === "unavailable") {
      return new Response(JSON.stringify({ error: "context unavailable" }), { status: 503, headers: { "content-type": "application/json" } });
    }
    if (path === "/api/opencode/location") payload = { directory: "/workspace/project" };
    else if (path === "/api/opencode/pocket/providers") payload = { all: [], connected: [] };
    else if (path === "/api/opencode/agent") payload = [{ id: "build" }, { id: "plan" }];
    else if (path === "/api/opencode/session") payload = [session];
    else if (path === "/api/opencode/session/active") payload = {};
    else if (path.endsWith("/context")) payload = context;
    else if (path === "/api/user-automation/slash") payload = { commands: [] };
    return new Response(JSON.stringify(payload), { headers: { "content-type": "application/json" } });
  };
  const evaluate = (code, require) => {
    const exports = {};
    window.Function("require", "exports", code)(require, exports);
    return exports;
  };
  const bounds = evaluate(compiledBounds, name => {
    if (name === "./i18n") return i18nCore;
    throw new Error("Unexpected bounds import");
  });
  const modules = {
    "./execution-state.mjs": execution,
    "./opencode-event-compat.mjs": events,
    "./session-tools.mjs": sessions,
    "./model-pricing.mjs": pricing,
    "./reconnect-policy.mjs": reconnect,
    "./latest-request.mjs": latestRequest,
    "./opencode-turn-state.mjs": turnState,
    "./reconnect-after-sync.mjs": reconnectAfterSync,
    "./opencode-session-list.mjs": sessionList,
    "./event-recovery.mjs": eventRecovery,
    "./fetch-with-timeout.mjs": fetchTimeout,
    "./opencode-provider-catalog.mjs": providerCatalog,
    "./opencode-session-title.mjs": sessionTitle,
    "./opencode-model-label.mjs": modelLabel,
    "./chat-markdown.mjs": { renderChatMarkdown },
    "./chat-draft.mjs": chatDraft,
    "./chat-transcript-actions.mjs": transcriptActions,
    "./bounded-transcript": bounds,
    "./opencode-chat.css": {},
    "./i18n": { speechRecognitionLanguage: () => "en-US", ...i18nCore },
    "./wake-lock": { setWakeLockExecutionActive() {}, wakeLockEnabled: () => false, wakeLockSupported: () => false },
    "./safety-client": {},
    "./opencode/status": await loadPureTypeScript("opencode/status.ts"),
    "./opencode/tools": await loadPureTypeScript("opencode/tools.ts")
  };
  const { mountOpenCodeRemote } = evaluate(compiled, name => {
    assert.ok(Object.hasOwn(modules, name), `unexpected module: ${name}`);
    return modules[name];
  });
  const controller = mountOpenCodeRemote(root);
  controller.setOnline(true);
  await settle();
  if (!listFailuresAtStart) assert.equal(root.querySelector("#ocxSessionTitle").textContent, "Test session");
  return {
    root, window, copied, controller, requests,
    emit(type, properties) { source.onmessage({ data: JSON.stringify({ type, properties }) }); },
    context(value) { context = value; },
    async tick(delay) {
      const ready = [...timers].filter(([, timer]) => timer.delay === delay);
      assert.ok(ready.length, `expected a ${delay}ms timer`);
      for (const [id, timer] of ready) { timers.delete(id); timer.callback(); }
      await settle();
    }
  };
}

test("saved OpenCode assistant Markdown renders safely while reasoning and tool payloads stay plain", async t => {
  const ui = await harness(t, [{ type: "assistant", content: [
    { type: "text", text: "## Saved answer\n\n**Ready**\n\n<script>alert(1)</script>" },
    { type: "reasoning", text: "**plain reasoning**" },
    { type: "tool", name: "read", state: { status: "completed", result: "**plain tool**" } }
  ] }]);
  const body = ui.root.querySelector(".ocx-assistant-text");
  assert.equal(body.querySelector("h2").textContent, "Saved answer");
  assert.equal(body.querySelector("strong").textContent, "Ready");
  assert.equal(body.querySelector("script"), null);
  assert.equal(ui.root.querySelector(".ocx-reasoning div").textContent, "**plain reasoning**");
  assert.equal(ui.root.querySelector(".ocx-reasoning strong"), null);
  assert.equal(ui.root.querySelector(".ocx-tool-card pre").textContent, "**plain tool**");
});

test("v1 deltas merge raw Markdown and canonical snapshots replace it through completion refresh", async t => {
  const ui = await harness(t);
  const part = { sessionID: "session-1", messageID: "m1", partID: "p1" };
  ui.emit("message.part.updated", { sessionID: part.sessionID, part: { id: part.partID, messageID: part.messageID, type: "text", text: "**Hel" } });
  ui.emit("message.part.delta", { ...part, delta: "lo**\n\n```js\n  x" });
  const body = ui.root.querySelector(".ocx-assistant-text");
  assert.equal(body.querySelector("strong").textContent, "Hello");
  body.textContent = "tampered rendered content";
  ui.emit("message.part.delta", { ...part, delta: "  \n\nreturn x;\n```" });
  assert.equal(body.querySelector("strong").textContent, "Hello", "stream retains raw Markdown after DOM changes");
  const code = "  x  \n\nreturn x;\n";
  body.querySelector(".dm-code-copy").click();
  assert.deepEqual(ui.copied, [code]);

  const canonical = "## Canonical\n\n```js\n  newValue  \n```";
  ui.emit("message.part.updated", { sessionID: part.sessionID, delta: "ignored snapshot delta", part: { id: part.partID, messageID: part.messageID, type: "text", text: canonical } });
  assert.equal(body.querySelector("h2").textContent, "Canonical");
  assert.ok(!body.textContent.includes("Hello"));
  ui.context([{ type: "assistant", content: [{ type: "text", text: canonical }] }]);
  ui.emit("session.idle", { sessionID: part.sessionID });
  await ui.tick(60);
  assert.equal(ui.root.querySelectorAll(".ocx-message-row.assistant").length, 1);
  const saved = ui.root.querySelector(".ocx-assistant-text");
  assert.equal(saved.querySelector("h2").textContent, "Canonical");
  assert.equal(saved.closest(".ocx-message-row").classList.contains("live"), false);
  saved.querySelector(".dm-code-copy").click();
  assert.deepEqual(ui.copied, [code, "  newValue  \n"]);
  assert.equal(ui.root.querySelector("#ocxActivity").dataset.state, "completed");
});

test("legacy projected text events retain Markdown source and ended snapshots supersede deltas", async t => {
  const ui = await harness(t);
  const part = { sessionID: "session-1", assistantMessageID: "legacy", partID: 3 };
  ui.emit("session.text.started", part);
  ui.emit("session.text.delta", { ...part, delta: "**par" });
  const body = ui.root.querySelector(".ocx-assistant-text");
  body.textContent = "tampered";
  ui.emit("session.text.delta", { ...part, delta: "tial**" });
  assert.equal(body.querySelector("strong").textContent, "partial");
  ui.emit("session.text.ended", { ...part, text: "## Final\n\n```text\n  exact  \n```" });
  assert.equal(body.querySelector("h2").textContent, "Final");
  body.querySelector(".dm-code-copy").click();
  assert.deepEqual(ui.copied, ["  exact  \n"]);

  ui.emit("message.part.updated", { sessionID: "session-1", part: { id: "reasoning", messageID: "m2", type: "reasoning", text: "**plain" } });
  ui.emit("message.part.delta", { sessionID: "session-1", messageID: "m2", partID: "reasoning", delta: " thought**" });
  assert.equal(ui.root.querySelector(".ocx-reasoning div").textContent, "**plain thought**");
  assert.equal(ui.root.querySelector(".ocx-reasoning strong"), null);
});

test("failed OpenCode history load keeps the session and retries without sending", async t => {
  const ui = await harness(t, "unavailable");
  const notice = ui.root.querySelector("#ocxTranscript [data-history-retry]");
  assert.ok(notice, "history failure shows a retry notice");
  assert.equal(notice.getAttribute("role"), "alert");
  assert.equal(ui.window.localStorage.getItem("opencode-pocket-opencode-session"), "session-1");
  assert.equal(ui.root.querySelector("#ocxSessionTitle").textContent, "Test session");

  ui.root.querySelector("#ocxPromptInput").value = "unsent draft";
  ui.context([{ type: "assistant", content: [{ type: "text", text: "Recovered answer" }] }]);
  const before = ui.requests.length;
  notice.querySelector("button").click();
  await settle();

  const retried = ui.requests.slice(before);
  assert.ok(retried.some(request => request.path.endsWith("/session/session-1/context")));
  assert.deepEqual(retried.filter(request => request.method !== "GET"), []);
  assert.equal(ui.root.querySelector("[data-history-retry]"), null);
  assert.equal(ui.root.querySelector(".ocx-assistant-text").textContent.trim(), "Recovered answer");
  assert.equal(ui.root.querySelector("#ocxPromptInput").value, "unsent draft");
  assert.equal(ui.window.localStorage.getItem("opencode-pocket-opencode-session"), "session-1");
});

test("failed OpenCode session list offers an in-place retry that keeps the draft", async t => {
  const ui = await harness(t, [], { listFailures: 1 });
  const notice = ui.root.querySelector("#ocxSessions [data-history-retry]");
  assert.ok(notice, "list failure shows a retry notice in the sidebar");
  assert.equal(notice.getAttribute("role"), "alert");
  assert.equal(notice.querySelector("p").textContent, i18nCore.translate("en", "chat.history.listLoadFailed"));

  ui.root.querySelector("#ocxPromptInput").value = "unsent draft";
  const before = ui.requests.length;
  notice.querySelector("button").click();
  await settle();

  const retried = ui.requests.slice(before);
  assert.ok(retried.some(request => request.path === "/api/opencode/session"));
  assert.deepEqual(retried.filter(request => request.method !== "GET"), []);
  assert.deepEqual(retried.filter(request => request.path.startsWith("/api/opencode/session/session-1")), [], "the saved session is not opened under the draft");
  assert.equal(ui.root.querySelector("#ocxSessions [data-history-retry]"), null);
  assert.ok(ui.root.querySelector("#ocxSessions").textContent.includes("Test session"));
  assert.equal(ui.root.querySelector("#ocxPromptInput").value, "unsent draft");
});

test("OpenCode copies every text part of the latest answer and reports when there is none", async t => {
  const empty = await harness(t);
  empty.root.querySelector("#ocxCopyLatest").click();
  await settle();
  assert.deepEqual(empty.copied, []);
  assert.equal(empty.root.querySelector("#ocxToast").classList.contains("hidden"), false);

  const ui = await harness(t, [
    { type: "assistant", content: [{ type: "text", text: "First part" }, { type: "text", text: "**Second** part" }] }
  ]);
  ui.root.querySelector("#ocxCopyLatest").click();
  await settle();
  assert.deepEqual(ui.copied, ["First part\n\n**Second** part"]);
});
