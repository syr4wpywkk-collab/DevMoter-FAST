import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { createServer } from "vite";

const vite = await createServer({ server: { middlewareMode: true }, appType: "custom" });
const { mountUnifiedFeatureShell } = await vite.ssrLoadModule("/src/app-shell.ts");
await vite.close();

function makeDom() {
  const dom = new JSDOM(`<!doctype html><body>
    <button class="dm-tools-launcher">tools</button>
    <div class="dm-tools-tabs"><button>Terminal</button><button>Safety</button><button>Project Index</button></div>
    <button class="pocket-git-trigger">git</button><button id="wfLaunch">review</button>
    <button id="devmoterAgentLauncher">agents</button><button class="sc-fab">sessions</button>
    <button class="adv-fab">advanced</button>
    <button class="dm-control-trigger">remote</button>
    <div class="dm-control-tabs"><button data-tab="hosts">hosts</button><button data-tab="automation">automation</button><button data-tab="passkeys">passkeys</button></div>
    <button id="cxProjectsNav">projects</button><button id="cxDevWorkflowsNav">workflows</button>
    <button id="devmoterHomeTitle">home</button>
  </body>`, { url: "http://localhost/", pretendToBeVisual: true });
  dom.window.HTMLElement.prototype.getClientRects = () => [{ width: 1, height: 1 }];
  Object.defineProperty(dom.window.HTMLElement.prototype, "inert", {
    configurable: true,
    get() { return this.hasAttribute("inert"); },
    set(value) { if (value) this.setAttribute("inert", ""); else this.removeAttribute("inert"); }
  });
  return dom;
}

function mount(dom, calls) {
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.CustomEvent = dom.window.CustomEvent;
  globalThis.HTMLElement = dom.window.HTMLElement;
  const on = (selector, callback) => dom.window.document.querySelector(selector)?.addEventListener("click", callback);
  on(".dm-tools-launcher", () => calls.push("terminal-launcher"));
  [...dom.window.document.querySelectorAll(".dm-tools-tabs button")].forEach((button, index) => {
    button.addEventListener("click", () => calls.push(`tool-tab-${index}`));
  });
  on(".pocket-git-trigger", () => calls.push("git"));
  on("#wfLaunch", () => calls.push("review"));
  on("#devmoterAgentLauncher", () => calls.push("agents"));
  on(".sc-fab", () => calls.push("sessions"));
  on(".adv-fab", () => calls.push("advanced"));
  on(".dm-control-trigger", () => calls.push("remote-launcher"));
  for (const button of dom.window.document.querySelectorAll(".dm-control-tabs button")) {
    button.addEventListener("click", () => calls.push(`remote-${button.dataset.tab}`));
  }
  on("#cxProjectsNav", () => calls.push("projects-nav"));
  on("#cxDevWorkflowsNav", () => calls.push("workflows-nav"));
  dom.window.addEventListener("devmoter:open-mission-control", () => calls.push("mission-control"));
  dom.window.addEventListener("devmoter:open-settings", event => calls.push(`settings-${event.detail.page}`));
  mountUnifiedFeatureShell({ switchBackend: backend => calls.push(`backend-${backend}`), openHome: () => calls.push("home") });
}

function click(dom, selector) {
  const element = dom.window.document.querySelector(selector);
  assert.ok(element, `missing ${selector}`);
  element.click();
  return element;
}

function tick(dom) {
  return new Promise(resolve => dom.window.setTimeout(resolve, 5));
}

test("Tools search and category filters update the mounted menu and recover from no results", async () => {
  const dom = makeDom();
  const calls = [];
  mount(dom, calls);
  click(dom, ".dm-shell-menu-trigger");
  const search = dom.window.document.querySelector("#dmShellToolSearch");
  const count = dom.window.document.querySelector("[data-tools-count]");
  const empty = dom.window.document.querySelector("[data-tools-empty]");

  search.value = "  project   index ";
  search.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  assert.equal(count.textContent, "1 tool");
  assert.equal(dom.window.document.querySelector(".dm-shell-primary").hidden, true);
  assert.equal(dom.window.document.querySelector('[data-shell-action="index"]').hidden, false);
  assert.equal(dom.window.document.querySelector('[data-shell-action="safety"]').hidden, true);

  search.value = "ターミナル";
  search.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  assert.equal(count.textContent, "1 tool");
  assert.equal(dom.window.document.querySelector('[data-shell-app="terminal"]').hidden, false);

  click(dom, '[data-tools-filter="Settings"]');
  assert.equal(count.textContent, "0 tools");
  assert.equal(empty.classList.contains("hidden"), false);
  assert.equal(dom.window.document.querySelector('[data-tools-filter="Settings"]').getAttribute("aria-pressed"), "true");

  click(dom, "[data-tools-clear]");
  click(dom, '[data-tools-filter="All"]');
  assert.equal(empty.classList.contains("hidden"), true);
  assert.equal(dom.window.document.querySelector(".dm-shell-primary").hidden, false);
  assert.equal(count.textContent, `${dom.window.document.querySelectorAll("[data-tools-item]").length} tools`);
  assert.equal(dom.window.document.querySelector("[data-tools-clear]").disabled, true);
  dom.window.close();
});

