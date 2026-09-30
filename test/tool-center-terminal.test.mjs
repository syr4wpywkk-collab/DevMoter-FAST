import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import ts from "typescript";
import { JSDOM } from "jsdom";

const source = await readFile(new URL("../src/control-center.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source.replace(/^import .*;\s*$/gm, ""), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
}).outputText;

const settle = async () => {
  for (let index = 0; index < 10; index++) await new Promise(resolve => setImmediate(resolve));
};

const session = ({ id = "terminal-one", persistent = true, name = "api-dev", seq = 4 } = {}) => ({
  id,
  name,
  persistent,
  expiresAt: null,
  status: "detached",
  projectId: "project-a",
  projectName: "Sample",
  cwd: "/work/sample",
  createdAt: 1,
  lastAttachedAt: null,
  lastActivityAt: 1,
  closed: false,
  exitCode: null,
  signal: null,
  seq
});

function mount({ fetch, confirm = () => true, prompt = () => null, storedRecord = null } = {}) {
  const dom = new JSDOM("<!doctype html><main><button>Background</button></main>", {
    url: "https://devmoter.example/", runScripts: "outside-only"
  });
  const { window } = dom;
  Object.defineProperty(window.HTMLElement.prototype, "inert", {
    get() { return this.hasAttribute("inert"); },
    set(value) { this.toggleAttribute("inert", Boolean(value)); }
  });
  window.HTMLElement.prototype.getClientRects = function () {
    return this.closest(".hidden, [inert], [aria-hidden='true']") ? [] : [{ width: 44, height: 44 }];
  };
  window.requestAnimationFrame = callback => { callback(); return 1; };
  window.confirm = confirm;
  window.prompt = prompt;
  window.fetch = fetch;
  window.localStorage.setItem("opencode-pocket-project", "project-a");
  if (storedRecord) window.sessionStorage.setItem("devmoter-terminal-record", JSON.stringify(storedRecord));

  class FakeTerminal {
    constructor(options) {
      this.options = options;
      this.cols = 80;
      this.rows = 24;
    }
    loadAddon() {}
    open(element) { this.element = element; }
    onData(callback) { this.dataHandler = callback; }
    onResize(callback) { this.resizeHandler = callback; }
    write(data) { this.writes ||= []; this.writes.push(data); }
    reset() { this.resetCalled = true; }
    input() {}
  }
  class FakeFitAddon { fit() {} }
  const socketInstances = [];
  class FakeWebSocket {
    static OPEN = 1;
    static CLOSING = 2;
    constructor(url, protocols) {
      this.url = url;
      this.protocols = protocols;
      this.readyState = FakeWebSocket.CONNECTING;
      socketInstances.push(this);
    }
    close(code = 1000, reason = "") {
      this.closeCall = { code, reason };
      this.readyState = FakeWebSocket.CLOSED;
      this.onclose?.({ code, reason });
    }
    send(data) { this.sent ||= []; this.sent.push(data); }
    open() {
      this.readyState = FakeWebSocket.OPEN;
      this.onopen?.();
    }
  }
  FakeWebSocket.CONNECTING = 0;
  FakeWebSocket.CLOSED = 3;

  const exports = {};
  const module = { exports };
  vm.runInNewContext(compiled, {
    exports,
    module,
    require: name => name === "@xterm/xterm"
      ? { Terminal: FakeTerminal }
      : name === "@xterm/addon-fit"
        ? { FitAddon: FakeFitAddon }
        : {},
    window,
    document: window.document,
    HTMLElement: window.HTMLElement,
    HTMLDivElement: window.HTMLDivElement,
    localStorage: window.localStorage,
    sessionStorage: window.sessionStorage,
    fetch: window.fetch,
    Headers,
    crypto: window.crypto,
    btoa: window.btoa.bind(window),
    location: window.location,
    WebSocket: FakeWebSocket,
    ResizeObserver: class { observe() {} disconnect() {} },
    setTimeout: window.setTimeout.bind(window),
    clearTimeout: window.clearTimeout.bind(window)
  });
  module.exports.mountControlCenter();
  return { dom, window, document: window.document, socketInstances };
}

function response(payload, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => payload };
}

