import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";
import { build } from "esbuild";
import {
  LEGACY_QWEN_SESSION_KEY,
  QWEN_CHATS_KEY,
  createNdjsonReader,
  loadQwenChats,
  qwenChatTime,
  qwenChatTitle,
  saveQwenChats
} from "../src/qwen-chat-history.mjs";

const SID = "123e4567-e89b-12d3-a456-426614174000";
const PROJECTS = { projects: [{ id: "p1", name: "DevMoter-FAST", path: "/work/devmoter", available: true }, { id: "p2", name: "Other", path: "/work/other", available: true }] };
const tick = (ms = 0) => new Promise(resolve => setTimeout(resolve, ms));

function memoryStorage(seed = {}) {
  const data = new Map(Object.entries(seed));
  return { getItem: key => (data.has(key) ? data.get(key) : null), setItem: (key, value) => data.set(key, String(value)), removeItem: key => data.delete(key), data };
}

test("history helpers: titles, newest first, legacy resume id, bounded storage", () => {
  assert.equal(qwenChatTitle("  テストを\n実行して  "), "テストを 実行して");
  assert.equal(qwenChatTitle(""), "新しいチャット");
  assert.equal(Array.from(qwenChatTitle("あ".repeat(80))).length, 40);
  const storage = memoryStorage({
    [QWEN_CHATS_KEY]: JSON.stringify({ chats: [
      { id: "old", title: "old", sessionId: "../../etc", updatedAt: 1, messages: [{ role: "user", text: "x" }, { role: "system", text: "dropped" }] },
      { id: "new", title: "new", sessionId: SID, updatedAt: 5, messages: [{ role: "assistant", text: "y" }] }
    ] }),
    [LEGACY_QWEN_SESSION_KEY]: "7b2f7c1e-2a4d-4e6f-8a1b-3c5d7e9f1a2b"
  });
  const chats = loadQwenChats(storage);
  assert.deepEqual(chats.map(chat => chat.id).slice(0, 2), ["new", "old"]);
  assert.equal(chats[1].sessionId, null, "invalid resume ids are dropped");
  assert.deepEqual(chats[1].messages, [{ role: "user", text: "x" }]);
  assert.equal(chats[2].title, "以前のチャット");
  assert.equal(storage.getItem(LEGACY_QWEN_SESSION_KEY), null, "legacy key migrated once");
  assert.equal(loadQwenChats(memoryStorage({ [QWEN_CHATS_KEY]: "{broken" })).length, 0);
  const many = Array.from({ length: 40 }, (_, index) => ({ id: `c${index}`, title: "t", sessionId: null, projectId: "", updatedAt: index, messages: [{ role: "user", text: "x" }] }));
  assert.equal(saveQwenChats(storage, many), true);
  assert.equal(JSON.parse(storage.getItem(QWEN_CHATS_KEY)).chats.length, 30);
  assert.equal(saveQwenChats({ setItem() { throw new Error("quota"); } }, many), false);
});

test("history times are relative for a week, then a date; NDJSON survives split chunks", () => {
  const now = Date.UTC(2026, 10, 3, 12);
  assert.equal(qwenChatTime(now - 5 * 60_000, now, "ja"), "5 分前");
  assert.equal(qwenChatTime(now - 3 * 3600_000, now, "ja"), "3 時間前");
  assert.equal(qwenChatTime(now - 9 * 86400_000, now, "ja"), "10/25");
  const reader = createNdjsonReader();
  assert.deepEqual(reader.push('{"type":"delta","te'), []);
  assert.deepEqual(reader.push('xt":"a"}\nnot json\n{"type":"done"}'), [{ type: "delta", text: "a" }]);
  assert.deepEqual(reader.flush(), [{ type: "done" }]);
});

let modulePromise;
async function loadQwenChat() {
  modulePromise ||= (async () => {
    const result = await build({
      entryPoints: [fileURLToPath(new URL("../src/qwen-chat.ts", import.meta.url))],
      bundle: true, platform: "browser", format: "esm", write: false,
      outdir: "dist-test", loader: { ".css": "empty" }, logLevel: "silent"
    });
    const code = result.outputFiles.find(file => file.path.endsWith(".js")).text;
    return import("data:text/javascript;base64," + Buffer.from(code).toString("base64"));
  })();
  return modulePromise;
}

