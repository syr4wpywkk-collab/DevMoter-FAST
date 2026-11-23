import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { once } from "node:events";
import { existsSync, readdirSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import { build } from "esbuild";
import { chromium } from "playwright";
import { createBrowserSessionManager } from "../server/browser-session.mjs";
import { handleBrowserApiRequest } from "../server/browser-api.mjs";
import { createBrowserSocketTickets, installBrowserWebSocketEndpoint } from "../server/browser-websocket.mjs";
import { readListenerIdentity } from "../server/listener-identity.mjs";

// Real-browser check of the remote browser tab: a phone-sized Chromium page
// drives the host Chromium through the real HTTP API and ticketed WebSocket.
// Skipped when no Chromium binary is available.
const repo = path.resolve(import.meta.dirname, "..");

function findChromium() {
  const managed = "/opt/.devin/chrome/chrome";
  const candidates = [process.env.DEVMOTER_TEST_CHROMIUM_BIN];
  if (existsSync(managed)) {
    for (const dir of readdirSync(managed).sort().reverse()) candidates.push(path.join(managed, dir, "chrome-linux64/chrome"));
  }
  candidates.push("chromium", "chromium-browser", "google-chrome-stable");
  for (const candidate of candidates.filter(Boolean)) {
    try {
      if (spawnSync(candidate, ["--version"], { encoding: "utf8", timeout: 5000 }).status === 0) return candidate;
    } catch { /* try next */ }
  }
  return null;
}

const chromiumBin = findChromium();

async function listen(handler) {
  const server = createServer(handler);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return { server, port: server.address().port };
}

async function waitFor(check, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    last = await check();
    if (last) return last;
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  throw new Error("Timed out; last value: " + String(last).slice(0, 200));
}

const previewPage = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{margin:0;font:16px sans-serif;height:3000px}#name{position:absolute;left:20px;top:80px;width:300px;height:40px;font-size:16px}</style></head>
<body><p id="marker">remote-browser-ok</p>
<input id="name" oninput="document.getElementById('echo').textContent = this.value">
<p id="echo" style="position:absolute;top:140px"></p>
<p id="scroll" style="position:fixed;bottom:0">0</p>
<script>addEventListener('scroll', () => { document.getElementById('scroll').textContent = String(Math.round(scrollY)); });</script>
</body></html>`;

async function bundleApp(dir) {
  const entry = path.join(dir, "entry.ts");
  await writeFile(entry, `import { openRemoteBrowser } from ${JSON.stringify(path.join(repo, "src/remote-browser.ts"))};
import ${JSON.stringify(path.join(repo, "src/styles/base.css"))};
openRemoteBrowser();`);
  await build({ entryPoints: [entry], bundle: true, format: "esm", outdir: dir, entryNames: "app", logLevel: "silent" });
  return {
    js: await readFile(path.join(dir, "app.js")),
    css: await readFile(path.join(dir, "app.css"))
  };
}

test("phone UI streams the host browser, taps, scrolls, commits IME text and takes back control", { skip: chromiumBin ? false : "no Chromium binary available", timeout: 120000 }, async t => {
  // Register each cleanup as soon as its resource exists so a failed step
  // never leaves a listening server keeping the test process alive.
  const cleanups = [];
  t.after(async () => {
    for (const cleanup of cleanups.reverse()) await Promise.resolve().then(cleanup).catch(() => {});
  });
  let browser;
  try {
    browser = await chromium.launch({ executablePath: chromiumBin, headless: true, timeout: 30000 });
  } catch (error) {
    if (process.env.DEVMOTER_TEST_CHROMIUM_REQUIRED === "1") throw error;
    t.skip("Chromium could not be launched: " + String(error?.message || error).split("\n")[0]);
    return;
  }
  cleanups.push(() => browser.close());
  const preview = await listen((req, res) => {
    res.setHeader("content-type", "text/html; charset=utf-8");
    res.end(previewPage);
  });
  cleanups.push(() => preview.server.close());
  const dir = await mkdtemp(path.join(os.tmpdir(), "devmoter-remote-browser-ui-"));
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "devmoter-remote-browser-ui-project-"));
  cleanups.push(() => rm(dir, { recursive: true, force: true }), () => rm(projectDir, { recursive: true, force: true }));
  const manager = createBrowserSessionManager({
    configDir: dir,
    resolveProject: async id => ({ id, path: projectDir, name: id }),
    getPreview: () => ({ projectId: "real", host: "127.0.0.1", port: preview.port, token: "t", listener: readListenerIdentity("127.0.0.1", preview.port) }),
    env: {
      ...process.env,
      DEVMOTER_BROWSER_AUTOMATION: "1",
      DEVMOTER_BROWSER_BIN: chromiumBin,
      DEVMOTER_SANDBOX: process.env.DEVMOTER_TEST_SANDBOX || "preferred"
    },
    limits: { sweepMs: 0 }
  });
  cleanups.push(() => manager.stopAll());
  const assets = await bundleApp(dir);
  const tickets = createBrowserSocketTickets();
  const app = await listen(async (req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    if (await handleBrowserApiRequest(req, res, url, manager, { tickets, authenticateDevice: async () => ({ id: "phone" }) })) return;
    if (url.pathname === "/app.js") return res.writeHead(200, { "content-type": "text/javascript" }).end(assets.js);
    if (url.pathname === "/app.css") return res.writeHead(200, { "content-type": "text/css" }).end(assets.css);
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(
      `<!doctype html><html lang="ja"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"></head><body><script type="module" src="/app.js"></script></body></html>`
    );
  });
  cleanups.push(() => { app.server.closeAllConnections?.(); app.server.close(); });
  const origin = "http://127.0.0.1:" + app.port;
  const sockets = installBrowserWebSocketEndpoint(app.server, manager, tickets, { publicOrigin: origin });
  cleanups.push(() => sockets?.close?.());

  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await context.addInitScript(() => {
    localStorage.setItem("opencode-pocket-project", "real");
    localStorage.setItem("devmoter-language", "ja");
  });
  const page = await context.newPage();
  await page.goto(origin + "/");
  const start = page.locator("[data-rb-start]");
  await start.waitFor({ state: "visible" });
  await start.click();
  try {
    await page.locator("[data-rb-canvas]").waitFor({ state: "visible", timeout: 20000 });
  } catch (error) {
    const statusText = await page.locator("[data-rb-status]").textContent();
    if (process.env.DEVMOTER_TEST_CHROMIUM_REQUIRED !== "1" && /browser_start_failed|sandbox|bubblewrap|起動できません/i.test(statusText || "")) {
      t.skip("Chromium could not start in this sandbox: " + statusText);
      return;
    }
    throw new Error("Remote browser did not start: " + statusText, { cause: error });
  }
  const [session] = [manager.status("real").session];
  const dom = () => manager.act(session.id, { type: "dom" }).then(result => result.content);
  await waitFor(async () => (await dom()).includes("remote-browser-ok"));
  assert.equal(await page.locator("[data-rb-driver]").textContent(), "あなたが操作中");
  await waitFor(() => page.locator("[data-rb-canvas]").evaluate(canvas => canvas.width > 0));

  const box = await page.locator("[data-rb-canvas]").boundingBox();
  const viewport = manager.get(session.id).viewport;
  const toPage = (x, y) => ({ x: box.x + (x / viewport.width) * box.width, y: box.y + (y / viewport.height) * box.height });
  const input = toPage(120, 100);
  await page.touchscreen.tap(input.x, input.y);
  await waitFor(async () => (await dom()).includes('id="name"') && manager.get(session.id).active);

  await page.locator("[data-rb-keyboard]").click();
  await page.locator("[data-rb-ime]").evaluate(element => element.focus());
  const cdp = await context.newCDPSession(page);
  await cdp.send("Input.imeSetComposition", { text: "にほんご", selectionStart: 4, selectionEnd: 4 });
  await cdp.send("Input.imeSetComposition", { text: "日本語", selectionStart: 3, selectionEnd: 3 });
  await cdp.send("Input.insertText", { text: "日本語" });
  await waitFor(async () => (await dom()).includes('<p id="echo" style="position:absolute;top:140px">日本語</p>'));
  assert.equal((await dom()).includes("にほんご"), false, "uncommitted composition never reaches the host page");
  await page.keyboard.press("Backspace");
  await waitFor(async () => (await dom()).includes('top:140px">日本</p>'));

  await page.locator("[data-rb-ime]").evaluate(element => element.blur());
  const from = toPage(200, 600);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let step = 1; step <= 8; step++) await page.mouse.move(from.x, from.y - step * 30);
  await page.mouse.up();
  await waitFor(async () => {
    const match = (await dom()).match(/<p id="scroll"[^>]*>(\d+)<\/p>/);
    return match && Number(match[1]) > 100;
  });

  assert.throws(() => manager.acquireDriver(session.id, { holder: "agent" }), error => error.code === "driver_busy", "the user keeps control until handing over");
  await page.locator("[data-rb-release]").click();
  await waitFor(async () => (await page.locator("[data-rb-driver]").textContent()) === "操作中の人はいません");
  const agent = manager.acquireDriver(session.id, { holder: "agent" });
  await waitFor(async () => (await page.locator("[data-rb-driver]").textContent()) === "エージェントが操作中");
  await assert.rejects(
    () => manager.act(session.id, { type: "reload" }, { holder: "user", generation: agent.generation - 1, deviceId: "phone" }),
    error => error.code === "driver_stale"
  );
  const takeover = page.locator("[data-rb-takeover]");
  assert.equal(await takeover.textContent(), "操作を取り戻す");
  await takeover.click();
  await waitFor(async () => (await page.locator("[data-rb-driver]").textContent()) === "あなたが操作中");
  assert.equal(manager.get(session.id).driver.holder, "user");
  await assert.rejects(
    () => manager.act(session.id, { type: "reload" }, { holder: "agent", generation: agent.generation }),
    error => error.code === "driver_stale",
    "the agent's old generation is rejected after takeover"
  );

  await page.locator("[data-rb-stop]").click();
  await start.waitFor({ state: "visible" });
  assert.equal(manager.status("real").session, null);
});
