import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { transform } from "esbuild";
import { JSDOM } from "jsdom";

const i18nCore = JSON.stringify(new URL("../src/i18n-core.mjs", import.meta.url).href);

async function loadModule(file, cssPattern) {
  const source = await readFile(new URL("../src/" + file, import.meta.url), "utf8");
  const clean = source
    .replace(cssPattern, "")
    .replace(/from "\.\/i18n";/g, `from ${i18nCore};`)
    .replace(/from "\.\/feature-flags\.mjs";/g, `from ${JSON.stringify(new URL("../src/feature-flags.mjs", import.meta.url).href)};`);
  const { code } = await transform(clean, { loader: "ts", format: "esm", target: "es2022" });
  return import("data:text/javascript;base64," + Buffer.from(code).toString("base64") + "#" + Math.random());
}

const loadRemoteBrowser = () => loadModule("remote-browser.ts", /import "\.\/remote-browser\.css";/g);
const loadNavigator = async () => (await loadModule("unified-workspace-nav.ts", /import "\.\/unified-workspace-(?:nav|chat)\.css";/g)).mountTaskFirstWorkspace;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function installDom(url = "https://devmoter.test/?unifiedUI=1") {
  const dom = new JSDOM("<!doctype html><div id=\"app\"></div>", { url, pretendToBeVisual: true });
  const keys = ["window", "document", "localStorage", "location", "WebSocket", "fetch", "createImageBitmap"];
  const prior = Object.fromEntries(keys.map(key => [key, globalThis[key]]));
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.localStorage = dom.window.localStorage;
  globalThis.location = dom.window.location;
  dom.window.localStorage.setItem("devmoter-language", "ja");
  return { dom, restore: () => { for (const key of keys) globalThis[key] = prior[key]; dom.window.close(); } };
}

function frameBuffer(seq, width = 390, height = 844) {
  const buffer = new ArrayBuffer(16);
  const view = new DataView(buffer);
  view.setUint32(0, 0x444d4246);
  view.setUint32(4, seq);
  view.setUint16(8, width);
  view.setUint16(10, height);
  return buffer;
}

function fakeBackend(sessionDriver = { holder: "user", generation: 3 }) {
  const session = {
    id: "11111111-2222-4333-8444-555555555555",
    active: true,
    url: "http://127.0.0.1:5173/",
    viewport: { width: 390, height: 844 },
    driver: { ...sessionDriver }
  };
  const calls = [];
  const sockets = [];
  let ticketCount = 0;
  class FakeSocket {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSING = 2;
    static CLOSED = 3;
    constructor(url, protocols) {
      this.url = url;
      this.protocols = protocols;
      this.readyState = FakeSocket.OPEN;
      this.sent = [];
      sockets.push(this);
      queueMicrotask(() => this.onopen?.());
    }
    send(data) {
      const message = JSON.parse(data);
      this.sent.push(message);
      if (message.t === "act" && backend.autoResult !== false) queueMicrotask(() => this.emit({ t: "result", id: message.id, ok: true }));
    }
    close(code = 1000) {
      if (this.readyState === FakeSocket.CLOSED) return;
      this.readyState = FakeSocket.CLOSED;
      this.onclose?.({ code });
    }
    emit(message) { this.onmessage?.({ data: typeof message === "string" ? message : message instanceof ArrayBuffer ? message : JSON.stringify(message) }); }
    acts() { return this.sent.filter(message => message.t === "act"); }
  }
  globalThis.WebSocket = FakeSocket;
  globalThis.createImageBitmap = async () => ({ width: 390, height: 844, close() {} });
  globalThis.fetch = async (path, init = {}) => {
    const method = init.method || "GET";
    calls.push({ path, method, body: init.body ? JSON.parse(init.body) : undefined, headers: init.headers });
    const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    const overridden = await backend.override?.(path, method, json);
    if (overridden) return overridden;
    if (path.startsWith("/api/browser?")) return json(200, { capability: { enabled: backend.enabled, available: true }, session: session.active ? session : null });
    if (path.endsWith("/ticket")) return json(201, { ticket: "t".repeat(63) + String(++ticketCount % 10) });
    if (path.endsWith("/driver")) {
      const op = JSON.parse(init.body).op;
      session.driver = { holder: op === "acquire" ? "user" : null, generation: session.driver.generation + 1 };
      return json(200, { driver: session.driver });
    }
    return json(404, { error: "not found" });
  };
  const backend = { session, calls, sockets, tickets: () => ticketCount, enabled: true };
  return backend;
}

