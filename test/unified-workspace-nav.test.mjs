import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { transform } from "esbuild";
import { JSDOM } from "jsdom";

async function loadNavigator() {
  const source = await readFile(new URL("../src/unified-workspace-nav.ts", import.meta.url), "utf8");
  // Browser CSS import is intentionally omitted only from this DOM unit test.
  const transpiled = await transform(source.replace(/import "\.\/unified-workspace-(?:nav|chat)\.css";/g, ""), {
    loader: "ts", format: "esm", target: "es2022"
  });
  const uri = "data:text/javascript;base64," + Buffer.from(transpiled.code).toString("base64");
  return (await import(uri)).mountTaskFirstWorkspace;
}

test("unified task-first navigation delegates to real app actions and native provider history", async () => {
  const dom = new JSDOM(
    '<!doctype html><div id="app"></div><button id="apiMenu">API history</button><button id="cxMenu">Codex history</button><button id="ocxMenu">OpenCode history</button>',
    { url: "https://localhost/?unifiedUI=1" }
  );
  const priorWindow = globalThis.window;
  const priorDocument = globalThis.document;
  const priorLocalStorage = globalThis.localStorage;
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.localStorage = dom.window.localStorage;
  try {
    const mount = await loadNavigator();
    const actions = [];
    dom.window.localStorage.setItem("opencode-pocket-project", "/projects/<img src=x onerror=alert(1)>");
    const nav = mount({
      initialSurface: "api",
      switchBackend: backend => actions.push("backend:" + backend),
      openHome: () => actions.push("home"),
      openTasks: () => actions.push("tasks"),
      openReview: () => actions.push("review"),
      openTools: () => actions.push("tools")
    });
    const root = dom.window.document.getElementById("dmTaskFirstWorkspace");
    assert.ok(root);
    assert.equal(root.querySelector("[data-workspace-project]").textContent, "<img src=x onerror=alert(1)>");
    assert.equal(root.querySelector("[data-workspace-project] img"), null);
    assert.equal(root.querySelector("[data-workspace-backend]").value, "api");

    let apiHistoryOpened = 0;
    root.ownerDocument.getElementById("apiMenu").addEventListener("click", () => apiHistoryOpened++);
    root.querySelector('[data-workspace-action="chat"]').click();
    assert.equal(apiHistoryOpened, 1);

    for (const name of ["tasks", "review", "tools"]) root.querySelector('[data-workspace-action="' + name + '"]').click();
    assert.deepEqual(actions, ["tasks", "review", "tools"]);

    const select = root.querySelector("[data-workspace-backend]");
    select.value = "codex";
    select.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
    assert.deepEqual(actions, ["tasks", "review", "tools", "backend:codex"]);

    dom.window.dispatchEvent(new dom.window.CustomEvent("devmoter:surface-changed", { detail: { surface: "codex" } }));
    assert.equal(select.value, "codex");
    let codexHistoryOpened = 0;
    root.ownerDocument.getElementById("cxMenu").addEventListener("click", () => codexHistoryOpened++);
    root.querySelector('[data-workspace-action="chat"]').click();
    assert.equal(codexHistoryOpened, 1);

    root.querySelector("[data-workspace-home]").click();
    assert.equal(actions.at(-1), "home");
    nav.destroy();
    assert.equal(root.ownerDocument.getElementById("dmTaskFirstWorkspace"), null);
    assert.equal(root.ownerDocument.body.classList.contains("dm-task-first-enabled"), false);
  } finally {
    globalThis.window = priorWindow;
    globalThis.document = priorDocument;
    globalThis.localStorage = priorLocalStorage;
    dom.window.close();
  }
});

test("task-first navigator has no fake execution, server state or permission handling", async () => {
  const [moduleCode, shellCode, css] = await Promise.all([
    readFile(new URL("../src/unified-workspace-nav.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/app-shell.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/unified-workspace-nav.css", import.meta.url), "utf8")
  ]);
  assert.ok(shellCode.includes("shouldUseUnifiedWorkspace(window.location.search)"));
  assert.ok(shellCode.includes('launchApp("sessions")'));
  assert.ok(shellCode.includes('launchApp("review")'));
  assert.ok(moduleCode.includes('document.querySelector<HTMLButtonElement>'));
  assert.ok(moduleCode.includes('window.addEventListener("devmoter:surface-changed"'));
  assert.ok(!moduleCode.includes("fetch("));
  assert.ok(!moduleCode.includes("innerHTML = response"));
  assert.ok(css.includes("env(safe-area-inset-bottom)"));
  assert.ok(css.includes("min-height:44px") || css.includes("min-height: 44px"));
  // Each provider is fixed to the viewport, not laid out by #app.
  // Prevent mobile navigation from covering headers, composer and approvals.
  assert.ok(css.includes(":is(.cx-app, .ocx-app, .api-app, .ix-app)"));
  assert.ok(css.includes("top:var(--dw-top-height)"));
  assert.ok(css.includes("--dw-bottom-height"));
  assert.ok(css.includes("height:calc(var(--dm-viewport-height, 100dvh) - var(--dw-top-height) - var(--dw-bottom-height))"));
  assert.ok(!css.includes("body.dm-task-first-enabled #ocxSidebar,"));
});

