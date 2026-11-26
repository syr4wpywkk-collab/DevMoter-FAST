import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript-legacy";
import { JSDOM } from "jsdom";
import * as i18nCore from "../src/i18n-core.mjs";
import { loadPureTypeScript } from "./helpers/ts-pure-modules.mjs";

const source = await readFile(new URL("../src/devin-chat.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
}).outputText;
const modules = new Map(await Promise.all(ts.preProcessFile(source).importedFiles
  .filter(({ fileName }) => fileName.endsWith(".mjs"))
  .map(async ({ fileName }) => [fileName, await import(new URL("../src/" + fileName.slice(2), import.meta.url))])));
modules.set("./app-registry", await loadPureTypeScript("app-registry.ts"));
const settle = () => new Promise(resolve => setImmediate(resolve));

async function mountDevin(fetchImpl) {
  const dom = new JSDOM('<!doctype html><main id="root"></main>', {
    url: "https://devmoter.example/?surface=devin",
    runScripts: "outside-only"
  });
  const { window } = dom;
  const { document } = window;
  let eventSource = null;
  window.matchMedia = () => ({ matches: false, addEventListener() {} });
  window.requestAnimationFrame = callback => { callback(); return 1; };
  window.confirm = () => true;
  window.Headers = Headers;
  if (!window.crypto?.randomUUID) window.crypto = globalThis.crypto;
  window.EventSource = class {
    listeners = new Map();
    constructor(url) { this.url = url; eventSource = this; }
    addEventListener(name, listener) {
      const list = this.listeners.get(name) || [];
      list.push(listener);
      this.listeners.set(name, list);
    }
    close() {}
    emit(name, data) { for (const listener of this.listeners.get(name) || []) listener({ data: JSON.stringify(data) }); }
  };
  window.fetch = fetchImpl;
  const require = name => {
    if (modules.has(name)) return modules.get(name);
    if (name === "./i18n") return i18nCore;
    if (name === "./app-registry") return modules.get("./app-registry");
    if (name.endsWith(".css")) return {};
    throw new Error(`Unexpected module: ${name}`);
  };
  window.exports = {};
  window.Function("require", "exports", compiled)(require, window.exports);
  const controller = window.exports.mountDevinChat(document.querySelector("#root"));
  return { dom, window, document, controller, exports: window.exports, getEventSource: () => eventSource };
}

const jsonResponse = (body, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body
});

test("Devin UI shows the install guide and disables input when the CLI is not installed", async t => {
  const notice = "devin が見つからないよ。入れ方: curl -fsSL https://cli.devin.ai/install.sh | bash";
  const { dom, document, controller } = await mountDevin(async input => {
    if (String(input) === "/api/devin/health") {
      return jsonResponse({ online: false, ready: false, loggedIn: false, bin: "devin", cwd: "/work", error: notice, code: "not_installed" }, 503);
    }
    throw new Error(`Unexpected request: ${input}`);
  });
  t.after(() => dom.window.close());

  await controller.refresh();
  await settle();

  const state = document.querySelector("[data-devin-state]");
  assert.equal(state.textContent, i18nCore.translate("en", "devin.availability.notInstalled"));
  assert.equal(state.dataset.devinState, "not_installed");
  assert.equal(state.classList.contains("missing"), true);
  const availability = document.querySelector("[data-devin-availability]");
  assert.equal(availability.hidden, false);
  assert.match(availability.textContent, /curl -fsSL/);
  assert.ok(availability.textContent.includes(i18nCore.translate("en", "devin.availability.notInstalledGuide")));
  assert.equal(document.querySelector("[data-devin-input]").disabled, true);
  assert.equal(document.querySelector("[data-devin-send]").disabled, true);
});