function ndjsonResponse(events, { hold = false, signal } = {}) {
  const encoder = new TextEncoder();
  const body = new ReadableStream({
    start(controller) {
      for (const event of events) controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
      if (!hold) controller.close();
      signal?.addEventListener("abort", () => controller.error(new DOMException("aborted", "AbortError")));
    }
  });
  return { ok: true, status: 200, body, json: async () => ({}) };
}

async function mount({ chat, seed, confirm = () => true } = {}) {
  const dom = new JSDOM("<div id='root'></div>", { url: "https://devmoter.test/" });
  const requests = [];
  Object.assign(globalThis, {
    window: dom.window, document: dom.window.document, localStorage: dom.window.localStorage,
    HTMLElement: dom.window.HTMLElement, CustomEvent: dom.window.CustomEvent,
    fetch: async (path, init = {}) => {
      requests.push({ path, init, body: init.body ? JSON.parse(init.body) : null });
      if (path === "/api/projects") return { ok: true, json: async () => PROJECTS };
      if (path === "/api/qwen/chat") return chat(init);
      if (path === "/api/qwen/chat/cancel") return { ok: true, json: async () => ({ cancelled: true }) };
      throw new Error("unexpected " + path);
    }
  });
  dom.window.confirm = confirm;
  dom.window.localStorage.setItem("opencode-pocket-project", "p1");
  if (seed) dom.window.localStorage.setItem(QWEN_CHATS_KEY, JSON.stringify(seed));
  const { mountQwenChat } = await loadQwenChat();
  const root = dom.window.document.getElementById("root");
  const opened = [];
  const controller = mountQwenChat(root, { onIntegrations: () => opened.push("integrations") });
  await controller.refresh();
  const $ = selector => root.querySelector(selector);
  const type = (text, init = {}) => {
    $("[data-qwen-input]").value = text;
    $("[data-qwen-input]").dispatchEvent(new dom.window.Event("input"));
    $("[data-qwen-input]").dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true, ...init }));
  };
  return { dom, root, $, type, requests, opened };
}

test("Qwen chat shows its project, streams a reply and keeps the resume id per chat", async () => {
  const { dom, root, $, type, requests } = await mount({
    chat: () => ndjsonResponse([{ type: "start" }, { type: "session", sessionId: SID }, { type: "delta", text: "Hel" }, { type: "tool", name: "read_file" }, { type: "delta", text: "lo" }, { type: "done", text: "Hello", sessionId: SID }])
  });
  try {
    assert.equal($("[data-qwen-project]").textContent, "DevMoter-FAST");
    assert.match($("[data-qwen-welcome-text]").textContent, /DevMoter-FAST/);
    assert.ok($("[data-qwen-history] svg") && $("[data-qwen-new] svg") && $("[data-qwen-send] svg"), "line icons");
    assert.equal($("[data-qwen-send]").disabled, true, "empty composer cannot send");

    type("一行目", { shiftKey: true });
    type("一行目", { isComposing: true });
    assert.equal(requests.filter(request => request.path === "/api/qwen/chat").length, 0, "Shift+Enter and IME composition do not send");

    type("README を要約して");
    await tick(150);
    const sent = requests.find(request => request.path === "/api/qwen/chat");
    assert.equal(sent.body.projectId, "p1");
    assert.equal(sent.body.sessionId, null);
    assert.match(sent.body.runId, /^[0-9a-f-]{36}$/);
    assert.ok(sent.init.headers.get("x-pocket-operation-id"));
    assert.equal($("[data-qwen-welcome]").hidden, true);
    const messages = [...root.querySelectorAll(".qx-message")];
    assert.deepEqual(messages.map(row => row.className), ["qx-message user", "qx-message assistant"]);
    assert.match(messages[1].textContent, /Hello/);
    const saved = JSON.parse(dom.window.localStorage.getItem(QWEN_CHATS_KEY)).chats;
    assert.equal(saved.length, 1);
    assert.equal(saved[0].title, "README を要約して");
    assert.equal(saved[0].sessionId, SID);
    assert.equal(saved[0].projectId, "p1");

    type("続けて");
    await tick(150);
    const second = requests.filter(request => request.path === "/api/qwen/chat")[1];
    assert.equal(second.body.sessionId, SID, "the follow-up resumes the same qwen session");
  } finally {
    dom.window.close();
  }
});

