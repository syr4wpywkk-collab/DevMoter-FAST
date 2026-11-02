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
const PRESETS = [
  { id: "coding-plan", label: "Coding Plan", group: "alibaba", title: "Alibaba ModelStudio", baseUrls: [{ id: "aliyun", label: "China (Beijing)" }, { id: "alibabacloud", label: "Singapore (International)" }], custom: false, protocols: ["openai"], modelsEditable: true, keyPlaceholder: "sk-sp-...", models: [{ id: "qwen3-coder-plus" }, { id: "glm-5" }] },
  { id: "openrouter", label: "OpenRouter", group: "third-party", title: "Third-party Providers", baseUrls: [{ id: "default", label: "" }], custom: false, protocols: ["openai"], modelsEditable: true, keyPlaceholder: "", models: [{ id: "z-ai/glm-4.5-air:free" }] },
  { id: "custom-openai-compatible", label: "Custom Provider", group: "custom", title: "Custom Provider", baseUrls: [], custom: true, protocols: ["openai", "anthropic", "gemini"], modelsEditable: true, keyPlaceholder: "", models: [] }
];
const MODELS = {
  version: "0.26.6", scope: "user", defaultModel: "coder-model",
  groups: [{ id: "coding-plan:aliyun", label: "ModelStudio Coding Plan" }, { id: "openrouter:default", label: "OpenRouter" }],
  models: [
    { id: "qwen3-coder-plus", name: "[ModelStudio Coding Plan] qwen3-coder-plus", authType: "openai", group: "coding-plan:aliyun", host: "coding.dashscope.aliyuncs.com" },
    { id: "glm-5", name: "[ModelStudio Coding Plan] glm-5", authType: "openai", group: "coding-plan:aliyun", host: "coding.dashscope.aliyuncs.com" },
    { id: "z-ai/glm-4.5-air:free", name: "[OpenRouter] z-ai/glm-4.5-air:free", authType: "openai", group: "openrouter:default", host: "openrouter.ai", disabled: true, reason: "APIキーが未設定です" }
  ],
  presets: PRESETS
};

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

