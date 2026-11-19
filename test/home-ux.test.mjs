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
  assert.equal(root.querySelector("h1")?.textContent, "Workspace");
  assert.equal(root.querySelector("#dm-home-apps-title")?.textContent, "Tools");
  assert.equal(root.querySelector("[data-home-app-count]")?.textContent, "13 apps");
  assert.match(root.textContent, /Developer Workflows|Knowledge|Browser/);
  assert.doesNotMatch(root.textContent, /開発ワークフロー|ナレッジ|ブラウザー/);
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
  const browserCard = root.querySelector('[data-home-app="browser"]');
  assert.equal(browserCard.getAttribute("aria-disabled"), null);
  assert.equal(browserCard.disabled, false);
  assert.equal(root.querySelector('[data-home-app="knowledge"]').getAttribute("aria-disabled"), "true");
  root.querySelector('[data-home-app="knowledge"]').click();
  assert.equal(root.querySelector('[data-home-app="knowledge"]')?.getAttribute("aria-label"), "Knowledge, Preview");
  assert.equal(root.querySelector('[data-home-app="knowledge"] .dm-home-app-state')?.textContent, "Preview");
  browserCard.click();
  assert.deepEqual(launches, []);
  assert.equal(previews.length, 2);
  assert.equal(previews[0].id, "knowledge");
  assert.equal(previews[0].message, "Knowledge is not available yet. Its app shell is planned separately.");
  assert.equal(previews[1].id, "browser");
  assert.match(previews[1].message, /Files & Preview/);
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

const FAVORITES_KEY = "devmoter-home-favorite-apps-v1";
const RECENTS_KEY = "devmoter-home-recent-apps-v1";

function mountHomeAt(mountHomeSurface, dom) {
  const root = dom.window.document.getElementById("home");
  const launched = [];
  const previews = [];
  mountHomeSurface(root, {
    onLaunchApp: id => launched.push(id),
    onPreviewApp: (id, message) => previews.push({ id, message })
  });
  return { root, launched, previews };
}

const favoriteIds = root => [...root.querySelectorAll("[data-home-favorite-app]")].map(button => button.dataset.homeFavoriteApp);

test("#459: only available apps can be saved as favorites and they are restored after reload", async () => {
  const { mountHomeSurface } = await loadHome();
  const dom = new JSDOM("<main id='home'></main>", { url: "https://devmoter.test" });
  const storage = dom.window.localStorage;
  let { root, launched } = mountHomeAt(mountHomeSurface, dom);
  assert.equal(root.querySelector("[data-home-favorites-section]").hidden, true);
  // Preview / unavailable launchers offer no favorite control at all.
  assert.equal(root.querySelector('[data-home-favorite-toggle="knowledge"]'), null);
  assert.equal(root.querySelector('[data-home-favorite-toggle="browser"]'), null);

  const gitToggle = root.querySelector('[data-home-favorite-toggle="git"]');
  assert.equal(gitToggle.getAttribute("aria-pressed"), "false");
  assert.equal(gitToggle.getAttribute("aria-label"), "Add Git to favorites");
  gitToggle.click();
  root.querySelector('[data-home-favorite-toggle="terminal"]').click();
  assert.equal(gitToggle.getAttribute("aria-pressed"), "true");
  assert.equal(gitToggle.getAttribute("aria-label"), "Remove Git from favorites");
  assert.deepEqual(JSON.parse(storage.getItem(FAVORITES_KEY)), ["git", "terminal"]);
  assert.deepEqual(launched, [], "pinning never launches the app");

  ({ root, launched } = mountHomeAt(mountHomeSurface, dom)); // reload
  assert.equal(root.querySelector("[data-home-favorites-section]").hidden, false);
  assert.deepEqual(favoriteIds(root), ["git", "terminal"]);
  assert.equal(root.querySelector('[data-home-favorite-toggle="git"]').getAttribute("aria-pressed"), "true");
  root.querySelector('[data-home-favorite-app="git"]').click();
  assert.deepEqual(launched, ["git"], "favorites reuse the registry launcher");

  root.querySelector('[data-home-favorite-remove="git"]').click();
  assert.deepEqual(favoriteIds(root), ["terminal"]);
  assert.deepEqual(JSON.parse(storage.getItem(FAVORITES_KEY)), ["terminal"]);
  dom.window.close();
});

test("#459/#460: invalid stored favorites are ignored without breaking Home", async () => {
  const { mountHomeSurface } = await loadHome();
  const dom = new JSDOM("<main id='home'></main>", { url: "https://devmoter.test" });
  const storage = dom.window.localStorage;
  for (const bad of ["{not json", "null", '{"git":true}', '"git"', "42"]) {
    storage.setItem(FAVORITES_KEY, bad);
    const { root } = mountHomeAt(mountHomeSurface, dom);
    assert.deepEqual(favoriteIds(root), [], bad);
    assert.equal(root.querySelectorAll("[data-home-app]").length, 13);
  }
  storage.setItem(FAVORITES_KEY, JSON.stringify([
    "terminal", "knowledge", "browser", "settings", "<img src=x onerror=alert(1)>", "__proto__",
    7, null, { id: "git" }, ["chat"], "terminal", "git"
  ]));
  const { root, launched, previews } = mountHomeAt(mountHomeSurface, dom);
  assert.deepEqual(favoriteIds(root), ["terminal", "git"]);
  assert.equal(root.querySelector("[data-home-favorites] img"), null);
  for (const button of root.querySelectorAll("[data-home-favorite-app]")) button.click();
  assert.deepEqual(launched, ["terminal", "git"]);
  assert.deepEqual(previews, []);
  dom.window.close();
});

