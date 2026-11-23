import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough, Readable } from "node:stream";
import { existsSync, statSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createBrowserSessionManager,
  createPreviewNavigationPolicy,
  normalizeBrowserAction,
  remoteBrowserArgs
} from "../server/browser-session.mjs";
import { handleBrowserApiRequest } from "../server/browser-api.mjs";

function probe(command) {
  if (command === "chromium") return { status: 0, stdout: "Chromium 140.0" };
  if (command === "bwrap") return { status: 0, stdout: "bubblewrap 0.10.0" };
  return { status: 127, stdout: "" };
}

function fakeChrome({ history, results: extraResults } = {}) {
  const toBrowser = new PassThrough();
  const fromBrowser = new PassThrough();
  const child = new EventEmitter();
  child.stdio = [null, null, null, toBrowser, fromBrowser];
  child.killed = false;
  child.kill = () => {
    if (!child.killed) {
      child.killed = true;
      fromBrowser.end();
      queueMicrotask(() => child.emit("exit", 0));
    }
    return true;
  };
  child.calls = [];
  child.emitEvent = (method, params, sessionId = "S1") => fromBrowser.write(JSON.stringify({ method, params, sessionId }) + "\0");
  const nav = history || { currentIndex: 0, entries: [{ id: 1, url: "http://127.0.0.1:3000/" }] };
  const results = {
    "Target.createTarget": () => ({ targetId: "T1" }),
    "Target.getTargets": () => ({ targetInfos: [{ targetId: "T0", type: "page", url: "about:blank" }, { targetId: "T1", type: "page", url: "about:blank" }] }),
    "Target.attachToTarget": () => ({ sessionId: "S1" }),
    "Page.navigate": () => ({ frameId: "F1" }),
    "Page.getNavigationHistory": () => nav,
    "Page.captureScreenshot": () => ({ data: Buffer.from("jpeg-bytes").toString("base64") }),
    "DOM.getDocument": () => ({ root: { nodeId: 1 } }),
    "DOM.querySelector": params => ({ nodeId: params.selector === "#go" ? 7 : 0 }),
    "DOM.getBoxModel": () => ({ model: { content: [10, 20, 30, 20, 30, 40, 10, 40] } }),
    "DOM.getOuterHTML": () => ({ outerHTML: "<html><body>" + "a".repeat(5000) + "</body></html>" }),
    ...extraResults
  };
  let buffer = "";
  toBrowser.on("data", chunk => {
    buffer += chunk.toString("utf8");
    let index;
    while ((index = buffer.indexOf("\0")) !== -1) {
      const message = JSON.parse(buffer.slice(0, index));
      buffer = buffer.slice(index + 1);
      child.calls.push(message);
      const result = results[message.method]?.(message.params || {}) || {};
      fromBrowser.write(JSON.stringify({ id: message.id, result }) + "\0");
      if (message.method === "Browser.close") child.kill();
    }
  });
  return child;
}

async function setup(t, overrides = {}) {
  const configDir = await mkdtemp(join(tmpdir(), "devmoter-remote-browser-"));
  t.after(() => rm(configDir, { recursive: true, force: true }));
  const previews = new Map([
    ["p1", { projectId: "p1", host: "127.0.0.1", port: 3000, token: "tok1" }],
    ["p2", { projectId: "p2", host: "127.0.0.1", port: 3001, token: "tok2" }],
    ["p3", { projectId: "p3", host: "127.0.0.1", port: 3002, token: "tok3" }]
  ]);
  const spawns = [];
  let clock = 1_000_000;
  const removed = new Set();
  const manager = createBrowserSessionManager({
    configDir,
    resolveProject: async id => {
      if (removed.has(id)) throw Object.assign(new Error("Unknown project"), { statusCode: 404 });
      return { id, path: "/tmp/devmoter-project", name: id };
    },
    getPreview: id => previews.get(id) || null,
    env: { DEVMOTER_BROWSER_AUTOMATION: "1", DEVMOTER_SANDBOX: "required", PATH: "", OPENAI_API_KEY: "sk-secret", LC_ALL: "ja_JP.UTF-8" },
    spawnImpl: (command, args, options) => {
      const child = fakeChrome(overrides.chrome);
      spawns.push({ command, args, options, child });
      return child;
    },
    spawnSyncImpl: probe,
    now: () => clock,
    limits: { sweepMs: 0, commandTimeoutMs: 500, ...overrides.limits }
  });
  t.after(() => manager.stopAll());
  return { manager, spawns, previews, configDir, removed, advance: ms => { clock += ms; } };
}