test("Home and Integrations preserve the real backend choice for Chat", async () => {
  const dom = new JSDOM('<!doctype html><div id="app"></div>', { url: "https://localhost/?unifiedUI=1" });
  const priorWindow = globalThis.window;
  const priorDocument = globalThis.document;
  const priorLocalStorage = globalThis.localStorage;
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.localStorage = dom.window.localStorage;
  try {
    const mount = await loadNavigator();
    const switched = [];
    const controller = mount({
      initialSurface: "home",
      initialBackend: "api",
      switchBackend: backend => switched.push(backend),
      openHome: () => {},
      openTasks: () => {},
      openReview: () => {},
      openTools: () => {}
    });
    const root = dom.window.document.getElementById("dmTaskFirstWorkspace");
    const picker = root.querySelector("[data-workspace-backend]");
    const chat = root.querySelector('[data-workspace-action="chat"]');
    assert.equal(picker.value, "api", "Home should not silently reset the selected backend");
    chat.click();
    assert.deepEqual(switched, ["api"]);

    dom.window.dispatchEvent(new dom.window.CustomEvent("devmoter:surface-changed", { detail: { surface: "integrations" } }));
    assert.equal(picker.value, "api");
    dom.window.dispatchEvent(new dom.window.CustomEvent("devmoter:backend-changed", { detail: { backend: "codex" } }));
    assert.equal(picker.value, "codex");
    chat.click();
    assert.deepEqual(switched, ["api", "codex"]);
    controller.destroy();
  } finally {
    globalThis.window = priorWindow;
    globalThis.document = priorDocument;
    globalThis.localStorage = priorLocalStorage;
    dom.window.close();
  }
});

test("workspace tabs close the previous panel, select exactly one tab and restore browser history", async () => {
  const dom = new JSDOM('<!doctype html><div id="app"></div>', {
    url: "https://localhost/?surface=codex&session=synthetic-session#keep"
  });
  const prior = { window: globalThis.window, document: globalThis.document, localStorage: globalThis.localStorage };
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, localStorage: dom.window.localStorage });
  const { window } = dom;
  let panel = null;
  const panelEvent = (tab, open) => window.dispatchEvent(new window.CustomEvent("devmoter:workspace-panel-changed", { detail: { tab, open } }));
  window.addEventListener("devmoter:workspace-tab-changing", () => {
    if (panel) panelEvent(panel, false);
    panel = null;
  });
  const open = tab => { panel = tab; panelEvent(tab, true); };
  try {
    const mount = await loadNavigator();
    window.history.replaceState({ devmoterSurface: "codex", retained: "synthetic" }, "");
    const controller = mount({
      initialSurface: "codex", switchBackend: () => {}, openHome: () => {},
      openTasks: () => open("tasks"), openReview: () => open("review"), openTools: () => open("tools")
    });
    const root = window.document.getElementById("dmTaskFirstWorkspace");
    const selected = () => [...root.querySelectorAll('[aria-current="page"]')].map(button => button.dataset.workspaceAction);
    const click = tab => root.querySelector(`[data-workspace-action="${tab}"]`).click();
    for (const tab of ["tasks", "review", "tasks", "chat", "review", "tools", "tasks"]) {
      click(tab);
      assert.deepEqual(selected(), [tab]);
      assert.equal(panel, tab === "chat" ? null : tab);
      assert.equal(new URL(window.location.href).searchParams.get("workspaceTab"), tab);
      assert.equal(new URL(window.location.href).searchParams.get("session"), "synthetic-session");
      assert.equal(window.location.hash, "#keep");
      assert.deepEqual(window.history.state, { devmoterSurface: "codex", retained: "synthetic" });
    }
    const traverse = direction => new Promise(resolve => {
      window.addEventListener("popstate", resolve, { once: true });
      window.history[direction]();
    });
    await traverse("back");
    assert.deepEqual(selected(), ["tools"]);
    assert.equal(panel, "tools");
    await traverse("forward");
    assert.deepEqual(selected(), ["tasks"]);
    assert.equal(panel, "tasks");
    panel = null;
    panelEvent("tasks", false);
    assert.deepEqual(selected(), ["chat"], "closing a panel restores the visible underlying Chat");
    const length = window.history.length;
    click("tasks");
    click("tasks");
    assert.equal(window.history.length, length + 1, "reselecting the current tab must not add history");
    controller.destroy();
  } finally {
    Object.assign(globalThis, prior);
    dom.window.close();
  }
});

