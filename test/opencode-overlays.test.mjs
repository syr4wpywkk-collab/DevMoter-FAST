import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";
import { JSDOM } from "jsdom";

const source = await readFile(new URL("../src/opencode.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
}).outputText;
const modules = new Map(await Promise.all(ts.preProcessFile(source).importedFiles
  .filter(({ fileName }) => fileName.endsWith(".mjs"))
  .map(async ({ fileName }) => [fileName, await import(new URL("../src/" + fileName.slice(2), import.meta.url))])));
const workspaceSource = await readFile(new URL("../src/workspace-control.ts", import.meta.url), "utf8");
const compiledWorkspace = ts.transpileModule(workspaceSource, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
}).outputText;
const [shellSource, registrySource, toolsSource] = await Promise.all([
  readFile(new URL("../src/app-shell.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/app-registry.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/tools-ai.ts", import.meta.url), "utf8")
]);
const compile = value => ts.transpileModule(value, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
}).outputText;

function mount(t) {
  const dom = new JSDOM('<!doctype html><div id="root"></div><div id="cxWorkspaceControlsMount"></div>', {
    url: "https://devmoter.example/?surface=opencode",
    runScripts: "outside-only"
  });
  t.after(() => dom.window.close());
  const { document, HTMLElement } = dom.window;
  // jsdom has no layout or native inert reflector; retain their browser contracts.
  Object.defineProperty(HTMLElement.prototype, "inert", {
    get() { return this.hasAttribute("inert"); },
    set(value) { this.toggleAttribute("inert", Boolean(value)); }
  });
  HTMLElement.prototype.getClientRects = function () {
    return this.closest('.hidden, [inert], [aria-hidden="true"]') ? [] : [{ width: 44, height: 44 }];
  };
  dom.window.matchMedia = () => ({ matches: false, addEventListener() {} });
  dom.window.setInterval = () => 1;
  dom.window.setTimeout = () => 1;
  dom.window.requestAnimationFrame = () => 1;
  const noop = () => {};
  dom.window.require = name => {
    if (modules.has(name)) return modules.get(name);
    if (name.endsWith(".css")) return {};
    if (name === "./i18n") return { speechRecognitionLanguage: () => "en-US" };
    if (name === "./wake-lock") return {
      setWakeLockEnabled: noop, setWakeLockExecutionActive: noop,
      wakeLockEnabled: () => false, wakeLockSupported: () => false
    };
    if (name === "./bounded-transcript") return { enforceTranscriptLimit: noop };
    if (name === "./safety-client") return {};
    throw new Error(`Unexpected dependency: ${name}`);
  };
  dom.window.exports = {};
  dom.window.eval(compiled);
  document.body.classList.add("opencode-mode");
  dom.window.exports.mountOpenCodeRemote(document.querySelector("#root"));
  const query = selector => document.querySelector(selector);
  const key = (value, shiftKey = false) => {
    const event = new dom.window.KeyboardEvent("keydown", { key: value, shiftKey, bubbles: true, cancelable: true });
    document.dispatchEvent(event);
    return event;
  };
  return { dom, document, query, key };
}

test("OpenCode history traps Tab, blocks background interaction and restores its opener", t => {
  const { document, query, key } = mount(t);
  const sidebar = query("#ocxSidebar");
  const menu = query("#ocxMenu");
  const close = query("#ocxSidebarClose");
  assert.equal(sidebar.inert, true);
  menu.focus();
  menu.click();
  assert.equal(sidebar.inert, false);
  assert.equal(sidebar.getAttribute("aria-modal"), "true");
  assert.equal(menu.getAttribute("aria-expanded"), "true");
  assert.equal(query(".ocx-composer-wrap").inert, true);
  assert.equal(query("#ocxPermission").inert, true);
  assert.equal(document.activeElement, close);
  assert.equal(key("Tab", true).defaultPrevented, true);
  assert.equal(document.activeElement, query("#ocxRefresh"));
  assert.equal(key("Tab").defaultPrevented, true);
  assert.equal(document.activeElement, close);
  key("Escape");
  assert.equal(sidebar.inert, true);
  assert.equal(sidebar.hasAttribute("aria-modal"), false);
  assert.equal(query(".ocx-composer-wrap").inert, false);
  assert.equal(document.activeElement, menu);
});

