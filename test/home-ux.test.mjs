import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";
import { build } from "esbuild";

// Bundle the actual TypeScript UI with its registry. Only the CSS import is
// omitted because JSDOM does not implement layout or CSS asset loading.
let homePromise;
async function loadHome() {
  homePromise ||= (async () => {
    const result = await build({
      entryPoints: [fileURLToPath(new URL("../src/home.ts", import.meta.url))],
      bundle: true,
      platform: "browser",
      format: "esm",
      write: false,
      outdir: "dist-test",
      loader: { ".css": "empty" },
      logLevel: "silent"
    });
    const code = result.outputFiles.find(file => file.path.endsWith(".js"))?.text;
    assert.ok(code, "esbuild must output a JavaScript module");
    return import("data:text/javascript;base64," + Buffer.from(code).toString("base64"));
  })();
  return homePromise;
}

test("Home has no continue card or footer copy; Chat still opens through the registry launcher", async () => {
  const { mountHomeSurface } = await loadHome();
  const dom = new JSDOM("<main id='home'></main>");
  const root = dom.window.document.querySelector("#home");
  const launches = [];
  const previews = [];
  mountHomeSurface(root, {
    onLaunchApp: id => launches.push(id),
    onPreviewApp: (id, message) => previews.push({ id, message })
  });
  assert.equal(root.querySelector("[data-home-continue]"), null);
  assert.equal(root.querySelector("[data-home-open-chat]"), null);
  assert.equal(root.querySelector("footer"), null);
  assert.doesNotMatch(root.textContent, /作業を続ける|ローカル開発環境|RECENT ACTIVITY|まだ最近開いたアプリ|Project files, previews/);
  root.querySelector('[data-home-app="chat"]').click();
  root.querySelector('[data-home-quick-action="chat"]').click();
  assert.deepEqual(launches, ["chat", "chat"]);
  assert.deepEqual(previews, []);
  dom.window.close();
});

test("Home copy describes a development workspace without generic AI slogans", async () => {
  const { mountHomeSurface } = await loadHome();
  const dom = new JSDOM("<main id='home'></main>");
  const root = dom.window.document.querySelector("#home");
  mountHomeSurface(root, { onLaunchApp() {}, onPreviewApp() {} });
  assert.equal(root.querySelector("h1")?.textContent, "作業スペース");
  assert.equal(root.querySelector("#dm-home-apps-title")?.textContent, "ツール");
  assert.doesNotMatch(root.textContent, /building with AI|local AI workspace/i);
  dom.window.close();
});

test("Home still treats non-shipped applications as previews, never launches them", async () => {
  const { mountHomeSurface } = await loadHome();
  const dom = new JSDOM("<main id='home'></main>");
  const root = dom.window.document.querySelector("#home");
  const launches = [];
  const previews = [];
  mountHomeSurface(root, {
    onLaunchApp: id => launches.push(id),
    onPreviewApp: (id, message) => previews.push({ id, message })
  });
  root.querySelector('[data-home-app="knowledge"]').click();
  assert.deepEqual(launches, []);
  assert.equal(previews.length, 1);
  assert.equal(previews[0].id, "knowledge");
  assert.match(previews[0].message, /not available yet/i);
  dom.window.close();
});

test("MAR-111: five accessible Home quick actions reuse the safe App Registry launcher", async () => {
  const { mountHomeSurface } = await loadHome();
  const dom = new JSDOM("<main id='home'></main>", { url: "https://devmoter.test" });
  const root = dom.window.document.getElementById("home");
  const launched = [];
  const previews = [];
  mountHomeSurface(root, {
    onLaunchApp: id => launched.push(id),
    onPreviewApp: (id, message) => previews.push({ id, message })
  });
  const ids = ["chat", "projects", "terminal", "review", "sessions"];
  const buttons = [...root.querySelectorAll("[data-home-quick-action]")];
  assert.deepEqual(buttons.map(button => button.dataset.homeQuickAction), ids);
  for (const button of buttons) {
    assert.equal(button.tagName, "BUTTON");
    assert.equal(button.type, "button");
    assert.equal(button.disabled, false);
    assert.ok(button.getAttribute("aria-label"));
    button.click();
  }
  assert.deepEqual(launched, ids);
  assert.deepEqual(previews, []);
  assert.deepEqual([...root.querySelectorAll(".dm-home-recent-card")].map(button => button.dataset.homeRecentApp),
    ["sessions", "review", "terminal"]);
  dom.window.close();
});
