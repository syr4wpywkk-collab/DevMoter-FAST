import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";
import { JSDOM } from "jsdom";
import { loadPureTypeScript } from "./helpers/ts-pure-modules.mjs";

const source = await readFile(new URL("../src/codex.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
}).outputText;
const workspaceSource = await readFile(new URL("../src/workspace-control.ts", import.meta.url), "utf8");
const compiledWorkspace = ts.transpileModule(workspaceSource, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
}).outputText;
const modules = new Map(await Promise.all(ts.preProcessFile(source).importedFiles
  .filter(({ fileName }) => fileName.endsWith(".mjs"))
  .map(async ({ fileName }) => [fileName, await import(new URL("../src/" + fileName.slice(2), import.meta.url))])));
modules.set("./codex/presentation", await loadPureTypeScript("codex/presentation.ts"));
modules.set("./codex/icons", await loadPureTypeScript("codex/icons.ts"));

function mount(t, desktop = false) {
  const dom = new JSDOM('<!doctype html><main id="root"></main>', {
    url: "https://devmoter.example/?surface=codex", runScripts: "outside-only"
  });
  t.after(() => dom.window.close());
  const { window } = dom;
  const { document, HTMLElement } = window;
  Object.defineProperty(HTMLElement.prototype, "inert", {
    get() { return this.hasAttribute("inert"); },
    set(value) { this.toggleAttribute("inert", Boolean(value)); }
  });
  HTMLElement.prototype.getClientRects = function () {
    return this.closest('.hidden, [inert], [aria-hidden="true"]') ? [] : [{ width: 44, height: 44 }];
  };
  const listeners = [];
  const media = { matches: desktop, addEventListener(_name, fn) { listeners.push(fn); } };
  window.matchMedia = () => media;
  window.setInterval = () => 1;
  const timers = [];
  window.setTimeout = fn => { timers.push(fn); return timers.length; };
  window.requestAnimationFrame = () => 1;
  const noop = () => {};
  const require = name => {
    if (modules.has(name)) return modules.get(name);
    if (name.endsWith(".css")) return {};
    if (name === "./i18n") return { speechRecognitionLanguage: () => "en-US" };
    if (name === "./dev-workflows-ui") return { createDevWorkflowPanel: () => ({ show: async () => {} }) };
    if (name === "./mcp-result") return { isMcpToolItem: () => false, mcpToolSummary: () => ({}), normalizeStructuredMcpResult: value => ({ value, rawText: "", truncated: false }) };
    if (name === "./bounded-transcript") return { enforceTranscriptLimit: noop };
    if (name === "./wake-lock") return { setWakeLockExecutionActive: noop };
    if (name === "./safety-client") return {};
    throw new Error(`Unexpected dependency: ${name}`);
  };
  window.exports = {};
  window.Function("require", "exports", compiled)(require, window.exports);
  document.body.classList.add("codex-mode");
  window.exports.mountCodexRemote(document.querySelector("#root"));
  const query = selector => document.querySelector(selector);
  const setDesktop = value => { media.matches = value; for (const listener of listeners) listener({ matches: value }); };
  const key = key => document.dispatchEvent(new window.KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  const flushTimers = () => { for (const fn of timers.splice(0)) fn(); };
  return { window, document, query, setDesktop, key, flushTimers };
}

test("desktop sidebar stays interactive until a modal opens, including after a resize", t => {
  const { query, setDesktop } = mount(t, true);
  const sidebar = query("#cxSidebar");
  assert.equal(sidebar.inert, false);
  assert.equal(sidebar.getAttribute("aria-hidden"), "false");
  query("#cxReasoningTop").click();
  assert.equal(sidebar.inert, true, "modal blocks the desktop sidebar");
  query("#cxModalClose").click();
  assert.equal(sidebar.inert, false);
  assert.equal(sidebar.getAttribute("aria-hidden"), "false");
  setDesktop(false);
  assert.equal(sidebar.inert, true);
  assert.equal(sidebar.getAttribute("aria-hidden"), "true");
  setDesktop(true);
  assert.equal(sidebar.inert, false);
  assert.equal(sidebar.getAttribute("aria-hidden"), "false");
});

test("mobile details drawer closes on scrim, Escape and navigation without leaving hidden controls active", t => {
  const { window, document, query, key, setDesktop } = mount(t);
  const panel = query("#cxDetailsPanel");
  const toggle = query("#cxDetailsTop");
  const closeWith = action => {
    toggle.focus();
    toggle.click();
    assert.equal(panel.inert, false);
    assert.equal(panel.getAttribute("aria-hidden"), "false");
    assert.equal(toggle.getAttribute("aria-expanded"), "true");
    action();
    assert.equal(panel.inert, true);
    assert.equal(panel.getAttribute("aria-hidden"), "true");
    assert.equal(toggle.getAttribute("aria-expanded"), "false");
  };
  closeWith(() => query("#cxScrim").click());
  closeWith(() => { key("Escape"); assert.equal(document.activeElement, toggle); });
  closeWith(() => window.dispatchEvent(new window.CustomEvent("devmoter:surface-changed", { detail: { surface: "api" } })));
  setDesktop(true);
  assert.equal(panel.inert, false);
  setDesktop(false);
  assert.equal(panel.inert, true);
});

test("mobile history closes on global navigation and surface changes", t => {
  const { window, query } = mount(t);
  const sidebar = query("#cxSidebar");
  for (const eventName of ["devmoter:close-chat-history", "devmoter:surface-changed"]) {
    query("#cxMenu").click();
    assert.equal(sidebar.inert, false);
    assert.equal(query(".cx-main").inert, true);
    window.dispatchEvent(new window.CustomEvent(eventName, { detail: { surface: "api" } }));
    assert.equal(sidebar.inert, true);
    assert.equal(sidebar.getAttribute("aria-hidden"), "true");
    assert.equal(query(".cx-main").inert, false);
  }
});

test("Codex details drawer holds no workspace shortcuts; workspace commands open a body-level panel", t => {
  const { window, document, query } = mount(t);
  window.exports = {};
  window.Function("exports", compiledWorkspace)(window.exports);
  const stop = window.exports.startWorkspaceControl();
  t.after(stop);
  const panel = query("#cxDetailsPanel");
  for (const removed of [".dm-review-shortcut", ".dm-agent-shortcut", ".dm-session-shortcut", ".dm-settings-shortcut", ".dm-git-shortcut", ".dm-context", "#cxWorkspaceControlsMount"]) {
    assert.equal(document.querySelector(removed), null, removed);
  }
  window.dispatchEvent(new window.CustomEvent("devmoter:workspace-command", { detail: { command: "context" } }));
  const controls = query(".dm-panel");
  assert.equal(controls.classList.contains("hidden"), false);
  assert.equal(panel.contains(controls), false);
});
