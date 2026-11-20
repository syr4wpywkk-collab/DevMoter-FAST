import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { transform } from "esbuild";
import { JSDOM } from "jsdom";

async function loadNavigator() {
  const source = await readFile(new URL("../src/unified-workspace-nav.ts", import.meta.url), "utf8");
  // Browser CSS import is intentionally omitted only from this DOM unit test.
  const clean = source
    .replace(/import "\.\/unified-workspace-(?:nav|chat)\.css";/g, "")
    .replace(/from "\.\/i18n";/g, `from ${JSON.stringify(new URL("../src/i18n-core.mjs", import.meta.url).href)};`)
    .replace(/from "\.\/feature-flags\.mjs";/g, `from ${JSON.stringify(new URL("../src/feature-flags.mjs", import.meta.url).href)};`);
  const transpiled = await transform(clean, {
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

test("mobile language selector has a 44px minimum tap target", async () => {
  const css = await readFile(new URL("../src/unified-workspace-nav.css", import.meta.url), "utf8");
  const rule = css.match(/\.dm-task-first-menu-row > select\s*\{([^}]+)\}/)?.[1];
  assert.ok(rule, "language select styling remains scoped to the existing menu control");
  assert.match(rule, /min-width:\s*44px/);
  assert.match(rule, /min-height:\s*44px/);
  assert.match(rule, /max-width:\s*112px/, "the existing compact menu width remains bounded");
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
  // Each provider fills the viewport cleanly without a top header bar,
  // while overlay panels/drawers clear the floating top-left menu button.
  assert.ok(!moduleCode.includes("<header"), "no header markup rendered in unified workspace nav");
  assert.ok(!moduleCode.includes("dm-task-first-header"), "header class removed from unified workspace nav");
  assert.ok(css.includes(":is(.cx-app, .ocx-app, .api-app, .ix-app, .qx-app)"));
  assert.ok(css.includes("top: var(--dm-viewport-offset-top, 0px);"));
  assert.ok(css.includes("height: var(--dm-viewport-height, 100dvh);"));
  assert.ok(!css.includes("--dw-bottom-height"), "no bottom tab bar reserves space");
  assert.ok(!moduleCode.includes("dm-task-first-tabs"));
  assert.ok(css.includes("top: calc(var(--dw-top-height) + var(--dm-viewport-offset-top, 0px))"));
  assert.ok(css.includes("height: calc(var(--dm-viewport-height, 100dvh) - var(--dw-top-height))"));
  assert.ok(css.includes(".adv-drawer"), "Files & Preview drawer keeps clearance below the floating menu button");
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
    assert.equal(menu.querySelector("[data-workspace-theme-value]").textContent, "System");
    menu.querySelector('[data-workspace-command="theme"]').click();
    assert.equal(menu.hidden, false, "theme cycles in place");
    dom.window.localStorage.setItem("devmoter-theme", "light");
    dom.window.dispatchEvent(new dom.window.CustomEvent("devmoter:theme-changed"));
    assert.equal(menu.querySelector("[data-workspace-theme-value]").textContent, "Light");
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
    assert.equal(menu.hidden, false, "drawer brand/backend controls live inside the drawer and do not trigger outside-tap close");
    doc.querySelector("[data-workspace-scrim]").click();
    assert.equal(menu.hidden, true, "tapping the backdrop scrim closes the drawer cleanly");
    assert.equal(doc.getElementById("dmTaskFirstDrawer").hidden, true);
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
    assert.deepEqual(items.slice(0, 6).map(item => item.textContent.trim()), ["Home", "Tasks", "Chat", "Review", "Tools", "Terminal"]);
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

test("unified AI backend selector hides Qwen Code and normalizes stale qwen states to opencode", async () => {
  const dom = new JSDOM("<!doctype html><div id='app'></div>", { url: "https://localhost/?unifiedUI=1" });
  const prior = { window: globalThis.window, document: globalThis.document, localStorage: globalThis.localStorage };
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.localStorage = dom.window.localStorage;
  try {
    const mount = await loadNavigator();
    const switched = [];
    const nav = mount({
      initialSurface: "home",
      initialBackend: "qwen",
      switchBackend: backend => switched.push(backend),
      openHome() {}, openTasks() {}, openReview() {}, openTools() {}, openTerminal() {}
    });
    const select = dom.window.document.querySelector("[data-workspace-backend]");
    const values = [...select.querySelectorAll("option")].map(option => option.value).filter(Boolean);
    assert.deepEqual(values, ["codex", "opencode", "api", "deepseek"]);
    assert.equal(select.value, "opencode");

    dom.window.dispatchEvent(new dom.window.CustomEvent("devmoter:backend-changed", { detail: { backend: "qwen" } }));
    assert.equal(select.value, "opencode");

    dom.window.document.querySelector('[data-workspace-action="chat"]').click();
    assert.deepEqual(switched, ["opencode"]);

    dom.window.dispatchEvent(new dom.window.CustomEvent("devmoter:surface-changed", { detail: { surface: "qwen" } }));
    assert.equal(select.value, "opencode");

    select.value = "qwen";
    select.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
    assert.deepEqual(switched, ["opencode"], "spurious qwen change must not switch backend");
    nav.destroy();
  } finally {
    Object.assign(globalThis, prior);
    dom.window.close();
  }
});

test("issue #555: header removed, only menu button remains on screen, drawer holds logo/project/AI switch and closes cleanly without narrow-width overlap", async () => {
  const dom = new JSDOM('<!doctype html><div id="app"></div><aside class="adv-drawer"><div class="adv-head"><div><strong>Files</strong></div><button type="button" data-close>×</button></div></aside>', {
    url: "https://localhost/?unifiedUI=1&surface=home"
  });
  const prior = { window: globalThis.window, document: globalThis.document, localStorage: globalThis.localStorage };
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, localStorage: dom.window.localStorage });
  try {
    dom.window.localStorage.setItem("opencode-pocket-project", "/tmp/worktrees/my-repo");
    const switched = [];
    let wentHome = 0;
    const mount = await loadNavigator();
    const nav = mount({
      initialSurface: "home",
      initialBackend: "opencode",
      switchBackend: backend => switched.push(backend),
      openHome: () => { wentHome += 1; },
      openTasks() {},
      openReview() {},
      openTools() {},
      openTerminal() {}
    });
    const doc = dom.window.document;
    const root = doc.getElementById("dmTaskFirstWorkspace");
    const button = root.querySelector("[data-workspace-menu-button]");
    const drawer = root.querySelector("#dmTaskFirstDrawer");
    const scrim = root.querySelector("[data-workspace-scrim]");
    const menu = root.querySelector("#dmTaskFirstMenu");
    const closeBtn = root.querySelector("[data-workspace-menu-close]");
    const brand = root.querySelector("[data-workspace-home]");
    const project = root.querySelector("[data-workspace-project]");
    const backendSelect = root.querySelector("[data-workspace-backend]");

    // 1. No <header> is rendered anywhere in #dmTaskFirstWorkspace; only menu trigger is visible initially.
    assert.equal(root.querySelector("header"), null);
    assert.equal(root.querySelector(".dm-task-first-header"), null);
    assert.ok(button && button.tagName === "BUTTON");
    assert.ok(button.getAttribute("aria-label"), "menu button has an accessible label");
    assert.equal(button.tabIndex, 0, "menu button is keyboard focusable");
    assert.equal(button.getAttribute("aria-expanded"), "false");
    assert.equal(drawer.hidden, true);
    assert.equal(scrim.hidden, true);
    assert.equal(menu.hidden, true);

    // 2. Menu button opens drawer; logo is at the top of the drawer; project & AI backend live inside drawer.
    button.click();
    assert.equal(drawer.hidden, false);
    assert.equal(scrim.hidden, false);
    assert.equal(menu.hidden, false);
    assert.equal(button.getAttribute("aria-expanded"), "true");
    assert.ok(drawer.contains(brand), "logo/title home button is inside the drawer");
    assert.equal(drawer.firstElementChild.contains(brand), true, "logo sits at the very top of the drawer");
    assert.ok(drawer.contains(project), "project ID display is inside the drawer");
    assert.equal(project.textContent, "my-repo");
    assert.ok(drawer.contains(backendSelect), "AI backend switcher is inside the drawer");

    // 3. Switching AI backend in the drawer switches chat backend and closes the drawer cleanly.
    backendSelect.value = "codex";
    backendSelect.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
    assert.deepEqual(switched, ["codex"]);
    assert.equal(drawer.hidden, true);
    assert.equal(scrim.hidden, true);

    // 4. Drawer closes cleanly via close button, scrim backdrop, and Escape, restoring focus to menu button.
    button.click();
    assert.equal(drawer.hidden, false);
    closeBtn.click();
    assert.equal(drawer.hidden, true);
    assert.equal(scrim.hidden, true);
    assert.equal(button.getAttribute("aria-expanded"), "false");
    assert.equal(doc.activeElement, button, "close button restores focus to menu trigger");

    button.click();
    assert.equal(drawer.hidden, false);
    scrim.click();
    assert.equal(drawer.hidden, true);
    assert.equal(doc.activeElement, button, "scrim click restores focus to menu trigger");

    button.click();
    assert.equal(drawer.hidden, false);
    doc.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    assert.equal(drawer.hidden, true);
    assert.equal(doc.activeElement, button, "Escape restores focus to menu trigger");

    // 5. Clicking the drawer logo navigates Home and closes the drawer cleanly.
    button.click();
    brand.click();
    assert.equal(wentHome, 1);
    assert.equal(drawer.hidden, true);

    // 6. Narrow-width (360px) CSS & geometry verification: no top-right header element overlaps close (×).
    const [css, advCss] = await Promise.all([
      readFile(new URL("../src/unified-workspace-nav.css", import.meta.url), "utf8"),
      readFile(new URL("../src/advanced.css", import.meta.url), "utf8")
    ]);
    assert.ok(!css.includes(".dm-task-first-header"), "removed header styles");
    const navRule = css.match(/\.dm-task-first-nav\s*\{([^}]+)\}/)?.[1] || "";
    const btnRule = css.match(/\.dm-task-first-menu-button\s*\{([^}]+)\}/)?.[1] || "";
    assert.ok(!navRule.includes("right:"), "nav wrapper must not span across the top edge");
    assert.ok(navRule.includes("pointer-events: none"), "nav wrapper does not block clicks");
    assert.ok(btnRule.includes("left:") && !btnRule.includes("right:"), "menu button sits top-left, never top-right");
    assert.match(css, /body\.dm-task-first-enabled\s+#app\s*\{[^}]*margin-top:\s*0;/s);
    assert.doesNotMatch(css, /@media\s*\(max-width:\s*680px\)\s*\{\s*\.dm-task-first-project\s*\{\s*display:\s*none/s, "project ID remains visible inside the drawer at narrow width");
    assert.ok(css.includes("dialog.dm-office[open]"), "Docs modal hides background trigger when open");
    assert.match(css, /body\.dm-task-first-enabled\s+:is\([^)]*\.adv-drawer[^)]*\)\s*\{[^}]*top:\s*calc\(var\(--dw-top-height\)\s*\+\s*var\(--dm-viewport-offset-top,\s*0px\)\)/s);

    // Derive box positions from declared CSS values at 360px width: zero intersection in X or Y.
    const topPx = Number(btnRule.match(/max\((\d+)px,\s*env\(safe-area-inset-top\)\)/)?.[1]);
    const leftPx = Number(btnRule.match(/left:\s*max\((\d+)px,\s*env\(safe-area-inset-left\)\)/)?.[1]);
    const btnSize = Number(btnRule.match(/width:\s*(\d+)px;/)?.[1]);
    const btnH = Number(btnRule.match(/height:\s*(\d+)px;/)?.[1]);
    const topClearance = Number(css.match(/--dw-top-height:\s*calc\((\d+)px\s*\+/)?.[1]);
    const advWidthVw = Number(advCss.match(/\.adv-drawer\{[^}]*width:min\((\d+)vw,/)?.[1]);
    const viewportW = 360;
    const menuBtnRect = { left: leftPx, top: topPx, right: leftPx + btnSize, bottom: topPx + btnH };
    const advDrawerRect = {
      left: Math.max(0, viewportW - (viewportW * advWidthVw) / 100),
      top: topClearance,
      right: viewportW,
      bottom: 800
    };
    const advCloseRect = {
      left: advDrawerRect.right - 16 - 44,
      top: advDrawerRect.top + 12,
      right: advDrawerRect.right - 16,
      bottom: advDrawerRect.top + 12 + 44
    };
    const intersects = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
    assert.ok(menuBtnRect.bottom <= advDrawerRect.top, "menu button sits strictly above overlay top clearance");
    assert.equal(intersects(menuBtnRect, advDrawerRect), false, "menu button does not collide with .adv-drawer at 360px");
    assert.equal(intersects(menuBtnRect, advCloseRect), false, "menu button does not overlap .adv-drawer close (×) at 360px");

    nav.destroy();
  } finally {
    Object.assign(globalThis, prior);
    dom.window.close();
  }
});

test("issue #555 audit fix: drawer traps Tab / Shift+Tab inside #dmTaskFirstDrawer without leaking focus", async () => {
  const dom = new JSDOM('<!doctype html><div id="app"><button id="appButton">Behind</button></div>', {
    url: "https://localhost/?unifiedUI=1&surface=home"
  });
  const prior = { window: globalThis.window, document: globalThis.document, localStorage: globalThis.localStorage };
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, localStorage: dom.window.localStorage });
  try {
    const doc = dom.window.document;
    dom.window.HTMLElement.prototype.getClientRects = function () {
      return this.closest('[inert], [aria-hidden="true"], [hidden], .hidden') ? [] : [{ width: 44, height: 44 }];
    };
    const mount = await loadNavigator();
    const nav = mount({
      initialSurface: "home",
      initialBackend: "opencode",
      switchBackend() {},
      openHome() {},
      openTasks() {},
      openReview() {},
      openTools() {},
      openTerminal() {}
    });
    const root = doc.getElementById("dmTaskFirstWorkspace");
    const button = root.querySelector("[data-workspace-menu-button]");
    const drawer = root.querySelector("#dmTaskFirstDrawer");
    const first = root.querySelector("[data-workspace-home]");
    const closeBtn = root.querySelector("[data-workspace-menu-close]");
    const last = root.querySelector("[data-language-select]");
    const appButton = doc.getElementById("appButton");

    // Disabled / hidden elements added at the end of drawer must be skipped by the trap.
    const trailingDisabled = doc.createElement("button");
    trailingDisabled.disabled = true;
    drawer.append(trailingDisabled);
    const trailingHidden = doc.createElement("button");
    trailingHidden.hidden = true;
    drawer.append(trailingHidden);

    // Simulate a background document-level bubble Tab listener (e.g. app-shell.ts sidebar).
    let backgroundBubbleSawTab = 0;
    const onBackgroundBubbleKeydown = event => {
      if (event.key === "Tab") backgroundBubbleSawTab += 1;
    };
    doc.addEventListener("keydown", onBackgroundBubbleKeydown);

    const pressTab = (target, shiftKey = false) => {
      const event = new dom.window.KeyboardEvent("keydown", { key: "Tab", shiftKey, bubbles: true, cancelable: true });
      target.dispatchEvent(event);
      return event;
    };

    // Closed drawer does not intercept Tab.
    appButton.focus();
    const closedTab = pressTab(appButton, false);
    assert.equal(closedTab.defaultPrevented, false);
    assert.equal(backgroundBubbleSawTab, 1);

    // Open drawer: Shift+Tab from first control wraps to last (<select data-language-select>), not menuButton or #app.
    button.click();
    assert.equal(drawer.hidden, false);
    first.focus();
    const shiftTabFirst = pressTab(first, true);
    assert.equal(shiftTabFirst.defaultPrevented, true);
    assert.equal(doc.activeElement, last, "Shift+Tab from first drawer control wraps to last drawer control");
    assert.equal(drawer.contains(doc.activeElement), true);
    assert.equal(drawer.hidden, false);
    assert.equal(backgroundBubbleSawTab, 1, "Tab inside open drawer does not propagate to background listeners");

    // Tab from last control wraps to first ([data-workspace-home]).
    const tabLast = pressTab(last, false);
    assert.equal(tabLast.defaultPrevented, true);
    assert.equal(doc.activeElement, first, "Tab from last drawer control wraps to first drawer control");
    assert.equal(drawer.contains(doc.activeElement), true);
    assert.equal(drawer.hidden, false);
    assert.equal(backgroundBubbleSawTab, 1);

    // Middle control Tab allows native progression inside the drawer while still stopping background Tab hijacking.
    closeBtn.focus();
    const tabMiddle = pressTab(closeBtn, false);
    assert.equal(tabMiddle.defaultPrevented, false);
    assert.equal(backgroundBubbleSawTab, 1, "middle Tab still blocks background sidebar traps from pulling focus out");

    // If focus is on menuButton (which is in isMenuTarget so focusout keeps drawer open), Tab / Shift+Tab pulls it back into drawer.
    button.focus();
    const tabFromMenuBtn = pressTab(button, false);
    assert.equal(tabFromMenuBtn.defaultPrevented, true);
    assert.equal(doc.activeElement, first);
    button.focus();
    const shiftTabFromMenuBtn = pressTab(button, true);
    assert.equal(shiftTabFromMenuBtn.defaultPrevented, true);
    assert.equal(doc.activeElement, last);
    assert.equal(drawer.contains(doc.activeElement), true);

    // Moving focus programmatically to #app closes the drawer via focusout, and reopening keeps trapping.
    appButton.focus();
    assert.equal(drawer.hidden, true, "programmatic focus outside menu targets closes the drawer");

    // Fallback when getClientRects() returns empty (e.g. unmocked JSDOM).
    delete dom.window.HTMLElement.prototype.getClientRects;
    button.click();
    assert.equal(drawer.hidden, false);
    first.focus();
    assert.equal(pressTab(first, true).defaultPrevented, true);
    assert.equal(doc.activeElement, last);
    assert.equal(pressTab(last, false).defaultPrevented, true);
    assert.equal(doc.activeElement, first);

    doc.removeEventListener("keydown", onBackgroundBubbleKeydown);
    nav.destroy();
  } finally {
    Object.assign(globalThis, prior);
    dom.window.close();
  }
});

test("issue #555 audit fix: unified mode Home shell clears both notch safe-area and floating ☰ at every width", async () => {
  const [navCss, homeCss, shellCss, baseCss] = await Promise.all([
    readFile(new URL("../src/unified-workspace-nav.css", import.meta.url), "utf8"),
    readFile(new URL("../src/home.css", import.meta.url), "utf8"),
    readFile(new URL("../src/app-shell.css", import.meta.url), "utf8"),
    readFile(new URL("../src/styles/base.css", import.meta.url), "utf8")
  ]);

  // Verify body.dm-task-first-enabled .dm-home-shell rule exists with higher specificity than .dm-home-shell (0,2,1 > 0,1,0).
  const homeClearanceMatch = navCss.match(/body\.dm-task-first-enabled\s+\.dm-home-shell\s*\{([^}]+)\}/s);
  assert.ok(homeClearanceMatch, "unified nav CSS defines top clearance on body.dm-task-first-enabled .dm-home-shell");
  assert.match(
    homeClearanceMatch[1],
    /padding-top:\s*calc\(var\(--dw-top-height\)\s*\+\s*var\(--space-2,\s*8px\)\);/,
    "Home shell clears --dw-top-height plus --space-2 (8px)"
  );
  assert.doesNotMatch(
    navCss,
    /\.dm-home-header\s*\{\s*padding-left:\s*48px/,
    "redundant narrow-width left-padding workaround on .dm-home-header is removed"
  );
  // Confirm legacy mode still clears top in app-shell.css and home.css keeps safe-area-inset-top untouched.
  assert.match(shellCss, /body:not\(\.dm-task-first-enabled\)\s+\.dm-home-shell\s*\{[^}]*padding-top:\s*calc\(64px\s*\+\s*env\(safe-area-inset-top\)\)/s);
  assert.ok(!homeCss.includes("env(safe-area-inset-top)"));

  // Geometric verification across non-notched (0px) and notched iOS (47px, 59px) viewports:
  // Home top padding >= --dw-top-height and places .dm-home-header strictly below both safe-area and floating ☰.
  const dwBase = Number(navCss.match(/--dw-top-height:\s*calc\((\d+)px\s*\+\s*env\(safe-area-inset-top\)\)/)?.[1]);
  const space2 = Number(baseCss.match(/--space-2:\s*(\d+)px;/)?.[1]);
  const btnRule = navCss.match(/\.dm-task-first-menu-button\s*\{([^}]+)\}/)?.[1] || "";
  const btnTopMin = Number(btnRule.match(/max\((\d+)px,\s*env\(safe-area-inset-top\)\)/)?.[1]);
  const btnH = Number(btnRule.match(/height:\s*(\d+)px;/)?.[1]);
  assert.equal(dwBase, 56);
  assert.equal(space2, 8);
  for (const safeTop of [0, 20, 47, 59]) {
    const dwTopHeight = dwBase + safeTop;
    const homePaddingTop = dwTopHeight + space2;
    const menuBtnTop = Math.max(btnTopMin, safeTop);
    const menuBtnBottom = menuBtnTop + btnH;
    assert.ok(homePaddingTop >= dwTopHeight, `Home top padding (${homePaddingTop}px) >= --dw-top-height (${dwTopHeight}px) at safeTop=${safeTop}`);
    assert.ok(homePaddingTop > safeTop, `Home header clears status bar/notch (${safeTop}px)`);
    assert.ok(homePaddingTop > menuBtnBottom, `Home header top (${homePaddingTop}px) sits below floating ☰ bottom (${menuBtnBottom}px) at safeTop=${safeTop}`);
  }
});
