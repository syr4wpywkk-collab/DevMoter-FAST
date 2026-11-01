import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { JSDOM } from "jsdom";

async function bundle(entry, globalName) {
  const result = await build({
    entryPoints: [fileURLToPath(new URL(entry, import.meta.url))],
    bundle: true,
    platform: "browser",
    format: "iife",
    globalName,
    outfile: "bundle.js",
    write: false,
    loader: { ".css": "empty" },
    target: "es2022",
    logLevel: "silent"
  });
  const output = result.outputFiles[0]?.text;
  assert.ok(output, `${entry} must bundle to JavaScript`);
  return output;
}

const settled = () => new Promise(resolve => setTimeout(resolve, 0));
const evaluate = (window, code, globalName) => {
  window.eval(`${code}\nwindow.${globalName} = ${globalName};`);
};

test("Japanese locale translates Home, workspace navigation, and Review copy and accessible names", async t => {
  const [homeCode, i18nCode, navCode, workflowCode] = await Promise.all([
    bundle("../src/home.ts", "HomeUI"),
    bundle("../src/i18n.ts", "DevMoterI18n"),
    bundle("../src/unified-workspace-nav.ts", "WorkspaceNav"),
    bundle("../src/workflow.ts", "WorkflowUI")
  ]);
  const dom = new JSDOM(
    '<!doctype html><html><body><main id="home"></main><div id="workflow"></div></body></html>',
    { url: "https://devmoter.test/", runScripts: "outside-only" }
  );
  t.after(() => dom.window.close());
  const { window } = dom;
  window.localStorage.setItem("devmoter-language", "ja");
  window.Headers = globalThis.Headers;
  let releaseProjects;
  window.fetch = () => new Promise(resolve => {
    releaseProjects = () => resolve({ ok: true, status: 200, json: async () => ({ projects: [] }) });
  });

  // Home is mounted before the translation observer, as it is during app startup.
  evaluate(window, homeCode, "HomeUI");
  window.HomeUI.mountHomeSurface(window.document.querySelector("#home"), {
    onLaunchApp() {},
    onPreviewApp() {}
  });
  evaluate(window, i18nCode, "DevMoterI18n");
  window.DevMoterI18n.startI18n();

  // The shared navigator and Review modal mount after i18n starts; the observer
  // must translate their initial and subsequently rendered copy as well.
  evaluate(window, navCode, "WorkspaceNav");
  window.WorkspaceNav.mountTaskFirstWorkspace({
    initialSurface: "home",
    initialBackend: "api",
    switchBackend() {},
    openHome() {},
    openTasks() {},
    openReview() {},
    openTools() {}
  });
  evaluate(window, workflowCode, "WorkflowUI");
  window.WorkflowUI.mountTaskWorkflow(window.document.querySelector("#workflow"));
  window.document.querySelector("#wfLaunch").click();
  await settled();
  assert.equal(window.document.querySelector("#wfStatus").textContent, "更新中…");
  assert.ok(releaseProjects, "opening Review should request the project list");
  releaseProjects();
  await settled();
  await settled();

  const home = window.document.querySelector("#home");
  assert.equal(home.querySelector(".dm-home-search-trigger strong").textContent, "検索");
  const appLabels = {
    office: "文書", chat: "チャット", projects: "プロジェクト", "mission-control": "状況",
    knowledge: "ナレッジ", terminal: "ターミナル", git: "Git", review: "レビュー",
    agents: "エージェント", sessions: "セッション・実行履歴", browser: "ブラウザー",
    automation: "自動化", "developer-workflows": "開発ワークフロー"
  };
  for (const [id, label] of Object.entries(appLabels)) {
    assert.equal(home.querySelector(`[data-home-app="${id}"] strong`).textContent, label, `${id} label`);
  }
  assert.equal(home.querySelector('[data-home-app="developer-workflows"]').title, "MCP、スキル、ルール、ACP、CI、検証");
  assert.equal(home.querySelector('[data-home-app="knowledge"]').getAttribute("aria-label"), "ナレッジ、プレビュー");
  assert.equal(home.querySelector('[data-home-quick-action="chat"]').getAttribute("aria-label"), "チャットを開く");
  assert.equal(home.querySelector("[data-home-app-count]").textContent, "13件");

  const nav = window.document.querySelector("#dmTaskFirstWorkspace");
  assert.equal(nav.querySelector("[data-workspace-home]").getAttribute("aria-label"), "DevMoter FAST ホーム");
  assert.equal(nav.querySelector(".dm-task-first-brand small").textContent, "統合ワークスペース");
  assert.equal(nav.querySelector("[data-workspace-backend]").parentElement.querySelector("span").textContent, "AIバックエンド");
  assert.equal(nav.querySelector("[data-workspace-menu-button]").getAttribute("aria-label"), "画面を切り替え");
  assert.equal(nav.querySelector('[data-workspace-action="tasks"]').getAttribute("aria-label"), "タスクとセッション");
  assert.equal(nav.querySelector('[data-workspace-action="chat"]').getAttribute("aria-label"), "現在のチャットと会話履歴");
  assert.equal(nav.querySelector('[data-workspace-action="review"]').getAttribute("aria-label"), "変更を確認");
  assert.equal(nav.querySelector('[data-workspace-action="tools"]').getAttribute("aria-label"), "ツールを開く");

  const review = window.document.querySelector("#workflow");
  assert.equal(review.querySelector("#wfLaunch b").textContent, "レビュー");
  assert.equal(review.querySelector("#wfLaunch").getAttribute("aria-label"), "変更とタスクを確認");
  assert.equal(review.querySelector("#wfModal").getAttribute("aria-label"), "レビューとタスク");
  assert.equal(review.querySelector("#wfClose").getAttribute("aria-label"), "閉じる");
  assert.equal(review.querySelector(".wf-kicker").textContent, "DevMoterのワークフロー");
  assert.equal(review.querySelector(".wf-tabs").getAttribute("aria-label"), "ワークフローのセクション");
  assert.equal(review.querySelector('[data-wf-tab="changes"]').textContent, "変更");
  assert.equal(review.querySelector('[data-wf-tab="worktrees"]').textContent, "作業ツリー");
  assert.equal(review.querySelector("#wfStatus").textContent, "準備完了");
  assert.equal(review.querySelector("#wfWorktreesPanel .wf-empty").textContent, "実行中の作業ツリーはありません。");
  assert.equal(review.querySelector(".wf-section-head strong").textContent, "変更内容");
  assert.equal(review.querySelector(".wf-section-head small").textContent, "確認中の変更はファイルに反映されません。");
  assert.equal(review.querySelector("#wfLoadDiff").textContent, "作業中の差分");
  assert.equal(review.querySelector(".wf-empty").textContent, "変更セットはまだありません。エージェント連携からWorkflow APIに提案を送信できます。");

  // Verify the observer also handles Home recent-action labels and changing counts.
  home.querySelector('[data-home-quick-action="chat"]').click();
  const search = home.querySelector("[data-home-search]");
  search.value = "terminal";
  search.dispatchEvent(new window.Event("input", { bubbles: true }));
  await settled();
  assert.equal(home.querySelector(".dm-home-recent-card").getAttribute("aria-label"), "チャットをもう一度開く");
  assert.equal(home.querySelector("[data-home-app-count]").textContent, "1件");
});
