import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { JSDOM } from "jsdom";
import { createSheetHeader } from "../src/sheet-header.mjs";
import { createDeviceGate } from "../src/device-gate.mjs";
import { shortProjectPath } from "../src/project-labels.mjs";

const source = path => readFile(new URL(`../src/${path}`, import.meta.url), "utf8");
const HEX = /#[0-9a-f]{3,8}\b/i;

test("shared sheet header: title, one-line subtitle, optional primary, close", () => {
  const dom = new JSDOM("<!doctype html><body></body>");
  const doc = dom.window.document;
  let closed = 0;
  let primary = 0;
  const head = createSheetHeader(doc, { title: "Review & Tasks", titleId: "wfTitle", onClose: () => { closed += 1; } });
  doc.body.append(head.element);
  assert.equal(head.element.tagName, "HEADER");
  assert.equal(head.element.className, "dm-sheet-head");
  assert.equal(doc.getElementById("wfTitle").textContent, "Review & Tasks");
  assert.equal(head.subtitleEl.hidden, true, "no subtitle → no empty line");
  assert.equal(head.primaryButton.hidden, true, "no primary → hidden");
  assert.equal(head.closeButton.type, "button");
  assert.equal(head.closeButton.getAttribute("aria-label"), "閉じる");
  assert.ok(head.closeButton.querySelector("svg[aria-hidden='true']"), "line icon, not a × glyph");
  assert.doesNotMatch(head.closeButton.textContent, /×/);
  head.closeButton.click();
  assert.equal(closed, 1);

  head.setTitle("Hosts");
  head.setSubtitle("localhost:8787");
  head.setPrimary({ label: "Save", onClick: () => { primary += 1; } });
  assert.equal(head.titleEl.textContent, "Hosts");
  assert.equal(head.subtitleEl.hidden, false);
  assert.equal(head.primaryButton.hidden, false);
  assert.equal(head.primaryButton.textContent, "Save");
  head.primaryButton.click();
  assert.equal(primary, 1);
  head.setPrimary(null);
  head.primaryButton.click();
  assert.equal(primary, 1, "a removed primary no longer fires");
  // Order is fixed: text, icon actions, primary, close.
  assert.deepEqual([...head.element.children].map(child => child.className),
    ["dm-sheet-head-text", "dm-sheet-head-actions", "dm-sheet-head-primary", "dm-sheet-head-close"]);
  dom.window.close();
});

test("every Group G sheet builds its header with createSheetHeader and the old header code is gone", async () => {
  const files = {
    "codex.ts": ['createSheetHeader(document, { title: "設定", titleId: "cxModalTitle"'],
    "control-center.ts": ['createSheetHeader(document, { title: "Terminal", titleId: "dm-tools-title" })'],
    "agent-console.ts": ['title: "Agent mode"'],
    "workflow.ts": ['createSheetHeader(document, { title: "Review & Tasks", titleId: "wfTitle" })'],
    "session-control.ts": ['createSheetHeader(document,{title:"Activity",titleId:"scTitle"})'],
    "mission-control.ts": ['createSheetHeader(document, { title: "Mission Control", titleId: "dmMissionTitle" })'],
    "remote-control.ts": ['createSheetHeader(document, { title: "Hosts", subtitle: location.host, titleId: "dmControlTitle" })']
  };
  const gone = {
    "codex.ts": ['class="cx-modal-head"', 'id="cxModalTitle"'],
    "control-center.ts": ['"dm-tools-head"', '"dm-tools-heading"', '"dm-tools-close"'],
    "agent-console.ts": ['devmoter-agent-head', 'devmoter-agent-close'],
    "workflow.ts": ['class="wf-header"', 'wf-kicker', 'DEVMOTER WORKFLOW'],
    "session-control.ts": ['class="sc-head"'],
    "mission-control.ts": ['dm-mission-head', 'data-mission-close'],
    "remote-control.ts": ['dm-control-head', 'dm-control-close']
  };
  for (const [file, markers] of Object.entries(files)) {
    const text = await source(file);
    assert.ok(text.includes('from "./sheet-header.mjs"'), `${file} imports the shared header`);
    for (const marker of markers) assert.ok(text.includes(marker), `${file}: ${marker}`);
    for (const old of gone[file]) assert.ok(!text.includes(old), `${file} still has ${old}`);
  }
  const css = (await Promise.all(["styles/base.css", "control-center.css", "agent-console.css", "styles/tools.css", "session-control.css", "mission-control.css"].map(source))).join("\n");
  for (const old of [".cx-modal-head {", ".dm-tools-head {", ".devmoter-agent-head", ".wf-header {", ".wf-kicker", ".sc-head {", ".dm-mission-head", ".dm-control-head {", ".dm-control-close {"]) {
    assert.ok(!css.includes(old), `old header CSS left: ${old}`);
  }
});