test("navigation policy only admits the approved preview origin", () => {
  const policy = createPreviewNavigationPolicy({ host: "127.0.0.1", port: 3000 });
  assert.equal(policy.origin, "http://127.0.0.1:3000");
  assert.equal(policy.resolveNavigation("/docs?q=1"), "http://127.0.0.1:3000/docs?q=1");
  assert.equal(policy.allows("ws://127.0.0.1:3000/hmr"), true);
  for (const blocked of [
    "file:///etc/passwd", "chrome://settings", "devtools://devtools/bundled/inspector.html",
    "view-source:http://127.0.0.1:3000/", "javascript:alert(1)", "data:text/html,hi",
    "http://127.0.0.1:3001/", "http://localhost:3000/", "https://example.com/",
    "http://user:pw@127.0.0.1:3000/", "//example.com/"
  ]) {
    assert.throws(() => policy.resolveNavigation(blocked), error => error.statusCode === 403 || error.statusCode === 400, blocked);
  }
  assert.equal(policy.allows("http://127.0.0.1:4173/"), false);
  assert.equal(policy.allows("http://127.0.0.1:3000.evil.test/"), false);
  assert.throws(() => policy.resolveNavigation("/a\nb"), /invalid/i);
  assert.throws(() => createPreviewNavigationPolicy({ host: "10.0.0.2", port: 3000 }), /loopback live preview/i);
  assert.throws(() => createPreviewNavigationPolicy(null), /live preview/i);
});

test("Chromium flags use a private CDP pipe and a dead proxy for everything but the preview", () => {
  const policy = createPreviewNavigationPolicy({ host: "127.0.0.1", port: 3000 });
  const args = remoteBrowserArgs("/tmp/profile", policy);
  assert.ok(args.includes("--remote-debugging-pipe"));
  assert.ok(!args.some(arg => arg.startsWith("--remote-debugging-port")));
  assert.ok(args.includes("--proxy-server=http://127.0.0.1:1"));
  assert.ok(args.includes("--proxy-bypass-list=<-loopback>;127.0.0.1:3000"));
  assert.ok(args.includes("--user-data-dir=/tmp/profile"));
});

test("actions are validated against a fixed schema", () => {
  assert.deepEqual(normalizeBrowserAction({ type: "click", x: "5", y: 6, extra: "ignored" }), { type: "click", x: 5, y: 6 });
  assert.deepEqual(normalizeBrowserAction({ type: "scroll", dy: 99999 }), { type: "scroll", dx: 0, dy: 10000 });
  assert.deepEqual(normalizeBrowserAction({ type: "screenshot", quality: 500 }), { type: "screenshot", format: "jpeg", quality: 90 });
  for (const bad of [
    null, [], { type: "evaluate", expression: "1" }, { type: "Runtime.evaluate" }, { type: "click", x: "a", y: 1 },
    { type: "click", x: true, y: 1 }, { type: "type", text: "" }, { type: "press", key: "F12" }, { type: "navigate" }
  ]) {
    assert.throws(() => normalizeBrowserAction(bad), error => error.statusCode === 400, JSON.stringify(bad));
  }
  assert.throws(() => normalizeBrowserAction({ type: "type", text: "x".repeat(2001) }), error => error.statusCode === 413);
});