test("untrusted tab URLs cannot launch arbitrary tools or inject project markup", async () => {
  const dom = new JSDOM('<!doctype html><div id="app"></div>', {
    url: "https://localhost/?surface=codex&workspaceTab=javascript%3Aalert(1)"
  });
  const prior = { window: globalThis.window, document: globalThis.document, localStorage: globalThis.localStorage };
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, localStorage: dom.window.localStorage });
  try {
    const calls = [];
    const mount = await loadNavigator();
    const controller = mount({
      initialSurface: "codex", switchBackend: () => calls.push("backend"), openHome: () => calls.push("home"),
      openTasks: () => calls.push("tasks"), openReview: () => calls.push("review"), openTools: () => calls.push("tools")
    });
    assert.deepEqual(calls, []);
    assert.equal(dom.window.document.querySelector('[data-workspace-action][aria-current="page"]').dataset.workspaceAction, "chat");
    controller.destroy();
  } finally {
    Object.assign(globalThis, prior);
    dom.window.close();
  }
});

test("Chat routing reuses provider history entries and focuses the live tab after closing Review", async () => {
  const dom = new JSDOM('<!doctype html><div id="app"></div>', { url: "https://localhost/?surface=home&project=keep" });
  const prior = { window: globalThis.window, document: globalThis.document, localStorage: globalThis.localStorage };
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, localStorage: dom.window.localStorage });
  try {
    const { createSurfaceNavigation } = await import("../src/surface-navigation.mjs");
    const navigation = createSurfaceNavigation({
      window: dom.window,
      onSurface: surface => dom.window.dispatchEvent(new dom.window.CustomEvent("devmoter:surface-changed", { detail: { surface } }))
    });
    const mount = await loadNavigator();
    const nav = mount({
      initialSurface: "home", initialBackend: "codex",
      switchBackend: backend => navigation.navigate(backend),
      openHome: () => navigation.navigate("home"),
      openTasks: () => {}, openReview: () => {}, openTools: () => {}
    });
    const root = dom.window.document.getElementById("dmTaskFirstWorkspace");
    const tab = name => root.querySelector(`[data-workspace-action="${name}"]`);
    const start = dom.window.history.length;
    tab("chat").click();
    assert.equal(dom.window.history.length, start + 1, "opening Chat from Home must push just once");
    assert.equal(new URL(dom.window.location.href).searchParams.get("workspaceTab"), "chat");
    assert.equal(new URL(dom.window.location.href).searchParams.get("surface"), "codex");
    const picker = root.querySelector("[data-workspace-backend]");
    picker.value = "api";
    picker.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
    assert.equal(dom.window.history.length, start + 2, "changing provider must push just once");
    assert.equal(new URL(dom.window.location.href).searchParams.get("surface"), "api");
    tab("review").click();
    tab("tasks").click();
    assert.equal(dom.window.document.activeElement, tab("tasks"), "focus follows the live Tasks tab");
    nav.destroy();
    navigation.destroy();
  } finally {
    Object.assign(globalThis, prior);
    dom.window.close();
  }
});

test("Review canvas uses the Unified Workspace theme instead of a detached modal background", async () => {
  const [css, workflow] = await Promise.all([
    readFile(new URL("../src/unified-workspace-nav.css", import.meta.url), "utf8"),
    readFile(new URL("../src/workflow.ts", import.meta.url), "utf8")
  ]);
  assert.match(css, /body\.dm-task-first-enabled \.wf-modal\s*\{[^}]*background: var\(--dw-chat-bg\)/s);
  assert.match(css, /body\.dm-task-first-enabled \.wf-sheet\s*\{[^}]*background: var\(--dw-chat-bg\)/s);
  assert.match(css, /body\.dm-task-first-enabled \.wf-body\s*\{[^}]*background: var\(--dw-chat-bg\)/s);
  assert.match(workflow, /devmoter:workspace-tab-changing", \(\) => closeReview\(false\)/);
});
