import test from "node:test";
import assert from "node:assert/strict";
import * as i18nCore from "../src/i18n-core.mjs";

const jaI18n = {
  ...i18nCore,
  getLanguage: () => "ja",
  t: (k, p) => i18nCore.translate("ja", k, p),
  translateServerMessage: m => i18nCore.translateServerMessage(m, "ja"),
  formatDateTime: (v, o) => i18nCore.formatDateTime(v, o, "ja"),
  formatTime: (v, o) => i18nCore.formatTime(v, o, "ja"),
  formatNumber: (v, o) => i18nCore.formatNumber(v, o, "ja"),
  formatRelativeTime: (ts, now) => i18nCore.formatRelativeTime(ts, now, "ja"),
  tApp: (id, f) => i18nCore.tApp(id, f, "ja")
};
import { readFile } from "node:fs/promises";
import ts from "typescript";
import { JSDOM } from "jsdom";
import * as execution from "../src/execution-state.mjs";
import * as pluginMetadata from "../src/codex-plugin-metadata.mjs";
import * as reasoning from "../src/codex-reasoning.mjs";
import * as reconnect from "../src/reconnect-policy.mjs";
import * as markdown from "../src/chat-markdown.mjs";
import * as sendError from "../src/codex-send-error.mjs";
import * as chatDraft from "../src/chat-draft.mjs";
import * as transcriptActions from "../src/chat-transcript-actions.mjs";
import { loadPureTypeScript } from "./helpers/ts-pure-modules.mjs";

const source = await readFile(new URL("../src/codex.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
}).outputText;
const modules = new Map(await Promise.all(ts.preProcessFile(source).importedFiles
  .filter(({ fileName }) => fileName.endsWith(".mjs"))
  .map(async ({ fileName }) => [fileName, await import(new URL("../src/" + fileName.slice(2), import.meta.url))])));
modules.set("./codex/presentation", await loadPureTypeScript("codex/presentation.ts"));
modules.set("./codex/icons", await loadPureTypeScript("codex/icons.ts"));
modules.set("./app-registry", await loadPureTypeScript("app-registry.ts"));
const settle = () => new Promise(resolve => setImmediate(resolve));

test("native failed turn reason reaches the Codex failure UI", () => {
  const connectEvents = source.indexOf("function connectEvents()");
  const start = source.indexOf('if (method === "turn/completed")', connectEvents);
  const end = source.indexOf('if (method === "item/completed")', start);
  const eventPath = source.slice(start, end);
  assert.match(eventPath, /if \(finalState === "failed"\)[\s\S]*?completedFailure = normalizeCodexSendError\(turn\.error \?\? params\?\.error \?\? \{\}\)/);
  assert.match(source, /normalizeCodexSendError\(error\)/);
  assert.match(source, /t\("codex\.sendError\.detailCategory", \{ value: localizedCategory \}\)/);
  assert.match(source, /t\("codex\.sendError\.detailReason", \{ value: localizedReason \}\)/);
});