test("session start is opt-in, preview-scoped and sandbox fail-closed", async t => {
  const { manager } = await setup(t);
  await assert.rejects(() => manager.start("missing"), error => error.code === "preview_required");

  const disabledDir = await mkdtemp(join(tmpdir(), "devmoter-remote-browser-off-"));
  t.after(() => rm(disabledDir, { recursive: true, force: true }));
  const disabled = createBrowserSessionManager({
    configDir: disabledDir,
    resolveProject: async id => ({ id, path: "/tmp/p" }),
    getPreview: () => ({ host: "127.0.0.1", port: 3000 }),
    env: {},
    spawnSyncImpl: probe
  });
  await assert.rejects(() => disabled.start("p1"), error => error.code === "browser_disabled");

  const noBwrap = createBrowserSessionManager({
    configDir: disabledDir,
    resolveProject: async id => ({ id, path: "/tmp/p" }),
    getPreview: () => ({ host: "127.0.0.1", port: 3000 }),
    env: { DEVMOTER_BROWSER_AUTOMATION: "1", DEVMOTER_SANDBOX: "required" },
    spawnImpl: () => { throw new Error("must not spawn"); },
    spawnSyncImpl: command => command === "chromium" ? { status: 0, stdout: "Chromium" } : { status: 127 }
  });
  await assert.rejects(() => noBwrap.start("p1"), error => error.code === "sandbox_required");

  for (const mode of ["off", "preferred"]) {
    const unsandboxed = createBrowserSessionManager({
      configDir: disabledDir,
      resolveProject: async id => ({ id, path: "/tmp/p" }),
      getPreview: () => ({ host: "127.0.0.1", port: 3000 }),
      env: { DEVMOTER_BROWSER_AUTOMATION: "1", DEVMOTER_SANDBOX: mode },
      spawnImpl: () => { throw new Error("must not spawn"); },
      spawnSyncImpl: mode === "off" ? probe : command => command === "chromium" ? { status: 0, stdout: "Chromium" } : { status: 127 }
    });
    await assert.rejects(() => unsandboxed.start("p1"), error => error.code === "sandbox_required", mode);
  }
});

test("session start configures CDP isolation and cleans its 0700 profile on stop", async t => {
  const { manager, spawns } = await setup(t);
  const { session } = await manager.start("p1", { deviceId: "dev-a", viewport: { width: 400, height: 800 } });
  assert.equal(session.active, true);
  assert.equal(session.sandboxed, true);
  assert.equal(session.transport, "cdp-pipe");
  assert.deepEqual(session.driver, { holder: "user", generation: 1 });
  assert.equal(session.viewport.width, 400);
  const { command, args, options, child } = spawns[0];
  assert.equal(command, "bwrap");
  assert.ok(args.includes("--remote-debugging-pipe"));
  assert.deepEqual(options.stdio, ["ignore", "ignore", "ignore", "pipe", "pipe"]);
  const profileDir = args.find(arg => arg.startsWith("--user-data-dir=")).slice("--user-data-dir=".length);
  assert.equal(statSync(profileDir).mode & 0o777, 0o700);
  const methods = child.calls.map(call => call.method);
  for (const method of ["Browser.setDownloadBehavior", "Fetch.enable", "Emulation.setDeviceMetricsOverride", "Browser.setPermission", "Page.navigate"]) {
    assert.ok(methods.includes(method), method);
  }
  assert.equal(child.calls.find(call => call.method === "Browser.setDownloadBehavior").params.behavior, "deny");
  assert.equal(child.calls.find(call => call.method === "Page.navigate").params.url, "http://127.0.0.1:3000/");

  const stopped = await manager.stop(session.id);
  assert.equal(stopped.session.active, false);
  assert.equal(existsSync(profileDir), false);
  assert.equal(manager.status("p1").session, null);
  await assert.rejects(() => manager.act(session.id, { type: "reload" }, { generation: 1 }), error => error.statusCode === 404);
});

