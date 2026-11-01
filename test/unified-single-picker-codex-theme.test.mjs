import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { JSDOM } from "jsdom";
import { transform } from "esbuild";

const source = async name => readFile(new URL("../src/" + name, import.meta.url), "utf8");

async function navigator() {
  const sourceText = await source("unified-workspace-nav.ts");
  const clean = sourceText.replace(/import "\.\/unified-workspace-(?:nav|chat)\.css";/g, "");
  const js = await transform(clean, { loader: "ts", format: "esm", target: "es2022" });
  const uri = "data:text/javascript;base64," + Buffer.from(js.code).toString("base64");
  return (await import(uri)).mountTaskFirstWorkspace;
}

test("Codex and API Chat keep their legacy switch DOM but use read-only labels in unified mode", async () => {
  const [codex, api, css, sharedCSS] = await Promise.all([
    source("codex.ts"), source("api-chat.ts"), source("unified-workspace-nav.css"), source("unified-workspace-chat.css")
  ]);
  for (const [name, text] of [["Codex", codex], ["API Chat", api]]) {
    assert.match(text, /data-unified-agent-label hidden/, name + " needs a truly hidden legacy-state label");
    assert.match(text, /dm-agent-switch-shell/, name + " legacy chooser must remain usable without the new flag");
  }
  assert.match(css, /body\.dm-task-first-enabled\s+:is\(/);
  for (const target of [".cx-app .dm-agent-switch-shell", ".api-app .dm-agent-switch-shell", "[data-home-react-pilot]"]) {
    assert.ok(css.includes(target), "redundant agent picker not scoped: " + target);
  }
  assert.ok(!css.includes(".dm-shell-ai-grid"), "the Tools backend grid was deleted, not hidden");
  assert.ok(!css.includes(".ocx-context-button"), "do not hide OpenCode's model chooser");
  assert.ok(!css.includes(".api-picker-row"), "do not hide API Chat's provider/model select");
  assert.match(sharedCSS, /body\.dm-task-first-enabled \.cx-app \.cx-sidebar/);
  for (const selector of [
    ".cx-app .cx-topbar", ".cx-app .cx-side-action.primary",
    ".cx-app .cx-search", ".cx-app .cx-thread-row.active",
    ".cx-app .cx-composer", ".cx-app #cxSend.stop",
    ".cx-modal-card"
  ]) {
    assert.ok(sharedCSS.includes(selector), "Codex palette incomplete: " + selector);
  }
  assert.ok(sharedCSS.includes("var(--dw-chat-surface)"), "native sidebar must inherit shared palette");
  assert.ok(sharedCSS.includes("var(--dw-chat-accent)"), "native Codex focus/action feedback must be readable");
  assert.ok(!/display\s*:\s*none\b/.test(sharedCSS), "chat design must not hide permission/model controls");
  const compiled = await Promise.all([css, sharedCSS].map(text => transform(text, { loader: "css", target: ["chrome120", "safari17"], minify: true })));
  for (const output of compiled) assert.ok(output.code.length > 0, "scoped CSS must compile");
});

test("unified picker is sole agent switch and labels return to hidden after destroy", async () => {
  const dom = new JSDOM([
    '<!doctype html><html><body><div id="app">',
    '<div class="cx-app"><aside class="cx-sidebar">',
    '<div class="dm-unified-agent-identity" data-unified-agent-label hidden>Codex</div>',
    '<div class="dm-agent-switch-shell"><button id="cxAgentSwitchButton">Choose</button></div>',
    '<button id="cxMenu">History</button></aside></div>',
    '<div class="api-app"><aside class="api-sidebar">',
    '<div class="dm-unified-agent-identity" data-unified-agent-label hidden>API Chat</div>',
    '<div class="dm-agent-switch-shell"><button id="apiAgentSwitchButton">Choose</button></div>',
    '</aside></div></div>',
    '<div class="dm-shell-ai-grid"><button data-backend="codex">Codex</button></div>',
    '</body></html>'
  ].join(""), { url: "https://localhost/?surface=codex&unifiedUI=1" });
  const oldWindow = globalThis.window;
  const oldDocument = globalThis.document;
  const oldStorage = globalThis.localStorage;
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.localStorage = dom.window.localStorage;
  try {
    const mount = await navigator();
    const switched = [];
    const labels = [...dom.window.document.querySelectorAll("[data-unified-agent-label]")];
    assert.ok(labels.every(el => el.hidden));
    assert.ok(dom.window.document.querySelector("#cxAgentSwitchButton"), "existing legacy switch not removed");
    const instance = mount({
      initialSurface: "codex",
      switchBackend: next => switched.push(next),
      openHome: () => {}, openTasks: () => {}, openReview: () => {}, openTools: () => {}
    });
    const root = dom.window.document.getElementById("dmTaskFirstWorkspace");
    assert.ok(dom.window.document.body.classList.contains("dm-task-first-enabled"));
    assert.ok(labels.every(el => !el.hidden), "native sidebars show static identities");
    assert.equal(dom.window.document.querySelectorAll("[data-workspace-backend]").length, 1);
    const select = root.querySelector("[data-workspace-backend]");
    select.value = "api";
    select.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
    assert.deepEqual(switched, ["api"], "still uses native backend switch action");
    instance.destroy();
    assert.ok(labels.every(el => el.hidden), "legacy mode should never show duplicate identity labels");
    assert.ok(!dom.window.document.body.classList.contains("dm-task-first-enabled"));
    assert.ok(dom.window.document.querySelector("#cxAgentSwitchButton"));
  } finally {
    globalThis.window = oldWindow;
    globalThis.document = oldDocument;
    globalThis.localStorage = oldStorage;
    dom.window.close();
  }
});
