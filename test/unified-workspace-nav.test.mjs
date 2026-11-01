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
  const chatCss = await readFile(new URL("../src/unified-workspace-chat.css", import.meta.url), "utf8");
  assert.ok(chatCss.includes("padding-bottom: calc(8px + env(safe-area-inset-bottom))"), "composers keep the home indicator clear");
  assert.ok(css.includes("min-height:44px") || css.includes("min-height: 44px"));
  // Each provider is fixed to the viewport, not laid out by #app.
  // Prevent mobile navigation from covering headers, composer and approvals.
  assert.ok(css.includes(":is(.cx-app, .ocx-app, .api-app, .ix-app)"));
  assert.ok(css.includes("top:calc(var(--dw-top-height) + var(--dm-viewport-offset-top, 0px))"));
  assert.ok(!css.includes("--dw-bottom-height"), "no bottom tab bar reserves space");
  assert.ok(!moduleCode.includes("dm-task-first-tabs"));
  assert.ok(css.includes("height:calc(var(--dm-viewport-height, 100dvh) - var(--dw-top-height))"));
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

test("Chat routing reuses provider history entries and returns focus to the menu button after closing Review", async () => {
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
    assert.equal(dom.window.document.activeElement, root.querySelector("[data-workspace-menu-button]"), "focus returns to the ☰ menu button");
    assert.equal(tab("tasks").getAttribute("aria-current"), "page");
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

test("☰ menu replaces the bottom tab bar: aria-expanded, Escape, outside tap and current screen", async () => {
  const dom = new JSDOM('<!doctype html><div id="app"></div><button id="outside">x</button>', { url: "https://localhost/?unifiedUI=1" });
  const prior = { window: globalThis.window, document: globalThis.document, localStorage: globalThis.localStorage };
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, localStorage: dom.window.localStorage });
  try {
    const mount = await loadNavigator();
    const opened = [];
    const nav = mount({
      initialSurface: "opencode", switchBackend() {}, openHome() {},
      openTasks: () => opened.push("tasks"), openReview: () => opened.push("review"), openTools: () => opened.push("tools")
    });
    const doc = dom.window.document;
    const button = doc.querySelector("[data-workspace-menu-button]");
    const menu = doc.getElementById("dmTaskFirstMenu");
    assert.equal(doc.querySelector(".dm-task-first-tabs"), null, "no bottom tab bar");
    assert.equal(menu.hidden, true);
    button.click();
    assert.equal(button.getAttribute("aria-expanded"), "true");
    assert.equal(menu.hidden, false);
    assert.equal(doc.activeElement, menu.querySelector('[aria-current="page"]'), "focus starts on the current screen");
    assert.equal(doc.activeElement.dataset.workspaceAction, "chat");
    doc.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    assert.equal(menu.hidden, true);
    assert.equal(button.getAttribute("aria-expanded"), "false");
    assert.equal(doc.activeElement, button, "Escape returns focus to ☰");
    button.click();
    doc.getElementById("outside").dispatchEvent(new dom.window.Event("pointerdown", { bubbles: true }));
    assert.equal(menu.hidden, true, "outside tap closes");
    button.click();
    menu.querySelector('[data-workspace-action="review"]').click();
    assert.equal(menu.hidden, true, "choosing a screen closes the menu");
    assert.deepEqual(opened, ["review"]);
    assert.equal(menu.querySelector('[aria-current="page"]').dataset.workspaceAction, "review");
    const settingsOpened = [];
    dom.window.addEventListener("devmoter:open-settings", event => settingsOpened.push(event.detail.page));
    button.click();
    const settings = menu.querySelector("[data-workspace-settings]");
    assert.equal(settings.hasAttribute("data-workspace-action"), false, "設定 is not a screen tab");
    settings.click();
    assert.deepEqual(settingsOpened, ["root"]);
    assert.equal(menu.hidden, true);
    // The former drawer button group (theme / 表示履歴 / タスク / 拡張) lives in ☰ as commands.
    const commands = [];
    dom.window.addEventListener("devmoter:workspace-command", event => commands.push(event.detail.command));
    button.click();
    assert.deepEqual([...menu.querySelectorAll("[data-workspace-command]")].map(item => item.dataset.workspaceCommand),
      ["theme", "context", "checkpoints", "extensions"]);
    assert.equal(menu.querySelector("[data-workspace-theme-value]").textContent, "システム");
    menu.querySelector('[data-workspace-command="theme"]').click();
    assert.equal(menu.hidden, false, "theme cycles in place");
    dom.window.localStorage.setItem("devmoter-theme", "light");
    dom.window.dispatchEvent(new dom.window.CustomEvent("devmoter:theme-changed"));
    assert.equal(menu.querySelector("[data-workspace-theme-value]").textContent, "ライト");
    menu.querySelector('[data-workspace-command="extensions"]').click();
    assert.equal(menu.hidden, true);
    assert.deepEqual(commands, ["theme", "extensions"]);
    nav.destroy();
  } finally {
    Object.assign(globalThis, prior);
    dom.window.close();
  }
});

