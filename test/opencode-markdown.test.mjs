import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";
import { JSDOM } from "jsdom";
import * as execution from "../src/execution-state.mjs";
import * as events from "../src/opencode-event-compat.mjs";
import * as sessions from "../src/session-tools.mjs";
import * as pricing from "../src/model-pricing.mjs";
import * as reconnect from "../src/reconnect-policy.mjs";
import { renderChatMarkdown } from "../src/chat-markdown.mjs";

const compile = source => ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
}).outputText;
const compiled = compile(await readFile(new URL("../src/opencode.ts", import.meta.url), "utf8"));
const compiledBounds = compile(await readFile(new URL("../src/bounded-transcript.ts", import.meta.url), "utf8"));
const settle = () => new Promise(resolve => setImmediate(resolve));

async function harness(t, initialContext = []) {
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
  window.fetch = async input => {
    const url = new URL(String(input), window.location.href);
    const path = url.pathname;
    let payload = [];
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
  const bounds = evaluate(compiledBounds, () => { throw new Error("Unexpected bounds import"); });
  const modules = {
    "./execution-state.mjs": execution,
    "./opencode-event-compat.mjs": events,
    "./session-tools.mjs": sessions,
    "./model-pricing.mjs": pricing,
    "./reconnect-policy.mjs": reconnect,
    "./chat-markdown.mjs": { renderChatMarkdown },
    "./bounded-transcript": bounds,
    "./opencode-chat.css": {},
    "./i18n": { speechRecognitionLanguage: () => "en-US" },
    "./wake-lock": { setWakeLockExecutionActive() {}, wakeLockEnabled: () => false, wakeLockSupported: () => false },
    "./safety-client": {}
  };
  const { mountOpenCodeRemote } = evaluate(compiled, name => {
    assert.ok(Object.hasOwn(modules, name), `unexpected module: ${name}`);
    return modules[name];
  });
  const controller = mountOpenCodeRemote(root);
  controller.setOnline(true);
  await settle();
  assert.equal(root.querySelector("#ocxSessionTitle").textContent, "Test session");
  return {
    root, copied, controller,
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