test("OpenCode runtime modal closes history and attachment menus without stacking overlays", t => {
  const { dom, document, query, key } = mount(t);
  const plus = query("#ocxPlus");
  const menu = query("#ocxMenu");
  const agent = query("#ocxAgentButton");
  // The offline mount deliberately disables runtime selection; enable its existing
  // launcher to exercise the local modal without connecting a backend.
  agent.disabled = false;
  plus.click();
  assert.equal(plus.getAttribute("aria-expanded"), "true");
  menu.click();
  assert.equal(query("#ocxAttachmentMenu").classList.contains("hidden"), true);
  assert.equal(plus.getAttribute("aria-expanded"), "false");
  agent.click();
  const modal = query("#ocxModal");
  assert.equal(query("#ocxSidebar").classList.contains("open"), false);
  assert.equal(modal.classList.contains("hidden"), false);
  assert.equal(document.activeElement, query("#ocxModalClose"));
  menu.click();
  assert.equal(query("#ocxSidebar").classList.contains("open"), false);
  const last = document.createElement("button");
  last.textContent = "Runtime choice";
  query("#ocxModalBody").append(last);
  key("Tab", true);
  assert.equal(document.activeElement, last);
  key("Tab");
  assert.equal(document.activeElement, query("#ocxModalClose"));
  key("Escape");
  assert.equal(modal.classList.contains("hidden"), true);
  assert.equal(document.activeElement, menu);

  agent.focus();
  agent.click();
  dom.window.dispatchEvent(new dom.window.CustomEvent("devmoter:global-nav-opened"));
  assert.equal(modal.classList.contains("hidden"), true);
  assert.equal(query(".ocx-main").inert, false);
  assert.equal(document.activeElement, agent);
});

test("OpenCode attachment Escape and surface navigation close transient controls", t => {
  const { dom, query, key } = mount(t);
  const plus = query("#ocxPlus");
  plus.click();
  key("Escape");
  assert.equal(plus.getAttribute("aria-expanded"), "false");
  assert.equal(query("#ocxAttachmentMenu").classList.contains("hidden"), true);
  query("#ocxMenu").click();
  dom.window.dispatchEvent(new dom.window.CustomEvent("devmoter:surface-changed", { detail: { surface: "api" } }));
  assert.equal(query("#ocxSidebar").classList.contains("open"), false);
  assert.equal(query(".ocx-topbar").inert, false);
});

test("global Tools replaces the OpenCode modal and receives keyboard focus", t => {
  const { dom, document, query, key } = mount(t);
  dom.window.exports = {};
  dom.window.eval(compile(registrySource));
  const registry = dom.window.exports;
  dom.window.exports = {};
  dom.window.eval(compile(toolsSource));
  const tools = dom.window.exports;
  const require = dom.window.require;
  dom.window.require = name => name === "./app-registry" ? registry : name === "./tools-ai" ? tools : require(name);
  dom.window.exports = {};
  dom.window.eval(compile(shellSource));
  dom.window.exports.mountUnifiedFeatureShell({
    initialBackend: "opencode", initialSurface: "opencode",
    switchBackend() {}, openHome() {}
  });
  const agent = query("#ocxAgentButton");
  agent.disabled = false;
  agent.focus();
  agent.click();
  query(".dm-shell-menu-trigger").click();
  assert.equal(query("#ocxModal").classList.contains("hidden"), true);
  assert.equal(query("#ocxSidebar").classList.contains("open"), false);
  assert.equal(query(".dm-shell-sidebar").classList.contains("open"), true);
  assert.equal(document.activeElement, query("[data-shell-close]"));
  key("Tab", true);
  assert.equal(document.activeElement, query('[data-manual-tools] > summary'));
  key("Tab");
  assert.equal(document.activeElement, query("[data-shell-close]"));
  key("Escape");
  assert.equal(query(".dm-shell-sidebar").classList.contains("open"), false);
  assert.equal(document.activeElement, agent);
});

test("one existing workspace toolbar moves between OpenCode, Codex and body", t => {
  const { dom, document, query } = mount(t);
  dom.window.exports = {};
  dom.window.eval(compiledWorkspace);
  const stop = dom.window.exports.startWorkspaceControl();
  t.after(stop);
  const host = query(".dm-controlbar");
  const context = query(".dm-context");
  const panel = query(".dm-panel");
  const emit = surface => dom.window.dispatchEvent(new dom.window.CustomEvent("devmoter:surface-changed", { detail: { surface } }));
  assert.equal(host.parentElement, query("#ocxWorkspaceControlsMount"));
  context.click();
  assert.equal(panel.classList.contains("hidden"), false);
  emit("codex");
  assert.equal(host.parentElement, query("#cxWorkspaceControlsMount"));
  emit("api");
  assert.equal(host.parentElement, document.body);
  emit("opencode");
  assert.equal(host.parentElement, query("#ocxWorkspaceControlsMount"));
  assert.equal(query(".dm-context"), context);
  assert.equal(query(".dm-panel"), panel);
  assert.equal(panel.classList.contains("hidden"), false);
  assert.equal(document.querySelectorAll(".dm-controlbar").length, 1);
});
