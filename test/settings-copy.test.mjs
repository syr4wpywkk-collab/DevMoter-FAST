import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import ts from "typescript";
import { JSDOM } from "jsdom";
import { readFile } from "node:fs/promises";

const source = path => readFile(new URL("../" + path, import.meta.url), "utf8");
const settings = await source("src/settings.ts");
const i18n = await source("src/i18n.ts");

// The i18n dictionary maps a source string to every locale: { en, ja, "zh-CN" }.
const dictionary = new Map(
  [...i18n.matchAll(/^ {2}("(?:[^"\\]|\\.)*"): \{ en: ("(?:[^"\\]|\\.)*"), ja: ("(?:[^"\\]|\\.)*"), "zh-CN": ("(?:[^"\\]|\\.)*") \}/gm)]
    .map(([, key, en, ja, zh]) => [JSON.parse(key), { en: JSON.parse(en), ja: JSON.parse(ja), zh: JSON.parse(zh) }])
);
const ja = text => dictionary.get(text)?.ja ?? text;
const en = text => dictionary.get(text)?.en ?? text;

function rootRowLabels() {
  const body = settings.slice(settings.indexOf("function renderRoot()"), settings.indexOf("function renderAppearance()"));
  return [...body.matchAll(/row\("[^"]*", "([^"]+)"/g)].map(match => match[1]);
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
  const expected = { "アクティビティ": "Activity", "信頼済み端末": "Trusted devices", "パスキー": "Passkeys", "ホスト一覧": "Hosts", "自動化": "Automation", "チェックポイント": "Checkpoints", "拡張機能": "Extensions", "ファイルとプレビュー": "Files & preview", "レビューとタスク": "Review & tasks", "表示履歴": "Context" };
  for (const [label, english] of Object.entries(expected)) {
    assert.ok(rootRowLabels().includes(label), label);
    assert.equal(en(label), english, label);
  }
});

test("every sheet opened from a Settings row is titled with that row's label", async () => {
  const files = Object.fromEntries(await Promise.all(
    ["src/session-control.ts", "src/workflow.ts", "src/agent-console.ts", "src/workspace-control.ts", "src/remote-control.ts", "src/control-center.ts", "src/advanced.ts"]
      .map(async file => [file, await source(file)])
  ));
  // [row label in Settings, title source string, where the sheet sets it]
  const sheets = [
    ["アクティビティ", "Activity", "src/session-control.ts", '<header class="sc-head"><strong>Activity</strong>'],
    ["レビューとタスク", "Review & Tasks", "src/workflow.ts", "<strong>Review & Tasks</strong>"],
    ["エージェントモード", "Agent mode", "src/agent-console.ts", "<h2>Agent mode</h2>"],
    ["表示履歴", "表示履歴", "src/workspace-control.ts", 'panelHead("表示履歴")'],
    ["チェックポイント", "チェックポイント", "src/workspace-control.ts", 'panelHead("チェックポイント")'],
    ["拡張機能", "拡張機能", "src/workspace-control.ts", 'panelHead("拡張機能")'],
    ["ホスト一覧", "Hosts", "src/remote-control.ts", 'data-tab="hosts" data-title="Hosts"'],
    ["自動化", "Automation", "src/remote-control.ts", 'data-tab="automation" data-title="Automation"'],
    ["パスキー", "Passkeys", "src/remote-control.ts", 'data-tab="passkeys" data-title="Passkeys"'],
    ["ターミナル", "Terminal", "src/control-center.ts", 'terminal: "Terminal"'],
    ["セーフティスキャン", "Safety scan", "src/control-center.ts", 'safety: "Safety scan"'],
    ["プロジェクトインデックス", "Project index", "src/control-center.ts", 'index: "Project index"'],
    ["ファイルとプレビュー", "Files & preview", "src/advanced.ts", "<strong>Files & preview</strong>"]
  ];
  const labels = rootRowLabels();
  for (const [row, title, file, marker] of sheets) {
    assert.ok(labels.includes(row), `Settings row ${row}`);
    assert.ok(files[file].includes(marker), `${file}: ${marker}`);
    assert.equal(ja(title), row, `${title} → ${row}`);
  }
  assert.ok(!files["src/control-center.ts"].includes('"DevMoter Tools"'));
  assert.ok(!files["src/advanced.ts"].includes("<strong>DevMoter Tools</strong>"));
  assert.ok(settings.includes('setHeader("信頼済み端末"'));
});

test("Settings copy is polite Japanese without casual endings", () => {
  for (const casual of ["してね", "したよ", "選んでね", "入力してね", "置き換える？", "しない。", "保存する。"]) {
    assert.ok(!settings.includes(casual), casual);
  }
  assert.ok(settings.includes("このブラウザを信頼済み端末として登録してください。"));
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
    exports, require: () => ({}), window, document: window.document, location: window.location, navigator: window.navigator,
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
    assert.equal(ja("Registered passkeys"), "登録済みパスキー");
  } finally {
    window.close();
  }
});

test("rows merged or removed in #504 keep #504's set; their copy is unified and translated", async () => {
  const labels = rootRowLabels();
  // Removed / merged rows stay gone, with no orphaned dictionary entries for the old gate.
  for (const removed of ["使用状況と制限", "データコントロール", "詳細", "ストレージ", "データ管理", "サインイン", "サインイン方法", "テーマ", "表示とレイアウト", "通知設定", "ペアリングコード"]) {
    assert.ok(!labels.includes(removed), removed);
  }
  for (const orphan of ["This browser is not a Trusted device", "Open Trusted devices"]) {
    assert.ok(!dictionary.has(orphan), orphan);
  }
  // Each row label appears once.
  assert.equal(new Set(labels).size, labels.length, labels.join(","));
  // Merged rows use the polite Japanese label, and the sheet they open carries the same title.
  assert.ok(labels.includes("テーマと表示") && settings.includes('setHeader("テーマと表示"'));
  assert.ok(settings.includes('row("device", "信頼済み端末", { action: "page:devices", value: "端末の登録とペアリングコード" })'));
  assert.ok(settings.includes('setHeader("信頼済み端末"'));
  assert.ok(settings.includes('value: "GitHub の Issue を開く", external: "GitHub"'));
  for (const text of ["テーマと表示", "端末の登録とペアリングコード", "不具合を報告", "GitHub の Issue を開く"]) {
    assert.ok(dictionary.has(text), text);
    assert.doesNotMatch(en(text), /[ぁ-んァ-ン一-龯]/, text);
  }
  // The device gate speaks the same words as the row it opens.
  const gate = await source("src/device-gate.mjs");
  for (const text of ["この端末は未登録です", "端末を登録すると使えます", "端末を登録"]) {
    assert.ok(gate.includes(`"${text}"`), text);
    assert.equal(ja(text), text);
    assert.doesNotMatch(en(text), /[ぁ-んァ-ン一-龯]/, text);
  }
  // Device-bound sheets title their gate with the Settings row label, not the old English title.
  const workspace = await source("src/workspace-control.ts");
  assert.ok(workspace.includes('showFailure("チェックポイント", error)'));
  assert.ok(workspace.includes('showFailure("拡張機能", error)'));
  assert.ok(!workspace.includes('"Task checkpoints"'));
});