test("#460: favorites can be reordered with buttons and Alt+Arrow keys, and the order persists", async () => {
  const { mountHomeSurface } = await loadHome();
  const dom = new JSDOM("<main id='home'></main>", { url: "https://devmoter.test" });
  const storage = dom.window.localStorage;
  storage.setItem(FAVORITES_KEY, JSON.stringify(["chat", "git", "terminal"]));
  let { root } = mountHomeAt(mountHomeSurface, dom);
  const doc = dom.window.document;

  assert.equal(root.querySelector('[data-home-favorite-up="chat"]').disabled, true);
  assert.equal(root.querySelector('[data-home-favorite-down="terminal"]').disabled, true);
  assert.equal(root.querySelector('[data-home-favorite-up="git"]').getAttribute("aria-label"), "Move Git up");
  assert.equal(root.querySelector('[data-home-favorite-up="git"]').tagName, "BUTTON");

  root.querySelector('[data-home-favorite-down="chat"]').click();
  assert.deepEqual(favoriteIds(root), ["git", "chat", "terminal"]);
  assert.equal(doc.activeElement, root.querySelector('[data-home-favorite-down="chat"]'), "focus follows the moved row");
  assert.equal(root.querySelector("[data-home-status]").textContent, "Chat moved to position 2 of 3.");

  const key = (id, name, init = { altKey: true }) => root.querySelector(`[data-home-favorite-app="${id}"]`)
    .dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true, ...init }));
  key("terminal", "ArrowUp");
  key("terminal", "ArrowUp");
  assert.deepEqual(favoriteIds(root), ["terminal", "git", "chat"]);
  assert.equal(doc.activeElement, root.querySelector('[data-home-favorite-app="terminal"]'), "at the top edge focus stays on the row");
  key("terminal", "ArrowUp"); // already first: no-op
  key("git", "ArrowDown", {}); // no Alt: plain arrows are left alone
  assert.deepEqual(favoriteIds(root), ["terminal", "git", "chat"]);
  key("git", "ArrowDown");
  assert.deepEqual(favoriteIds(root), ["terminal", "chat", "git"]);
  assert.deepEqual(JSON.parse(storage.getItem(FAVORITES_KEY)), ["terminal", "chat", "git"]);

  ({ root } = mountHomeAt(mountHomeSurface, dom));
  assert.deepEqual(favoriteIds(root), ["terminal", "chat", "git"]);
  dom.window.close();
});

test("#461: clearing recents removes only the recently opened list", async () => {
  const { mountHomeSurface } = await loadHome();
  const dom = new JSDOM("<main id='home'></main>", { url: "https://devmoter.test" });
  const storage = dom.window.localStorage;
  storage.setItem("devmoter-unrelated", "keep");
  storage.setItem(FAVORITES_KEY, JSON.stringify(["git"]));
  const requests = [];
  dom.window.fetch = (...args) => { requests.push(args); return Promise.reject(new Error("no network")); };
  let { root, launched } = mountHomeAt(mountHomeSurface, dom);
  root.querySelector('[data-home-app="terminal"]').click();
  root.querySelector('[data-home-app="git"]').click();
  assert.equal(root.querySelectorAll(".dm-home-recent-card").length, 2);
  assert.ok(storage.getItem(RECENTS_KEY));

  const clear = root.querySelector("[data-home-clear-recents]");
  assert.equal(clear.tagName, "BUTTON");
  assert.equal(clear.textContent, "Clear");
  clear.click();
  assert.equal(root.querySelector("[data-home-recent-section]").hidden, true);
  assert.equal(root.querySelectorAll(".dm-home-recent-card").length, 0);
  assert.equal(storage.getItem(RECENTS_KEY), null);
  assert.equal(storage.getItem("devmoter-unrelated"), "keep");
  assert.deepEqual(JSON.parse(storage.getItem(FAVORITES_KEY)), ["git"]);
  assert.deepEqual(favoriteIds(root), ["git"]);
  assert.equal(root.querySelectorAll("[data-home-app]").length, 13);
  assert.deepEqual(requests, [], "clearing is local only: no server request");
  assert.deepEqual(launched, ["terminal", "git"]);
  assert.equal(dom.window.document.activeElement, root.querySelector("#devmoterHomeTitle"));

  ({ root } = mountHomeAt(mountHomeSurface, dom));
  assert.equal(root.querySelector("[data-home-recent-section]").hidden, true);
  root.querySelector('[data-home-app="chat"]').click();
  assert.deepEqual([...root.querySelectorAll(".dm-home-recent-card")].map(b => b.dataset.homeRecentApp), ["chat"]);
  dom.window.close();
});
