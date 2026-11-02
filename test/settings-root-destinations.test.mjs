import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import ts from "typescript";
import { JSDOM } from "jsdom";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../src/settings.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
}).outputText;

function response(payload = {}, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => payload };
}

async function openRoot() {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "https://devmoter.example/" });
  const { window } = dom;
  const opened = [];
  window.open = (...args) => { opened.push(args); return null; };
  const fetch = async path => {
    if (path === "/api/auth/status") return response({ authenticated: true, identity: { provider: "local", login: "devmoter" } });
    if (path === "/api/system/diagnostics") return response({ app: { version: "1.2.3" }, projects: { count: 4 } });
    return response({});
  };
  const exports = {};
  vm.runInNewContext(compiled, {
    exports, require: () => ({}), window, document: window.document, navigator: window.navigator,
    location: window.location, localStorage: window.localStorage, Headers, fetch, setTimeout, clearTimeout,
    crypto: { randomUUID: () => "op" }, CustomEvent: window.CustomEvent, matchMedia: () => ({ matches: false }), atob, URL
  });
  exports.mountSettingsPanel();
  window.dispatchEvent(new window.CustomEvent("devmoter:open-settings", { detail: { page: "root" } }));
  for (let i = 0; i < 4; i += 1) await new Promise(resolve => setImmediate(resolve));
  const scroll = window.document.querySelector(".devmoter-settings-scroll");
  return { dom, window, scroll, opened };
}

const labels = scroll => [...scroll.querySelectorAll(".devmoter-settings-row strong")].map(node => node.textContent);

test("settings root has no rows that only redirect to Diagnostics", async () => {
  const { dom, scroll } = await openRoot();
  try {
    const toDiagnostics = [...scroll.querySelectorAll('[data-action="page:diagnostics"]')];
    assert.deepEqual(toDiagnostics.map(node => node.querySelector("strong").textContent), ["診断"]);
    for (const removed of ["使用状況と制限", "データコントロール", "詳細", "ストレージ"]) {
      assert.ok(!labels(scroll).includes(removed), removed);
    }
    // Storage and Cloud browser no longer share the Tools modal.
    assert.equal(scroll.querySelectorAll('[data-action="open:files"]').length, 1);
  } finally {
    dom.window.close();
  }
});

test("each settings destination has exactly one root row", async () => {
  const { dom, scroll } = await openRoot();
  try {
    const actions = [...scroll.querySelectorAll(".devmoter-settings-row[data-action]")].map(node => node.dataset.action);
    const pageActions = actions.filter(action => action.startsWith("page:"));
    assert.equal(new Set(pageActions).size, pageActions.length, pageActions.join(","));
    // The profile card is the single entry to the account page.
    assert.equal(scroll.querySelectorAll('[data-action="page:account"]').length, 1);
    assert.ok(scroll.querySelector('.devmoter-settings-profile[data-action="page:account"]'));
    for (const removed of ["サインイン", "サインイン方法", "テーマ", "表示とレイアウト", "通知設定", "ペアリングコード"]) {
      assert.ok(!labels(scroll).includes(removed), removed);
    }
    assert.ok(labels(scroll).includes("テーマと表示"));
    assert.match(scroll.querySelector('[data-action="page:appearance"]').textContent, /システム · 標準/);
    assert.match(scroll.querySelector('[data-action="page:devices"]').textContent, /ペアリングコード/);
  } finally {
    dom.window.close();
  }
});

test("bug report row says it leaves the app for GitHub", async () => {
  const { dom, scroll, opened } = await openRoot();
  try {
    const report = scroll.querySelector('[data-action="report"]');
    assert.match(report.getAttribute("aria-label"), /GitHub.*新しいタブ/);
    assert.match(report.textContent, /GitHub/);
    assert.ok(report.querySelector(".devmoter-settings-chevron.external svg"));
    assert.ok(!report.querySelector(".devmoter-settings-chevron:not(.external)"));
    report.click();
    assert.equal(opened.length, 1);
    assert.equal(opened[0][2], "noopener,noreferrer");
  } finally {
    dom.window.close();
  }
});