test("failed send exposes a restore action and opens app Diagnostics without resending", () => {
  const start = source.indexOf("function addCodexSendFailure(");
  const end = source.indexOf("function addMcpToolResult(", start);
  const failureUi = source.slice(start, end);
  assert.match(failureUi, /textContent = t\("codex\.sendError\.restoreInput"\)/);
  assert.match(failureUi, /promptInput\.value\.trim\(\) \|\| pendingAttachments\.length \|\| selectedContextRefs\.length/);
  assert.match(failureUi, /activeThreadId !== retryDraft\.threadId/);
  assert.match(failureUi, /detail: \{ page: "diagnostics" \}/);
  assert.match(failureUi, /textContent = t\("codex\.sendError\.diagnostics"\)/);
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
    if (name === "./i18n") return { speechRecognitionLanguage: () => "en-US", ...jaI18n };
    if (name === "./dev-workflows-ui") return { createDevWorkflowPanel: () => ({ show: async () => {} }) };
    if (name === "./mcp-result") return { isMcpToolItem: () => false, mcpToolSummary: () => ({}), normalizeStructuredMcpResult: value => ({ value, rawText: "", truncated: false }) };
    if (name === "./bounded-transcript") return { enforceTranscriptLimit() {} };
    if (name === "./codex-plugin-metadata.mjs") return pluginMetadata;
    if (name === "./execution-state.mjs") return execution;
    if (name === "./codex-reasoning.mjs") return reasoning;
    if (name === "./reconnect-policy.mjs") return reconnect;
    if (name === "./chat-markdown.mjs") return markdown;
    if (name === "./chat-draft.mjs") return chatDraft;
    if (name === "./chat-transcript-actions.mjs") return transcriptActions;
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

async function mountWithFailedThreadList(t, { savedThread = null } = {}) {
  const dom = new JSDOM('<!doctype html><main id="root"></main>', {
    url: "https://devmoter.example/?surface=codex",
    runScripts: "outside-only"
  });
  t.after(() => dom.window.close());
  const { window } = dom;
  const { document } = window;
  const methods = [];
  let listFailures = 1;
  window.matchMedia = () => ({ matches: false, addEventListener() {} });
  window.setInterval = () => 1;
  window.setTimeout = () => 1;
  window.clearTimeout = () => {};
  window.requestAnimationFrame = callback => { callback(); return 1; };
  window.EventSource = class { addEventListener() {} close() {} };
  if (savedThread) window.localStorage.setItem("opencode-pocket-codex-thread", savedThread);
  window.fetch = async (input, init = {}) => {
    const path = String(input);
    const ok = (result, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => result });
    if (path === "/api/projects") return ok({ projects: [] });
    if (path !== "/api/codex/rpc") throw new Error(`Unexpected request: ${path}`);
    const { method } = JSON.parse(String(init.body));
    methods.push(method);
    if (method === "thread/list") {
      if (listFailures > 0) { listFailures -= 1; return ok({ error: "list unavailable" }, 503); }
      return ok({ result: { data: [{ id: "thread-1", name: "Recovered thread", cwd: "/work/other" }] } });
    }
    if (method === "model/list") return ok({ result: { models: [] } });
    return ok({ result: {} });
  };
  const require = name => {
    if (modules.has(name)) return modules.get(name);
    if (name === "./i18n") return { speechRecognitionLanguage: () => "en-US", ...jaI18n };
    if (name === "./dev-workflows-ui") return { createDevWorkflowPanel: () => ({ show: async () => {} }) };
    if (name === "./mcp-result") return { isMcpToolItem: () => false, mcpToolSummary: () => ({}), normalizeStructuredMcpResult: value => ({ value, rawText: "", truncated: false }) };
    if (name === "./bounded-transcript") return { enforceTranscriptLimit() {} };
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

  return { window, document, methods };
}

test("failed Codex thread list shows an in-place retry that keeps the draft", async t => {
  const { document, methods } = await mountWithFailedThreadList(t);
  const notice = document.querySelector("#cxSidebarThreads [data-history-retry]");
  assert.ok(notice, "list failure replaces the loading placeholder with a retry notice");
  assert.equal(notice.getAttribute("role"), "alert");
  assert.equal(notice.querySelector("p").textContent, i18nCore.translate("ja", "chat.history.listLoadFailed"));

  document.querySelector("#cxPromptInput").value = "unsent draft";
  const before = methods.length;
  notice.querySelector("button").click();
  await settle();
  await settle();

  assert.deepEqual(methods.slice(before).filter(method => method !== "thread/list"), []);
  assert.equal(document.querySelector("#cxSidebarThreads [data-history-retry]"), null);
  assert.ok(document.querySelector("#cxSidebarThreads").textContent.includes("Recovered thread"));
  assert.equal(document.querySelector("#cxPromptInput").value, "unsent draft");
});

test("Codex list retry survives a search and does not swap a draft for the saved thread", async t => {
  const { window, document, methods } = await mountWithFailedThreadList(t, { savedThread: "thread-1" });
  const search = document.querySelector("#cxThreadSearch");
  search.value = "abc";
  search.dispatchEvent(new window.Event("input", { bubbles: true }));
  assert.equal(document.querySelector("#cxSidebarThreads [data-history-retry]"), null);
  search.value = "";
  search.dispatchEvent(new window.Event("input", { bubbles: true }));
  const notice = document.querySelector("#cxSidebarThreads [data-history-retry]");
  assert.ok(notice, "clearing the search brings the retry back while the list is still missing");

  document.querySelector("#cxPromptInput").value = "draft for a new chat";
  const before = methods.length;
  notice.querySelector("button").click();
  await settle();
  await settle();

  assert.deepEqual(methods.slice(before), ["thread/list"], "the saved thread is not reopened under the draft");
  assert.ok(document.querySelector("#cxSidebarThreads").textContent.includes("Recovered thread"));
  assert.equal(document.querySelector("#cxPromptInput").value, "draft for a new chat");
});
