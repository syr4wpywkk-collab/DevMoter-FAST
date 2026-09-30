import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";
import { JSDOM } from "jsdom";
import { renderChatMarkdown } from "../src/chat-markdown.mjs";

const source = await readFile(new URL("../src/api-chat.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
}).outputText;
const settle = () => new Promise(resolve => setImmediate(resolve));
const reply = payload => new Response(JSON.stringify(payload), {
  headers: { "content-type": "application/json" }
});

async function harness(t) {
  const dom = new JSDOM('<!doctype html><main id="root"></main>', {
    url: "https://devmoter.example/chat", runScripts: "outside-only"
  });
  t.after(() => dom.window.close());
  const { window } = dom;
  const root = window.document.querySelector("#root");
  const providers = [
    { id: "alpha", name: "Alpha", ready: true, protocol: "openai-compatible", baseUrl: "https://alpha.example/v1", models: ["alpha-1", "alpha-2"], reasoningModes: ["auto", "low", "high"] },
    { id: "beta", name: "Beta", ready: true, protocol: "anthropic", baseUrl: "https://beta.example", models: ["beta-1", "beta-2"], reasoningModes: ["auto", "medium", "high"] }
  ];
  const requests = [];
  const chats = [];
  const uploads = [];
  const copied = [];
  window.Headers = Headers;
  window.AbortController = AbortController;
  window.URL.createObjectURL = file => `blob:https://devmoter.example/${file.name}`;
  window.URL.revokeObjectURL = () => {};
  Object.defineProperty(window.navigator, "clipboard", {
    value: { writeText: async text => copied.push(text) }
  });
  window.localStorage.setItem("devmoter-device-token", "paired-test-device");
  window.localStorage.setItem("opencode-pocket-project", "project-1");
  window.fetch = (input, init = {}) => {
    const path = new URL(String(input), window.location.href).pathname;
    const request = { path, init, body: typeof init.body === "string" ? JSON.parse(init.body) : init.body };
    requests.push(request);
    if (path === "/api/llm/chat" || (path === "/api/llm/attachments" && init.method === "POST")) {
      // Deliberately allow late resolution after abort to exercise the UI's own
      // generation boundary independently of fetch cancellation behavior.
      return new Promise(resolve => {
        request.resolve = payload => resolve(reply(payload));
        (path === "/api/llm/chat" ? chats : uploads).push(request);
      });
    }
    if (path === "/api/llm/providers") return Promise.resolve(reply({ providers }));
    if (path === "/api/llm/presets") return Promise.resolve(reply({ presets: [
      { id: "custom", name: "Custom", protocol: "openai-compatible", baseUrl: "https://custom.example/v1" }
    ] }));
    return Promise.resolve(reply({}));
  };
  const exports = {};
  const modules = {
    "./i18n": { getLanguage: () => "en" },
    "./chat-markdown.mjs": { renderChatMarkdown }
  };
  window.Function("require", "exports", compiled)(name => {
    if (name.endsWith(".css")) return {};
    assert.ok(Object.hasOwn(modules, name), `unexpected module: ${name}`);
    return modules[name];
  }, exports);
  const controller = exports.mountApiChat(root);
  await settle();
  const select = (id, value) => {
    const node = root.querySelector(`#${id}`);
    node.value = value;
    node.dispatchEvent(new window.Event("change", { bubbles: true }));
  };
  return {
    root, window, controller, requests, chats, uploads, copied, providers, select,
    history: () => [...root.querySelectorAll("#apiHistory .api-history-row")],
    historyChat(title) {
      const row = this.history().find(node => node.querySelector("strong")?.textContent === title);
      assert.ok(row, `history entry for ${title}`);
      return row;
    },
    submit(text) {
      root.querySelector("#apiPrompt").value = text;
      root.querySelector("#apiForm").dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
      return chats.at(-1);
    },
    async answer(text, content) {
      const request = this.submit(text);
      request.resolve({ message: { content } });
      await settle();
      return request;
    }
  };
}

