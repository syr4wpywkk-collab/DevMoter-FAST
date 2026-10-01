import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";
import { JSDOM } from "jsdom";
import * as execution from "../src/execution-state.mjs";
import * as pluginMetadata from "../src/codex-plugin-metadata.mjs";
import * as reasoning from "../src/codex-reasoning.mjs";
import * as reconnect from "../src/reconnect-policy.mjs";
import * as markdown from "../src/chat-markdown.mjs";
import * as sendError from "../src/codex-send-error.mjs";

const source = await readFile(new URL("../src/codex.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
}).outputText;
const modules = new Map(await Promise.all(ts.preProcessFile(source).importedFiles
  .filter(({ fileName }) => fileName.endsWith(".mjs"))
  .map(async ({ fileName }) => [fileName, await import(new URL("../src/" + fileName.slice(2), import.meta.url))])));
const settle = () => new Promise(resolve => setImmediate(resolve));

test("native failed turn reason reaches the Codex failure UI", () => {
  const connectEvents = source.indexOf("function connectEvents()");
  const start = source.indexOf('if (method === "turn/completed")', connectEvents);
  const end = source.indexOf('if (method === "item/completed")', start);
  const eventPath = source.slice(start, end);
  assert.match(eventPath, /if \(finalState === "failed"\)[\s\S]*?completedFailure = normalizeCodexSendError\(turn\.error \?\? params\?\.error \?\? \{\}\)/);
  assert.match(source, /normalizeCodexSendError\(error\)/);
  assert.match(source, /`Category: \$\{normalized\.category\}`/);
  assert.match(source, /`Reason: \$\{normalized\.reason\}`/);
});

test("failed send exposes a restore action and opens app Diagnostics without resending", () => {
  const start = source.indexOf("function addCodexSendFailure(");
  const end = source.indexOf("function addMcpToolResult(", start);
  const failureUi = source.slice(start, end);
  assert.match(failureUi, /textContent = "入力に戻す"/);
  assert.match(failureUi, /promptInput\.value\.trim\(\) \|\| pendingAttachments\.length \|\| selectedContextRefs\.length/);
  assert.match(failureUi, /activeThreadId !== retryDraft\.threadId/);
  assert.match(failureUi, /detail: \{ page: "diagnostics" \}/);
  assert.match(failureUi, /textContent = "Diagnostics"/);
  assert.doesNotMatch(failureUi, /void sendMessage\(\)/);
});

