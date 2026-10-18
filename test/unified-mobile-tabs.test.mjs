import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { transform } from "esbuild";
import { JSDOM } from "jsdom";

async function navigator() {
  const source = await readFile(new URL("../src/unified-workspace-nav.ts", import.meta.url), "utf8");
  const js = await transform(source.replace(/import "\\.\\/unified-workspace-(?:nav|chat)\\.css";/g, ""), {
    loader: "ts", format: "esm", target: "es2022"
  });
  return (await import("data:text/javascript;base64," + Buffer.from(js.code).toString("base64"))).mountTaskFirstWorkspace;
}

test("MAR-251: all mobile tabs navigate in both directions and select exactly one", async () => {
  const dom = new JSDOM('<!doctype html><div id="app"></div><button id="cxMenu">History</button>', {
    url: "https://localhost/?unifiedUI=1"
  });
  const saved = { window: globalThis.window, document: globalThis.document, localStorage: globalThis.localStorage };
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, localStorage: dom.window.localStorage });
  try {
    const mount = await navigator();
    const actions = [];
    const changing = [];
    let currentlyOpen = null;
    dom.window.addEventListener("devmoter:workspace-tab-changing", event => {
      changing.push(event.detail.tab);
      if (currentlyOpen && currentlyOpen !== event.detail.tab) {
        dom.window.dispatchEvent(new dom.window.CustomEvent("devmoter:workspace-panel-closed", {
          detail: { tab: currentlyOpen }
        }));
      }
    });
    const controller = mount({
      initialSurface: "codex",
      switchBackend: value => actions.push("backend:" + value),
      openHome: () => actions.push("home"),
      openTasks: () => { actions.push("tasks"); currentlyOpen = "tasks"; },
      openReview: () => { actions.push("review"); currentlyOpen = "review"; },
      openTools: () => { actions.push("tools"); currentlyOpen = "tools"; }
    });
    const root = dom.window.document.getElementById("dmTaskFirstWorkspace");
    const selected = () => [...root.querySelectorAll('[data-workspace-action][aria-current="page"]')]
      .map(button => button.dataset.workspaceAction);
    assert.deepEqual(selected(), ["chat"]);
    for (const tab of ["tasks", "review", "tasks", "chat", "tools", "review", "tasks"]) {
      root.querySelector('[data-workspace-action="' + tab + '"]').click();
      assert.deepEqual(selected(), [tab], "only " + tab + " should be selected");
    }
    assert.deepEqual(changing, ["tasks", "review", "tasks", "chat", "tools", "review", "tasks"]);
    assert.deepEqual(actions, ["tasks", "review", "tasks", "tools", "review", "tasks"]);
    dom.window.dispatchEvent(new dom.window.CustomEvent("devmoter:workspace-panel-closed", {
      detail: { tab: "tasks" }
    }));
    assert.deepEqual(selected(), ["chat"], "closing an overlay should restore the chat selection");
    controller.destroy();
    assert.equal(dom.window.document.getElementById("dmTaskFirstWorkspace"), null);
  } finally {
    Object.assign(globalThis, saved);
    dom.window.close();
  }
});

test("MAR-249: Review canvas shares theme tokens; touch hover cannot masquerade as selection", async () => {
  const [css, workflow, session] = await Promise.all([
    readFile(new URL("../src/unified-workspace-nav.css", import.meta.url), "utf8"),
    readFile(new URL("../src/workflow.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/session-control.ts", import.meta.url), "utf8")
  ]);
  assert.match(css, /body\\.dm-task-first-enabled \\.wf-modal\\s*\\{[^}]*background: var\\(--dw-chat-bg\\)/s);
  assert.match(css, /body\\.dm-task-first-enabled \\.wf-sheet\\s*\\{[^}]*background: var\\(--dw-chat-bg\\)/s);
  assert.match(css, /body\\.dm-task-first-enabled \\.wf-body\\s*\\{ background: var\\(--dw-chat-bg\\); \\}/);
  assert.match(css, /@media \\(hover: hover\\) and \\(pointer: fine\\)/);
  assert.doesNotMatch(css, /\\.dm-task-first-tabs button:hover,\\s*\\.dm-task-first-tabs button\\[aria-current="page"\\]/);
  assert.match(workflow, /devmoter:workspace-tab-changing/);
  assert.match(session, /devmoter:workspace-tab-changing/);
  assert.match(css, /env\\(safe-area-inset-bottom\\)/);
});