test("Devin UI shows the login guide when Devin is not logged in", async t => {
  const { dom, document, controller } = await mountDevin(async input => {
    if (String(input) === "/api/devin/health") {
      return jsonResponse({ online: false, ready: false, loggedIn: false, bin: "devin", cwd: "/work", error: "Devin is not logged in. Run `devin auth login` first.", code: "not_logged_in" }, 503);
    }
    throw new Error(`Unexpected request: ${input}`);
  });
  t.after(() => dom.window.close());

  await controller.refresh();
  await settle();

  const state = document.querySelector("[data-devin-state]");
  assert.equal(state.textContent, i18nCore.translate("en", "devin.availability.notLoggedIn"));
  assert.equal(state.dataset.devinState, "not_logged_in");
  const availability = document.querySelector("[data-devin-availability]");
  assert.equal(availability.hidden, false);
  assert.ok(availability.textContent.includes(i18nCore.translate("en", "devin.availability.notLoggedInGuide")));
  assert.equal(document.querySelector("[data-devin-input]").disabled, true);
});

test("Devin UI creates a session, streams chunks over SSE, changes config, and loads a past session", async t => {
  const requests = [];
  let eventSourceRef = null;
  const emitUpdate = (sessionId, update) => eventSourceRef?.emit("notification", {
    method: "session/update",
    params: { sessionId, update }
  });
  const { dom, window, document, controller, getEventSource } = await mountDevin(async (input, init = {}) => {
    const path = String(input);
    if (path === "/api/devin/health") {
      return jsonResponse({ online: true, ready: true, loggedIn: true, bin: "devin", cwd: "/work/project" });
    }
    if (path === "/api/projects") return jsonResponse({ projects: [{ id: "p1", name: "Proj", path: "/work/project", available: true }] });
    if (path === "/api/devin/notify") return jsonResponse({ ok: true });
    if (path !== "/api/devin/rpc") throw new Error(`Unexpected request: ${path}`);
    const { method, params } = JSON.parse(String(init.body));
    requests.push({ method, params });
    if (method === "session/list") {
      return jsonResponse({ result: { sessions: [{ sessionId: "s-old", cwd: "/work/project", title: "Old session", updatedAt: "2026-11-20T00:00:00.000Z" }] } });
    }
    if (method === "session/new") {
      assert.equal(params.cwd, "/work/project", "session/new sends the selected project path as cwd");
      assert.deepEqual(params.mcpServers, []);
      return jsonResponse({ result: {
        sessionId: "s1",
        modes: { currentModeId: "default", availableModes: [] },
        configOptions: [{ id: "model", name: "Model", type: "select", currentValue: "m1", options: [{ value: "m1", name: "Model 1" }, { value: "m2", name: "Model 2" }] }]
      } });
    }
    if (method === "session/prompt") {
      assert.equal(params.sessionId, "s1");
      assert.deepEqual(params.prompt, [{ type: "text", text: "Do the work" }]);
      eventSourceRef = getEventSource();
      emitUpdate("s1", { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Hello " } });
      emitUpdate("s1", { sessionUpdate: "tool_call", toolCallId: "tc1", title: "run_shell" });
      emitUpdate("s1", { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "world" } });
      emitUpdate("s1", { sessionUpdate: "usage_update", used: 3, size: 10 });
      return jsonResponse({ result: { stopReason: "end_turn" } });
    }
    if (method === "session/set_config_option") return jsonResponse({ result: {} });
    if (method === "session/load") {
      eventSourceRef = getEventSource();
      emitUpdate("s-old", { sessionUpdate: "user_message_chunk", content: { type: "text", text: "Earlier question" } });
      emitUpdate("s-old", { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Earlier answer" } });
      return jsonResponse({ result: {} });
    }
    throw new Error(`Unexpected RPC method: ${method}`);
  });
  t.after(() => dom.window.close());

  await controller.refresh();
  await settle();
  assert.equal(document.querySelector("[data-devin-state]").dataset.devinState, "online");
  assert.equal(document.querySelector("[data-devin-input]").disabled, false);
  assert.equal(getEventSource()?.url, "/api/devin/events");

  const input = document.querySelector("[data-devin-input]");
  input.value = "Do the work";
  input.dispatchEvent(new window.Event("input", { bubbles: true }));
  document.querySelector("[data-devin-form]").dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
  await settle();
  await settle();

  const messages = document.querySelector("[data-devin-messages]");
  assert.match(messages.textContent, /Do the work/);
  assert.match(messages.textContent, /Hello world/);
  assert.match(messages.textContent, /run_shell/);
  assert.equal(document.querySelector("[data-devin-usage]").textContent, i18nCore.translate("en", "devin.chat.usage", { used: "3", size: "10" }));

  const select = document.querySelector("[data-devin-config='model']");
  assert.ok(select, "config select is rendered from session/new configOptions");
  assert.equal(select.value, "m1");
  select.value = "m2";
  select.dispatchEvent(new window.Event("change", { bubbles: true }));
  await settle();
  const configChange = requests.find(request => request.method === "session/set_config_option");
  assert.deepEqual(configChange.params, { sessionId: "s1", configId: "model", value: "m2" });

  document.querySelector("[data-devin-history]").click();
  await settle();
  const historyItem = [...document.querySelectorAll("[data-session-id]")].find(item => item.dataset.sessionId === "s-old");
  assert.ok(historyItem, "session/list entries are shown in the history sheet");
  historyItem.click();
  await settle();
  await settle();
  assert.ok(requests.some(request => request.method === "session/load" && request.params.sessionId === "s-old"));
  assert.match(document.querySelector("[data-devin-messages]").textContent, /Earlier question/);
  assert.match(document.querySelector("[data-devin-messages]").textContent, /Earlier answer/);
});

test("isMethodNotFoundError identifies JSON-RPC -32601 and method-not-found messages", async t => {
  const { dom, exports } = await mountDevin(async () => jsonResponse({}));
  t.after(() => dom.window.close());
  const { isMethodNotFoundError } = exports;

  assert.equal(isMethodNotFoundError(new Error("Method not found")), true);
  assert.equal(isMethodNotFoundError(new Error("JSON-RPC error -32601: session/list")), true);
  assert.equal(isMethodNotFoundError({ message: "method not found" }), true);
  assert.equal(isMethodNotFoundError({ code: -32601, message: "unsupported" }), true);
  assert.equal(isMethodNotFoundError("Error -32601"), true);
  assert.equal(isMethodNotFoundError(new Error("ACP request timeout: session/list")), false);
  assert.equal(isMethodNotFoundError(new Error("")), false);
  assert.equal(isMethodNotFoundError(null), false);
});

test("Devin UI retries session/list once after failure and succeeds without notice", async t => {
  let listCalls = 0;
  const { dom, window, document, controller } = await mountDevin(async (input, init = {}) => {
    const path = String(input);
    if (path === "/api/devin/health") return jsonResponse({ online: true, ready: true, loggedIn: true, bin: "devin", cwd: "/work/project" });
    if (path === "/api/projects") return jsonResponse({ projects: [{ id: "p1", name: "Proj", path: "/work/project", available: true }] });
    if (path === "/api/devin/rpc") {
      const { method } = JSON.parse(String(init.body));
      if (method === "session/list") {
        listCalls += 1;
        if (listCalls === 1) return jsonResponse({ error: "ACP request timeout: session/list" }, 502);
        return jsonResponse({ result: { sessions: [{ sessionId: "s-retry", cwd: "/work/project", title: "Recovered session" }] } });
      }
    }
    throw new Error(`Unexpected request: ${path}`);
  });
  t.after(() => dom.window.close());

  const delays = [];
  window.setTimeout = (fn, delay) => {
    delays.push(delay);
    setImmediate(fn);
    return delays.length;
  };

  await controller.refresh();
  await settle();

  assert.equal(listCalls, 2);
  assert.deepEqual(delays, [800]);
  assert.equal(document.querySelector("[data-devin-status]").textContent, "");

  document.querySelector("[data-devin-history]").click();
  await settle();
  const item = document.querySelector("[data-session-id='s-retry']");
  assert.ok(item, "recovered sessions appear in the history sheet");
  assert.equal(listCalls, 2, "opening history after a successful load does not re-fetch");
});

test("Devin UI shows server error in notice after retry fails, and re-fetches when opening history", async t => {
  let listCalls = 0;
  const { dom, window, document, controller } = await mountDevin(async (input, init = {}) => {
    const path = String(input);
    if (path === "/api/devin/health") return jsonResponse({ online: true, ready: true, loggedIn: true, bin: "devin", cwd: "/work/project" });
    if (path === "/api/projects") return jsonResponse({ projects: [{ id: "p1", name: "Proj", path: "/work/project", available: true }] });
    if (path === "/api/devin/rpc") {
      const { method } = JSON.parse(String(init.body));
      if (method === "session/list") {
        listCalls += 1;
        if (listCalls <= 2) return jsonResponse({ error: "ACP request timeout: session/list" }, 502);
        return jsonResponse({ result: { sessions: [{ sessionId: "s-later", cwd: "/work/project", title: "Loaded on sheet open" }] } });
      }
    }
    throw new Error(`Unexpected request: ${path}`);
  });
  t.after(() => dom.window.close());

  const delays = [];
  window.setTimeout = (fn, delay) => {
    delays.push(delay);
    setImmediate(fn);
    return delays.length;
  };

  await controller.refresh();
  await settle();

  assert.equal(listCalls, 2);
  assert.deepEqual(delays, [800]);
  const statusText = document.querySelector("[data-devin-status]").textContent;
  assert.ok(statusText.includes(i18nCore.translate("en", "devin.chat.sessionsLoadFailed")));
  assert.ok(statusText.includes("ACP request timeout: session/list"));

  // Opening the history sheet after a failed fetch retries session/list and clears the notice on success.
  document.querySelector("[data-devin-history]").click();
  await settle();
  await settle();

  assert.equal(listCalls, 3);
  assert.equal(document.querySelector("[data-devin-status]").textContent, "");
  assert.ok(document.querySelector("[data-session-id='s-later']"), "history sheet shows sessions loaded on retry");
});

test("Devin UI falls back to fixed notice when session/list error has no message", async t => {
  let listCalls = 0;
  const { dom, window, document, controller } = await mountDevin(async (input, init = {}) => {
    const path = String(input);
    if (path === "/api/devin/health") return jsonResponse({ online: true, ready: true, loggedIn: true, bin: "devin", cwd: "/work/project" });
    if (path === "/api/projects") return jsonResponse({ projects: [] });
    if (path === "/api/devin/rpc") {
      const { method } = JSON.parse(String(init.body));
      if (method === "session/list") {
        listCalls += 1;
        throw new Error("");
      }
    }
    throw new Error(`Unexpected request: ${path}`);
  });
  t.after(() => dom.window.close());

  window.setTimeout = fn => {
    setImmediate(fn);
    return 1;
  };

  await controller.refresh();
  await settle();

  assert.equal(listCalls, 2);
  assert.equal(document.querySelector("[data-devin-status]").textContent, i18nCore.translate("en", "devin.chat.sessionsLoadFailed"));
});

test("Devin UI degrades gracefully without notice when session/list returns -32601 Method not found", async t => {
  let listCalls = 0;
  const { dom, window, document, controller } = await mountDevin(async (input, init = {}) => {
    const path = String(input);
    if (path === "/api/devin/health") return jsonResponse({ online: true, ready: true, loggedIn: true, bin: "devin", cwd: "/work/project" });
    if (path === "/api/projects") return jsonResponse({ projects: [] });
    if (path === "/api/devin/rpc") {
      const { method } = JSON.parse(String(init.body));
      if (method === "session/list") {
        listCalls += 1;
        return jsonResponse({ error: "JSON-RPC error -32601: Method not found" }, 502);
      }
    }
    throw new Error(`Unexpected request: ${path}`);
  });
  t.after(() => dom.window.close());

  const delays = [];
  window.setTimeout = (fn, delay) => {
    delays.push(delay);
    setImmediate(fn);
    return delays.length;
  };

  await controller.refresh();
  await settle();

  assert.equal(listCalls, 1, "-32601 does not retry");
  assert.deepEqual(delays, []);
  assert.equal(document.querySelector("[data-devin-status]").textContent, "");

  document.querySelector("[data-devin-history]").click();
  await settle();

  assert.equal(listCalls, 1, "opening history after -32601 does not re-call session/list");
  assert.equal(document.querySelector(".dv-history-empty")?.textContent, i18nCore.translate("en", "devin.chat.emptyHistory"));
  assert.equal(document.querySelectorAll("[data-session-id]").length, 0);
});

test("Devin permission dialog requires a click and posts an allow-once decision", async t => {
  const decisions = [];
  let finishPrompt;
  const { dom, window, document, controller, getEventSource } = await mountDevin(async (input, init = {}) => {
    const path = String(input);
    if (path === "/api/devin/health") return jsonResponse({ online: true, ready: true, loggedIn: true, cwd: "/work/project" });
    if (path === "/api/projects") return jsonResponse({ projects: [{ id: "p1", name: "Proj", path: "/work/project", available: true }] });
    if (path === "/api/devin/permission") {
      decisions.push(JSON.parse(String(init.body)));
      return jsonResponse({ ok: true });
    }
    if (path !== "/api/devin/rpc") throw new Error("Unexpected fetch: " + path);
    const { method } = JSON.parse(String(init.body));
    if (method === "session/list") return jsonResponse({ result: { sessions: [] } });
    if (method === "session/new") return jsonResponse({ result: { sessionId: "s1", configOptions: [] } });
    if (method === "session/prompt") return new Promise(resolve => { finishPrompt = () => resolve(jsonResponse({ result: { stopReason: "end_turn" } })); });
    throw new Error("Unexpected RPC: " + method);
  });
  t.after(() => dom.window.close());
  await controller.refresh();
  await settle();
  const input = document.querySelector("[data-devin-input]");
  input.value = "Test tool approval";
  document.querySelector("[data-devin-form]").dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
  await settle();
  await settle();
  assert.equal(typeof finishPrompt, "function");
  getEventSource().emit("permission-request", {
    requestId: "req-1", sessionId: "s1", title: "<unsafe tool title>", kind: "execute"
  });
  const dialog = document.querySelector("[data-devin-permission]");
  assert.equal(dialog.hidden, false);
  assert.match(dialog.textContent, /<unsafe tool title>/);
  assert.equal(dialog.querySelector("script"), null, "tool title never enters the DOM as HTML");
  assert.deepEqual(decisions, [], "SSE event alone does not approve anything");
  document.querySelector("[data-devin-permission-allow]").click();
  await settle();
  assert.deepEqual(decisions, [{ requestId: "req-1", sessionId: "s1", decision: "allow_once" }]);
  assert.equal(dialog.hidden, true);
  finishPrompt();
  await settle();
});

test("Devin tool permission can be explicitly denied", async t => {
  const decisions = [];
  let finishPrompt;
  const { dom, window, document, controller, getEventSource } = await mountDevin(async (input, init = {}) => {
    const path = String(input);
    if (path === "/api/devin/health") return jsonResponse({ online: true, ready: true, loggedIn: true, cwd: "/work/project" });
    if (path === "/api/projects") return jsonResponse({ projects: [] });
    if (path === "/api/devin/permission") {
      decisions.push(JSON.parse(String(init.body)));
      return jsonResponse({ ok: true });
    }
    if (path === "/api/devin/rpc") {
      const { method } = JSON.parse(String(init.body));
      if (method === "session/list") return jsonResponse({ result: { sessions: [] } });
      if (method === "session/new") return jsonResponse({ result: { sessionId: "s1", configOptions: [] } });
      if (method === "session/prompt") return new Promise(resolve => { finishPrompt = () => resolve(jsonResponse({ result: { stopReason: "end_turn" } })); });
    }
    throw new Error("Unexpected fetch: " + path);
  });
  t.after(() => dom.window.close());
  await controller.refresh();
  await settle();
  document.querySelector("[data-devin-input]").value = "Test deny";
  document.querySelector("[data-devin-form]").dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
  await settle();
  await settle();
  getEventSource().emit("permission-request", { requestId: "req-2", sessionId: "s1", title: "Run command", kind: "execute" });
  document.querySelector("[data-devin-permission-deny]").click();
  await settle();
  assert.deepEqual(decisions, [{ requestId: "req-2", sessionId: "s1", decision: "deny" }]);
  assert.equal(document.querySelector("[data-devin-permission]").hidden, true);
  finishPrompt();
  await settle();
});