test("Group G sheets sit in the shared frame and use theme tokens only", async () => {
  for (const [file, marker] of [
    ["agent-console.ts", '"devmoter-agent-panel dm-sheet-frame hidden"'],
    ["workflow.ts", '"wf-sheet dm-sheet-frame"'],
    ["session-control.ts", '"sc-panel dm-sheet-frame"'],
    ["mission-control.ts", '"dm-mission-sheet dm-sheet-frame"'],
    ["remote-control.ts", '"dm-control-card dm-sheet-frame"']
  ]) assert.ok((await source(file)).includes(marker), `${file}: ${marker}`);
  for (const file of ["agent-console.css", "mission-control.css", "session-control.css"]) {
    const literals = (await source(file)).split("\n").filter(line => HEX.test(line));
    assert.deepEqual(literals, [], `${file} has no hardcoded colors`);
  }
  const theme = await source("zcode-theme.css");
  assert.match(theme, /\.dm-sheet-head \{[^}]*background: var\(--surface-panel\);[^}]*color: var\(--text-primary\);/);
  assert.match(theme, /\.dm-sheet-head-title \{[^}]*color: var\(--text-primary\);/);
  // The terminal canvas follows the theme instead of a fixed #070809.
  const tools = await source("control-center.ts");
  assert.ok(!tools.includes("#070809"));
  assert.ok(tools.includes("theme: terminalTheme()"));
  // Selected tabs are a surface step, not an inverted black pill.
  const toolsCss = await source("styles/tools.css");
  assert.match(toolsCss, /\.dm-control-tabs button\[aria-selected="true"\] \{[^}]*background: var\(--surface-hover\);/);
  assert.ok(!/\.wf-modal \{[^}]*backdrop-filter/.test(toolsCss), "no blur layer turns the fixed frame relative");
});