test("CDP Fetch interception fails requests outside the preview and closes popups", async t => {
  const { manager, spawns } = await setup(t);
  const { session } = await manager.start("p1");
  const { child } = spawns[0];
  child.emitEvent("Fetch.requestPaused", { requestId: "r1", request: { url: "http://127.0.0.1:3000/app.js" } });
  child.emitEvent("Fetch.requestPaused", { requestId: "r2", request: { url: "file:///etc/passwd" } });
  child.emitEvent("Fetch.requestPaused", { requestId: "r3", request: { url: "http://127.0.0.1:8787/api/projects" } });
  child.emitEvent("Target.targetCreated", { targetInfo: { targetId: "T2", type: "page", url: "https://example.com" } }, undefined);
  await new Promise(resolve => setTimeout(resolve, 20));
  const byMethod = method => child.calls.filter(call => call.method === method).map(call => call.params);
  assert.deepEqual(byMethod("Fetch.continueRequest"), [{ requestId: "r1" }]);
  assert.deepEqual(byMethod("Fetch.failRequest"), [
    { requestId: "r2", errorReason: "BlockedByClient" },
    { requestId: "r3", errorReason: "BlockedByClient" }
  ]);
  assert.deepEqual(byMethod("Target.closeTarget"), [{ targetId: "T0" }, { targetId: "T2" }]);
  assert.equal(manager.get(session.id).blockedRequests, 2);

  const navigations = () => child.calls.filter(call => call.method === "Page.navigate").length;
  const before = navigations();
  child.emitEvent("Page.frameRequestedNavigation", { frameId: "F1", url: "data:text/html,<h1>x</h1>" });
  child.emitEvent("Page.frameNavigated", { frame: { id: "F1", url: "blob:http://evil.test/1" } });
  child.emitEvent("Page.frameNavigated", { frame: { id: "F1", url: "http://127.0.0.1:3000/ok" } });
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(child.calls.filter(call => call.method === "Page.stopLoading").length, 1);
  assert.equal(navigations(), before + 1);
  assert.equal(manager.get(session.id).url, "http://127.0.0.1:3000/ok");
  assert.equal(manager.get(session.id).blockedRequests, 4);
});

test("driver generation rejects stale operations after takeover", async t => {
  const { manager } = await setup(t);
  const { session } = await manager.start("p1", { deviceId: "dev-a" });
  const ok = await manager.act(session.id, { type: "type", text: "secret" }, { generation: 1, deviceId: "dev-a" });
  assert.equal(ok.ok, true);
  assert.equal(JSON.stringify(ok).includes("secret"), false);

  const agentBlocked = () => manager.acquireDriver(session.id, { holder: "agent" });
  assert.throws(agentBlocked, error => error.code === "driver_busy");

  assert.throws(() => manager.acquireDriver(session.id, { holder: "user", deviceId: "dev-b" }), error => error.code === "session_forbidden");
  await assert.rejects(() => manager.act(session.id, { type: "screenshot" }, { deviceId: "dev-b" }), error => error.code === "session_forbidden");
  assert.throws(() => manager.get(session.id, { deviceId: "dev-b" }), error => error.statusCode === 403);
  await assert.rejects(() => manager.stop(session.id, "x", { deviceId: "dev-b" }), error => error.statusCode === 403);
  assert.equal(manager.status("p1", { deviceId: "dev-b" }).session, null);
  assert.equal(manager.status("p1", { deviceId: "dev-b" }).otherDeviceSession, true);

  const takeover = manager.acquireDriver(session.id, { holder: "user", deviceId: "dev-a" });
  assert.deepEqual(takeover, { holder: "user", generation: 2 });
  await assert.rejects(() => manager.act(session.id, { type: "reload" }, { generation: 1, deviceId: "dev-a" }), error => error.code === "driver_stale");
  await assert.rejects(() => manager.act(session.id, { type: "reload" }, { deviceId: "dev-a" }), error => error.code === "driver_stale");
  assert.equal((await manager.act(session.id, { type: "reload" }, { generation: 2, deviceId: "dev-a" })).ok, true);

  const released = manager.releaseDriver(session.id, { generation: 2, deviceId: "dev-a" });
  assert.deepEqual(released, { holder: null, generation: 3 });
  const agent = manager.acquireDriver(session.id, { holder: "agent" });
  assert.deepEqual(agent, { holder: "agent", generation: 4 });
  await assert.rejects(() => manager.act(session.id, { type: "reload" }, { generation: 4, deviceId: "dev-a" }), error => error.code === "driver_stale");
  assert.equal((await manager.act(session.id, { type: "reload" }, { holder: "agent", generation: 4 })).ok, true);
  const user = manager.acquireDriver(session.id, { holder: "user", deviceId: "dev-a" });
  assert.equal(user.generation, 5);
  await assert.rejects(() => manager.act(session.id, { type: "reload" }, { holder: "agent", generation: 4 }), error => error.code === "driver_stale");

  const screenshot = await manager.act(session.id, { type: "screenshot" });
  assert.equal(screenshot.mime, "image/jpeg");
  assert.equal(screenshot.data.toString(), "jpeg-bytes");
});