test("A-5: ☰ toggles through one state path; a tap on ☰ is never an outside tap", async () => {
  const dom = new JSDOM('<!doctype html><div id="app"></div><button id="outside">x</button>', { url: "https://localhost/?unifiedUI=1" });
  const prior = { window: globalThis.window, document: globalThis.document, localStorage: globalThis.localStorage };
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, localStorage: dom.window.localStorage });
  try {
    const mount = await loadNavigator();
    const nav = mount({
      initialSurface: "opencode", switchBackend() {}, openHome() {},
      openTasks() {}, openReview() {}, openTools() {}, openTerminal() {}
    });
    const doc = dom.window.document;
    const button = doc.querySelector("[data-workspace-menu-button]");
    const menu = doc.getElementById("dmTaskFirstMenu");
    // A real tap: pointerdown (capture listeners see it first), focus moves
    // from the open menu to ☰, then click.
    const tap = () => {
      button.dispatchEvent(new dom.window.Event("pointerdown", { bubbles: true }));
      button.focus();
      button.click();
    };
    const states = [];
    for (let i = 0; i < 6; i++) { tap(); states.push(!menu.hidden); }
    assert.deepEqual(states, [true, false, true, false, true, false]);
    for (let i = 0; i < 6; i++) assert.equal(button.getAttribute("aria-expanded"), "false");
    tap();
    doc.getElementById("outside").dispatchEvent(new dom.window.Event("pointerdown", { bubbles: true }));
    assert.equal(menu.hidden, true, "outside tap closes");
    tap();
    assert.equal(menu.hidden, false, "the next ☰ tap opens again");
    const brand = doc.querySelector("[data-workspace-home]");
    brand.dispatchEvent(new dom.window.Event("pointerdown", { bubbles: true }));
    assert.equal(menu.hidden, true, "other header controls count as outside the menu");
    nav.destroy();
  } finally {
    Object.assign(globalThis, prior);
    dom.window.close();
  }
});

test("A-4/A-2: Home and Terminal are ☰ destinations; every destination closes what covers the screen", async () => {
  const dom = new JSDOM('<!doctype html><div id="app"></div>', { url: "https://localhost/?surface=codex" });
  const prior = { window: globalThis.window, document: globalThis.document, localStorage: globalThis.localStorage };
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, localStorage: dom.window.localStorage });
  try {
    const { window } = dom;
    const calls = [];
    let changing = 0;
    window.addEventListener("devmoter:workspace-tab-changing", () => changing++);
    const mount = await loadNavigator();
    const nav = mount({
      initialSurface: "codex", switchBackend() {},
      openHome: () => { calls.push("home"); window.dispatchEvent(new window.CustomEvent("devmoter:surface-changed", { detail: { surface: "home" } })); },
      openTasks: () => calls.push("tasks"), openReview: () => calls.push("review"), openTools: () => calls.push("tools"),
      openTerminal: () => calls.push("terminal")
    });
    changing = 0; // mounting restores the route once
    const doc = window.document;
    const menu = doc.getElementById("dmTaskFirstMenu");
    const items = [...menu.querySelectorAll("button")];
    assert.deepEqual(items.slice(0, 6).map(item => item.textContent.trim()), ["Home", "タスク", "Chat", "Review", "Tools", "Terminal"]);
    for (const item of [...items, menu.querySelector(".dm-task-first-menu-row")]) {
      const icon = item.querySelector("svg");
      assert.ok(icon, `${item.textContent.trim()} has an inline line icon`);
      // Shared 24px line-icon set (#507): the 1.5 stroke comes from CSS, checked in line-icons.test.mjs.
      assert.equal(icon.getAttribute("viewBox"), "0 0 24 24");
      assert.equal(icon.getAttribute("aria-hidden"), "true");
      assert.equal(icon.parentElement.tagName, "SPAN");
      assert.equal(icon.parentElement.getAttribute("aria-hidden"), "true");
    }
    const source = await readFile(new URL("../src/unified-workspace-nav.ts", import.meta.url), "utf8");
    assert.match(source, /data-workspace-go="home"[^>]*><span aria-hidden="true">\$\{ICONS\.home\}/);
    assert.match(source, /data-workspace-action="terminal"[^>]*><span aria-hidden="true">\$\{ICONS\.terminal\}/);
    assert.doesNotMatch(source, /from "\.\/line-icons/, "standalone module inlines its SVGs");
    const shell = await readFile(new URL("../src/app-shell.ts", import.meta.url), "utf8");
    assert.ok(shell.includes('openTerminal: () => run(() => launchApp("terminal"))'));

    const choose = selector => { doc.querySelector("[data-workspace-menu-button]").click(); menu.querySelector(selector).click(); };
    choose('[data-workspace-action="terminal"]');
    assert.deepEqual(calls, ["terminal"]);
    assert.equal(menu.hidden, true);
    assert.equal(changing, 1, "Terminal closes Settings/Tasks/Review first");
    assert.equal(menu.querySelector('[aria-current="page"]').dataset.workspaceAction, "terminal");
    assert.equal(new URL(window.location.href).searchParams.get("workspaceTab"), "terminal");

    const length = window.history.length;
    choose('[data-workspace-action="terminal"]');
    assert.equal(changing, 2, "reselecting the current screen still closes whatever covers it");
    assert.equal(window.history.length, length, "…without another Back stop");

    choose('[data-workspace-go="home"]');
    assert.equal(calls.at(-1), "home");
    assert.equal(changing, 3);
    assert.equal(menu.querySelector('[aria-current="page"]').dataset.workspaceGo, "home");
    assert.equal(new URL(window.location.href).searchParams.get("workspaceTab"), null);

    choose('[data-workspace-action="tasks"]');
    choose('[data-workspace-action="tasks"]');
    assert.equal(changing, 5);
    assert.deepEqual(calls.filter(call => call === "tasks"), ["tasks", "tasks"]);
    nav.destroy();
  } finally {
    Object.assign(globalThis, prior);
    dom.window.close();
  }
});