test("native completion reason survives the thread/read transcript replacement", async t => {
  const dom = new JSDOM('<!doctype html><main id="root"></main>', {
    url: "https://devmoter.example/?surface=codex",
    runScripts: "outside-only"
  });
  t.after(() => dom.window.close());
  const { window } = dom;
  const { document } = window;
  const requests = [];
  let eventSource;
  let threadReadCount = 0;
  window.matchMedia = () => ({ matches: false, addEventListener() {} });
  window.setInterval = () => 1;
  window.setTimeout = () => 1;
  window.clearTimeout = () => {};
  window.requestAnimationFrame = callback => { callback(); return 1; };
  window.confirm = () => true;
  window.localStorage.setItem("opencode-pocket-codex-thread", "thread-1");
  window.EventSource = class {
    listeners = new Map();
    constructor() { eventSource = this; }
    addEventListener(name, listener) { this.listeners.set(name, listener); }
    close() {}
    emit(name, data) { this.listeners.get(name)?.({ data: JSON.stringify(data) }); }
  };
  window.fetch = async (input, init = {}) => {
    const path = String(input);
    requests.push({ path, body: init.body ? JSON.parse(String(init.body)) : null });
    const ok = (result, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => result });
    const okRpc = result => ok({ result });
    if (path === "/api/projects") return ok({ projects: [] });
    if (path !== "/api/codex/rpc") throw new Error(`Unexpected request: ${path}`);
    const { method, params } = JSON.parse(String(init.body));
    if (method === "model/list") return okRpc({ models: [] });
    if (method === "thread/list") return okRpc({ data: [{ id: "thread-1", name: "Test thread" }] });
    if (method === "thread/resume") return okRpc({});
    if (method === "thread/read") {
      if (!params.includeTurns) return okRpc({ thread: { id: "thread-1", status: {}, turns: [] } });
      threadReadCount += 1;
      return okRpc({ thread: {
        status: {},
        turns: threadReadCount <= 2 ? [] : [{
          id: "turn-1",
          status: "failed",
          error: { message: "The requested model is unavailable", codexErrorInfo: { category: "Model" } },
          items: [{ type: "userMessage", content: [{ type: "text", text: "Please do the work" }] }]
        }]
      } });
    }
    if (method === "turn/start") return okRpc({ turn: { id: "turn-1" } });
    return okRpc({});
  };

  const require = name => {
    if (modules.has(name)) return modules.get(name);
    if (name === "./i18n") return { speechRecognitionLanguage: () => "en-US" };
    if (name === "./dev-workflows-ui") return { createDevWorkflowPanel: () => ({ show: async () => {} }) };
    if (name === "./mcp-result") return { isMcpToolItem: () => false, mcpToolSummary: () => ({}), normalizeStructuredMcpResult: value => ({ value, rawText: "", truncated: false }) };
    if (name === "./bounded-transcript") return { enforceTranscriptLimit() {} };
    if (name === "./codex-plugin-metadata.mjs") return pluginMetadata;
    if (name === "./execution-state.mjs") return execution;
    if (name === "./codex-reasoning.mjs") return reasoning;
    if (name === "./reconnect-policy.mjs") return reconnect;
    if (name === "./chat-markdown.mjs") return markdown;
    if (name === "./codex-send-error.mjs") return sendError;
    if (name === "./wake-lock") return { setWakeLockExecutionActive() {} };
    if (name === "./safety-client") return { runPreExecutionGuard: async () => ({ decision: "allow" }), guardMessage: () => "", continueAgentRun: async () => {}, loopMessage: () => "", matchRememberedPermission: async () => ({ matched: false }), recordAgentAction: async () => null, rememberPermission: async () => {}, scanCommand: async () => ({ dangerous: false }) };
    if (name.endsWith(".css")) return {};
    throw new Error(`Unexpected module: ${name}`);
  };
  window.exports = {};
  window.Function("require", "exports", compiled)(require, window.exports);
  const controller = window.exports.mountCodexRemote(document.querySelector("#root"));
  controller.setOnline(true);
  await settle();
  await settle();
  assert.equal(document.querySelector("#cxPromptInput").disabled, false);
  document.querySelector("#cxPromptInput").value = "Please do the work";
  document.querySelector("#cxPromptForm").dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
  await settle();
  await settle();

  eventSource.emit("notification", {
    method: "turn/completed",
    params: {
      threadId: "thread-1",
      turn: { id: "turn-1", status: "failed", error: { message: "The requested model is unavailable", codexErrorInfo: { category: "Model" } } }
    }
  });
  await settle();
  await settle();

  let failure = [...document.querySelectorAll(".cx-message.system")]
    .find(node => node.textContent.includes("The requested model is unavailable"));
  assert.ok(failure, `failure remains after the failed thread/read replaces transcript children: ${JSON.stringify({ requests, transcript: document.querySelector("#cxTranscript").textContent })}`);
  await controller.refresh();
  await settle();
  failure = [...document.querySelectorAll(".cx-message.system")]
    .find(node => node.textContent.includes("The requested model is unavailable"));
  assert.ok(failure, "cached turn error remains when the next canonical thread/read includes the failed turn");
  assert.ok(requests.some(request => request.body?.method === "thread/read" && request.body?.params?.includeTurns));
  assert.ok(failure.querySelector("button")?.textContent === "入力に戻す");
  document.querySelector("#cxPromptInput").value = "Keep this newer draft";
  failure.querySelector("button").click();
  assert.equal(document.querySelector("#cxPromptInput").value, "Keep this newer draft");
  document.querySelector("#cxPromptInput").value = "";
  failure.querySelector("button").click();
  assert.equal(document.querySelector("#cxPromptInput").value, "Please do the work");
  assert.equal(document.activeElement, document.querySelector("#cxPromptInput"));
});