test("mounting and opening Tools only lists sessions and shows the Trusted-device gate", async t => {
  const requests = [];
  const app = mount({ fetch: async (path, init = {}) => {
    const url = String(path);
    const method = init.method || "GET";
    requests.push({ url, method, init });
    if (url === "/api/projects") return response({ projects: [{ id: "project-a", name: "Sample", path: "/work/sample" }] });
    if (url === "/api/terminal/sessions") return response({ error: "Trusted device required" }, 403);
    return response({ error: `Unexpected request: ${method} ${url}` }, 404);
  } });
  t.after(() => app.dom.window.close());

  await settle();
  app.document.querySelector(".dm-tools-launcher").click();
  await settle();

  assert.ok(app.document.querySelector("[data-terminal-device-gate]"));
  assert.match(app.document.querySelector(".dm-terminal-status").textContent, /Trusted device required/);
  assert.ok(requests.filter(item => item.url === "/api/terminal/sessions").length > 0);
  assert.ok(requests.filter(item => item.url === "/api/terminal/sessions").every(item => item.method === "GET"));
  assert.equal(requests.some(item => item.method === "POST" || item.method === "DELETE"), false);
  assert.equal(app.window.sessionStorage.getItem("devmoter-terminal-record"), null);
});

test("explicit start sends scoped create data, attaches through a one-use ticket, and panel close only detaches", async t => {
  const requests = [];
  let ticketNumber = 0;
  const created = session();
  const app = mount({ fetch: async (path, init = {}) => {
    const url = String(path);
    const method = init.method || "GET";
    requests.push({ url, method, init });
    if (url === "/api/projects") return response({ projects: [{ id: "project-a", name: "Sample", path: "/work/sample" }] });
    if (url === "/api/terminal/sessions" && method === "GET") return response({ sessions: [created] });
    if (url === "/api/terminal/sessions" && method === "POST") return response({ session: created, token: "test-session-token" });
    if (url.endsWith("/socket-ticket")) return response({ ticket: `test-ticket-${++ticketNumber}` });
    if (url === "/api/terminal/sessions/terminal-one" && method === "GET") return response({ session: created });
    return response({ error: `Unexpected request: ${method} ${url}` }, 404);
  } });
  t.after(() => app.dom.window.close());

  await settle();
  app.document.querySelector(".dm-tools-launcher").click();
  await settle();
  const terminal = app.document.querySelector("#dm-tools-terminal-panel");
  const persist = terminal.querySelector(".dm-terminal-persist-label input");
  persist.checked = true;
  persist.dispatchEvent(new app.window.Event("change", { bubbles: true }));
  const name = terminal.querySelector("input[maxlength='48']");
  name.value = "api-dev";
  terminal.querySelector("button.primary").click();
  await settle();

  const create = requests.find(item => item.url === "/api/terminal/sessions" && item.method === "POST");
  assert.ok(create, "creation follows the explicit Start button");
  assert.deepEqual(JSON.parse(create.init.body), { projectId: "project-a", persistent: true, name: "api-dev" });
  const createHeaders = new Headers(create.init.headers);
  assert.equal(createHeaders.get("x-devmoter-terminal-entry"), "explicit");
  assert.match(createHeaders.get("x-pocket-operation-id"), /^terminal-create-/);
  assert.deepEqual(JSON.parse(app.window.sessionStorage.getItem("devmoter-terminal-record")), {
    session: created,
    token: "test-session-token"
  });

  const firstTicket = requests.find(item => item.url.endsWith("/socket-ticket"));
  assert.ok(firstTicket);
  assert.equal(firstTicket.method, "POST");
  const ticketHeaders = new Headers(firstTicket.init.headers);
  assert.equal(ticketHeaders.get("x-devmoter-terminal-token"), "test-session-token");
  assert.match(ticketHeaders.get("x-pocket-operation-id"), /^terminal-ticket-/);
  assert.equal(firstTicket.init.body, "{}");
  assert.equal(app.socketInstances.length, 1);
  const firstSocket = app.socketInstances[0];
  assert.equal(firstSocket.url, "wss://devmoter.example/api/terminal/sessions/terminal-one/socket?after=0");
  assert.deepEqual(Array.from(firstSocket.protocols), ["devmoter-terminal.v1", "devmoter-ticket.test-ticket-1"]);
  firstSocket.open();

  app.document.querySelector(".dm-tools-close").click();
  assert.deepEqual(firstSocket.closeCall, { code: 1000, reason: "Client detached." });
  assert.equal(requests.some(item => item.url === "/api/terminal/sessions/terminal-one" && item.method === "DELETE"), false);
  assert.ok(app.window.sessionStorage.getItem("devmoter-terminal-record"), "the reattach record survives panel close");

  app.document.querySelector(".dm-tools-launcher").click();
  await settle();
  const reattach = requests.find(item => item.url === "/api/terminal/sessions/terminal-one" && item.method === "GET");
  assert.ok(reattach, "reopen revalidates the saved session");
  assert.equal(new Headers(reattach.init.headers).get("x-devmoter-terminal-token"), "test-session-token");
  assert.equal(ticketNumber, 2, "reopen obtains a fresh single-use socket ticket");
  assert.equal(app.socketInstances.length, 2);
  assert.deepEqual(Array.from(app.socketInstances[1].protocols), ["devmoter-terminal.v1", "devmoter-ticket.test-ticket-2"]);
  assert.equal(requests.some(item => item.url === "/api/terminal/sessions/terminal-one" && item.method === "DELETE"), false);
});

