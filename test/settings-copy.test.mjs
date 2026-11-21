import test from "node:test";
import * as fetchTimeout from "../src/fetch-with-timeout.mjs";
import assert from "node:assert/strict";
import vm from "node:vm";
import ts from "typescript-legacy";
import { JSDOM } from "jsdom";
import * as i18n from "../src/i18n-core.mjs";
import * as deviceGate from "../src/device-gate.mjs";
import * as sheetHeader from "../src/sheet-header.mjs";
import { readFile } from "node:fs/promises";

const { DICTIONARIES } = i18n;
const source = path => readFile(new URL("../" + path, import.meta.url), "utf8");
const settings = await source("src/settings.ts");

function rootRowKeys() {
  const body = settings.slice(settings.indexOf("function renderRoot()"), settings.indexOf("function renderAppearance()"));
  return [...body.matchAll(/row\("[^"]*",\s*t\("([^"]+)"\)/g)].map(match => match[1]);
}

function rootRowLabels() {
  return rootRowKeys().map(key => DICTIONARIES.ja[key] ?? key);
}

test("Settings row labels are Japanese; only product names stay in English", () => {
  const allowed = /\b(API Vault|GitHub|Codex|OpenCode)\b/g;
  const labels = rootRowLabels();
  assert.ok(labels.length > 20);
  for (const label of labels) {
    assert.doesNotMatch(label.replace(allowed, ""), /[A-Za-z]/, label);
    assert.doesNotMatch(label, /[!。.]$/, label);
  }
  for (const old of ["Activity / Session Control", "Trusted devices", "ホスト registry", "Automation / Schedules", "Task checkpoints", "拡張機能と Skills", "クラウドブラウザー / Preview"]) {
    assert.ok(!settings.includes(`"${old}"`), old);
  }
});

test("the English locale keeps English for the rows that changed", () => {
  const expected = {
    "settings.root.sessions": ["アクティビティ", "Activity"],
    "settings.root.devices": ["信頼済み端末", "Trusted Devices"],
    "settings.root.passkey": ["パスキー", "Passkeys"],
    "settings.root.hosts": ["ホスト一覧", "Hosts"],
    "settings.root.automation": ["自動化", "Automation"],
    "settings.root.checkpoints": ["チェックポイント", "Checkpoints"],
    "settings.root.extensions": ["拡張機能", "Extensions"],
    "settings.root.files": ["ファイルとプレビュー", "Files & Preview"],
    "settings.root.review": ["レビューとタスク", "Review & Tasks"],
    "settings.root.context": ["表示履歴", "Display History"]
  };
  const keys = rootRowKeys();
  for (const [key, [japanese, english]] of Object.entries(expected)) {
    assert.ok(keys.includes(key), key);
    assert.equal(DICTIONARIES.ja[key], japanese, key);
    assert.equal(DICTIONARIES.en[key], english, key);
  }
});

test("every sheet opened from a Settings row is titled with that row's label", async () => {
  const files = Object.fromEntries(await Promise.all(
    ["src/session-control.ts", "src/workflow.ts", "src/agent-console.ts", "src/workspace-control.ts", "src/remote-control.ts", "src/control-center.ts", "src/advanced.ts"]
      .map(async file => [file, await source(file)])
  ));
  // [row key in Settings, title key in sheet, file, marker]
  const sheets = [
    ["settings.root.sessions", "sessionControl.title", "src/session-control.ts", 'createSheetHeader(document,{title:t("sessionControl.title")'],
    ["settings.root.review", "workflow.sheetTitle", "src/workflow.ts", 'createSheetHeader(document, { title: t("workflow.sheetTitle")'],
    ["settings.root.agents", "agentConsole.sheetTitle", "src/agent-console.ts", 'title: t("agentConsole.sheetTitle")'],
    ["settings.root.context", "workspaceControl.context.title", "src/workspace-control.ts", 'panelHead(t("workspaceControl.context.title"))'],
    ["settings.root.checkpoints", "workspaceControl.checkpoints.title", "src/workspace-control.ts", 'const title = t("workspaceControl.checkpoints.title")'],
    ["settings.root.extensions", "workspaceControl.extensions.title", "src/workspace-control.ts", 'const title = t("workspaceControl.extensions.title")'],
    ["settings.root.hosts", "remote.tabs.hosts", "src/remote-control.ts", 'const hostsTitle = esc(t("remote.tabs.hosts"))'],
    ["settings.root.automation", "remote.tabs.automation", "src/remote-control.ts", 'const automationTitle = esc(t("remote.tabs.automation"))'],
    ["settings.root.passkey", "remote.tabs.passkeys", "src/remote-control.ts", 'const passkeysTitle = esc(t("remote.tabs.passkeys"))'],
    ["settings.root.terminal", "controlCenter.tab.terminal", "src/control-center.ts", 'terminal: t("controlCenter.tab.terminal")'],
    ["settings.root.safety", "controlCenter.tab.safetyTitle", "src/control-center.ts", 'safety: t("controlCenter.tab.safetyTitle")'],
    ["settings.root.index", "controlCenter.tab.indexTitle", "src/control-center.ts", 'index: t("controlCenter.tab.indexTitle")'],
    ["settings.root.files", "advanced.drawerTitle", "src/advanced.ts", '<strong>${escapeHtml(t("advanced.drawerTitle"))}</strong>']
  ];
  const keys = rootRowKeys();
  for (const [rowKey, titleKey, file, marker] of sheets) {
    assert.ok(keys.includes(rowKey), `Settings row ${rowKey}`);
    assert.ok(files[file].includes(marker), `${file}: ${marker}`);
    assert.equal(DICTIONARIES.ja[titleKey], DICTIONARIES.ja[rowKey], `${titleKey} → ${rowKey}`);
  }
  assert.ok(!files["src/control-center.ts"].includes('"DevMoter Tools"'));
  assert.ok(!files["src/advanced.ts"].includes("<strong>DevMoter Tools</strong>"));
  assert.ok(settings.includes('setHeader(t("settings.root.devices")'));
});

test("Settings copy is polite Japanese without casual endings", () => {
  const jaSettingsEntries = Object.entries(DICTIONARIES.ja).filter(([key]) => key.startsWith("settings."));
  assert.ok(jaSettingsEntries.length > 80);
  for (const [key, value] of jaSettingsEntries) {
    for (const casual of ["してね", "したよ", "選んでね", "入力してね", "置き換える？", "しない。", "保存する。"]) {
      assert.ok(!value.includes(casual), `${key}: ${casual}`);
    }
  }
  assert.ok(DICTIONARIES.ja["settings.devices.guidanceLocal"].includes("信頼済み端末として登録"));
});

test("Remote & automation renders each section once even when opened and switched back to back", async () => {
  const compiled = ts.transpileModule(await source("src/remote-control.ts"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
  }).outputText;
  const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "https://devmoter.example/" });
  const { window } = dom;
  const reply = payload => ({ ok: true, status: 200, json: async () => payload });
  const fetch = async path => {
    await new Promise(resolve => setTimeout(resolve, 15));
    if (path === "/api/control/hosts/status") return reply({ hosts: [{ host: { id: "local", label: "This host", address: "http://127.0.0.1:8787", trustState: "local" }, status: { state: "online" } }] });
    if (path === "/api/auth/passkey/status") return reply({ enabled: true, credentialCount: 2, authenticated: true, rpId: "devmoter.example" });
    return reply({ schedules: [], triggers: [], runs: [], projects: [] });
  };
  const exports = {};
  vm.runInNewContext(compiled, {
    exports,
    require: name => name === "./fetch-with-timeout.mjs"
      ? fetchTimeout
      : name === "./i18n"
      ? i18n
      : name === "./device-gate.mjs"
        ? deviceGate
        : name === "./sheet-header.mjs"
          ? sheetHeader
          : {},
    window, document: window.document, location: window.location, navigator: window.navigator,
    Headers, fetch, setTimeout, clearTimeout, crypto: { randomUUID: () => "op" }, CustomEvent: window.CustomEvent,
    PublicKeyCredential: undefined, Intl, atob, btoa
  });
  try {
    exports.mountRemoteControlCenter();
    const doc = window.document;
    // What Settings does for the ホスト一覧 row: open the sheet, then select the tab.
    doc.querySelector(".dm-control-trigger").click();
    doc.querySelector('.dm-control-tabs [data-tab="hosts"]').click();
    await new Promise(resolve => setTimeout(resolve, 80));
    const body = doc.querySelector(".dm-control-body");
    assert.equal(body.querySelectorAll(".dm-list").length, 1);
    assert.equal(body.textContent.match(/This host/g)?.length, 1);
    assert.equal(doc.querySelector("#dmControlTitle").textContent, "Hosts");
    assert.equal(body.querySelector(".dm-section-title"), null);

    doc.querySelector('.dm-control-tabs [data-tab="passkeys"]').click();
    await new Promise(resolve => setTimeout(resolve, 80));
    assert.equal(doc.querySelector("#dmControlTitle").textContent, "Passkeys");
    const state = body.querySelector(".dm-passkey-card p");
    // Static words are separate text nodes so the dictionary can translate them.
    assert.equal(state.childNodes[0].textContent, "Registered passkeys");
    assert.equal(state.querySelector("strong").textContent, "2");
    assert.equal(DICTIONARIES.ja["remote.passkeys.registeredLabel"], "登録済みパスキー");
  } finally {
    window.close();
  }
});

