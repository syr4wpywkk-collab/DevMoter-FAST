import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";
import { build, transform } from "esbuild";

let homePromise;
async function loadHome() {
  homePromise ||= (async () => {
    const result = await build({
      entryPoints: [fileURLToPath(new URL("../src/home.ts", import.meta.url))],
      bundle: true, platform: "browser", format: "esm", write: false,
      outdir: "dist-test", loader: { ".css": "empty" }, logLevel: "silent"
    });
    const code = result.outputFiles.find(file => file.path.endsWith(".js"))?.text;
    assert.ok(code);
    return import("data:text/javascript;base64," + Buffer.from(code).toString("base64"));
  })();
  return homePromise;
}

test("Home keeps a real two-column launcher and uses the canonical app registry", async () => {
  const { mountHomeSurface } = await loadHome();
  const dom = new JSDOM("<main id='home'></main>", { url: "https://devmoter.test/" });
  const root = dom.window.document.querySelector("#home");
  const launched = [];
  const previews = [];
  mountHomeSurface(root, {
    onLaunchApp: id => launched.push(id),
    onPreviewApp: (id, message) => previews.push({ id, message })
  });
  assert.match(root.textContent, /作業スペース/);
  assert.equal(root.querySelectorAll("[data-home-app]").length, 14);
  assert.equal(root.querySelector("[data-home-app-count]").textContent, "14件");
  assert.equal(root.querySelector("[data-home-app-grid]").children.length, 13);
  assert.equal(root.querySelector('[data-home-app="chat"]').getAttribute("type"), "button");
  assert.equal(root.querySelector("[data-home-health]").dataset.state, "checking", "never assume online");
  assert.doesNotMatch(root.textContent, /98\.4k|Swarm 8\/8|24ms|FastAPI Streamer|CodeGeeX/);
  root.querySelector('[data-home-app="terminal"]').click();
  root.querySelector('[data-home-app="knowledge"]').click();
  assert.deepEqual(launched, ["terminal"]);
  assert.equal(previews.length, 1);
  assert.equal(previews[0].id, "knowledge");
  assert.match(root.querySelector("[data-home-recent]").textContent, /ターミナル/);
  dom.window.close();
});

test("search, Ctrl+K and Escape filter existing real app launchers", async () => {
  const { mountHomeSurface } = await loadHome();
  const dom = new JSDOM("<main id='home'></main>", { url: "https://devmoter.test/" });
  const root = dom.window.document.querySelector("#home");
  const launched = [];
  mountHomeSurface(root, { onLaunchApp: id => launched.push(id), onPreviewApp: () => {} });
  const toggle = root.querySelector("[data-home-search-toggle]");
  const input = root.querySelector("[data-home-search]");
  const search = root.querySelector("#dmHomeSearchPanel");
  assert.equal(toggle.getAttribute("aria-expanded"), "false");
  dom.window.document.dispatchEvent(new dom.window.KeyboardEvent("keydown", { bubbles: true, key: "k", ctrlKey: true }));
  assert.equal(toggle.getAttribute("aria-expanded"), "true");
  assert.ok(!search.classList.contains("hidden"));
  input.value = "terminal";
  input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  assert.equal(root.querySelectorAll("[data-home-app]:not(.hidden)").length, 1);
  assert.equal(root.querySelector("[data-home-app-count]").textContent, "1件");
  root.querySelector('[data-home-app="terminal"]').click();
  assert.deepEqual(launched, ["terminal"]);
  dom.window.document.dispatchEvent(new dom.window.KeyboardEvent("keydown", { bubbles: true, key: "Escape" }));
  assert.equal(toggle.getAttribute("aria-expanded"), "false");
  assert.equal(root.querySelectorAll("[data-home-app]:not(.hidden)").length, 14);
  dom.window.close();
});

