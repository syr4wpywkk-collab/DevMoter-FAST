import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { once } from "node:events";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createBrowserSessionManager } from "../server/browser-session.mjs";

// Real Chromium check. Runs when DEVMOTER_TEST_CHROMIUM_BIN (or a chromium on
// PATH) is available; skipped otherwise so CI without a browser stays green.
function findChromium() {
  for (const candidate of [process.env.DEVMOTER_TEST_CHROMIUM_BIN, "chromium", "chromium-browser", "google-chrome-stable"].filter(Boolean)) {
    try {
      if (spawnSync(candidate, ["--version"], { encoding: "utf8", timeout: 5000 }).status === 0) return candidate;
    } catch { /* try next */ }
  }
  return null;
}

const chromium = findChromium();

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
  throw new Error("Timed out waiting for Chromium state");
}

test("real Chromium stays inside the approved preview", { skip: chromium ? false : "no Chromium binary available" }, async t => {
  const forbiddenHits = [];
  const forbidden = await listen((req, res) => { forbiddenHits.push(req.url); res.end("forbidden"); });
  forbidden.server.on("upgrade", req => forbiddenHits.push("ws:" + req.url));
  const leak = "http://127.0.0.1:" + forbidden.port;
  const page = `<!doctype html><html><head><title>preview</title></head><body>
<p id="marker">remote-browser-ok</p>
<input id="name" oninput="document.getElementById('echo').textContent = this.value">
<p id="echo"></p>
<button id="escape" onclick="location.href='file:///etc/passwd'">escape</button>
<button id="dataurl" onclick="location.href='data:text/html,<p>data-escape</p>'">data</button>
<button id="popup" onclick="window.open('${leak}/popup')">popup</button>
<img src="${leak}/img.png">
<script>
fetch('${leak}/fetch').catch(() => {});
try { new WebSocket('ws://127.0.0.1:${forbidden.port}/ws'); } catch {}
fetch('https://example.com/').catch(() => {});
</script></body></html>`;
  const preview = await listen((req, res) => {
    res.setHeader("content-type", "text/html; charset=utf-8");
    res.end(req.url === "/next" ? "<title>next</title><p id=marker>next-page</p>" : page);
  });
  const configDir = await mkdtemp(join(tmpdir(), "devmoter-remote-browser-real-"));
  const projectDir = await mkdtemp(join(tmpdir(), "devmoter-remote-browser-project-"));
  const manager = createBrowserSessionManager({
    configDir,
    resolveProject: async id => ({ id, path: projectDir, name: id }),
    getPreview: () => ({ projectId: "real", host: "127.0.0.1", port: preview.port, token: "t" }),
    env: {
      ...process.env,
      DEVMOTER_BROWSER_AUTOMATION: "1",
      DEVMOTER_BROWSER_BIN: chromium,
      DEVMOTER_SANDBOX: process.env.DEVMOTER_TEST_SANDBOX || "preferred"
    },
    limits: { sweepMs: 0 }
  });
  t.after(async () => {
    await manager.stopAll();
    preview.server.close();
    forbidden.server.close();
    await rm(configDir, { recursive: true, force: true });
    await rm(projectDir, { recursive: true, force: true });
  });

  let session;
  try {
    ({ session } = await manager.start("real", { deviceId: "dev", viewport: { width: 390, height: 700 } }));
  } catch (error) {
    // Hosts without unprivileged user namespaces (e.g. AppArmor-restricted CI
    // runners) cannot run bwrap+Chromium; the manager fails closed there.
    if (process.env.DEVMOTER_TEST_CHROMIUM_REQUIRED !== "1" && ["browser_start_failed", "sandbox_required"].includes(error?.code)) {
      t.skip("Chromium could not start in this sandbox: " + error.message.slice(0, 160));
      return;
    }
    throw error;
  }
  const dom = () => manager.act(session.id, { type: "dom" }).then(result => result.content);
  await waitFor(async () => (await dom()).includes("remote-browser-ok"));
  t.diagnostic("sandboxed=" + session.sandboxed);

  const shot = await manager.act(session.id, { type: "screenshot", quality: 50 });
  assert.equal(shot.data[0], 0xff);
  assert.equal(shot.data[1], 0xd8);

  const opts = { generation: 1, deviceId: "dev" };
  await manager.act(session.id, { type: "click", selector: "#name" }, opts);
  await manager.act(session.id, { type: "type", text: "日本語入力" }, opts);
  await waitFor(async () => (await dom()).includes('<p id="echo">日本語入力</p>'));

  await assert.rejects(() => manager.act(session.id, { type: "navigate", url: leak + "/" }, opts), error => error.code === "navigation_blocked");
  await assert.rejects(() => manager.act(session.id, { type: "navigate", url: "file:///etc/passwd" }, opts), error => error.code === "navigation_blocked");

  await manager.act(session.id, { type: "click", selector: "#escape" }, opts);
  await manager.act(session.id, { type: "click", selector: "#dataurl" }, opts);
  await manager.act(session.id, { type: "click", selector: "#popup" }, opts);
  await new Promise(resolve => setTimeout(resolve, 1000));
  const afterEscape = await dom();
  assert.equal(afterEscape.includes("root:"), false);
  assert.ok(afterEscape.includes("remote-browser-ok"), "data: and file: escapes must stay on the preview page");
  assert.equal(manager.get(session.id).browser.version.length > 0, true);
  assert.ok(manager.get(session.id).active);
  assert.ok(String(manager.get(session.id).url).startsWith("http://127.0.0.1:" + preview.port));

  await manager.act(session.id, { type: "navigate", url: "/next" }, opts);
  await waitFor(async () => (await dom()).includes("next-page"));
  await manager.act(session.id, { type: "back" }, opts);
  await waitFor(async () => (await dom()).includes("remote-browser-ok"));

  assert.deepEqual(forbiddenHits, []);
  assert.ok(manager.get(session.id).blockedRequests >= 1);

  const profile = (await import("node:fs")).readdirSync(join(configDir, "browser-profiles")).map(name => join(configDir, "browser-profiles", name));
  assert.equal(profile.length, 1);
  await manager.stop(session.id);
  assert.equal(existsSync(profile[0]), false);
});