test("actions drive CDP input and keep navigation inside the preview", async t => {
  const { manager, spawns } = await setup(t);
  const { session } = await manager.start("p1", { deviceId: "dev-a" });
  const opts = { generation: 1, deviceId: "dev-a" };
  const { child } = spawns[0];
  await assert.rejects(() => manager.act(session.id, { type: "navigate", url: "file:///etc/passwd" }, opts), error => error.code === "navigation_blocked");
  await assert.rejects(() => manager.act(session.id, { type: "navigate", url: "http://127.0.0.1:8787/" }, opts), error => error.code === "navigation_blocked");
  await manager.act(session.id, { type: "navigate", url: "/settings" }, opts);
  assert.equal(child.calls.filter(call => call.method === "Page.navigate").at(-1).params.url, "http://127.0.0.1:3000/settings");

  const clicked = await manager.act(session.id, { type: "click", selector: "#go" }, opts);
  assert.deepEqual([clicked.x, clicked.y], [20, 30]);
  await assert.rejects(() => manager.act(session.id, { type: "click", selector: "#missing" }, opts), error => error.code === "selector_not_found");
  await manager.act(session.id, { type: "press", key: "Enter" }, opts);
  const keys = child.calls.filter(call => call.method === "Input.dispatchKeyEvent").map(call => call.params.type);
  assert.deepEqual(keys, ["keyDown", "keyUp"]);
  assert.deepEqual(await manager.act(session.id, { type: "back" }, opts).then(r => r.ok), false);

  const dom = await manager.act(session.id, { type: "dom", maxBytes: 1024 });
  assert.equal(dom.trust, "untrusted-page-content");
  assert.equal(dom.truncated, true);
  assert.equal(Buffer.byteLength(dom.content), 1024);
});

test("history navigation refuses entries outside the preview", async t => {
  const configDir = await mkdtemp(join(tmpdir(), "devmoter-remote-browser-history-"));
  t.after(() => rm(configDir, { recursive: true, force: true }));
  const manager = createBrowserSessionManager({
    configDir,
    resolveProject: async id => ({ id, path: "/tmp/p" }),
    getPreview: () => ({ host: "127.0.0.1", port: 3000 }),
    env: { DEVMOTER_BROWSER_AUTOMATION: "1", DEVMOTER_SANDBOX: "required", PATH: "" },
    spawnImpl: () => fakeChrome({ history: { currentIndex: 1, entries: [{ id: 1, url: "http://127.0.0.1:4000/" }, { id: 2, url: "http://127.0.0.1:3000/" }] } }),
    spawnSyncImpl: probe,
    limits: { sweepMs: 0 }
  });
  t.after(() => manager.stopAll());
  const { session } = await manager.start("p1");
  await assert.rejects(() => manager.act(session.id, { type: "back" }, { generation: 1 }), error => error.code === "navigation_blocked");
});

test("session limits, preview changes, idle and lifetime stops", async t => {
  const { manager, previews, advance } = await setup(t, { limits: { idleMs: 1000, maxLifetimeMs: 5000 } });
  const a = (await manager.start("p1")).session;
  const b = (await manager.start("p2")).session;
  await assert.rejects(() => manager.start("p3"), error => error.statusCode === 429);
  const replaced = (await manager.start("p1")).session;
  assert.notEqual(replaced.id, a.id);
  assert.throws(() => manager.get(a.id), error => error.statusCode === 404);

  previews.set("p2", { projectId: "p2", host: "127.0.0.1", port: 3001, token: "rotated" });
  await assert.rejects(() => manager.act(b.id, { type: "screenshot" }), error => error.code === "preview_changed");
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(manager.status("p2").session, null);

  advance(1500);
  await manager.sweep();
  assert.equal(manager.status("p1").session, null);

  const c = (await manager.start("p3")).session;
  for (let i = 0; i < 6; i++) {
    advance(900);
    await manager.act(c.id, { type: "reload" }, { generation: 1 });
    await manager.sweep();
  }
  assert.equal(manager.status("p3").session, null);
  assert.throws(() => manager.get(c.id), error => error.statusCode === 404);
});

