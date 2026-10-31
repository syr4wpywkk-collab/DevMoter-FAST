import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";
import { build } from "esbuild";

async function loadIntegrations() {
  const result = await build({
    entryPoints: [fileURLToPath(new URL("../src/integrations.ts", import.meta.url))],
    bundle: true, platform: "browser", format: "esm", write: false,
    outdir: "dist-test", loader: { ".css": "empty" }, logLevel: "silent"
  });
  const code = result.outputFiles.find(file => file.path.endsWith(".js")).text;
  return import("data:text/javascript;base64," + Buffer.from(code).toString("base64"));
}

test("Integrations has no Project card or intro copy, one action column per card, and launches in the current project", async () => {
  const { mountIntegrations } = await loadIntegrations();
  const dom = new JSDOM("<div id='root'></div>", { url: "https://devmoter.test/" });
  const prior = { window: globalThis.window, document: globalThis.document, localStorage: globalThis.localStorage, fetch: globalThis.fetch };
  const launches = [];
  const longRemote = "chromebook-" + "x".repeat(120);
  Object.assign(globalThis, {
    window: dom.window, document: dom.window.document, localStorage: dom.window.localStorage,
    fetch: async (path, init = {}) => {
      if (path === "/api/projects") return { ok: true, json: async () => ({ projects: [
        { id: "p1", name: "First", path: "/work/first" }, { id: "p2", name: "Current", path: "/work/current" }
      ] }) };
      if (path === "/api/integrations/status") return { ok: true, json: async () => ({ integrations: [
        { id: "antigravity", name: "Antigravity", installed: true, remote: { running: true, name: longRemote, remoteUrl: "https://remote.example" } },
        { id: "claude", name: "Claude Code", installed: true }
      ] }) };
      if (String(path).endsWith("/launch")) { launches.push(JSON.parse(init.body).projectId); return { ok: true, json: async () => ({ terminal: "tmux" }) }; }
      throw new Error("unexpected " + path);
    }
  });
  try {
    dom.window.localStorage.setItem("opencode-pocket-project", "/work/current/");
    dom.window.localStorage.setItem("devmoter-enabled-integrations", JSON.stringify(["antigravity", "claude"]));
    const root = dom.window.document.getElementById("root");
    const controller = mountIntegrations(root);
    await controller.refresh();
    assert.equal(root.querySelector("#ixProject"), null);
    assert.equal(root.querySelector(".ix-hero"), null);
    assert.doesNotMatch(root.textContent, /開発ツールをひとつの場所から|使うものだけ表示|ON\/OFFは表示設定|launcher & handoff|準備中/);
    const cards = [...root.querySelectorAll(".ix-card")];
    assert.equal(cards.length, 2);
    for (const card of cards) {
      assert.equal(card.querySelectorAll(".ix-actions").length, 1, "one action column");
      assert.ok(card.querySelector(".ix-description").textContent.trim(), "card description stays");
    }
    assert.deepEqual([...cards[0].querySelectorAll(".ix-actions button")].map(b => b.textContent.trim()), ["PCで開く", "Remote停止", "Remoteを開く", "QR表示"]);
    assert.deepEqual([...cards[1].querySelectorAll(".ix-actions button")].map(b => b.textContent.trim()), ["PCで開く", "Claude Code Web", "QR表示"]);
    const pill = cards[0].querySelector(".ix-pill");
    assert.equal(pill.title, "Remote: " + longRemote, "full name stays available when truncated");
    cards[1].querySelector('[data-action="launch"]').click();
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.deepEqual(launches, ["p2"], "the workspace's current project is used");
  } finally {
    Object.assign(globalThis, prior);
    dom.window.close();
  }
});
