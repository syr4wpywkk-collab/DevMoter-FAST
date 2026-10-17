import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { transform } from "esbuild";
import { JSDOM } from "jsdom";

async function loadNavigator() {
  const source = await readFile(new URL("../src/unified-workspace-nav.ts", import.meta.url), "utf8");
  // Browser CSS import is intentionally omitted only from this DOM unit test.
  const transpiled = await transform(source.replace('import "./unified-workspace-nav.css";', ""), {
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
  assert.ok(shellCode.includes('get("unifiedUI") === "1"'));
  assert.ok(shellCode.includes('launchApp("sessions")'));
  assert.ok(shellCode.includes('launchApp("review")'));
  assert.ok(moduleCode.includes('document.querySelector<HTMLButtonElement>'));
  assert.ok(moduleCode.includes('window.addEventListener("devmoter:surface-changed"'));
  assert.ok(!moduleCode.includes("fetch("));
  assert.ok(!moduleCode.includes("innerHTML = response"));
  assert.ok(css.includes("env(safe-area-inset-bottom)"));
  assert.ok(css.includes("min-height:44px") || css.includes("min-height: 44px"));
});