test("Stop aborts the stream, asks the server to cancel and keeps the partial reply", async () => {
  let signal;
  const { dom, root, $, type, requests } = await mount({
    chat: init => { signal = init.signal; return ndjsonResponse([{ type: "start" }, { type: "delta", text: "途中まで" }], { hold: true, signal }); }
  });
  try {
    type("テストを実行して");
    await tick(150);
    const send = $("[data-qwen-send]");
    assert.equal(send.getAttribute("aria-label"), "停止");
    assert.ok(send.classList.contains("stop"));
    assert.match($("[data-qwen-status]").textContent, /応答中 · \d+秒/);
    assert.match(root.querySelector("[data-qwen-live]").textContent, /途中まで/);
    send.click();
    await tick(20);
    assert.equal(signal.aborted, true);
    const cancel = requests.find(request => request.path === "/api/qwen/chat/cancel");
    assert.equal(cancel.body.runId, requests.find(request => request.path === "/api/qwen/chat").body.runId);
    const rows = [...root.querySelectorAll(".qx-message")];
    assert.deepEqual(rows.map(row => row.textContent.replace(/コピー$/, "").trim()), ["テストを実行して", "途中まで", "停止しました"]);
    assert.equal(send.getAttribute("aria-label"), "送信");
    assert.equal(root.querySelector("[data-qwen-live]"), null);
  } finally {
    dom.window.close();
  }
});

test("not installed and sign-in errors offer one button to ローカル連携", async () => {
  const { dom, root, type, opened } = await mount({
    chat: () => ({ ok: false, status: 404, body: null, json: async () => ({ error: "Qwen Code が未インストールです", code: "not_installed" }) })
  });
  try {
    type("こんにちは");
    await tick(50);
    const error = root.querySelector(".qx-message.error");
    assert.match(error.textContent, /未インストール/);
    const buttons = error.querySelectorAll("button");
    assert.equal(buttons.length, 1);
    assert.equal(buttons[0].textContent, "ローカル連携を開く");
    buttons[0].click();
    assert.deepEqual(opened, ["integrations"]);
  } finally {
    dom.window.close();
  }
});

test("history sheet lists chats newest first and switches, starts and deletes them", async () => {
  const now = Date.now();
  const seed = { version: 1, chats: [
    { id: "a", title: "古いチャット", sessionId: null, projectId: "p2", updatedAt: now - 3600_000, messages: [{ role: "user", text: "古い" }] },
    { id: "b", title: "新しいほう", sessionId: SID, projectId: "p1", updatedAt: now - 60_000, messages: [{ role: "user", text: "新しい" }, { role: "assistant", text: "はい" }] }
  ] };
  let answer = false;
  const { dom, root, $ } = await mount({ seed, chat: () => ndjsonResponse([]), confirm: () => answer });
  try {
    assert.match(root.querySelector(".qx-messages").textContent, /新しい/, "the newest chat opens first");
    $("[data-qwen-history]").click();
    const sheet = $("[data-qwen-sheet]");
    assert.equal(sheet.hidden, false);
    assert.equal($("[data-qwen-history]").getAttribute("aria-expanded"), "true");
    assert.ok(sheet.querySelector("[data-sheet-header]"), "shared sheet header");
    assert.deepEqual([...sheet.querySelectorAll(".qx-history-open strong")].map(node => node.textContent), ["新しいほう", "古いチャット"]);
    assert.match(sheet.querySelector('[data-chat-id="a"] small').textContent, /^Other · /);

    sheet.querySelector('[data-chat-id="a"]').click();
    assert.equal(sheet.hidden, true);
    assert.equal($("[data-qwen-project]").textContent, "Other", "a chat runs in its own project");

    $("[data-qwen-history]").click();
    sheet.querySelector('[data-delete-chat="a"]').click();
    assert.equal(sheet.querySelectorAll(".qx-history-row").length, 2, "cancelled confirm keeps the chat");
    answer = true;
    sheet.querySelector('[data-delete-chat="a"]').click();
    assert.equal(sheet.querySelectorAll(".qx-history-row").length, 1);
    assert.deepEqual(JSON.parse(dom.window.localStorage.getItem(QWEN_CHATS_KEY)).chats.map(chat => chat.id), ["b"]);
    assert.equal($("[data-qwen-welcome]").hidden, false, "deleting the open chat leaves a new empty one");

    sheet.querySelector(".dm-sheet-head-primary").click();
    assert.equal(sheet.hidden, true);
    assert.equal($("[data-qwen-project]").textContent, "DevMoter-FAST");
    $("[data-qwen-history]").click();
    sheet.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    assert.equal(sheet.hidden, true, "Escape closes the sheet");
  } finally {
    dom.window.close();
  }
});
