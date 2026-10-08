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

test("Continue working opens Chat using the same allowlisted launch callback", async () => {
  const { mountHomeSurface } = await loadHome();
  const dom = new JSDOM("<main id='home'></main>");
  const root = dom.window.document.querySelector("#home");
  const launches = [];
  const previews = [];
  mountHomeSurface(root, {
    onLaunchApp: id => launches.push(id),
    onPreviewApp: (id, message) => previews.push({ id, message })
  });

  const continueButton = root.querySelector("[data-home-open-chat]");
  assert.ok(continueButton);
  assert.equal(continueButton.getAttribute("type"), "button");
  assert.match(continueButton.getAttribute("aria-label"), /chat workspace/i);
  continueButton.click();
  assert.deepEqual(launches, ["chat"], "Continue must use the same app registry launch path");

  root.querySelector('[data-home-app="chat"]').click();
  assert.deepEqual(launches, ["chat", "chat"]);
  assert.deepEqual(previews, []);
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
