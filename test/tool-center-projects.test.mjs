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
  for (let index = 0; index < 8; index++) await new Promise(resolve => setImmediate(resolve));
};
const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

function response(payload, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => payload };
}

function createHarness(dom, fetchImpl) {
  const { window } = dom;
  Object.defineProperty(window.HTMLElement.prototype, "inert", {
    configurable: true,
    get() { return this.hasAttribute("inert"); },
    set(value) { this.toggleAttribute("inert", Boolean(value)); }
  });
  window.HTMLElement.prototype.getClientRects = function () {
    return this.closest(".hidden, [inert], [aria-hidden='true']") ? [] : [{ width: 44, height: 44 }];
  };
  window.requestAnimationFrame = callback => { callback(); return 1; };
  window.confirm = () => true;
  window.fetch = fetchImpl;
  const exports = {};
  const module = { exports };
  vm.runInNewContext(compiled, {
    exports, module, require: () => ({}), window, document: window.document,
    HTMLElement: window.HTMLElement, HTMLDivElement: window.HTMLDivElement,
    localStorage: window.localStorage, sessionStorage: window.sessionStorage,
    fetch: window.fetch, Headers, Event: window.Event, CustomEvent: window.CustomEvent,
    crypto: window.crypto, btoa: window.btoa.bind(window), location: window.location,
    WebSocket: Object.assign(class {}, { OPEN: 1, CLOSING: 2 }),
    ResizeObserver: class { observe() {} disconnect() {} },
    setTimeout: window.setTimeout.bind(window), clearTimeout: window.clearTimeout.bind(window)
  });
  module.exports.mountControlCenter();
  return window;
}

test("Project index drafts and delayed A responses stay scoped while switching to and back from B", async t => {
  const dom = new JSDOM("<!doctype html><body></body>", { url: "https://devmoter.example/", runScripts: "outside-only" });
  t.after(() => dom.window.close());
  const { window } = dom;
  window.localStorage.setItem("opencode-pocket-project", "project-a");
  const requests = [];
  const statusA = deferred();
  const searchA = deferred();
  const mapA = deferred();
  let statusACalls = 0;
  const fetchImpl = async (path, init = {}) => {
    const url = String(path);
    const method = init.method || "GET";
    requests.push({ url, method, init });
    if (url === "/api/projects") return response({ projects: [
      { id: "project-a", name: "Alpha", path: "/work/alpha" },
      { id: "project-b", name: "Beta", path: "/work/beta" }
    ] });
    if (url === "/api/terminal/sessions") return response({ sessions: [] });
    if (url === "/api/projects/project-a/index/status") {
      statusACalls++;
      return statusACalls === 1 ? statusA.promise : response({ ready: true, files: 4, indexedBytes: 4096, exclude: [".a-default"] });
    }
    if (url === "/api/projects/project-b/index/status") return response({ ready: true, files: 22, indexedBytes: 8192, exclude: [".b-default"] });
    if (url === "/api/projects/project-a/index/search?q=alpha%20draft") return searchA.promise;
    if (url === "/api/projects/project-a/map") return mapA.promise;
    if (url === "/api/projects/project-b/map") return response({
      directories: [{ path: "beta-src", fileCount: 22 }], symbols: [{ name: "betaSymbol", kind: "function", path: "beta-src/app.ts", line: 8 }]
    });
    return response({ error: `Unexpected request: ${method} ${url}` }, 404);
  };
  createHarness(dom, fetchImpl);

  window.document.querySelector(".dm-tools-launcher").click();
  await settle();
  window.document.querySelector("#dm-tools-index-tab").click();
  await settle();
  const indexPanel = window.document.querySelector("#dm-tools-index-panel");
  const [projectSelect] = indexPanel.querySelectorAll("select");
  const [excludeInput, queryInput] = indexPanel.querySelectorAll("input");
  assert.equal(projectSelect.value, "project-a");
  assert.equal(statusACalls, 1);

  excludeInput.value = "private-alpha, generated-alpha";
  excludeInput.dispatchEvent(new window.Event("input", { bubbles: true }));
  queryInput.value = "alpha draft";
  [...indexPanel.querySelectorAll("button")].find(item => item.textContent === "Search").click();
  [...indexPanel.querySelectorAll("button")].find(item => item.textContent === "Repo map").click();
  await settle();
  assert.ok(requests.some(item => item.url === "/api/projects/project-a/index/search?q=alpha%20draft"));
  assert.ok(requests.some(item => item.url === "/api/projects/project-a/map"));

  projectSelect.value = "project-b";
  projectSelect.dispatchEvent(new window.Event("change", { bubbles: true }));
  await settle();
  assert.equal(projectSelect.value, "project-b");
  assert.equal(excludeInput.value, ".b-default", "B should receive its status excludes while its draft is untouched");
  assert.match(indexPanel.querySelector(".dm-terminal-status").textContent, /22 files/);

  const results = indexPanel.querySelector(".dm-tools-list");
  assert.equal(results.children.length, 0, "switching projects clears A's in-flight results");

  statusA.resolve(response({ error: "Stale Alpha status failure" }, 503));
  searchA.resolve(response({ results: [{ path: "alpha-old.ts", line: 3, snippet: "old alpha result", score: 1 }] }));
  mapA.resolve(response({ error: "Alpha map became unavailable" }, 503));
  await settle();
  assert.equal(excludeInput.value, ".b-default");
  assert.match(indexPanel.querySelector(".dm-terminal-status").textContent, /22 files/);
  assert.equal(results.children.length, 0, "late A map and search responses must not repopulate B's result list");
  assert.doesNotMatch(indexPanel.textContent, /alpha-old|Stale Alpha status failure|Alpha map became unavailable/);

  projectSelect.value = "project-a";
  projectSelect.dispatchEvent(new window.Event("change", { bubbles: true }));
  await settle();
  assert.equal(excludeInput.value, "private-alpha, generated-alpha");
  assert.equal(queryInput.value, "alpha draft");
  assert.match(indexPanel.querySelector(".dm-terminal-status").textContent, /4 files/);
});