test("device revocation and browser exit stop the session", async t => {
  const { manager, spawns } = await setup(t);
  const a = (await manager.start("p1", { deviceId: "dev-a" })).session;
  const b = (await manager.start("p2", { deviceId: "dev-b" })).session;
  assert.equal((await manager.stopDevice("dev-a")).stopped, 1);
  assert.throws(() => manager.get(a.id), error => error.statusCode === 404);
  spawns[1].child.kill();
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.throws(() => manager.get(b.id), error => error.statusCode === 404);
});

async function callApi(manager, method, path, body, deviceId = "dev-a", { headers = {}, tickets } = {}) {
  const req = Readable.from(body === undefined ? [] : [Buffer.from(typeof body === "string" ? body : JSON.stringify(body))]);
  req.method = method;
  req.headers = headers;
  const res = { status: 0, headers: {}, body: null };
  res.writeHead = (status, headers) => { res.status = status; res.headers = headers; };
  res.end = data => { res.body = data; };
  const url = new URL("http://127.0.0.1" + path);
  const handled = await handleBrowserApiRequest(req, res, url, manager, {
    authenticateDevice: async () => deviceId ? { id: deviceId } : null,
    tickets
  });
  assert.equal(handled, true);
  const isJson = String(res.headers["content-type"] || "").startsWith("application/json");
  return { status: res.status, headers: res.headers, json: isJson ? JSON.parse(res.body) : null, raw: res.body };
}

test("browser HTTP API drives sessions with driver generations", async t => {
  const { manager } = await setup(t);
  assert.equal((await callApi(manager, "GET", "/api/browser", undefined, null)).status, 403);

  const created = await callApi(manager, "POST", "/api/browser/sessions", { projectId: "p1", viewport: { width: 360 } });
  assert.equal(created.status, 201);
  const id = created.json.session.id;
  assert.equal(created.json.session.viewport.width, 360);

  const status = await callApi(manager, "GET", "/api/browser?projectId=p1");
  assert.equal(status.json.session.id, id);
  assert.match(status.json.policy.network, /dead proxy/);

  const schema = await callApi(manager, "POST", `/api/browser/sessions/${id}/actions`, { generation: 1, action: { type: "evaluate", expression: "1" } });
  assert.equal(schema.status, 400);
  const blocked = await callApi(manager, "POST", `/api/browser/sessions/${id}/actions`, { generation: 1, action: { type: "navigate", url: "chrome://settings" } });
  assert.equal(blocked.status, 403);
  const typed = await callApi(manager, "POST", `/api/browser/sessions/${id}/actions`, { generation: 1, action: { type: "type", text: "パスワード" } });
  assert.equal(typed.status, 200);
  assert.equal(JSON.stringify(typed.json).includes("パスワード"), false);

  const foreign = await callApi(manager, "POST", `/api/browser/sessions/${id}/driver`, { op: "acquire" }, "dev-b");
  assert.equal(foreign.status, 403);
  assert.equal((await callApi(manager, "GET", `/api/browser/sessions/${id}/screenshot`, undefined, "dev-b")).status, 403);
  const takeover = await callApi(manager, "POST", `/api/browser/sessions/${id}/driver`, { op: "acquire" });
  assert.deepEqual(takeover.json.driver, { holder: "user", generation: 2 });
  const stale = await callApi(manager, "POST", `/api/browser/sessions/${id}/actions`, { generation: 1, action: { type: "reload" } });
  assert.equal(stale.status, 409);
  assert.equal(stale.json.code, "driver_stale");
  const badOp = await callApi(manager, "POST", `/api/browser/sessions/${id}/driver`, { op: "steal" });
  assert.equal(badOp.status, 400);
  const release = await callApi(manager, "POST", `/api/browser/sessions/${id}/driver`, { op: "release", generation: 2 });
  assert.deepEqual(release.json.driver, { holder: null, generation: 3 });

  const shot = await callApi(manager, "GET", `/api/browser/sessions/${id}/screenshot?format=jpeg&quality=40`);
  assert.equal(shot.status, 200);
  assert.equal(shot.headers["content-type"], "image/jpeg");
  assert.equal(shot.headers["cache-control"], "no-store");
  assert.equal(shot.raw.toString(), "jpeg-bytes");

  const issued = [];
  const tickets = { issue: grant => { issued.push(grant); return { ticket: "f".repeat(64), expiresInMs: 20000 }; } };
  const origin = { headers: { origin: "http://127.0.0.1:8787" }, tickets };
  assert.equal((await callApi(manager, "POST", `/api/browser/sessions/${id}/ticket`, undefined, "dev-a", { tickets })).status, 403);
  assert.equal((await callApi(manager, "POST", `/api/browser/sessions/${id}/ticket`, undefined, "dev-b", origin)).status, 403);
  const ticket = await callApi(manager, "POST", `/api/browser/sessions/${id}/ticket`, undefined, "dev-a", origin);
  assert.equal(ticket.status, 201);
  assert.deepEqual(issued, [{ sessionId: id, deviceId: "dev-a", origin: "http://127.0.0.1:8787", generation: 3 }]);

  assert.equal((await callApi(manager, "PUT", `/api/browser/sessions/${id}`)).status, 405);
  assert.equal((await callApi(manager, "GET", "/api/browser/sessions/xyz")).status, 404);
  assert.equal((await callApi(manager, "POST", "/api/browser/sessions", "x".repeat(70 * 1024))).status, 413);
  const deleted = await callApi(manager, "DELETE", `/api/browser/sessions/${id}`);
  assert.equal(deleted.json.session.stopReason, "user_stopped");
  assert.equal((await callApi(manager, "GET", `/api/browser/sessions/${id}`)).status, 404);
});

