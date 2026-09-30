import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";
import { JSDOM } from "jsdom";

const compile = source => ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
}).outputText;
const [apiSource, workspaceSource, shellSource, registrySource] = await Promise.all([
  readFile(new URL("../src/api-chat.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/workspace-control.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/app-shell.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/app-registry.ts", import.meta.url), "utf8")
]);
const compiledApi = compile(apiSource);
const modules = new Map(await Promise.all(ts.preProcessFile(apiSource).importedFiles
  .filter(({ fileName }) => fileName.endsWith(".mjs"))
  .map(async ({ fileName }) => [fileName, await import(new URL("../src/" + fileName.slice(2), import.meta.url))])));
const settle = () => new Promise(resolve => setImmediate(resolve));
const presets = [{ id: "custom", name: "Custom", protocol: "openai-compatible", baseUrl: "https://provider.example/v1" }];
const providers = [{
  id: "existing", name: "Existing provider", protocol: "openai-compatible",
  baseUrl: "https://provider.example/v1", ready: true, models: ["existing-model"],
  reasoningModes: ["auto", "high"], source: "env", editable: false
}];

function mount(t, { deferPresets = false } = {}) {
  const dom = new JSDOM('<!doctype html><div id="root"></div><div id="cxWorkspaceControlsMount"></div><div id="ocxWorkspaceControlsMount"></div>', {
    url: "https://devmoter.example/?surface=api", runScripts: "outside-only"
  });
  t.after(() => dom.window.close());
  const { document, HTMLElement } = dom.window;
  Object.defineProperty(HTMLElement.prototype, "inert", {
    get() { return this.hasAttribute("inert"); },
    set(value) { this.toggleAttribute("inert", Boolean(value)); }
  });
  HTMLElement.prototype.getClientRects = function () {
    if (this.closest('.hidden, [hidden], [inert], [aria-hidden="true"], .api-preset-select-hidden')) return [];
    const details = this.closest("details:not([open])");
    if (details && this !== details.querySelector("summary")) return [];
    return [{ width: 44, height: 44 }];
  };
  dom.window.Headers = Headers;
  dom.window.matchMedia = () => ({ matches: false, addEventListener() {} });
  dom.window.setInterval = () => 1;
  dom.window.setTimeout = () => 1;
  dom.window.requestAnimationFrame = () => 1;
  dom.window.localStorage.setItem("devmoter-device-token", "test-device-token");
  const requests = [];
  const pendingPresets = [];
  dom.window.fetch = async (input, init = {}) => {
    const path = String(input);
    requests.push({ path, method: init.method || "GET", token: init.headers?.get("x-devmoter-device-token") });
    const response = payload => ({ ok: true, status: 200, json: async () => payload });
    if (path === "/api/llm/providers") return response({ providers });
    if (path === "/api/llm/presets") {
      if (deferPresets) return new Promise(resolve => pendingPresets.push(() => resolve(response({ presets }))));
      return response({ presets });
    }
    throw new Error(`Unexpected API request: ${path}`);
  };
  dom.window.require = name => {
    if (name === "./i18n") return { getLanguage: () => "en" };
    if (name.endsWith(".css")) return {};
    if (modules.has(name)) return modules.get(name);
    throw new Error(`Unexpected dependency: ${name}`);
  };
  dom.window.exports = {};
  dom.window.eval(compiledApi);
  document.body.classList.add("api-mode");
  const controller = dom.window.exports.mountApiChat(document.querySelector("#root"));
  const query = selector => document.querySelector(selector);
  const key = (value, shiftKey = false) => {
    const event = new dom.window.KeyboardEvent("keydown", { key: value, shiftKey, bubbles: true, cancelable: true });
    document.dispatchEvent(event);
    return event;
  };
  return { dom, document, query, key, controller, requests, pendingPresets };
}

test("API history traps Tab, blocks its background and closes through the scrim", async t => {
  const { document, query, key } = mount(t);
  await settle();
  const menu = query("#apiMenu");
  const sidebar = query("#apiSidebar");
  const close = query("#apiSidebarClose");
  const first = query("#apiAgentSwitchButton");
  const last = query("#apiSettingsSide");
  assert.equal(sidebar.inert, true);
  menu.focus();
  menu.click();
  assert.equal(sidebar.inert, false);
  assert.equal(sidebar.getAttribute("aria-modal"), "true");
  assert.equal(menu.getAttribute("aria-expanded"), "true");
  assert.equal(query(".api-composer-wrap").inert, true);
  assert.equal(query("#apiScrim").classList.contains("hidden"), false);
  assert.equal(document.activeElement, close);
  first.focus();
  assert.equal(key("Tab", true).defaultPrevented, true);
  assert.equal(document.activeElement, last);
  assert.equal(key("Tab").defaultPrevented, true);
  assert.equal(document.activeElement, first);
  query("#apiScrim").click();
  assert.equal(sidebar.inert, true);
  assert.equal(query(".api-composer-wrap").inert, false);
  assert.equal(document.activeElement, menu);
});

