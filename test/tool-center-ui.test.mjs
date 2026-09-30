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

test("Tools panel exposes an accessible modal and keeps real safety/index workflows scoped", async t => {
  const dom = new JSDOM('<!doctype html><main id="background" aria-hidden="legacy"><button>Background</button></main>', {
    url: "https://devmoter.example/", runScripts: "outside-only"
  });
  t.after(() => dom.window.close());
  const { window } = dom;
  Object.defineProperty(window.HTMLElement.prototype, "inert", {
    get() { return this.hasAttribute("inert"); },
    set(value) { this.toggleAttribute("inert", Boolean(value)); }
  });
  window.HTMLElement.prototype.getClientRects = function () {
    return this.closest(".hidden, [inert], [aria-hidden='true']") ? [] : [{ width: 44, height: 44 }];
  };
  window.requestAnimationFrame = callback => { callback(); return 1; };
  window.confirm = () => true;
  let prompts = 0;
  window.prompt = () => { prompts++; return "never-used"; };
  let projectCalls = 0;
  let pendingInitialProjects;
  let indexStatusFails = false;
  const background = window.document.querySelector("#background");
  background.inert = true;
  const requests = [];
  window.fetch = async (path, init = {}) => {
    const url = String(path);
    const method = init.method || "GET";
    requests.push({ url, method, init });
    const response = (payload, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => payload });
    if (url === "/api/projects") {
      projectCalls++;
      if (projectCalls === 1) return new Promise(resolve => {
        pendingInitialProjects = () => resolve(response({ projects: [{ id: "project-a", name: "Sample", path: "/work/sample" }] }));
      });
      return response({ projects: [{ id: "project-a", name: "Sample", path: "/work/sample" }] });
    }
    if (url === "/api/terminal/sessions" && method === "GET") return response({ error: "Trusted device required" }, 403);
    if (url === "/api/safety/permissions" && method === "GET") return response({ rules: [{
      id: "rule-one", scope: { backend: "codex", tool: "shell", projectId: "project-a", action: "execute" }, createdAt: 1
    }] });
    if (url === "/api/safety/command-scan") return response({
      command: "rm -rf /tmp/demo", dangerous: true, risk: "high", reasons: ["Recursive deletion"], note: "Review before running."
    });
    if (url === "/api/safety/permissions/rule-one" && method === "DELETE") return response({ ok: true });
    if (url.endsWith("/index/status")) return indexStatusFails
      ? response({ error: "Index status unavailable" }, 503)
      : response({ ready: true, files: 9, indexedBytes: 1536, reusedFiles: 2, exclude: ["vendor"] });
    if (url.endsWith("/index/rebuild")) return response({ files: 10, indexedBytes: 2048, reusedFiles: 4 });
    if (url.includes("/index/search?")) return response({ results: [{ path: "src/main.ts", line: 12, snippet: "export function main()", score: 1 }] });
    if (url.endsWith("/map")) return response({ directories: [{ path: "src", fileCount: 3 }], symbols: [{ name: "main", kind: "function", path: "src/main.ts", line: 12 }] });
    if (url.endsWith("/index") && method === "DELETE") return response({ ok: true });
    return response({ error: `Unexpected request: ${method} ${url}` }, 404);
  };
  const exports = {};
  const module = { exports };
  vm.runInNewContext(compiled, {
    exports, module, require: () => ({}), window, document: window.document,
    HTMLElement: window.HTMLElement, HTMLDivElement: window.HTMLDivElement,
    localStorage: window.localStorage, sessionStorage: window.sessionStorage,
    fetch: window.fetch, Headers, crypto: window.crypto, btoa: window.btoa.bind(window),
    location: window.location,
    WebSocket: Object.assign(class {}, { OPEN: 1, CLOSING: 2 }),
    ResizeObserver: class { observe() {} disconnect() {} },
    setTimeout: window.setTimeout.bind(window), clearTimeout: window.clearTimeout.bind(window)
  });
  module.exports.mountControlCenter();

  const { document } = window;
  const launcher = document.querySelector(".dm-tools-launcher");
  const panel = document.querySelector(".dm-tools-panel");
  launcher.click();
  await settle();
  assert.equal(panel.getAttribute("role"), "dialog");
  assert.equal(panel.getAttribute("aria-modal"), "true");
  assert.equal(document.activeElement.getAttribute("aria-label"), "Close DevMoter tools");
  assert.equal(background.inert, true);
  assert.equal(background.getAttribute("aria-hidden"), "true");
  assert.equal(document.querySelectorAll('[role="tab"]').length, 3);
  assert.equal(document.querySelector('[role="tab"][aria-selected="true"]').id, "dm-tools-terminal-tab");
  document.querySelector("#dm-tools-index-tab").click();
  await settle();
  assert.equal(document.querySelector("#dm-tools-index-panel select").value, "project-a");
  pendingInitialProjects();
  await settle();

  const terminalSessionCalls = requests.filter(item => item.url === "/api/terminal/sessions");
  assert.ok(terminalSessionCalls.length >= 1);
  assert.ok(terminalSessionCalls.every(item => item.method === "GET"));
  assert.equal(prompts, 0);
  assert.ok(document.querySelector("[data-terminal-device-gate]"));

  const safetyTab = document.querySelector("#dm-tools-safety-tab");
  safetyTab.focus();
  safetyTab.dispatchEvent(new window.KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true }));
  assert.equal(document.activeElement.id, "dm-tools-index-tab");
  document.querySelector("#dm-tools-safety-tab").click();
  const command = document.querySelector("#dm-tools-safety-panel textarea");
  command.value = "rm -rf /tmp/demo";
  document.querySelector("#dm-tools-safety-panel button").click();
  await settle();
  const scanCall = requests.find(item => item.url === "/api/safety/command-scan");
  assert.deepEqual(JSON.parse(scanCall.init.body), { command: "rm -rf /tmp/demo" });
  assert.match(document.querySelector("#dm-tools-safety-panel pre").textContent, /Risk: high[\s\S]*Recursive deletion/);
  assert.ok(document.querySelector("#dm-tools-safety-panel .dm-risk-high"));

  [...document.querySelectorAll("#dm-tools-safety-panel button")].find(item => item.textContent === "Revoke").click();
  await settle();
  const revoke = requests.find(item => item.url.endsWith("/permissions/rule-one"));
  assert.equal(revoke.method, "DELETE");
  assert.match(revoke.init.headers["x-pocket-operation-id"], /^permission-revoke-/);
  assert.equal(document.querySelector("#dm-tools-safety-panel textarea").value, "rm -rf /tmp/demo");

  document.querySelector("#dm-tools-index-tab").click();
  await settle();
  const indexPanel = document.querySelector("#dm-tools-index-panel");
  assert.match(indexPanel.querySelector(".dm-terminal-status").textContent, /9 files · 2 KiB · 2 reused/);
  const indexInputs = indexPanel.querySelectorAll("input");
  indexInputs[0].value = "private, fixtures/secrets";
  const rebuild = [...indexPanel.querySelectorAll("button")].find(item => item.textContent === "Rebuild index");
  rebuild.click();
  await settle();
  const rebuildCall = requests.find(item => item.url.endsWith("/index/rebuild"));
  assert.deepEqual(JSON.parse(rebuildCall.init.body), { exclude: ["private", "fixtures/secrets"] });
  assert.match(rebuildCall.init.headers["x-pocket-operation-id"], /^index-rebuild-/);
  assert.match(indexPanel.querySelector(".dm-terminal-status").textContent, /10 files · 2 KiB · 4 unchanged files reused/);
  indexInputs[1].value = "main";
  [...indexPanel.querySelectorAll("button")].find(item => item.textContent === "Search").click();
  await settle();
  assert.match(indexPanel.textContent, /src\/main\.ts:12[\s\S]*export function main/);
  [...indexPanel.querySelectorAll("button")].find(item => item.textContent === "Repo map").click();
  await settle();
  assert.match(indexPanel.textContent, /function main — src\/main\.ts:12/);
  [...indexPanel.querySelectorAll("button")].find(item => item.textContent === "Delete index").click();
  await settle();
  const deleteCall = requests.find(item => item.url.endsWith("/index") && item.method === "DELETE");
  assert.match(deleteCall.init.headers["x-pocket-operation-id"], /^index-delete-/);

  indexStatusFails = true;
  document.querySelector("#dm-tools-safety-tab").click();
  await settle();
  assert.equal(document.querySelector("#dm-tools-safety-panel textarea").value, "rm -rf /tmp/demo");
  document.querySelector("#dm-tools-index-tab").click();
  await settle();
  assert.equal(indexPanel.querySelector(".dm-terminal-status").textContent, "Index status unavailable");

  document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
  assert.ok(panel.classList.contains("hidden"));
  assert.equal(background.inert, true);
  assert.equal(background.getAttribute("aria-hidden"), "legacy");
  launcher.click();
  await settle();
  window.dispatchEvent(new window.CustomEvent("devmoter:global-nav-opened"));
  assert.ok(panel.classList.contains("hidden"));
  assert.equal(background.inert, true);
  assert.equal(background.getAttribute("aria-hidden"), "legacy");
});
