import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { build } from "esbuild";
import { JSDOM } from "jsdom";

const source = path => readFile(new URL(`../src/${path}`, import.meta.url), "utf8");
const HEX = /#[0-9a-f]{3,8}\b/i;
const block = (css, start, end) => css.slice(css.indexOf(start), css.indexOf(end, css.indexOf(start)));

test("Review & Tasks, Session Control, DevMoter Tools and Developer workflows follow theme tokens", async () => {
  const [session, tools, toolsCss, advanced] = await Promise.all([
    source("session-control.css"), source("control-center.css"), source("styles/tools.css"), source("advanced.css")
  ]);
  for (const [name, css] of [
    ["session-control.css", session],
    ["control-center.css", tools],
    ["Review & Tasks + Developer workflows", block(toolsCss, ".wf-launch {", "/* DevMoter setup / diagnostics")],
    ["cloud browser", advanced]
  ]) {
    const literals = css.split("\n").filter(line => HEX.test(line) && !/box-shadow/.test(line));
    assert.deepEqual(literals, [], `${name} has no hardcoded colors`);
  }
  assert.ok(!tools.includes("color-scheme: dark"), "DevMoter Tools no longer forces a dark color scheme");
  assert.match(tools, /\.dm-tools-panel button\.primary \{[^}]*background: var\(--accent\);[^}]*color: var\(--canvas-base\);/);
  assert.match(toolsCss, /\.cx-dev-warning \{\s*color: var\(--status-warning\);/);
  assert.match(toolsCss, /\.cx-dev-form select,\s*\.cx-dev-form textarea \{[^}]*font-size: 16px;[^}]*border: 1px solid var\(--border-subtle\);/);
});

test("default controls and the cx modal use tokens with a light success/warning palette", async () => {
  const [base, theme, workspace, codexChat] = await Promise.all([
    source("styles/base.css"), source("zcode-theme.css"), source("styles/workspace.css"), source("codex-chat.css")
  ]);
  assert.match(base, /\nbutton \{[^}]*border: 1px solid var\(--border-subtle\);[^}]*color: var\(--text-primary\);[^}]*background: var\(--surface-card\);/);
  assert.match(base, /button:active:not\(:disabled\) \{\s*transform: scale\(0\.97\);/);
  assert.match(base, /button\.primary \{[^}]*background: var\(--accent\);[^}]*color: var\(--canvas-base\);/);
  assert.match(base, /\ntextarea \{[^}]*color: var\(--text-primary\);[^}]*background: var\(--canvas-base\);/);
  assert.match(base, /\.cx-modal-card \{[^}]*background: var\(--surface-elevated\);/);
  assert.ok(!/\.cx-settings-section h3 \{[^}]*uppercase/.test(base), "section labels are not tracked capitals");
  assert.match(workspace, /\.cx-project-form input \{[^}]*background: var\(--canvas-base\);[^}]*font-size: 16px;/);
  assert.ok(!/\.cx-modal-card \{[^}]*#262626/.test(codexChat));
  assert.match(theme, /html\[data-devmoter-theme="light"\] \{[\s\S]*?--status-success: #28643e;/);
});

test("shared sheet frame starts below the unified header; tabs wrap at 400px", async () => {
  const [theme, tools, toolsTs, toolsCss] = await Promise.all([
    source("zcode-theme.css"), source("control-center.css"), source("control-center.ts"), source("styles/tools.css")
  ]);
  assert.match(theme, /body\.dm-task-first-enabled \{ --dm-sheet-top: calc\(var\(--dw-top-height\) \+ 8px\); \}/);
  assert.match(theme, /\.dm-sheet-frame \{[^}]*top: calc\(var\(--dm-sheet-top\) \+ var\(--dm-viewport-offset-top, 0px\)\);[^}]*height: max\(0px, calc\(var\(--dm-viewport-height, 100dvh\) - var\(--dm-sheet-top\) - var\(--dm-sheet-bottom\)\)\);/);
  assert.match(toolsTs, /className = "dm-tools-panel dm-sheet-frame hidden"/);
  assert.ok(!/\.dm-tools-panel \{[^}]*inset:/.test(tools), "Tools no longer positions itself under the header");
  assert.match(tools, /\.dm-tools-tabs \{\s*flex-wrap: wrap;/);
  assert.match(toolsCss, /\.dm-control-tabs \{[^}]*display: flex;\s*flex-wrap: wrap;/);
});

async function loadPanel() {
  const result = await build({
    entryPoints: [new URL("../src/dev-workflows-ui.ts", import.meta.url).pathname],
    bundle: true, write: false, format: "esm", platform: "neutral", target: "es2022"
  });
  const uri = "data:text/javascript;base64," + Buffer.from(result.outputFiles[0].text).toString("base64");
  return (await import(uri)).createDevWorkflowPanel;
}

function harness(createPanel, { projectAfterLoad }) {
  const dom = new JSDOM("<!doctype html><div id=body></div>", { url: "https://devmoter.example/" });
  const prior = { window: globalThis.window, document: globalThis.document, localStorage: globalThis.localStorage, fetch: globalThis.fetch };
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, localStorage: dom.window.localStorage });
  const calls = [];
  globalThis.fetch = async path => {
    calls.push(String(path));
    const body = String(path).startsWith("/api/dev/settings") ? { settings: {} } : { mcp: [], skills: [], rules: [], adapters: [], negotiation: { v: 1 } };
    return { ok: true, status: 200, json: async () => body };
  };
  const subtitles = [];
  let project = null;
  let resolveLoad;
  const loaded = new Promise(resolve => { resolveLoad = resolve; });
  const panel = createPanel({
    modalBody: dom.window.document.getElementById("body"),
    openModal: (_title, subtitle) => subtitles.push(subtitle),
    closeSidebar() {},
    getActiveProject: () => project,
    whenProjectReady: () => loaded,
    getActiveThreadId: () => null,
    showToast() {},
    uid: () => "op"
  });
  const finishLoad = () => { project = projectAfterLoad; resolveLoad(); };
  const restore = () => { Object.assign(globalThis, prior); dom.window.close(); };
  return { dom, panel, subtitles, calls, finishLoad, restore };
}