function pointer(window, target, type, clientX, clientY, pointerId = 1) {
  const event = new window.MouseEvent(type, { bubbles: true, cancelable: true, clientX, clientY });
  Object.defineProperty(event, "pointerId", { value: pointerId });
  target.dispatchEvent(event);
}

test("frame parsing, coordinate mapping and text chunking match the PR2 protocol", async () => {
  const env = installDom();
  try {
    const { parseFrame, toViewportPoint, splitText } = await loadRemoteBrowser();
    const frame = parseFrame(frameBuffer(42, 390, 844));
    assert.deepEqual([frame.seq, frame.width, frame.height, frame.jpeg.byteLength], [42, 390, 844, 4]);
    const bad = frameBuffer(1);
    new DataView(bad).setUint32(0, 0x41424344);
    assert.equal(parseFrame(bad), null);
    assert.equal(parseFrame(new ArrayBuffer(12)), null);
    const rect = { left: 10, top: 20, width: 195, height: 422 };
    assert.deepEqual(toViewportPoint(10 + 97.5, 20 + 211, rect, { width: 390, height: 844 }), { x: 195, y: 422 });
    assert.equal(toViewportPoint(5, 30, rect, { width: 390, height: 844 }), null);
    assert.deepEqual(splitText("日本語テキスト", 3), ["日本語", "テキス", "ト"]);
    assert.deepEqual(splitText("a😀b😀", 3), ["a😀", "b😀"]);
    assert.ok(splitText("😀".repeat(1500)).every(chunk => chunk.length <= 2000));
  } finally {
    env.restore();
  }
});

test("☰ browser item opens the remote browser and restores from ?workspaceTab=browser", async () => {
  const env = installDom("https://devmoter.test/?unifiedUI=1&workspaceTab=browser");
  try {
    const mount = await loadNavigator();
    const opened = [];
    const nav = mount({
      initialSurface: "api",
      switchBackend: () => {},
      openHome: () => {},
      openTasks: () => {},
      openReview: () => {},
      openTools: () => {},
      openTerminal: () => {},
      openBrowser: () => opened.push("browser")
    });
    assert.deepEqual(opened, ["browser"], "route restore opens the browser tab");
    const root = env.dom.window.document.getElementById("dmTaskFirstWorkspace");
    const item = root.querySelector('[data-workspace-action="browser"]');
    assert.ok(item);
    assert.equal(item.getAttribute("aria-label"), "リモートブラウザを開く");
    env.dom.window.dispatchEvent(new env.dom.window.CustomEvent("devmoter:workspace-panel-changed", { detail: { tab: "browser", open: false } }));
    assert.notEqual(new URL(env.dom.window.location.href).searchParams.get("workspaceTab"), "browser", "closing the panel leaves the tab");
    item.click();
    assert.deepEqual(opened, ["browser", "browser"]);
    assert.equal(new URL(env.dom.window.location.href).searchParams.get("workspaceTab"), "browser");
    nav.destroy();
  } finally {
    env.restore();
  }
});