test("Safety keeps the command draft, ignores stale permission loads, and preserves failed revoke for retry", async t => {
  const dom = new JSDOM("<!doctype html><body></body>", { url: "https://devmoter.example/", runScripts: "outside-only" });
  t.after(() => dom.window.close());
  const { window } = dom;
  window.localStorage.setItem("opencode-pocket-project", "project-a");
  const requests = [];
  const oldPermissions = deferred();
  const postRevokeRefresh = deferred();
  let permissionGets = 0;
  let revokeCalls = 0;
  const rule = { id: "rule-a", scope: { backend: "codex", tool: "shell", projectId: "project-a", action: "execute" }, createdAt: 1 };
  const fetchImpl = async (path, init = {}) => {
    const url = String(path);
    const method = init.method || "GET";
    requests.push({ url, method, init });
    if (url === "/api/projects") return response({ projects: [{ id: "project-a", name: "Alpha", path: "/work/alpha" }] });
    if (url === "/api/terminal/sessions") return response({ sessions: [] });
    if (url.endsWith("/index/status")) return response({ ready: false });
    if (url === "/api/safety/command-scan") return response({ command: "rm -rf ./build", dangerous: true, risk: "high", reasons: ["Recursive delete"], note: "Inspect carefully." });
    if (url === "/api/safety/permissions" && method === "GET") {
      permissionGets++;
      if (permissionGets === 1) return oldPermissions.promise;
      if (permissionGets === 3) return postRevokeRefresh.promise;
      return response({ rules: [rule] });
    }
    if (url === "/api/safety/permissions/rule-a" && method === "DELETE") {
      revokeCalls++;
      return revokeCalls === 1
        ? response({ error: "Permission revoke failed" }, 503)
        : response({ ok: true });
    }
    return response({ error: `Unexpected request: ${method} ${url}` }, 404);
  };
  createHarness(dom, fetchImpl);
  window.document.querySelector(".dm-tools-launcher").click();
  await settle();

  const safetyTab = window.document.querySelector("#dm-tools-safety-tab");
  safetyTab.click();
  await settle();
  const safetyPanel = window.document.querySelector("#dm-tools-safety-panel");
  const command = safetyPanel.querySelector("textarea");
  command.value = "rm -rf ./build";
  safetyPanel.querySelector("button").click();
  await settle();
  assert.match(safetyPanel.querySelector("pre[role=status]").textContent, /Recursive delete/);

  window.document.querySelector("#dm-tools-index-tab").click();
  await settle();
  safetyTab.click();
  await settle();
  assert.equal(permissionGets, 2);
  assert.equal(safetyPanel.querySelectorAll("[data-safety-approval-list] .dm-tools-card").length, 1);
  oldPermissions.resolve(response({ rules: [rule] }));
  await settle();
  assert.equal(safetyPanel.querySelectorAll("[data-safety-approval-list] .dm-tools-card").length, 1, "stale tab revisit must not append a duplicate rule");
  assert.equal(command.value, "rm -rf ./build");

  let revoke = [...safetyPanel.querySelectorAll("button")].find(item => item.textContent === "Revoke");
  revoke.click();
  await settle();
  assert.match(safetyPanel.textContent, /Permission revoke failed/);
  revoke = [...safetyPanel.querySelectorAll("button")].find(item => item.textContent === "Revoke");
  assert.equal(revoke.disabled, false, "failed revoke remains retryable");
  revoke.click();
  await settle();
  assert.equal(revokeCalls, 2);
  assert.equal(permissionGets, 3);

  oldPermissions.resolve(response({ rules: [rule] }));
  postRevokeRefresh.resolve(response({ rules: [] }));
  await settle();
  assert.equal(safetyPanel.querySelectorAll("[data-safety-approval-list] .dm-tools-card").length, 0);
  assert.match(safetyPanel.textContent, /No remembered approvals/);
  assert.equal(command.value, "rm -rf ./build");
  assert.equal(requests.filter(item => item.url === "/api/safety/permissions/rule-a" && item.method === "DELETE").length, 2);
});