test("Developer workflows waits for the saved Project instead of asking to select one", async () => {
  const createPanel = await loadPanel();
  const h = harness(createPanel, { projectAfterLoad: { id: "p1", name: "DevMoter-FAST", path: "/p" } });
  try {
    const shown = h.panel.show();
    await new Promise(resolve => setImmediate(resolve));
    const body = h.dom.window.document.getElementById("body");
    assert.equal(body.querySelector(".cx-dev-state")?.dataset.state, "loading");
    assert.ok(!h.subtitles.includes("Projectを選択してください"));
    h.finishLoad();
    await shown;
    assert.ok(!h.subtitles.includes("Projectを選択してください"), "never flashes the empty-project prompt");
    assert.equal(h.subtitles.at(-1), "DevMoter-FAST");
    assert.ok(h.calls.some(path => path.startsWith("/api/dev/capabilities?projectId=p1")));
    // Short titles with line icons; JSON folded under 詳細; consistent empty state.
    const headings = [...body.querySelectorAll(".cx-dev-section-head > h3")].map(node => node.textContent);
    assert.deepEqual(headings, ["Review & CI", "Verification", "MCP servers", "Skills / Rules", "Extension manifest", "Agent adapters"]);
    for (const icon of body.querySelectorAll(".cx-dev-section-head > h3 > .cx-dev-section-icon")) assert.ok(icon.querySelector("svg"));
    for (const details of body.querySelectorAll("details.cx-dev-details")) {
      assert.equal(details.open, false);
      assert.equal(details.querySelector("summary").textContent, "詳細");
    }
    assert.ok([...body.querySelectorAll('.cx-dev-state[data-state="empty"]')].some(node => node.textContent === "設定済みMCP serverはありません。"));
  } finally {
    h.restore();
  }
});

test("Developer workflows still asks for a Project when none is saved", async () => {
  const createPanel = await loadPanel();
  const h = harness(createPanel, { projectAfterLoad: null });
  try {
    const shown = h.panel.show();
    h.finishLoad();
    await shown;
    assert.equal(h.subtitles.at(-1), "Projectを選択してください");
    assert.ok(!h.calls.length, "no Project-scoped request without a Project");
  } finally {
    h.restore();
  }
});
