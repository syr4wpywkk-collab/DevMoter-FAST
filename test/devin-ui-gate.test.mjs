import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";
import { build } from "esbuild";
import {
  DEVIN_UI_ENABLED,
  DEEPSEEK_UI_ENABLED,
  VISIBLE_CHAT_BACKENDS,
  isVisibleChatBackend,
  isHiddenDevinTarget,
  isHiddenDeepseekTarget,
  normalizeVisibleBackend,
  normalizeVisibleSurface
} from "../src/feature-flags.mjs";
import { initialMainSurface, isMainSurface } from "../src/surface-navigation.mjs";

const ROOT = new URL("../", import.meta.url);

async function bundleWithDevinEnabled(relPath) {
  const flagsPath = fileURLToPath(new URL("./src/feature-flags.mjs", ROOT));
  const result = await build({
    entryPoints: [fileURLToPath(new URL(relPath, ROOT))],
    bundle: true,
    platform: "browser",
    format: "esm",
    write: false,
    outdir: "dist-test",
    loader: { ".css": "empty" },
    logLevel: "silent",
    plugins: [{
      name: "restore-devin-ui",
      setup(api) {
        api.onLoad({ filter: /.*/ }, async args => {
          if (args.path !== flagsPath) return undefined;
          const raw = await readFile(args.path, "utf8");
          assert.match(raw, /export const DEVIN_UI_ENABLED = false;/);
          return { contents: raw.replace(
            "export const DEVIN_UI_ENABLED = false;",
            "export const DEVIN_UI_ENABLED = true;"
          ), loader: "js" };
        });
      }
    }]
  });
  const js = result.outputFiles.find(file => file.path.endsWith(".js")).text;
  return import("data:text/javascript;base64," + Buffer.from(js).toString("base64"));
}

test("Devin and DeepSeek are absent from all shared backend choices", () => {
  assert.equal(DEVIN_UI_ENABLED, false);
  assert.equal(DEEPSEEK_UI_ENABLED, false);
  assert.deepEqual([...VISIBLE_CHAT_BACKENDS], ["codex", "opencode", "api"]);
  for (const backend of ["devin", "deepseek"]) {
    assert.equal(isVisibleChatBackend(backend), false);
    assert.equal(normalizeVisibleBackend(backend), "opencode");
    assert.equal(normalizeVisibleSurface(backend), "opencode");
    assert.equal(isMainSurface(backend), false);
    assert.equal(initialMainSurface("?surface=" + backend), "opencode");
    assert.equal(initialMainSurface("?backend=" + backend), "opencode");
    assert.equal(initialMainSurface("?session=old", { savedBackend: backend }), "opencode");
  }
  assert.equal(isHiddenDevinTarget("devin"), true);
  assert.equal(isHiddenDeepseekTarget("deepseek"), true);
  assert.equal(normalizeVisibleSurface("home"), "home");
  assert.equal(normalizeVisibleSurface("integrations"), "integrations");
});

test("backend source remains intact, and enabling one flag restores only Devin", async () => {
  const [main, flags, source, restoredNavigation] = await Promise.all([
    readFile(new URL("./src/main.ts", ROOT), "utf8"),
    readFile(new URL("./src/feature-flags.mjs", ROOT), "utf8"),
    readFile(new URL("./src/unified-workspace-nav.ts", ROOT), "utf8"),
    bundleWithDevinEnabled("./src/surface-navigation.mjs")
  ]);
  assert.match(flags, /Set DEVIN_UI_ENABLED to true/);
  assert.match(main, /mountDevinChat/);
  assert.match(main, /const preserveHiddenDevin = !DEVIN_UI_ENABLED/);
  assert.match(main, /devinView.classList.toggle\("hidden", !DEVIN_UI_ENABLED/);
  assert.match(source, /DEVIN_UI_ENABLED \? '<option value="devin">Devin<\/option>'/);
  assert.equal(restoredNavigation.isMainSurface("devin"), true);
  assert.equal(restoredNavigation.initialMainSurface("?surface=devin"), "devin");
  assert.equal(restoredNavigation.initialMainSurface("?backend=devin"), "devin");
  assert.equal(restoredNavigation.isMainSurface("deepseek"), false);
});

test("re-enabled Devin appears in unified and legacy backend selectors", async () => {
  const [navModule, shellModule] = await Promise.all([
    bundleWithDevinEnabled("./src/unified-workspace-nav.ts"),
    bundleWithDevinEnabled("./src/app-shell.ts")
  ]);
  const dom = new JSDOM("<!doctype html><div id='app'></div>", { url: "https://devmoter.test/?unifiedUI=0" });
  const prior = {
    window: globalThis.window,
    document: globalThis.document,
    localStorage: globalThis.localStorage,
    CustomEvent: globalThis.CustomEvent
  };
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    localStorage: dom.window.localStorage,
    CustomEvent: dom.window.CustomEvent
  });
  try {
    const nav = navModule.mountTaskFirstWorkspace({
      initialSurface: "devin", initialBackend: "devin", switchBackend() {},
      openHome() {}, openTasks() {}, openReview() {}, openTools() {}, openTerminal() {}
    });
    const selector = dom.window.document.querySelector("[data-workspace-backend]");
    assert.ok(selector.querySelector('option[value="devin"]'));
    assert.equal(selector.querySelector('option[value="deepseek"]'), null);
    nav.destroy();

    shellModule.mountUnifiedFeatureShell({
      initialSurface: "devin", initialBackend: "devin", switchBackend() {}, openHome() {}
    });
    const fallback = dom.window.document.querySelector("[data-fallback-backend]");
    assert.ok(fallback.querySelector('option[value="devin"]'));
    assert.equal(fallback.querySelector('option[value="deepseek"]'), null);
  } finally {
    Object.assign(globalThis, prior);
    dom.window.close();
  }
});
