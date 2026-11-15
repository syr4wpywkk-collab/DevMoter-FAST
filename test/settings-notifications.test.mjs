import test from "node:test";
import assert from "node:assert/strict";
import * as i18nCore from "../src/i18n-core.mjs";

const jaI18n = {
  ...i18nCore,
  getLanguage: () => "ja",
  t: (k, p) => i18nCore.translate("ja", k, p),
  translateServerMessage: m => i18nCore.translateServerMessage(m, "ja"),
  formatDateTime: (v, o) => i18nCore.formatDateTime(v, o, "ja"),
  formatTime: (v, o) => i18nCore.formatTime(v, o, "ja"),
  formatNumber: (v, o) => i18nCore.formatNumber(v, o, "ja"),
  formatRelativeTime: (ts, now) => i18nCore.formatRelativeTime(ts, now, "ja"),
  tApp: (id, f) => i18nCore.tApp(id, f, "ja")
};
import vm from "node:vm";
import ts from "typescript";
import { JSDOM } from "jsdom";
import { readFile } from "node:fs/promises";

const helperSource = await readFile(new URL("../src/push-readiness.ts", import.meta.url), "utf8");
const helperExports = {};
vm.runInNewContext(ts.transpileModule(helperSource, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
}).outputText, { exports: helperExports, setTimeout, clearTimeout });

const settingsSource = await readFile(new URL("../src/settings.ts", import.meta.url), "utf8");
const settingsCompiled = ts.transpileModule(settingsSource, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
}).outputText;

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

function settingsHarness(getRegistration) {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "https://example.test/" });
  const { window } = dom;
  Object.defineProperty(window.navigator, "serviceWorker", {
    configurable: true,
    value: { getRegistration, ready: Promise.resolve({ pushManager: { getSubscription: async () => null } }) }
  });
  Object.defineProperty(window, "PushManager", { configurable: true, value: function PushManager() {} });
  Object.defineProperty(window, "Notification", {
    configurable: true,
    value: { permission: "granted", requestPermission: async () => "granted" }
  });
  const exports = {};
  vm.runInNewContext(settingsCompiled, {
    exports,
    require: name => (name === "./push-readiness.js" ? helperExports : name === "./i18n" ? jaI18n : {}),
    window,
    document: window.document,
    navigator: window.navigator,
    Notification: window.Notification,
    location: window.location,
    localStorage: window.localStorage,
    Headers,
    fetch: async () => ({ ok: true, status: 200, json: async () => ({}) }),
    setTimeout,
    clearTimeout,
    crypto: { randomUUID: () => "test-operation" },
    CustomEvent: window.CustomEvent,
    matchMedia: () => ({ matches: true }),
    atob
  });
  exports.mountSettingsPanel();
  window.dispatchEvent(new window.CustomEvent("devmoter:open-settings", { detail: { page: "notifications" } }));
  return { dom, window, root: window.document.querySelector(".devmoter-settings-root"), serviceWorker: window.navigator.serviceWorker };
}

async function flush() {
  await new Promise(resolve => setImmediate(resolve));
  await Promise.resolve();
}

test("appearance buttons apply light, dark and system preferences and announce the resolved palette", async () => {
  const { dom, window, root } = settingsHarness(async () => undefined);
  try {
    window.dispatchEvent(new window.CustomEvent("devmoter:open-settings", { detail: { page: "appearance" } }));
    await flush();
    const observed = [];
    window.addEventListener("devmoter:theme-changed", event => observed.push(event.detail.resolved));
    for (const [mode, resolved] of [["light", "light"], ["dark", "dark"], ["system", "dark"]]) {
      root.querySelector(`[data-action="theme:${mode}"]`).click();
      assert.equal(window.localStorage.getItem("devmoter-theme"), mode);
      assert.equal(window.document.documentElement.dataset.devmoterThemeMode, mode);
      assert.equal(window.document.documentElement.dataset.devmoterTheme, resolved);
    }
    assert.deepEqual(observed, ["light", "dark", "dark"]);
  } finally { dom.window.close(); }
});

test("notification settings show loading, explain missing worker, and allow retry", async () => {
  let attempts = 0;
  const registration = { pushManager: { getSubscription: async () => null } };
  const firstLookup = deferred();
  const harness = settingsHarness(async () => ++attempts === 1 ? firstLookup.promise : registration);
  const { root, dom } = harness;
  const scroll = root.querySelector(".devmoter-settings-scroll");

  assert.match(scroll.textContent, /設定を読み込んでいます/);
  await flush();
  assert.match(scroll.textContent, /確認中/);
  assert.equal(scroll.querySelector('[data-action="push:enable"]').disabled, true);

  firstLookup.resolve(undefined);
  await flush();
  assert.match(scroll.textContent, /Service Worker未登録/);
  assert.match(scroll.textContent, /アプリを再読み込み/);
  assert.equal(scroll.querySelector('[data-action="push:enable"]').disabled, true);

  scroll.querySelector('[data-action="push:retry"]').click();
  await flush();
  await flush();
  assert.match(scroll.textContent, /通知の状態/);
  assert.match(scroll.textContent, /無効/);
  assert.equal(scroll.querySelector('[data-action="push:enable"]').disabled, false, `${scroll.innerHTML} attempts=${attempts}`);
  assert.equal(attempts, 2);
  dom.window.close();
});

test("late readiness from notifications cannot overwrite a page opened afterward", async () => {
  const pendingRegistration = deferred();
  const harness = settingsHarness(() => pendingRegistration.promise);
  const { root, window, dom } = harness;
  const scroll = root.querySelector(".devmoter-settings-scroll");
  await flush();

  root.querySelector(".devmoter-settings-back").click();
  assert.match(scroll.textContent, /テーマ/);
  pendingRegistration.resolve(undefined);
  await flush();
  assert.match(scroll.textContent, /テーマ/);
  assert.doesNotMatch(scroll.textContent, /Service Worker未登録/);
  dom.window.close();
});
