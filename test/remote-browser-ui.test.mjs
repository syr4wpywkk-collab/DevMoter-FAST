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
    send(data) { this.sent.push(JSON.parse(data)); }
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
    if (path.startsWith("/api/browser?")) return json(200, { capability: { available: true }, session: session.active ? session : null });
    if (path.endsWith("/ticket")) return json(201, { ticket: "t".repeat(63) + String(++ticketCount % 10) });
    if (path.endsWith("/driver")) {
      const op = JSON.parse(init.body).op;
      session.driver = { holder: op === "acquire" ? "user" : null, generation: session.driver.generation + 1 };
      return json(200, { driver: session.driver });
    }
    return json(404, { error: "not found" });
  };
  return { session, calls, sockets, tickets: () => ticketCount };
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
    assert.deepEqual(ws.acts().at(-1).action, { type: "scroll", dx: 0, dy: 100 });

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