test("Chromium gets an allowlisted environment and a start cannot steal another device's session", async t => {
  const { manager, spawns } = await setup(t);
  const { session } = await manager.start("p1", { deviceId: "dev-a" });
  const env = spawns[0].options.env;
  assert.equal(env.OPENAI_API_KEY, undefined);
  assert.equal(env.DEVMOTER_BROWSER_AUTOMATION, undefined);
  assert.equal(env.LC_ALL, "ja_JP.UTF-8");
  assert.ok(env.HOME.includes("browser-profiles"));
  await assert.rejects(() => manager.start("p1", { deviceId: "dev-b" }), error => error.code === "session_owned_by_other_device");
  assert.equal(manager.get(session.id).active, true);
  const replaced = await manager.start("p1", { deviceId: "dev-a" });
  assert.notEqual(replaced.session.id, session.id);
});

test("concurrent starts respect the session limit and revocation during start", async t => {
  const { manager } = await setup(t, { limits: { maxSessions: 1 } });
  const results = await Promise.allSettled([manager.start("p1", { deviceId: "d" }), manager.start("p2", { deviceId: "d" })]);
  assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
  assert.equal(results.find(result => result.status === "rejected").reason.code, "session_limit");
  await manager.stopAll();

  const two = await setup(t, { limits: { maxSessions: 2 } });
  const both = await Promise.allSettled([two.manager.start("p1", { deviceId: "d" }), two.manager.start("p2", { deviceId: "d" })]);
  assert.deepEqual(both.map(result => result.status), ["fulfilled", "fulfilled"]);

  const pending = manager.start("p3", { deviceId: "dev-r" });
  await manager.stopDevice("dev-r");
  await assert.rejects(pending, error => error.code === "device_revoked");
  assert.equal(manager.status("p3").session, null);
});