test("API conversations restore raw messages and provider choices with safe Markdown and exact copy", async t => {
  const ui = await harness(t);
  const form = ui.root.querySelector("#apiForm");
  const selects = ["apiProvider", "apiModel", "apiReasoning"].map(id => ui.root.querySelector(`#${id}`));
  for (const select of selects) assert.equal(select.closest("form"), form, "real select lives in composer");
  ui.select("apiModel", "alpha-2");
  ui.select("apiReasoning", "high");
  const raw = "## First answer\n\n**Ready**\n\n<script>alert(1)</script>\n\n```js\n  value  \n```\n";
  const first = ui.submit("First conversation");
  assert.deepEqual(selects.map(select => select.disabled), [true, true, true]);
  assert.equal(first.body.providerId, "alpha");
  assert.equal(first.body.model, "alpha-2");
  assert.equal(first.body.reasoning, "high");
  assert.equal(first.init.headers.get("x-devmoter-device-token"), "paired-test-device");
  assert.ok(first.init.headers.get("x-pocket-operation-id"));
  first.resolve({ message: { content: raw } });
  await settle();
  assert.deepEqual(selects.map(select => select.disabled), [false, false, false]);
  const answer = ui.root.querySelector(".api-message.assistant");
  assert.equal(answer.querySelector("h2").textContent, "First answer");
  assert.equal(answer.querySelector("strong").textContent, "Ready");
  assert.equal(answer.querySelector("script"), null);
  answer.querySelector(".dm-code-copy").click();
  answer.querySelector(".api-message-copy").click();
  assert.deepEqual(ui.copied, ["  value  \n", raw]);
  answer.querySelector("h2").textContent = "tampered heading";
  answer.querySelector(".api-message-copy").click();
  assert.equal(ui.copied.at(-1), raw, "whole-response copy is source-backed after DOM mutation");
  answer.querySelector(".api-message-bubble").textContent = "tampered rendered response";

  ui.root.querySelector("#apiNewChat").click();
  assert.equal(ui.root.querySelectorAll(".api-message").length, 0);
  ui.select("apiProvider", "beta");
  ui.select("apiModel", "beta-2");
  ui.select("apiReasoning", "medium");
  await ui.answer("Second conversation", "Second answer\n");
  ui.historyChat("First conversation").click();
  assert.deepEqual(selects.map(select => select.value), ["alpha", "alpha-2", "high"]);
  assert.equal(ui.root.querySelector(".api-message.user").textContent, "First conversation");
  const restored = ui.root.querySelector(".api-message.assistant");
  assert.equal(restored.querySelector("h2").textContent, "First answer");
  restored.querySelector(".api-message-copy").click();
  assert.equal(ui.copied.at(-1), raw, "history restores canonical raw text rather than rendered text");
  ui.historyChat("Second conversation").click();
  assert.deepEqual(selects.map(select => select.value), ["beta", "beta-2", "medium"]);
  assert.match(ui.root.querySelector(".api-message.assistant").textContent, /Second answer/);
  assert.ok(ui.history().some(row => row.classList.contains("active") || row.getAttribute("aria-current") === "true"));
  assert.match(ui.root.querySelector("#apiSidebar").textContent, /this tab|current tab|このタブ|当前标签/i);
  for (const key of Object.keys(ui.window.localStorage)) assert.doesNotMatch(key, /conversation|history/i);

  ui.root.querySelector("#apiSettingsTop").click();
  await settle();
  assert.equal(ui.root.querySelector("#apiSettingsModal").classList.contains("hidden"), false);
  assert.ok(ui.requests.some(request => request.path === "/api/llm/presets"));
  assert.equal(ui.root.querySelectorAll(".api-provider-settings-item").length, 2);
});