test("Every original tool destination remains reachable and filtered controls stay out of the focus cycle", async () => {
  const dom = makeDom();
  const calls = [];
  mount(dom, calls);
  const items = [...dom.window.document.querySelectorAll("[data-tools-item]")];
  assert.ok(items.length >= 20);
  assert.ok(items.every(item => item.dataset.shellApp || item.dataset.shellAction));

  const invoke = selector => {
    click(dom, ".dm-shell-menu-trigger");
    dom.window.document.querySelector("[data-manual-tools]").open = true;
    click(dom, selector);
  };
  invoke('[data-shell-app="mission-control"]');
  invoke('[data-shell-app="terminal"]');
  await tick(dom);
  invoke('[data-shell-app="git"]');
  invoke('[data-shell-app="review"]');
  invoke('[data-shell-app="agents"]');
  invoke('[data-shell-app="sessions"]');
  invoke('[data-shell-app="automation"]');
  await tick(dom);
  invoke('[data-shell-app="projects"]');
  await tick(dom);
  invoke('[data-shell-app="developer-workflows"]');
  await tick(dom);
  invoke('[data-shell-action="advanced"]');
  invoke('[data-shell-action="safety"]');
  await tick(dom);
  invoke('[data-shell-action="index"]');
  await tick(dom);
  invoke('[data-shell-action="hosts"]');
  await tick(dom);
  invoke('[data-shell-action="passkeys"]');
  await tick(dom);
  invoke('[data-shell-action="vault"]');
  invoke('[data-shell-action="devices"]');
  invoke('[data-shell-action="notifications"]');
  invoke('[data-shell-action="diagnostics"]');
  invoke('[data-shell-action="settings"]');

  for (const action of ["mission-control", "terminal-launcher", "tool-tab-0", "git", "review", "agents", "sessions", "remote-automation", "backend-codex", "projects-nav", "workflows-nav", "advanced", "tool-tab-1", "tool-tab-2", "remote-hosts", "remote-passkeys", "settings-vault", "settings-devices", "settings-notifications", "settings-diagnostics", "settings-root"]) {
    assert.ok(calls.includes(action), `missing route ${action}`);
  }

  click(dom, ".dm-shell-menu-trigger");
  const search = dom.window.document.querySelector("#dmShellToolSearch");
  search.value = "terminal";
  search.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  const terminal = dom.window.document.querySelector('[data-shell-app="terminal"]');
  terminal.focus();
  dom.window.document.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
  assert.equal(dom.window.document.activeElement, dom.window.document.querySelector("[data-shell-close]"));
  dom.window.document.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  assert.equal(dom.window.document.querySelector(".dm-shell-sidebar").classList.contains("open"), false);
  assert.equal(dom.window.document.activeElement, dom.window.document.querySelector(".dm-shell-menu-trigger"));
  dom.window.close();
});

test("API history keeps an in-flow Tools entry while the floating trigger yields to history", async t => {
  const dom = makeDom();
  dom.window.document.body.insertAdjacentHTML('beforeend', '<aside id="apiSidebar"><nav class="api-agent-nav"></nav></aside>');
  t.after(() => dom.window.close());
  const calls = [];
  mount(dom, calls);
  const entry = dom.window.document.querySelector('#apiSidebar [data-open-tools]');
  assert.ok(entry);
  entry.click();
  assert.equal(dom.window.document.querySelector('.dm-shell-sidebar').classList.contains('open'), true);
  dom.window.document.querySelector('[data-shell-close]').click();
});