test("Project and model rows: body-colored names, short paths, selected = border + check", async () => {
  const [workspace, base, tools, codex] = await Promise.all([source("styles/workspace.css"), source("styles/base.css"), source("styles/tools.css"), source("codex.ts")]);
  assert.match(workspace, /\.cx-project-copy strong \{[^}]*color: var\(--text-primary\);/);
  assert.match(workspace, /\.cx-project-row\.selected \{[^}]*border-color: var\(--border-subtle\);[^}]*background: var\(--surface-hover\);/);
  assert.ok(!/\.cx-project-row[^{]*\{[^}]*#[0-9a-f]{3,6}/i.test(workspace), "no dark literals on project rows");
  assert.match(base, /\.cx-model-row strong \{[^}]*color: var\(--text-primary\);/);
  assert.match(base, /\.cx-model-row small \{[^}]*color: var\(--text-secondary\);/);
  assert.match(tools, /\.cx-model-row:disabled \{[^}]*opacity: 1;/);
  assert.ok(codex.includes("path.textContent = shortProjectPath(project.path);"));
  assert.ok(codex.includes("PROJECT_ROW_ICONS.check"));
  assert.equal(shortProjectPath("/home/mari/projects/very/long/OpenCode-Pocket"), "~/…/long/OpenCode-Pocket");
  assert.equal(shortProjectPath("/home/mari/雑談"), "~/雑談");
  assert.equal(shortProjectPath("/home/mari"), "~");
  assert.equal(shortProjectPath("/srv/a/b/c"), "/…/b/c");
});

test("compact device gate is one button into 信頼済み端末", () => {
  const dom = new JSDOM("<!doctype html><body></body>");
  const { window } = dom;
  const opened = [];
  let closed = 0;
  window.addEventListener("devmoter:open-settings", event => opened.push(event.detail));
  const gate = createDeviceGate(window.document, { compact: true, onRegister: () => { closed += 1; } });
  assert.ok(gate.classList.contains("dm-device-gate-compact"));
  assert.equal(gate.children.length, 1);
  const button = gate.querySelector("[data-device-gate-register]");
  assert.equal(button.textContent, "信頼済み端末を開く");
  button.click();
  assert.equal(closed, 1);
  assert.deepEqual(opened, [{ page: "devices" }]);
  dom.window.close();
});

test("device-token refusals in Agent mode, Mission Control and Automation show the gate, not raw text", async () => {
  const [agent, runtime, mission, remote] = await Promise.all([source("agent-console.ts"), source("host-agent-runtime.ts"), source("mission-control.ts"), source("remote-control.ts")]);
  assert.ok(runtime.includes("throw responseError(response.status"));
  assert.ok(agent.includes("function reportError(error: unknown)"));
  assert.equal((agent.match(/reportError\(error\)/g) || []).length >= 10, true);
  assert.ok(mission.includes("throw responseError(response.status, message)"));
  assert.ok(mission.includes("createDeviceGate(document, {\n      compact: true"));
  assert.ok(remote.includes("throw responseError(response.status, payload?.error)"));
  assert.ok(remote.includes("createDeviceGate(document, { compact: true"));
});

test("Group G copy has Japanese for every new or shortened English source string", async () => {
  const i18n = await source("i18n.ts");
  const ja = key => {
    const match = i18n.match(new RegExp(`^\\s*${JSON.stringify(key).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}: \\{[^}]*ja: "([^"]*)"`, "m"));
    return match?.[1];
  };
  for (const [key, expected] of [
    ["Saved sessions", "保存済みセッション"],
    ["Keep running after restart (tmux)", "再起動後も実行を続ける（tmux）"],
    ["Terminal not started", "ターミナルは未起動です"],
    ["Command check", "コマンドの確認"],
    ["Remembered approvals", "記憶した承認"],
    ["Exclude (comma-separated)", "除外（カンマ区切り）"],
    ["Rebuild index", "インデックスを再作成"],
    ["Repo map", "リポジトリマップ"],
    ["Details", "詳細"],
    ["Role model routing", "役割ごとのモデル"],
    ["Run as subagent", "サブエージェントで実行"],
    ["No changes to review", "レビュー待ちの変更はありません"],
    ["Not loaded", "未読み込み"],
    ["Active agents", "実行中のエージェント"],
    ["New schedule", "スケジュールを追加"],
    ["信頼済み端末を開く", "信頼済み端末を開く"]
  ]) assert.equal(ja(key), expected, key);
  // Old long English that no longer ships.
  const sources = (await Promise.all(["control-center.ts", "agent-console.ts", "workflow.ts", "mission-control.ts"].map(source))).join("\n");
  for (const old of ["Ready when you are", "Registered project", "Keep running after DevMoter restarts", "High-risk command scan", "Run as bounded Codex subagent", "No staged change sets yet", "PTY cwd is resolved"]) {
    assert.ok(!sources.includes(old), old);
  }
});

test("Index keeps everyday actions first and folds excludes and Delete index under 詳細", async () => {
  const tools = await source("control-center.ts");
  assert.ok(tools.includes("actions.replaceChildren(rebuild, showMap);"));
  assert.ok(tools.includes("advanced.append(advancedSummary, excludeLabel, advancedActions);"));
  assert.ok(tools.includes("indexSection.append(row, actions, advanced, searchRow, status, results);"));
});
