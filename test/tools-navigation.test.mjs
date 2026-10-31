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

test("Tools sidebar holds only Tools AI; registered apps still launch through the fixed allowlist", async () => {
  const dom = makeDom();
  const calls = [];
  mount(dom, calls);
  const doc = dom.window.document;
  for (const removed of ["[data-manual-tools]", "#dmShellToolSearch", "[data-tools-item]", "[data-shell-app]", "[data-shell-action]", "[data-home-nav]", ".dm-shell-sidebar [data-backend]"]) {
    assert.equal(doc.querySelector(removed), null, removed);
  }
  const launch = id => dom.window.dispatchEvent(new dom.window.CustomEvent("devmoter:launch-app", { detail: { id } }));
  for (const id of ["mission-control", "terminal", "git", "review", "agents", "sessions", "automation", "projects", "developer-workflows"]) launch(id);
  await tick(dom);
  for (const action of ["mission-control", "terminal-launcher", "tool-tab-0", "git", "review", "agents", "sessions", "remote-automation", "backend-codex", "projects-nav", "workflows-nav"]) {
    assert.ok(calls.includes(action), `missing route ${action}`);
  }

  click(dom, ".dm-shell-menu-trigger");
  assert.equal(doc.querySelector(".dm-shell-sidebar").classList.contains("open"), true);
  doc.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  assert.equal(doc.querySelector(".dm-shell-sidebar").classList.contains("open"), false);
  dom.window.close();
});

test("OpenCode history keeps a direct Tools escape owned by the global shell", async t => {
  const dom = makeDom();
  dom.window.document.body.insertAdjacentHTML("beforeend", '<div class="ocx-app"><aside id="ocxSidebar"><div class="ocx-sidebar-head"><div>OpenCode</div><button id="ocxSidebarClose">×</button></div></aside></div>');
  t.after(() => dom.window.close());
  const calls = [];
  mount(dom, calls);
  const entry = dom.window.document.querySelector('#ocxSidebar [data-open-tools]');
  assert.ok(entry);
  assert.equal(entry.textContent, "Tools");
  entry.click();
  assert.equal(dom.window.document.querySelector(".dm-shell-sidebar").classList.contains("open"), true);
  assert.equal(dom.window.document.querySelector(".dm-shell-menu-trigger").getAttribute("aria-expanded"), "true");
  dom.window.document.querySelector("[data-shell-close]").click();
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