test("remote browser streams frames, maps taps, sends committed IME text and takes back control", async () => {
  const env = installDom();
  const backend = fakeBackend();
  try {
    env.dom.window.localStorage.setItem("opencode-pocket-project", "/projects/demo");
    const { openRemoteBrowser, destroyRemoteBrowser } = await loadRemoteBrowser();
    const panelEvents = [];
    env.dom.window.addEventListener("devmoter:workspace-panel-changed", event => panelEvents.push(event.detail));
    openRemoteBrowser();
    await sleep(20);
    const doc = env.dom.window.document;
    const panel = doc.getElementById("dmRemoteBrowser");
    assert.equal(panel.hidden, false);
    assert.deepEqual(panelEvents[0], { tab: "browser", open: true });
    assert.equal(backend.calls[0].path, "/api/browser?projectId=%2Fprojects%2Fdemo");
    const ticketCall = backend.calls.find(call => call.path.endsWith("/ticket"));
    assert.equal(ticketCall.method, "POST");
    assert.ok(new Headers(ticketCall.headers).get("x-pocket-operation-id"));

    const ws = backend.sockets[0];
    assert.equal(ws.url, `wss://devmoter.test/api/browser/sessions/${backend.session.id}/socket`);
    assert.equal(ws.protocols[0], "devmoter-browser.v1");
    assert.match(ws.protocols[1], /^devmoter-ticket\.[0-9a-z]{64}$/);
    ws.emit({ t: "hello", session: backend.session });
    assert.equal(doc.querySelector("[data-rb-url]").textContent, "http://127.0.0.1:5173/");
    assert.equal(doc.querySelector("[data-rb-driver]").textContent, "あなたが操作中");
    assert.equal(doc.querySelector("[data-rb-takeover]").hidden, true);

    ws.emit(frameBuffer(7));
    await sleep(10);
    assert.deepEqual(ws.sent.filter(message => message.t === "ack"), [{ t: "ack", seq: 7 }]);

    const canvas = doc.querySelector("[data-rb-canvas]");
    canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 195, height: 422, right: 195, bottom: 422 });
    pointer(env.dom.window, canvas, "pointerdown", 50, 100);
    pointer(env.dom.window, canvas, "pointerup", 51, 101);
    assert.deepEqual(ws.acts().at(-1), { t: "act", id: 1, action: { type: "click", x: 102, y: 202 }, generation: 3 });

    pointer(env.dom.window, canvas, "pointerdown", 100, 300);
    pointer(env.dom.window, canvas, "pointermove", 100, 250);
    pointer(env.dom.window, canvas, "pointerup", 100, 250);
    await sleep(120);
    assert.deepEqual(ws.acts().at(-1).action, { type: "scroll", dx: 0, dy: 100, x: 200, y: 600 }, "drag scrolls at the point where it started");

    canvas.dispatchEvent(new env.dom.window.WheelEvent("wheel", { deltaY: 3, deltaMode: 1, clientX: 50, clientY: 100, bubbles: true, cancelable: true }));
    await sleep(120);
    assert.deepEqual(ws.acts().at(-1).action, { type: "scroll", dx: 0, dy: 48, x: 100, y: 200 }, "line-mode wheel deltas are converted to pixels");
    canvas.dispatchEvent(new env.dom.window.WheelEvent("wheel", { deltaX: 1, deltaY: 1, deltaMode: 2, clientX: 50, clientY: 100, bubbles: true, cancelable: true }));
    await sleep(120);
    assert.deepEqual(ws.acts().at(-1).action, { type: "scroll", dx: 390, dy: 844, x: 100, y: 200 }, "page-mode wheel deltas use the viewport width and height");

    const beforeRight = ws.acts().length;
    const right = new env.dom.window.MouseEvent("pointerdown", { clientX: 50, clientY: 100, button: 2, bubbles: true });
    Object.defineProperty(right, "pointerType", { value: "mouse" });
    Object.defineProperty(right, "pointerId", { value: 9 });
    canvas.dispatchEvent(right);
    pointer(env.dom.window, canvas, "pointerup", 50, 100, 9);
    assert.equal(ws.acts().length, beforeRight, "right clicks are not sent as clicks");
    assert.equal(doc.querySelector("[data-rb-ime]").tabIndex, -1, "the hidden IME field is out of the Tab order");

    const ime = doc.querySelector("[data-rb-ime]");
    const before = ws.acts().length;
    ime.dispatchEvent(new env.dom.window.CompositionEvent("compositionstart", { data: "" }));
    ime.value = "にほんご";
    ime.dispatchEvent(new env.dom.window.Event("input", { bubbles: true }));
    assert.equal(ws.acts().length, before, "uncommitted composition is not sent");
    ime.dispatchEvent(new env.dom.window.CompositionEvent("compositionend", { data: "日本語" }));
    ime.dispatchEvent(new env.dom.window.Event("input", { bubbles: true }));
    assert.deepEqual(ws.acts().slice(before).map(message => message.action), [{ type: "type", text: "日本語" }]);
    assert.equal(ime.value, "");
    ime.dispatchEvent(new env.dom.window.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    ime.dispatchEvent(new env.dom.window.KeyboardEvent("keydown", { key: "a", bubbles: true, cancelable: true }));
    assert.deepEqual(ws.acts().at(-1).action, { type: "press", key: "Enter" });

    doc.querySelector('[data-rb-act="back"]').click();
    assert.deepEqual(ws.acts().at(-1).action, { type: "back" });

    backend.session.driver = { holder: "agent", generation: 4 };
    ws.emit({ t: "driver", holder: "agent", generation: 4 });
    assert.equal(doc.querySelector("[data-rb-driver]").textContent, "エージェントが操作中");
    const takeover = doc.querySelector("[data-rb-takeover]");
    assert.equal(takeover.hidden, false);
    assert.equal(takeover.textContent, "操作を取り戻す");
    assert.equal(doc.querySelector('[data-rb-act="reload"]').disabled, true);
    const count = ws.acts().length;
    pointer(env.dom.window, canvas, "pointerdown", 50, 100);
    pointer(env.dom.window, canvas, "pointerup", 50, 100);
    assert.equal(ws.acts().length, count, "no input while an agent drives");

    takeover.click();
    await sleep(10);
    assert.deepEqual(backend.calls.find(call => call.path.endsWith("/driver")).body, { op: "acquire" });
    doc.querySelector('[data-rb-act="reload"]').click();
    assert.deepEqual(ws.acts().at(-1), { t: "act", id: count + 1, action: { type: "reload" }, generation: 5 });

    const release = doc.querySelector("[data-rb-release]");
    assert.equal(release.hidden, false);
    assert.equal(release.textContent, "エージェントに任せる");
    release.click();
    await sleep(10);
    assert.deepEqual(backend.calls.filter(call => call.path.endsWith("/driver")).at(-1).body, { op: "release", generation: 5 });
    assert.equal(doc.querySelector("[data-rb-driver]").textContent, "操作中の人はいません");
    assert.equal(doc.querySelector("[data-rb-takeover]").textContent, "操作する");

    ws.emit({ t: "result", id: 9, ok: false, error: "driver_stale" });
    assert.match(doc.querySelector("[data-rb-status]").textContent, /操作権がありません/);

    destroyRemoteBrowser();
    assert.equal(doc.getElementById("dmRemoteBrowser"), null);
    assert.deepEqual(panelEvents.at(-1), { tab: "browser", open: false });
  } finally {
    env.restore();
  }
});