test("rows merged or removed in #504 keep #504's set; their copy is unified and translated", async () => {
  const labels = rootRowLabels();
  // Removed / merged rows stay gone, with no orphaned entries for old gates.
  for (const removed of ["使用状況と制限", "データコントロール", "詳細", "ストレージ", "データ管理", "サインイン", "サインイン方法", "テーマ", "表示とレイアウト", "通知設定", "ペアリングコード"]) {
    assert.ok(!labels.includes(removed), removed);
  }
  assert.equal(Object.values(DICTIONARIES.en).includes("This browser is not a Trusted device"), false);
  // Each row label appears once.
  assert.equal(new Set(labels).size, labels.length, labels.join(","));
  // Merged rows use consistent localized labels, and the sheet they open carries the same title.
  assert.ok(labels.includes("テーマと表示") && settings.includes('setHeader(t("settings.root.appearance")'));
  assert.ok(settings.includes('row("device", t("settings.root.devices"), { action: "page:devices", value: t("settings.root.devicesSub") })'));
  assert.ok(settings.includes('setHeader(t("settings.root.devices")'));
  assert.ok(settings.includes('value: t("settings.root.reportSub"), external: "GitHub"'));
  for (const key of ["settings.root.appearance", "settings.root.devicesSub", "settings.root.report", "settings.root.reportSub"]) {
    assert.ok(DICTIONARIES.ja[key] && DICTIONARIES.en[key] && DICTIONARIES["zh-Hans"][key] && DICTIONARIES["zh-Hant"][key], key);
    assert.doesNotMatch(DICTIONARIES.en[key], /[ぁ-んァ-ン一-龯]/, key);
  }
  // The device gate speaks the same words as the row it opens.
  const gate = await source("src/device-gate.mjs");
  for (const key of ["deviceGate.unregisteredTitle", "deviceGate.unregisteredCopy", "deviceGate.registerButton"]) {
    assert.ok(gate.includes(`t("${key}")`), key);
    assert.ok(DICTIONARIES.ja[key] && DICTIONARIES.en[key] && DICTIONARIES["zh-Hans"][key] && DICTIONARIES["zh-Hant"][key], key);
    assert.doesNotMatch(DICTIONARIES.en[key], /[ぁ-んァ-ン一-龯]/, key);
  }
  // Device-bound sheets title their gate with the Settings row label, not the old English title.
  const workspace = await source("src/workspace-control.ts");
  assert.ok(workspace.includes('const title = t("workspaceControl.checkpoints.title")'));
  assert.ok(workspace.includes('const title = t("workspaceControl.extensions.title")'));
  assert.ok(workspace.includes("showFailure(title, error)"));
  assert.ok(!workspace.includes('"Task checkpoints"'));
});