test("create errors restore controls, persistent kill requires confirmation, and Forget password is tab-scoped", async t => {
  const requests = [];
  let createFails = true;
  let promptCount = 0;
  let confirmResult = false;
  const saved = session();
  const app = mount({
    prompt: () => { promptCount++; return "test-only-password"; },
    confirm: () => confirmResult,
    fetch: async (path, init = {}) => {
      const url = String(path);
      const method = init.method || "GET";
      const headers = new Headers(init.headers || {});
      requests.push({ url, method, init, headers });
      if (url === "/api/projects") return response({ projects: [{ id: "project-a", name: "Sample", path: "/work/sample" }] });
      if (url === "/api/terminal/sessions" && method === "GET") {
        if (!headers.has("authorization")) return response({ error: "Unauthorized" }, 401);
        return response({ sessions: [saved] });
      }
      if (url === "/api/terminal/sessions" && method === "POST") {
        if (createFails) { createFails = false; return response({ error: "Create unavailable" }, 503); }
        return response({ session: saved, token: "test-session-token" });
      }
      if (url === "/api/terminal/sessions/terminal-one" && method === "GET") return response({ session: saved });
      if (url === "/api/terminal/sessions/terminal-one" && method === "DELETE") return response({ ok: true });
      if (url.endsWith("/socket-ticket")) return response({ ticket: "test-ticket" });
      return response({ error: `Unexpected request: ${method} ${url}` }, 404);
    }
  });
  t.after(() => app.dom.window.close());

  await settle();
  app.document.querySelector(".dm-tools-launcher").click();
  await settle();
  assert.equal(promptCount, 1, "401 invokes the tab-local password prompt");
  assert.equal(app.window.sessionStorage.getItem("devmoter-terminal-auth"), `Basic ${app.window.btoa("devmoter:test-only-password")}`);
  assert.equal(app.window.localStorage.getItem("devmoter-terminal-auth"), null);

  const terminal = app.document.querySelector("#dm-tools-terminal-panel");
  const persist = terminal.querySelector(".dm-terminal-persist-label input");
  persist.checked = true;
  persist.dispatchEvent(new app.window.Event("change", { bubbles: true }));
  terminal.querySelector("input[maxlength='48']").value = "api-dev";
  const start = [...terminal.querySelectorAll("button")].find(item => item.textContent === "Start / Reattach");
  start.click();
  await settle();
  assert.match(terminal.querySelector(".dm-terminal-status").textContent, /Could not start terminal · Create unavailable/);
  assert.equal(start.disabled, false, "busy controls recover after create failure");

  // Restore a persistent record using the same public create request/UI flow.
  start.click();
  await settle();
  assert.ok(app.window.sessionStorage.getItem("devmoter-terminal-record"));
  const kill = [...terminal.querySelectorAll("button")].find(item => item.textContent === "Kill session");
  kill.click();
  await settle();
  assert.equal(requests.some(item => item.method === "DELETE"), false, "declining the warning does not kill the process");
  assert.ok(app.window.sessionStorage.getItem("devmoter-terminal-record"));

  confirmResult = true;
  kill.click();
  await settle();
  const deletion = requests.find(item => item.url === "/api/terminal/sessions/terminal-one" && item.method === "DELETE");
  assert.ok(deletion);
  assert.equal(deletion.headers.get("x-devmoter-terminal-token"), "test-session-token");
  assert.match(deletion.headers.get("x-pocket-operation-id"), /^terminal-kill-/);

  // The public control clears the password from this tab only.
  app.window.localStorage.setItem("devmoter-terminal-auth", "another-tab-auth-marker");
  terminal.querySelector("button[aria-label='Forget password']").click();
  assert.equal(app.window.sessionStorage.getItem("devmoter-terminal-auth"), null);
  assert.equal(app.window.localStorage.getItem("devmoter-terminal-auth"), "another-tab-auth-marker");
});