test("recent application cards use validated local app IDs and persist safely", async () => {
  const { mountHomeSurface } = await loadHome();
  const dom = new JSDOM("<main id='home'></main>", { url: "https://devmoter.test/" });
  const root = dom.window.document.querySelector("#home");
  const launched = [];
  const options = { onLaunchApp: id => launched.push(id), onPreviewApp: () => {} };
  mountHomeSurface(root, options);
  // No recents yet: the section is absent, with no empty-state copy.
  assert.equal(root.querySelector("[data-home-recent-section]").hidden, true);
  assert.equal(root.querySelector("[data-home-recent]").textContent, "");
  root.querySelector('[data-home-app="git"]').click();
  root.querySelector('[data-home-app="chat"]').click();
  mountHomeSurface(root, options);
  assert.equal(root.querySelectorAll("[data-home-recent]").length, 1);
  assert.deepEqual([...root.querySelectorAll(".dm-home-recent-card")].map(node => node.dataset.homeRecentApp), ["chat", "git"]);
  assert.equal(root.querySelector("[data-home-recent-section]").hidden, false);
  root.querySelector('[data-home-recent-app="git"]').click();
  assert.deepEqual(launched, ["git", "chat", "git"]);
  // Simulate tampered storage; bogus actions and markup must not be injected.
  dom.window.localStorage.setItem("devmoter-home-recent-apps-v1", JSON.stringify([
    { id: "<img src=x onerror=alert(1)>", openedAt: Date.now() },
    { id: "knowledge", openedAt: Date.now() },
    { id: "chat", openedAt: Date.now() }
  ]));
  mountHomeSurface(root, options);
  assert.deepEqual([...root.querySelectorAll(".dm-home-recent-card")].map(node => node.dataset.homeRecentApp), ["chat"]);
  assert.equal(root.querySelector("img"), null);
  dom.window.close();
});

test("health indicator only reports actual health response and tolerates unavailable endpoint", async () => {
  const { mountHomeSurface } = await loadHome();
  const dom = new JSDOM("<main id='home'></main>", { url: "https://devmoter.test/" });
  const root = dom.window.document.querySelector("#home");
  let calls = 0;
  dom.window.fetch = async () => {
    calls++;
    if (calls === 1) return {
      ok: true,
      json: async () => ({ backends: { opencode: { online: true }, codex: { online: false } } })
    };
    throw new Error("offline");
  };
  mountHomeSurface(root, { onLaunchApp: () => {}, onPreviewApp: () => {} });
  dom.window.dispatchEvent(new dom.window.CustomEvent("devmoter:surface-changed", { detail: { surface: "home" } }));
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(root.querySelector("[data-home-health]").dataset.state, "partial");
  assert.match(root.querySelector("[data-home-health-label]").textContent, /OpenCode ● \/ Codex ○/);
  dom.window.dispatchEvent(new dom.window.Event("online"));
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(root.querySelector("[data-home-health]").dataset.state, "unknown");
  assert.equal(calls, 2);
  dom.window.close();
});

test("Home uses bundled token CSS without neon effects, repeated card chrome or external frameworks", async () => {
  const [css, source] = await Promise.all([
    readFile(new URL("../src/home.css", import.meta.url), "utf8"),
    readFile(new URL("../src/home.ts", import.meta.url), "utf8")
  ]);
  const compiled = await transform(css, { loader: "css", target: ["chrome120", "safari17"], minify: true });
  assert.ok(compiled.code.length > 0);
  assert.match(css, /grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(css, /@media \(max-width: 640px\)/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(css, /focus-visible/);
  assert.match(css, /var\(--canvas-base\)/);
  assert.match(css, /var\(--space-1\)/);
  assert.match(css, /var\(--radius-small\)/);
  assert.match(css, /body\.devmoter-home-mode\s*\{[^}]*padding:\s*0;/s);
  assert.match(css, /\.dm-home-history-link\s*\{\s*min-height:\s*44px;/);
  assert.match(css, /\.dm-home-health\[data-state="offline"\]\s*\{\s*color:\s*var\(--status-error\);\s*\}/);
  assert.doesNotMatch(css, /radial-gradient|linear-gradient|box-shadow|backdrop-filter|#[0-9a-f]{3,8}/i);
  assert.ok(!/cdn\.tailwindcss|https?:\/\/|<script|Math\.random/.test(css + source));
  assert.match(source, /APP_REGISTRY/);
  assert.match(source, /onPreviewApp/);
  assert.match(source, /onLaunchApp/);
});