test("a long paste is sent in order without overrunning the host queue, and Escape reaches the page", async () => {
  const env = installDom();
  const backend = fakeBackend();
  backend.autoResult = false;
  try {
    env.dom.window.localStorage.setItem("opencode-pocket-project", "/projects/demo");
    const { openRemoteBrowser, destroyRemoteBrowser } = await loadRemoteBrowser();
    openRemoteBrowser();
    await sleep(20);
    const ws = backend.sockets[0];
    ws.emit({ t: "hello", session: backend.session });
    const ime = env.dom.window.document.querySelector("[data-rb-ime]");
    const paste = new env.dom.window.Event("paste", { bubbles: true, cancelable: true });
    paste.clipboardData = { getData: () => "x".repeat(2000 * 12) };
    ime.dispatchEvent(paste);
    assert.equal(ws.acts().length, 4, "no more than four actions wait on the host at once");
    while (ws.acts().length < 12) {
      const pending = ws.acts().length;
      ws.emit({ t: "result", id: ws.acts()[pending - 4].id, ok: true });
      assert.equal(ws.acts().length, pending + 1);
    }
    assert.deepEqual(ws.acts().map(message => message.id), Array.from({ length: 12 }, (_, index) => index + 1));
    assert.equal(ws.acts().map(message => message.action.text).join("").length, 24000);

    for (const message of ws.acts().slice(8)) ws.emit({ t: "result", id: message.id, ok: true });
    ime.focus();
    ime.dispatchEvent(new env.dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    assert.deepEqual(ws.acts().at(-1).action, { type: "press", key: "Escape" });
    assert.notEqual(env.dom.window.document.activeElement, ime);
    destroyRemoteBrowser();
  } finally {
    env.restore();
  }
});

test("unexpected disconnects reconnect with a fresh ticket; a closed session does not", async () => {
  const env = installDom();
  const backend = fakeBackend();
  try {
    env.dom.window.localStorage.setItem("opencode-pocket-project", "/projects/demo");
    const { openRemoteBrowser, destroyRemoteBrowser } = await loadRemoteBrowser();
    openRemoteBrowser();
    await sleep(20);
    assert.equal(backend.sockets.length, 1);
    backend.sockets[0].close(1006);
    assert.match(env.dom.window.document.querySelector("[data-rb-status]").textContent, /再接続/);
    await sleep(600);
    assert.equal(backend.sockets.length, 2);
    assert.equal(backend.tickets(), 2);
    assert.notEqual(backend.sockets[1].protocols[1], backend.sockets[0].protocols[1]);

    backend.sockets[1].emit({ t: "closed", reason: "stopped" });
    backend.session.active = false;
    backend.sockets[1].close(1000);
    await sleep(600);
    assert.equal(backend.sockets.length, 2);
    assert.equal(env.dom.window.document.querySelector("[data-rb-start]").hidden, false);
    destroyRemoteBrowser();
  } finally {
    env.restore();
  }
});

test("#712 a failed stop keeps the session attached instead of showing it as stopped", async () => {
  const env = installDom();
  const backend = fakeBackend();
  try {
    env.dom.window.localStorage.setItem("opencode-pocket-project", "/projects/demo");
    const { openRemoteBrowser, destroyRemoteBrowser } = await loadRemoteBrowser();
    openRemoteBrowser();
    await sleep(20);
    const doc = env.dom.window.document;
    backend.override = (path, method, json) => method === "DELETE" ? json(503, { error: "host busy" }) : null;
    doc.querySelector("[data-rb-stop]").click();
    await sleep(30);
    assert.match(doc.querySelector("[data-rb-status]").textContent, /停止できませんでした/);
    assert.equal(doc.querySelector("[data-rb-start]").hidden, true);
    assert.equal(backend.sockets.length, 2, "it reattaches to the still-running browser");

    backend.override = (path, method, json) => method === "DELETE" ? json(404, { error: "gone" }) : null;
    doc.querySelector("[data-rb-stop]").click();
    await sleep(30);
    assert.equal(doc.querySelector("[data-rb-start]").hidden, false, "an already-gone session counts as stopped");
    assert.doesNotMatch(doc.querySelector("[data-rb-status]").textContent, /停止できませんでした/, "a stop that succeeds clears the earlier failure");
    destroyRemoteBrowser();
  } finally {
    env.restore();
  }
});

test("#712 reconnect keeps retrying after failed refreshes, then offers a manual retry", async () => {
  const env = installDom();
  const backend = fakeBackend();
  try {
    env.dom.window.localStorage.setItem("opencode-pocket-project", "/projects/demo");
    const { openRemoteBrowser, destroyRemoteBrowser } = await loadRemoteBrowser();
    openRemoteBrowser();
    await sleep(20);
    const doc = env.dom.window.document;
    let failures = 0;
    backend.override = path => {
      if (path.startsWith("/api/browser?") && failures < 2) { failures += 1; throw new TypeError("Failed to fetch"); }
      return null;
    };
    backend.sockets[0].close(1006);
    await sleep(500 + 1000 + 2000 + 200);
    assert.equal(failures, 2);
    assert.equal(backend.sockets.length, 2, "the third attempt reconnects once the network is back");

    let refreshes = 0;
    backend.override = path => {
      if (path.startsWith("/api/browser?")) { refreshes += 1; throw new TypeError("Failed to fetch"); }
      return null;
    };
    const timers = [];
    const realSetTimeout = env.dom.window.setTimeout.bind(env.dom.window);
    env.dom.window.setTimeout = (fn, ms) => { timers.push(ms); return realSetTimeout(fn, 0); };
    backend.sockets[1].close(1006);
    await sleep(200);
    assert.equal(refreshes, 8, "attempts are bounded");
    assert.deepEqual(timers.filter(ms => ms >= 500), [500, 1000, 2000, 4000, 8000, 8000, 8000, 8000]);
    assert.equal(doc.querySelector("[data-rb-retry]").hidden, false);
    assert.doesNotMatch(doc.querySelector("[data-rb-status]").textContent, /再接続/, "no reconnecting status once automatic retries stop");
    env.dom.window.setTimeout = realSetTimeout;
    backend.override = null;
    doc.querySelector("[data-rb-retry]").click();
    await sleep(30);
    assert.equal(backend.sockets.length, 3);
    destroyRemoteBrowser();
  } finally {
    env.restore();
  }
});

test("#713 an older driver HTTP response never overwrites a newer socket takeover", async () => {
  const env = installDom();
  const backend = fakeBackend({ holder: null, generation: 3 });
  try {
    env.dom.window.localStorage.setItem("opencode-pocket-project", "/projects/demo");
    const { openRemoteBrowser, destroyRemoteBrowser } = await loadRemoteBrowser();
    openRemoteBrowser();
    await sleep(20);
    const doc = env.dom.window.document;
    let answer;
    backend.override = (path, method, json) => path.endsWith("/driver") ? new Promise(resolve => { answer = () => resolve(json(200, { driver: { holder: "user", generation: 4 } })); }) : null;
    doc.querySelector("[data-rb-takeover]").click();
    await sleep(10);
    backend.sockets[0].emit({ t: "driver", holder: "agent", generation: 5 });
    await sleep(10);
    answer();
    await sleep(20);
    assert.equal(doc.querySelector("[data-rb-takeover]").textContent, "操作を取り戻す", "the agent (generation 5) still holds control");
    backend.sockets[0].emit({ t: "driver", holder: "user", generation: 4 });
    await sleep(10);
    assert.equal(doc.querySelector("[data-rb-takeover]").textContent, "操作を取り戻す", "a reordered older socket event is ignored too");
    destroyRemoteBrowser();
  } finally {
    env.restore();
  }
});

test("a host with browser automation turned off offers no start button", async () => {
  const env = installDom();
  const backend = fakeBackend();
  backend.enabled = false;
  backend.session.active = false;
  try {
    env.dom.window.localStorage.setItem("opencode-pocket-project", "/projects/demo");
    const { openRemoteBrowser, destroyRemoteBrowser } = await loadRemoteBrowser();
    openRemoteBrowser();
    await sleep(20);
    const doc = env.dom.window.document;
    assert.equal(doc.querySelector("[data-rb-start]").hidden, true);
    assert.match(doc.querySelector("[data-rb-empty-text]").textContent, /DEVMOTER_BROWSER_AUTOMATION=1/);
    destroyRemoteBrowser();
  } finally {
    env.restore();
  }
});

test("surface router keeps a ?workspaceTab= deep link while filling in the initial surface", async () => {
  const env = installDom("https://devmoter.test/?unifiedUI=1&workspaceTab=browser");
  try {
    const { createSurfaceNavigation } = await import(new URL("../src/surface-navigation.mjs", import.meta.url).href + "?" + Math.random());
    createSurfaceNavigation({ window: env.dom.window });
    const params = new URL(env.dom.window.location.href).searchParams;
    assert.equal(params.get("workspaceTab"), "browser");
    assert.ok(params.get("surface"));
  } finally {
    env.restore();
  }
});

test("remote browser copy exists in every locale", async () => {
  const source = await readFile(new URL("../src/remote-browser.ts", import.meta.url), "utf8");
  const nav = await readFile(new URL("../src/unified-workspace-nav.ts", import.meta.url), "utf8");
  const keys = new Set([...`${source}\n${nav}`.matchAll(/t\("((?:remoteBrowser|nav)\.[A-Za-z]+)"/g)].map(match => match[1]));
  assert.ok(keys.has("remoteBrowser.takeBack") && keys.has("nav.browser"));
  for (const locale of ["en", "ja", "zh-Hans", "zh-Hant"]) {
    const dictionary = Object.values(await import(new URL(`../src/locales/${locale}.mjs`, import.meta.url)))[0];
    for (const key of keys) assert.ok(dictionary[key], `${locale} has ${key}`);
  }
});
