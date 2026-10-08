import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { JSDOM } from "jsdom";

test("React Home pilot bundles, delegates navigation and unmounts its own root", async () => {
  const dom = new JSDOM("<main><div id='pilot'></div></main>", { url: "https://devmoter.test/", pretendToBeVisual: true });
  const original = {
    window: globalThis.window, document: globalThis.document,
    HTMLElement: globalThis.HTMLElement, Node: globalThis.Node,
    navigator: globalThis.navigator
  };
  Object.assign(globalThis, {
    window: dom.window, document: dom.window.document,
    HTMLElement: dom.window.HTMLElement, Node: dom.window.Node,
    navigator: dom.window.navigator
  });
  let dispose;
  try {
    const bundled = await build({
      entryPoints: [fileURLToPath(new URL("../src/react/home-backend-shortcuts.tsx", import.meta.url))],
      bundle: true, format: "esm", platform: "browser", write: false,
      outdir: "dist-test", logLevel: "silent"
    });
    const code = bundled.outputFiles.find(file => file.path.endsWith(".js"))?.text;
    assert.ok(code, "React entrypoint must bundle as browser ESM");
    const { mountHomeBackendShortcuts } = await import("data:text/javascript;base64," + Buffer.from(code).toString("base64"));
    const host = dom.window.document.getElementById("pilot");
    const changes = [];
    dispose = mountHomeBackendShortcuts(host, backend => changes.push(backend));
    for (let i = 0; i < 40 && !host.querySelector("[aria-label='Open Codex workspace']"); i++) {
      await new Promise(resolve => setTimeout(resolve, 15));
    }
    const buttons = host.querySelectorAll("button");
    assert.equal(buttons.length, 3, "show three supported backend choices");
    assert.equal(host.querySelector("nav")?.getAttribute("aria-label"), "Quick switch to an AI workspace");
    assert.equal(buttons[0].getAttribute("type"), "button");
    host.querySelector("[aria-label='Open Codex workspace']").click();
    host.querySelector("[aria-label='Open OpenCode workspace']").click();
    assert.deepEqual(changes, ["codex", "opencode"], "React must delegate and not bypass shell navigation");
    dispose();
    dispose = null;
    assert.equal(host.childElementCount, 0, "React must clean up its own DOM when unmounted");
  } finally {
    if (dispose) dispose();
    Object.assign(globalThis, original);
    dom.window.close();
  }
});

test("React pilot stays isolated from runtime approval, SSE and login code", async () => {
  const [tsx, home, main] = await Promise.all([
    readFile(new URL("../src/react/home-backend-shortcuts.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/home.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/main.ts", import.meta.url), "utf8")
  ]);
  assert.match(tsx, /createRoot\(host\)/);
  assert.match(tsx, /root\.unmount\(\)/);
  assert.match(home, /pilotDisposers\.get\(target\)\?\.\(\)/);
  assert.match(main, /onSwitchBackend: backend => setBackend\(backend\)/);
  assert.doesNotMatch(tsx, /\b(fetch|WebSocket|EventSource|localStorage|sessionStorage)\b/);
});