async function mount({ chat, seed, confirm = () => true, models = () => ({ ok: true, json: async () => MODELS }), install } = {}) {
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
      if (String(path).startsWith("/api/qwen/models?")) return models(path);
      if (path === "/api/qwen/providers") return install(JSON.parse(init.body));
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

test("model picker: default first, provider chips, search, disabled with a reason, choice remembered and sent", async () => {
  const { dom, root, $, type, requests } = await mount({
    seed: { version: 1, chats: [{ id: "c1", title: "前の話", sessionId: SID, projectId: "p1", updatedAt: Date.now(), messages: [{ role: "user", text: "前" }, { role: "assistant", text: "はい" }] }] },
    chat: () => ndjsonResponse([{ type: "done", text: "ok", sessionId: SID }])
  });
  try {
    const chip = $("[data-qwen-model-button]");
    assert.equal(chip.textContent, "既定");
    assert.equal(chip.getAttribute("aria-label"), "モデル: Qwen Code の既定");
    assert.ok(chip.querySelector("svg"), "line icon");
    chip.click();
    await tick(10);
    const sheet = $("[data-qwen-picker]");
    assert.equal(sheet.hidden, false);
    assert.equal(chip.getAttribute("aria-expanded"), "true");
    assert.equal($("[data-qwen-scrim]").hidden, false);
    assert.ok(sheet.querySelector("[data-sheet-header]"), "shared sheet header");
    assert.equal(sheet.querySelector(".dm-sheet-head-title").textContent, "モデル");
    assert.equal(sheet.querySelector(".dm-sheet-head-primary").textContent, "APIを追加");
    assert.ok(requests.find(request => String(request.path) === "/api/qwen/models?projectId=p1"));
    const rows = () => [...sheet.querySelectorAll("[data-qwen-model]")];
    assert.equal(rows()[0].querySelector("strong").textContent, "Qwen Code の既定");
    assert.match(rows()[0].textContent, /coder-model/);
    assert.equal(rows()[0].getAttribute("aria-selected"), "true");
    assert.ok(rows()[0].querySelector(".qx-picker-check svg"), "selected check");
    assert.deepEqual([...sheet.querySelectorAll(".qx-picker-chip")].map(node => node.textContent), ["すべて", "ModelStudio Coding Plan", "OpenRouter"]);
    const disabled = sheet.querySelector('[data-qwen-model="openai/z-ai/glm-4.5-air:free"]');
    assert.equal(disabled.disabled, true, "unusable models stay visible but disabled");
    assert.match(disabled.textContent, /APIキーが未設定です/);

    sheet.querySelector('[data-group="openrouter:default"]').click();
    assert.deepEqual(rows().map(row => row.dataset.qwenModel), ["openai/z-ai/glm-4.5-air:free"], "a provider chip filters and hides the default row");
    sheet.querySelector('[data-group="all"]').click();
    const search = sheet.querySelector("[data-qwen-model-search]");
    search.value = "GLM-5";
    search.dispatchEvent(new dom.window.Event("input"));
    assert.deepEqual(rows().map(row => row.dataset.qwenModel), ["openai/glm-5"]);
    search.value = "zzz";
    search.dispatchEvent(new dom.window.Event("input"));
    assert.match(sheet.querySelector(".qx-picker-state").textContent, /「zzz」に一致するモデルはありません/);
    search.value = "";
    search.dispatchEvent(new dom.window.Event("input"));

    sheet.querySelector('[data-qwen-model="openai/glm-5"]').click();
    assert.equal(sheet.hidden, true);
    assert.equal(chip.textContent, "glm-5");
    assert.equal(chip.getAttribute("aria-expanded"), "false");
    assert.deepEqual(JSON.parse(dom.window.localStorage.getItem("devmoter-qwen-model")), { id: "glm-5", authType: "openai", name: "[ModelStudio Coding Plan] glm-5" });

    type("続きをお願い");
    await tick(150);
    const sent = requests.find(request => request.path === "/api/qwen/chat");
    assert.deepEqual(sent.body.model, { authType: "openai", id: "glm-5" });
    assert.equal(sent.body.sessionId, SID, "the session resumes with the new model");
    const note = root.querySelector("[data-qwen-note]");
    assert.match(note.textContent, /ここから glm-5 で応答します/);

    chip.click();
    await tick(10);
    const recent = sheet.querySelector(".qx-picker-section h3");
    assert.equal(recent.textContent, "最近使ったモデル", "recent models come first");
    assert.equal(sheet.querySelector('[data-qwen-model="openai/glm-5"]').getAttribute("aria-selected"), "true");
    rows()[0].click();
    assert.equal(chip.textContent, "既定");
    assert.equal(dom.window.localStorage.getItem("devmoter-qwen-model"), null);
  } finally {
    dom.window.close();
  }
});

test("model picker: empty and error states, then add an API like /auth and select its model", async () => {
  let listing = { ...MODELS, scope: "none", defaultModel: null, groups: [], models: [] };
  let fail = true;
  const installs = [];
  const { dom, $ } = await mount({
    chat: () => ndjsonResponse([]),
    models: () => fail
      ? { ok: false, status: 500, json: async () => ({ error: "Qwen Code の settings.json を読めませんでした。書式を確認してください" }) }
      : { ok: true, json: async () => listing },
    install: body => {
      installs.push(body);
      if (body.apiKey === "bad") return { ok: false, status: 400, json: async () => ({ error: "このプランのキーは「sk-sp-」で始まります" }) };
      listing = { ...MODELS, models: MODELS.models.slice(0, 2), groups: MODELS.groups.slice(0, 1) };
      return { ok: true, json: async () => ({ presetId: body.presetId, added: [{ id: "qwen3-coder-plus", authType: "openai" }] }) };
    }
  });
  try {
    $("[data-qwen-model-button]").click();
    await tick(10);
    const sheet = $("[data-qwen-picker]");
    assert.match(sheet.querySelector("[role=alert]").textContent, /settings\.json/);
    fail = false;
    sheet.querySelector("[data-qwen-picker-retry]").click();
    await tick(10);
    const empty = sheet.querySelector("[data-qwen-picker-empty]");
    assert.match(empty.textContent, /まだありません/);
    const buttons = empty.querySelectorAll("button");
    assert.equal(buttons.length, 1);
    assert.equal(buttons[0].textContent, "APIを追加");
    assert.equal(sheet.querySelector(".dm-sheet-head-primary").hidden, true, "one 「APIを追加」 button in the empty state");
    buttons[0].click();

    assert.equal(sheet.querySelector(".dm-sheet-head-title").textContent, "APIを追加");
    assert.equal(sheet.querySelector("[data-qwen-picker-back]").hidden, false);
    assert.deepEqual([...sheet.querySelectorAll(".qx-picker-section h3")].map(node => node.textContent), ["Alibaba ModelStudio", "Third-party Providers", "Custom Provider"]);
    sheet.querySelector('[data-qwen-preset="coding-plan"]').click();
    const form = sheet.querySelector("[data-qwen-provider-form]");
    assert.deepEqual([...form.querySelectorAll("select[name=baseUrlId] option")].map(node => node.textContent), ["China (Beijing)", "Singapore (International)"]);
    const key = form.querySelector("input[name=apiKey]");
    assert.equal(key.type, "password");
    assert.equal(key.placeholder, "sk-sp-...");
    assert.deepEqual([...form.querySelectorAll(".qx-check input")].map(box => box.checked), [true, true]);

    form.querySelector("[data-qwen-provider-submit]").click();
    form.dispatchEvent(new dom.window.Event("submit", { cancelable: true }));
    await tick(10);
    assert.equal(installs.length, 0, "an empty key is caught before the request");
    assert.match(form.querySelector(".qx-picker-message").textContent, /APIキーを入力/);

    key.value = "bad";
    form.dispatchEvent(new dom.window.Event("submit", { cancelable: true }));
    await tick(10);
    assert.match(form.querySelector("[role=alert]").textContent, /sk-sp-/);

    form.querySelector("select[name=baseUrlId]").value = "alibabacloud";
    form.querySelectorAll(".qx-check input")[1].checked = false;
    form.querySelector("input[name=modelIds]").value = "qwen3-max, kimi-k2.5";
    key.value = "sk-sp-good";
    form.dispatchEvent(new dom.window.Event("submit", { cancelable: true }));
    await tick(20);
    assert.deepEqual(installs.at(-1), { presetId: "coding-plan", baseUrlId: "alibabacloud", apiKey: "sk-sp-good", modelIds: ["qwen3-coder-plus", "qwen3-max", "kimi-k2.5"] });
    assert.equal(sheet.hidden, true, "the added model is selected and the picker closes");
    assert.equal($("[data-qwen-model-button]").textContent, "qwen3-coder-plus");
    assert.ok(!JSON.stringify({ ...dom.window.localStorage }).includes("sk-sp-good"), "the key is not kept in the browser");

    $("[data-qwen-model-button]").click();
    await tick(10);
    sheet.querySelector(".dm-sheet-head-primary").click();
    sheet.querySelector('[data-qwen-preset="custom-openai-compatible"]').click();
    const custom = sheet.querySelector("[data-qwen-provider-form]");
    assert.deepEqual([...custom.querySelectorAll("select[name=protocol] option")].map(node => node.value), ["openai", "anthropic", "gemini"]);
    assert.equal(custom.querySelector("input[name=baseUrl]").type, "url");
    custom.querySelector("input[name=apiKey]").value = "k";
    custom.dispatchEvent(new dom.window.Event("submit", { cancelable: true }));
    await tick(10);
    assert.match(custom.querySelector(".qx-picker-message").textContent, /Base URL/);
    sheet.querySelector("[data-qwen-picker-back]").click();
    assert.equal(sheet.querySelector(".dm-sheet-head-title").textContent, "APIを追加");
    sheet.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    assert.equal(sheet.hidden, true, "Escape closes the picker");
  } finally {
    dom.window.close();
  }
});

test("model helpers: stored choice is validated, recent list is bounded and deduplicated", async () => {
  const store = await import("../src/qwen-model-store.mjs");
  const storage = memoryStorage({ [store.QWEN_MODEL_KEY]: JSON.stringify({ id: "m", authType: "qwen-oauth" }) });
  assert.equal(store.loadQwenModel(storage), null, "qwen-oauth or junk falls back to the default");
  for (const id of ["a", "b", "c", "d", "e", "f", "b"]) store.saveQwenModel(storage, { id, authType: "openai", name: id });
  assert.deepEqual(store.loadRecentQwenModels(storage).map(item => item.id), ["b", "f", "e", "d", "c"]);
  assert.equal(store.qwenModelChipLabel({ id: "z-ai/glm-4.5-air:free" }), "glm-4.5-air:free");
  assert.equal(store.qwenModelChipLabel(null), "既定");
});