test("start fails when the preview does not load, SPA paths are tracked and removed projects stop", async t => {
  const broken = await setup(t, { chrome: { results: { "Page.navigate": () => ({ frameId: "F1", errorText: "net::ERR_CONNECTION_REFUSED" }) } } });
  await assert.rejects(() => broken.manager.start("p1", { deviceId: "d" }), error => error.code === "browser_start_failed");
  assert.equal(broken.manager.status("p1").session, null);

  const { manager, spawns, removed } = await setup(t);
  const { session } = await manager.start("p1", { deviceId: "d" });
  const child = spawns[0].child;
  child.emitEvent("Page.frameNavigated", { frame: { id: "F1", url: "http://127.0.0.1:3000/" } });
  child.emitEvent("Page.navigatedWithinDocument", { frameId: "F1", url: "http://127.0.0.1:3000/app/settings" });
  child.emitEvent("Page.navigatedWithinDocument", { frameId: "F9", url: "http://127.0.0.1:3000/iframe" });
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(manager.get(session.id).url, "http://127.0.0.1:3000/app/settings");

  removed.add("p1");
  await manager.sweep();
  assert.equal(manager.status("p1").session, null);
});

test("selector clicks scroll into view and refuse elements outside the viewport", async t => {
  const { manager, spawns } = await setup(t, { chrome: { results: { "DOM.getBoxModel": () => ({ model: { content: [10, 2000, 30, 2000, 30, 2040, 10, 2040] } }) } } });
  const { session } = await manager.start("p1", { deviceId: "d" });
  await assert.rejects(() => manager.act(session.id, { type: "click", selector: "#go" }, { generation: 1, deviceId: "d" }), error => error.code === "selector_not_visible");
  const methods = spawns[0].child.calls.map(call => call.method);
  assert.ok(methods.includes("DOM.scrollIntoViewIfNeeded"));
  assert.equal(methods.includes("Input.dispatchMouseEvent"), false);
});

test("screencast frames are paced by viewer ACKs and slow viewers are dropped", async t => {
  const { manager, spawns, advance } = await setup(t, { limits: { maxViewers: 2, frameAckTimeoutMs: 1000 } });
  const { session } = await manager.start("p1", { deviceId: "d" });
  const child = spawns[0].child;
  const frames = [[], []];
  const closed = [];
  const sink = index => ({ event() {}, frame: frame => frames[index].push(frame), close: (code, reason) => closed.push([index, code, reason]) });
  const a = manager.attachViewer(session.id, sink(0), { deviceId: "d" });
  const b = manager.attachViewer(session.id, sink(1), { deviceId: "d" });
  assert.throws(() => manager.attachViewer(session.id, sink(0), { deviceId: "d" }), error => error.code === "viewer_limit");
  assert.throws(() => manager.attachViewer(session.id, sink(0), { deviceId: "other" }), error => error.statusCode === 404 || error.statusCode === 403);
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(child.calls.some(call => call.method === "Page.startScreencast"));

  const jpeg = Buffer.from([0xff, 0xd8, 1, 2]).toString("base64");
  const acks = () => child.calls.filter(call => call.method === "Page.screencastFrameAck").length;
  const flush = () => new Promise(resolve => setTimeout(resolve, 20));
  child.emitEvent("Page.screencastFrame", { data: jpeg, sessionId: 1, metadata: { deviceWidth: 390, deviceHeight: 700 } });
  await flush();
  assert.equal(frames[0].length, 1);
  assert.equal(frames[1].length, 1);
  assert.equal(frames[0][0].width, 390);
  assert.equal(acks(), 0);
  a.ack(frames[0][0].seq);
  await flush();
  assert.equal(acks(), 0, "Chromium is acked only when every viewer has acked");
  b.ack(frames[1][0].seq);
  await flush();
  assert.equal(acks(), 1);

  child.emitEvent("Page.screencastFrame", { data: jpeg, sessionId: 2 });
  await flush();
  a.ack(frames[0][1].seq);
  advance(1500);
  await manager.sweep();
  assert.deepEqual(closed, [[1, 4008, "slow_consumer"]]);
  await flush();
  assert.equal(acks(), 2, "dropping the slow viewer releases the next frame");

  assert.equal(a.ack(999), false);
  a.detach();
  await flush();
  assert.ok(child.calls.some(call => call.method === "Page.stopScreencast"));
});
