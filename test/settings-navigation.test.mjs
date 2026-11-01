import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import ts from "typescript";
import { JSDOM } from "jsdom";
import { readFile } from "node:fs/promises";

const read = path => readFile(new URL(path, import.meta.url), "utf8");
const settingsCompiled = ts.transpileModule(await read("../src/settings.ts"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
}).outputText;

function mountSettings() {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "https://example.test/" });
  const { window } = dom;
  const exports = {};
  vm.runInNewContext(settingsCompiled, {
    exports,
    require: name => name === "./push-readiness.js" ? { boundedPushWait: p => p, inspectPushReadiness: async () => ({ state: "unsupported" }) } : {},
    window, document: window.document, navigator: window.navigator, location: window.location,
    localStorage: window.localStorage, Headers,
    fetch: async () => ({ ok: true, status: 200, json: async () => ({}) }),
    setTimeout, clearTimeout,
    crypto: { randomUUID: () => "test-operation" },
    CustomEvent: window.CustomEvent,
    matchMedia: () => ({ matches: true }),
    atob
  });
  exports.mountSettingsPanel();
  const modal = window.document.querySelector(".devmoter-settings-modal");
  const open = page => window.dispatchEvent(new window.CustomEvent("devmoter:open-settings", { detail: { page } }));
  const isOpen = () => !modal.classList.contains("hidden");
  return { dom, window, modal, open, isOpen };
}

const settle = () => new Promise(resolve => setTimeout(resolve, 10));

test("A-2: any workspace navigation closes Settings through one close path", async () => {
  const { dom, window, open, isOpen } = mountSettings();
  try {
    for (const [type, detail] of [
      ["devmoter:workspace-tab-changing", undefined],
      ["devmoter:surface-changed", { surface: "home" }]
    ]) {
      open("appearance");
      await settle();
      assert.equal(isOpen(), true);
      window.dispatchEvent(new window.CustomEvent(type, { detail }));
      assert.equal(isOpen(), false, `${type} closes Settings`);
      assert.equal(window.document.body.classList.contains("devmoter-settings-open"), false);
    }
  } finally {
    dom.window.close();
  }
});

test("A-3: every Settings row either stays (chevron), leaves (arrow-out) or acts in place", async () => {
  const { dom, window, open, isOpen } = mountSettings();
  try {
    open("root");
    await settle();
    const rows = [...window.document.querySelectorAll(".devmoter-settings-scroll [data-action]")];
    assert.ok(rows.length > 20);
    for (const row of rows) {
      const action = row.dataset.action;
      assert.match(action, /^(page|open):|^(report|logout)$/, `unknown row type: ${action}`);
      if (!row.classList.contains("devmoter-settings-row")) continue;
      const kind = row.dataset.kind;
      assert.equal(kind, action.startsWith("page:") ? "page" : action.startsWith("open:") ? "open" : "action");
      assert.equal(Boolean(row.querySelector(".devmoter-settings-chevron:not(.external)")), kind === "page", action);
      assert.equal(Boolean(row.querySelector(".devmoter-settings-leave")), kind === "open", action);
      if (kind === "open") assert.match(row.textContent, /設定を閉じて開く/);
    }
    // Rows that used to be the only mobile entry points stay reachable.
    const targets = rows.map(row => row.dataset.action).filter(action => action.startsWith("open:"));
    for (const target of ["sessions", "review", "agents", "passkeys", "hosts", "automation", "terminal", "index", "safety", "files"]) {
      assert.ok(targets.includes(`open:${target}`), `open:${target} is still reachable`);
    }
    const launched = [];
    window.addEventListener("devmoter:launch-app", event => launched.push(event.detail.id));
    window.document.querySelector('[data-action="open:terminal"]').click();
    assert.equal(isOpen(), false, "leaving rows close Settings first");
    await settle();
    assert.deepEqual(launched, ["terminal"], "then open the same launcher the app uses");

    open("root");
    await settle();
    window.document.querySelector('.devmoter-settings-row[data-action="page:appearance"]').click();
    await settle();
    assert.equal(isOpen(), true, "page rows stay inside Settings");
    assert.equal(window.document.querySelector("[data-settings-title]").textContent, "表示とレイアウト");
  } finally {
    dom.window.close();
  }
});

test("A-1: Settings sizes to the space below the unified header, not to the viewport", async () => {
  const [settingsCss, navCss, source] = await Promise.all([
    read("../src/settings.css"), read("../src/unified-workspace-nav.css"), read("../src/settings.ts")
  ]);
  assert.doesNotMatch(settingsCss, /\d+dvh/, "no dvh height hacks in Settings");
  assert.match(settingsCss, /\.devmoter-settings-modal\s*\{[^}]*grid-template-rows: minmax\(0, 1fr\)/s);
  assert.match(settingsCss, /\.devmoter-settings-sheet\s*\{[^}]*height: min\(100%, 940px\)/s);
  // The same header-aware rule as Tasks / Review / Tools panels.
  assert.match(navCss, /body\.dm-task-first-enabled :is\([^)]*\.devmoter-settings-modal[^)]*\)\s*\{\s*top: calc\(var\(--dw-top-height\)/);
  assert.match(navCss, /body\.dm-task-first-enabled \.dm-tools-panel\s*\{\s*top: calc\(var\(--dw-top-height\)/);
  for (const removed of ["function openExisting", "function openRemote", "function openTools", '"existing:', '"remote:', '"tool:', '"command:']) {
    assert.ok(!source.includes(removed), `obsolete ${removed} removed`);
  }
});
