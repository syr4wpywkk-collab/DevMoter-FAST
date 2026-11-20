import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";
import { build } from "esbuild";

const REPO_ROOT = new URL("../", import.meta.url);

async function bundleEntry(relPath, { qwenUiEnabled = null } = {}) {
  const plugins = [];
  if (qwenUiEnabled !== null) {
    const flagsPath = fileURLToPath(new URL("./src/feature-flags.mjs", REPO_ROOT));
    plugins.push({
      name: "override-qwen-flag",
      setup(api) {
        api.onLoad({ filter: /.*/ }, async args => {
          if (args.path !== flagsPath) return undefined;
          const raw = await readFile(args.path, "utf8");
          return {
            contents: raw.replace(
              /export const QWEN_UI_ENABLED = (?:false|true);/,
              `export const QWEN_UI_ENABLED = ${qwenUiEnabled ? "true" : "false"};`
            ),
            loader: "js"
          };
        });
      }
    });
  }
  const result = await build({
    entryPoints: [fileURLToPath(new URL(relPath, REPO_ROOT))],
    bundle: true,
    platform: "browser",
    format: "esm",
    write: false,
    outdir: "dist-test",
    loader: { ".css": "empty" },
    logLevel: "silent",
    plugins
  });
  const code = result.outputFiles.find(file => file.path.endsWith(".js")).text;
  return import("data:text/javascript;base64," + Buffer.from(code).toString("base64"));
}

test("shared QWEN_UI_ENABLED gate lives in src/feature-flags.mjs with owner documentation and helpers", async () => {
  const [source, flags] = await Promise.all([
    readFile(new URL("./src/feature-flags.mjs", REPO_ROOT), "utf8"),
    import("../src/feature-flags.mjs")
  ]);
  assert.equal(flags.QWEN_UI_ENABLED, false);
  assert.match(source, /2026-11-15/);
  assert.match(source, /QWEN_UI_ENABLED/);
  assert.deepEqual([...flags.VISIBLE_CHAT_BACKENDS], ["codex", "opencode", "api", "devin"]);
  assert.equal(flags.isVisibleChatBackend("qwen"), false);
  assert.equal(flags.isVisibleChatBackend("codex"), true);
  assert.equal(flags.normalizeVisibleBackend("qwen"), "opencode");
  assert.equal(flags.normalizeVisibleBackend("api"), "api");
  assert.equal(flags.normalizeVisibleSurface("qwen"), "opencode");
  assert.equal(flags.normalizeVisibleSurface("home"), "home");
  assert.equal(flags.isVisibleIntegration("qwen"), false);
  assert.equal(flags.isVisibleIntegration("claude"), true);
});

test("legacy app-shell fallback hides Qwen Code option and preserves persisted qwen value when falling back", async () => {
  const { mountUnifiedFeatureShell } = await bundleEntry("./src/app-shell.ts");
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
    dom.window.localStorage.setItem("opencode-pocket-backend", "qwen");
    const switched = [];
    mountUnifiedFeatureShell({
      initialSurface: "home",
      initialBackend: "qwen",
      switchBackend: backend => switched.push(backend),
      openHome() {}
    });

    const select = dom.window.document.querySelector("[data-fallback-backend]");
    assert.ok(select, "fallback AI picker renders when unifiedUI=0");
    assert.deepEqual([...select.querySelectorAll("option")].map(o => o.value), ["codex", "opencode", "api", "devin"]);
    assert.equal(select.value, "opencode");

    dom.window.dispatchEvent(new dom.window.CustomEvent("devmoter:launch-app", { detail: { id: "chat" } }));
    assert.deepEqual(switched, ["opencode"]);
    assert.equal(
      dom.window.localStorage.getItem("opencode-pocket-backend"),
      "qwen",
      "falling back must not delete or erase the stored qwen preference"
    );
  } finally {
    Object.assign(globalThis, prior);
    dom.window.close();
  }
});

test("src/main.ts consults the shared gate to fall back without deleting stored qwen preference", async () => {
  const mainSource = await readFile(new URL("./src/main.ts", REPO_ROOT), "utf8");
  assert.match(mainSource, /from "\.\/feature-flags\.mjs"/);
  assert.match(mainSource, /if \(isVisibleChatBackend\(deepLinkBackend\)\)/);
  assert.match(mainSource, /const preserveHiddenQwen = !QWEN_UI_ENABLED && localStorage\.getItem\("opencode-pocket-backend"\) === "qwen"/);
  assert.match(mainSource, /qwenView\.classList\.toggle\("hidden", !QWEN_UI_ENABLED \|\| resolved !== "qwen"\)/);
  assert.match(mainSource, /const qwenRemote = QWEN_UI_ENABLED\s*\?\s*mountQwenChat\(/);
});

test("all Qwen UI code and i18n dictionaries remain intact and flipping QWEN_UI_ENABLED restores Qwen UI", async () => {
  const [navModule, shellModule, integrationsModule, surfaceModule] = await Promise.all([
    bundleEntry("./src/unified-workspace-nav.ts", { qwenUiEnabled: true }),
    bundleEntry("./src/app-shell.ts", { qwenUiEnabled: true }),
    bundleEntry("./src/integrations.ts", { qwenUiEnabled: true }),
    bundleEntry("./src/surface-navigation.mjs", { qwenUiEnabled: true })
  ]);

  assert.equal(surfaceModule.isMainSurface("qwen"), true);
  assert.equal(surfaceModule.initialMainSurface("?surface=qwen"), "qwen");
  assert.equal(surfaceModule.initialMainSurface("?backend=qwen"), "qwen");
  assert.equal(surfaceModule.initialMainSurface("?session=s1", { savedBackend: "qwen" }), "qwen");

  const dom = new JSDOM("<!doctype html><div id='app'></div><div id='ix'></div>", { url: "https://devmoter.test/?unifiedUI=0" });
  const prior = {
    window: globalThis.window,
    document: globalThis.document,
    localStorage: globalThis.localStorage,
    CustomEvent: globalThis.CustomEvent,
    fetch: globalThis.fetch
  };
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    localStorage: dom.window.localStorage,
    CustomEvent: dom.window.CustomEvent,
    fetch: async path => {
      if (path === "/api/projects") return { ok: true, json: async () => ({ projects: [{ id: "p1", name: "P", path: "/p" }] }) };
      if (path === "/api/integrations/status") return { ok: true, json: async () => ({ integrations: [{ id: "qwen", name: "Qwen Code", installed: true }] }) };
      throw new Error("unexpected " + path);
    }
  });
  try {
    const nav = navModule.mountTaskFirstWorkspace({
      initialSurface: "qwen",
      initialBackend: "qwen",
      switchBackend() {},
      openHome() {}, openTasks() {}, openReview() {}, openTools() {}, openTerminal() {}
    });
    assert.ok(dom.window.document.querySelector('[data-workspace-backend] option[value="qwen"]'));
    nav.destroy();

    shellModule.mountUnifiedFeatureShell({
      initialSurface: "qwen",
      initialBackend: "qwen",
      switchBackend() {},
      openHome() {}
    });
    assert.ok(dom.window.document.querySelector('[data-fallback-backend] option[value="qwen"]'));

    const ixRoot = dom.window.document.getElementById("ix");
    await integrationsModule.mountIntegrations(ixRoot).refresh();
    assert.match(ixRoot.textContent, /Qwen Code/);
  } finally {
    Object.assign(globalThis, prior);
    dom.window.close();
  }
});