test("API agent picker Escape closes the picker before dismissing history", async t => {
  const { document, query, key } = mount(t);
  await settle();
  query("#apiMenu").click();
  const agent = query("#apiAgentSwitchButton");
  agent.click();
  assert.equal(agent.getAttribute("aria-expanded"), "true");
  key("Escape");
  assert.equal(agent.getAttribute("aria-expanded"), "false");
  assert.equal(query("#apiSidebar").classList.contains("open"), true);
  assert.equal(document.activeElement, agent);
  key("Escape");
  assert.equal(query("#apiSidebar").classList.contains("open"), false);
});

test("API Providers replaces history, retains its actual form and restores the opener", async t => {
  const { document, query, key, requests } = mount(t);
  await settle();
  const menu = query("#apiMenu");
  menu.focus();
  menu.click();
  query("#apiSettingsSide").click();
  const modal = query("#apiSettingsModal");
  const close = query("#apiSettingsClose");
  assert.equal(query("#apiSidebar").classList.contains("open"), false);
  assert.equal(modal.classList.contains("hidden"), false);
  assert.equal(document.activeElement, close, "loading begins with a reachable close control");
  await settle();
  query(".api-settings-toolbar button").click();
  await settle();
  const password = query('[data-field="apiKey"]');
  const save = query('[data-action="save"]');
  assert.equal(password.type, "password");
  password.value = "typed-test-key";
  query("#apiSettingsTop").click();
  assert.equal(query('[data-field="apiKey"]'), password, "duplicate opening does not replace a typed form");
  assert.equal(password.value, "typed-test-key");
  key("Tab", true);
  assert.equal(document.activeElement, save);
  key("Tab");
  assert.equal(document.activeElement, close);
  password.focus();
  key("Escape");
  assert.equal(modal.classList.contains("hidden"), true);
  assert.equal(password.value, "typed-test-key", "Escape hides the form without clearing or submitting its values");
  assert.equal(document.activeElement, menu);
  assert.ok(requests.every(request => request.method === "GET"));
  assert.ok(requests.every(request => request.token === "test-device-token"), "existing device authentication remains on provider requests");
});

test("a stale API settings load cannot overwrite a subsequently typed provider form", async t => {
  const { query, key, pendingPresets } = mount(t, { deferPresets: true });
  await settle();
  query("#apiSettingsTop").click();
  key("Escape");
  query("#apiSettingsTop").click();
  assert.equal(pendingPresets.length, 2);
  pendingPresets[1]();
  await settle();
  query(".api-settings-toolbar button").click();
  await settle();
  const password = query('[data-field="apiKey"]');
  password.value = "keep-new-form";
  pendingPresets[0]();
  await settle();
  assert.equal(query('[data-field="apiKey"]'), password);
  assert.equal(password.value, "keep-new-form");
  assert.equal(query("#apiSettingsModal").classList.contains("hidden"), false);
});

test("global Tools replaces API Settings and returns keyboard focus after dismissal", async t => {
  const { dom, document, query, key } = mount(t);
  await settle();
  dom.window.exports = {};
  dom.window.eval(compile(registrySource));
  const registry = dom.window.exports;
  const require = dom.window.require;
  dom.window.require = name => name === "./app-registry" ? registry : require(name);
  dom.window.exports = {};
  dom.window.eval(compile(shellSource));
  dom.window.exports.mountUnifiedFeatureShell({
    initialBackend: "api", initialSurface: "api", switchBackend() {}, openHome() {}
  });
  const opener = query("#apiSettingsTop");
  opener.focus();
  opener.click();
  query(".dm-shell-menu-trigger").click();
  assert.equal(query("#apiSettingsModal").classList.contains("hidden"), true);
  assert.equal(query("#apiSidebar").classList.contains("open"), false);
  assert.equal(query(".dm-shell-sidebar").classList.contains("open"), true);
  assert.equal(document.activeElement, query("[data-shell-close]"));
  key("Tab", true);
  assert.equal(document.activeElement, query('[data-shell-action="setup"]'));
  key("Escape");
  assert.equal(document.activeElement, opener);
});

test("one workspace toolbar moves between all three chat drawers and body", async t => {
  const { dom, document, query } = mount(t);
  await settle();
  dom.window.exports = {};
  dom.window.eval(compile(workspaceSource));
  const stop = dom.window.exports.startWorkspaceControl();
  t.after(stop);
  const host = query(".dm-controlbar");
  const context = query(".dm-context");
  const panel = query(".dm-panel");
  const emit = surface => dom.window.dispatchEvent(new dom.window.CustomEvent("devmoter:surface-changed", { detail: { surface } }));
  assert.equal(host.parentElement, query("#apiWorkspaceControlsMount"));
  context.click();
  assert.equal(panel.classList.contains("hidden"), false);
  for (const [surface, selector] of [["codex", "#cxWorkspaceControlsMount"], ["opencode", "#ocxWorkspaceControlsMount"], ["api", "#apiWorkspaceControlsMount"]]) {
    emit(surface);
    assert.equal(host.parentElement, query(selector), surface);
  }
  emit("home");
  assert.equal(host.parentElement, document.body);
  emit("api");
  assert.equal(host.parentElement, query("#apiWorkspaceControlsMount"));
  assert.equal(query(".dm-context"), context);
  assert.equal(query(".dm-panel"), panel);
  assert.equal(panel.classList.contains("hidden"), false);
  assert.equal(document.querySelectorAll(".dm-controlbar").length, 1);
});
