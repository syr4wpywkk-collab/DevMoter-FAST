import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import ts from "typescript";

const source = await readFile(new URL("../src/system-panel.ts", import.meta.url), "utf8");
const helperSource = await readFile(new URL("../src/push-readiness.ts", import.meta.url), "utf8");
const pushReadiness = {};
vm.runInNewContext(ts.transpileModule(helperSource, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
}).outputText, { exports: pushReadiness, setTimeout, clearTimeout });
const compiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
}).outputText;

function panelHarness({ dismissed = false } = {}) {
  const listeners = new Map();
  const timers = new Map();
  let timerId = 0;
  let requests = 0;

  function element(hidden = false) {
    const classes = new Set(hidden ? ["hidden"] : []);
    const handlers = new Map();
    return {
      classList: {
        add: name => classes.add(name),
        remove: name => classes.delete(name),
        contains: name => classes.has(name)
      },
      addEventListener: (name, handler) => handlers.set(name, handler),
      click() { handlers.get("click")?.({ target: this }); }
    };
  }

  const openButton = element();
  const closeButton = element();
  const modal = element(true);
  const body = element();
  const children = {
    ".devmoter-system-button": openButton,
    ".devmoter-system-modal": modal,
    ".devmoter-system-close": closeButton,
    ".devmoter-system-body": body
  };
  const root = { querySelector: selector => children[selector] };
  const window = {
    addEventListener: (name, handler) => listeners.set(name, handler),
    setTimeout: (handler, delay) => {
      assert.equal(delay, 250);
      timers.set(++timerId, handler);
      return timerId;
    },
    clearTimeout: id => timers.delete(id)
  };
  const exports = {};
  vm.runInNewContext(compiled, {
    exports,
    require: name => name === "./push-readiness.js" ? pushReadiness : {},
    window,
    document: {
      createElement: () => root,
      body: { appendChild() {} },
      addEventListener() {}
    },
    navigator: {},
    localStorage: { getItem: () => dismissed ? "1" : null },
    Headers,
    fetch: () => {
      requests++;
      return new Promise(() => {});
    }
  });
  exports.mountSystemPanel();

  return {
    openButton,
    closeButton,
    modal,
    pendingTimers: () => timers.size,
    requests: () => requests,
    surface: surface => listeners.get("devmoter:surface-changed")({ detail: { surface } }),
    tick() {
      const pending = Array.from(timers.values());
      timers.clear();
      pending.forEach(handler => handler());
    }
  };
}

test("first-run Home retains setup onboarding after the initial surface event", () => {
  const panel = panelHarness();
  panel.surface("home");
  assert.equal(panel.pendingTimers(), 1);
  panel.tick();
  assert.equal(panel.modal.classList.contains("hidden"), false);
});

test("chat deep links cancel first-run setup before it can cover the chat", () => {
  for (const surface of ["codex", "opencode", "api"]) {
    const panel = panelHarness();
    panel.surface(surface);
    assert.equal(panel.pendingTimers(), 0, surface);
    panel.tick();
    assert.equal(panel.modal.classList.contains("hidden"), true, surface);
    assert.equal(panel.requests(), 0, surface);
  }
});

test("navigating from Home to Codex cancels pending setup but explicit setup still opens", () => {
  const panel = panelHarness();
  panel.surface("home");
  panel.surface("codex");
  panel.tick();
  assert.equal(panel.modal.classList.contains("hidden"), true);
  panel.openButton.click();
  assert.equal(panel.modal.classList.contains("hidden"), false);
  panel.surface("home");
  assert.equal(panel.modal.classList.contains("hidden"), true);
  assert.equal(panel.pendingTimers(), 0);
});

test("explicit setup opening clears the automatic timer so closing is final", () => {
  const panel = panelHarness();
  panel.openButton.click();
  panel.closeButton.click();
  panel.tick();
  assert.equal(panel.modal.classList.contains("hidden"), true);
  assert.equal(panel.requests(), 4);
});

test("dismissed onboarding retains the existing explicit setup launcher", () => {
  const panel = panelHarness({ dismissed: true });
  assert.equal(panel.pendingTimers(), 0);
  panel.openButton.click();
  assert.equal(panel.modal.classList.contains("hidden"), false);
});