test("new chat and history switching abort active responses and reject late replies", async t => {
  const ui = await harness(t);
  const old = ui.submit("Old pending conversation");
  ui.root.querySelector("#apiNewChat").click();
  assert.equal(old.init.signal.aborted, true);
  const current = ui.submit("New conversation");
  old.resolve({ message: { content: "STALE AFTER NEW CHAT" } });
  await settle();
  assert.ok(!ui.root.querySelector("#apiTranscript").textContent.includes("STALE"));
  assert.equal(ui.root.querySelector("#apiSend").disabled, true, "old finally does not clear current sending state");
  current.resolve({ message: { content: "Current answer" } });
  await settle();
  const pending = ui.submit("Pending before switching history");
  ui.historyChat("Old pending conversation").click();
  assert.equal(pending.init.signal.aborted, true);
  pending.resolve({ message: { content: "STALE AFTER HISTORY SWITCH" } });
  await settle();
  assert.equal(ui.root.querySelectorAll(".api-message.assistant").length, 0);
  assert.equal(ui.root.querySelector(".api-message.user").textContent, "Old pending conversation");
  ui.historyChat("New conversation").click();
  assert.equal(ui.root.querySelectorAll(".api-message.assistant").length, 1);
  assert.ok(!ui.root.querySelector("#apiTranscript").textContent.includes("STALE"));
});

test("uploading disables conversation navigation until the attachment belongs to its original chat", async t => {
  const ui = await harness(t);
  await ui.answer("Archived conversation", "Archived answer");
  ui.root.querySelector("#apiNewChat").click();
  const prompt = ui.root.querySelector("#apiPrompt");
  prompt.value = "Image draft";
  const imageInput = ui.root.querySelector("#apiImageInput");
  const file = new ui.window.File(["image bytes"], "photo.png", { type: "image/png" });
  Object.defineProperty(imageInput, "files", { configurable: true, value: [file] });
  imageInput.dispatchEvent(new ui.window.Event("change", { bubbles: true }));
  assert.equal(ui.uploads.length, 1);
  assert.equal(ui.root.querySelector("#apiNewChat").disabled, true);
  assert.ok(ui.history().length > 0);
  assert.ok(ui.history().every(row => row.disabled));
  ui.root.querySelector("#apiNewChat").click();
  ui.historyChat("Archived conversation").click();
  assert.equal(prompt.value, "Image draft");
  assert.equal(ui.root.querySelectorAll(".api-message").length, 0);
  ui.uploads[0].resolve({ attachment: { id: "upload-1", name: "photo.png", mime: "image/png", size: file.size } });
  await settle();
  assert.equal(ui.root.querySelector("#apiNewChat").disabled, false);
  assert.ok(ui.history().every(row => !row.disabled));
  assert.match(ui.root.querySelector("#apiAttachments").textContent, /photo\.png/);
  const request = ui.submit("Image draft");
  assert.equal(request.body.messages.at(-1).attachments[0].id, "upload-1");
  request.resolve({ message: { content: "Image answer" } });
  await settle();
  ui.historyChat("Archived conversation").click();
  assert.ok(!ui.root.querySelector("#apiTranscript").textContent.includes("photo.png"));
  ui.historyChat("Image draft").click();
  assert.match(ui.root.querySelector("#apiTranscript").textContent, /photo\.png/);
});

test("memory history keeps at most 20 conversations and 100 messages per conversation", async t => {
  const ui = await harness(t);
  for (let index = 0; index < 52; index += 1) {
    const request = await ui.answer(`Long conversation ${index}`, `Reply ${index}`);
    assert.ok(request.body.messages.length <= 100);
  }
  assert.equal(ui.root.querySelectorAll(".api-message").length, 100);
  assert.ok(![...ui.root.querySelectorAll(".api-message.user")].some(row => row.textContent === "Long conversation 0"));
  for (let index = 0; index < 21; index += 1) {
    ui.root.querySelector("#apiNewChat").click();
    await ui.answer(`Bounded chat ${index}`, `Answer ${index}`);
    assert.ok(ui.history().length <= 20);
  }
  assert.equal(ui.history().length, 20);
  assert.ok(!ui.history().some(row => row.textContent.includes("Long conversation 0")));
  assert.ok(!ui.history().some(row => row.textContent.includes("Bounded chat 0")));
  ui.historyChat("Bounded chat 1").click();
  assert.equal(ui.root.querySelector(".api-message.user").textContent, "Bounded chat 1");
});
