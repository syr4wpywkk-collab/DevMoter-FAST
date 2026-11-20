import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript-legacy";
import { JSDOM } from "jsdom";
import * as i18nCore from "../src/i18n-core.mjs";
import * as deviceGate from "../src/device-gate.mjs";
import {
  DEEPSEEK_UI_ENABLED,
  VISIBLE_CHAT_BACKENDS,
  isVisibleChatBackend,
  normalizeVisibleBackend,
  normalizeVisibleSurface
} from "../src/feature-flags.mjs";
import { isMainSurface, initialMainSurface } from "../src/surface-navigation.mjs";
import { chatDraftKey } from "../src/chat-draft.mjs";

test("deepseek is hidden from pickers and falls back while DEEPSEEK_UI_ENABLED is false", () => {
  // Owner decision 2026-11-20: hide DeepSeek from the backend pickers for
  // now. The implementation stays mounted behind the gate (see the mount
  // tests below); flipping DEEPSEEK_UI_ENABLED to true restores routing.
  assert.equal(DEEPSEEK_UI_ENABLED, false);
  assert.ok(!VISIBLE_CHAT_BACKENDS.includes("deepseek"));
  assert.equal(isVisibleChatBackend("deepseek"), false);
  assert.equal(normalizeVisibleBackend("deepseek"), "opencode");
  assert.equal(normalizeVisibleSurface("deepseek"), "opencode");
  assert.equal(isMainSurface("deepseek"), false);
  assert.equal(initialMainSurface("?surface=deepseek"), "opencode");
  assert.equal(initialMainSurface("?backend=deepseek"), "opencode");
});

test("deepseek chat drafts are stored separately from api chat drafts", () => {
  assert.notEqual(chatDraftKey("deepseek-chat", "p1"), chatDraftKey("api-chat", "p1"));
  assert.match(chatDraftKey("deepseek-chat", "p1"), /deepseek-chat/);
});

// --- Dedicated DeepSeek surface (API Chat mount pinned to the deepseek preset) ---

const compile = source => ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
}).outputText;
const apiSource = await readFile(new URL("../src/api-chat.ts", import.meta.url), "utf8");
const compiledApi = compile(apiSource);
const modules = new Map(await Promise.all(ts.preProcessFile(apiSource).importedFiles
  .filter(({ fileName }) => fileName.endsWith(".mjs"))
  .map(async ({ fileName }) => [fileName, await import(new URL("../src/" + fileName.slice(2), import.meta.url))])));
const settle = () => new Promise(resolve => setImmediate(resolve));

const presets = [
  { id: "openai", name: "OpenAI", protocol: "openai-compatible", baseUrl: "https://api.openai.com/v1" },
  { id: "deepseek", name: "DeepSeek", protocol: "openai-compatible", baseUrl: "https://api.deepseek.com" },
  { id: "custom", name: "Custom API", protocol: "openai-compatible", baseUrl: "" }
];
const deepseekProvider = {
  id: "ui-deepseek", presetId: "deepseek", name: "DeepSeek", protocol: "openai-compatible",
  baseUrl: "https://api.deepseek.com", ready: true,
  models: ["deepseek-chat", "deepseek-reasoner"], reasoningModes: ["auto"], source: "file", editable: true
};
const openAiProvider = {
  id: "ui-openai", presetId: "openai", name: "OpenAI", protocol: "openai-compatible",
  baseUrl: "https://api.openai.com/v1", ready: true,
  models: ["gpt-example"], reasoningModes: ["auto"], source: "file", editable: true
};

// Mirrors the DeepSeek mount options used by src/main.ts.
const DEEPSEEK_MOUNT_OPTIONS = {
  surfaceId: "deepseek",
  fixedPresetId: "deepseek",
  brandName: "DeepSeek",
  brandIcon: "◆",
  identityAriaKey: "deepseekChat.unifiedIdentityAria",
  welcomePromptKey: "deepseekChat.welcomePrompt",
  addProviderHintKey: "deepseekChat.addApiHint",
  agentSummaryKey: "apiChat.agentDeepseekSummary",
  providerStorageKey: "devmoter-deepseek-provider",
  draftProvider: "deepseek-chat",
  modeClass: "deepseek-mode"
};

function mountDeepseek(t, { providers }) {
  const dom = new JSDOM('<!doctype html><div id="root"></div>', {
    url: "https://devmoter.example/?surface=deepseek&unifiedUI=0", runScripts: "outside-only"
  });
  t.after(() => dom.window.close());
  const { document, HTMLElement } = dom.window;
  Object.defineProperty(HTMLElement.prototype, "inert", {
    get() { return this.hasAttribute("inert"); },
    set(value) { this.toggleAttribute("inert", Boolean(value)); }
  });
  HTMLElement.prototype.getClientRects = function () {
    if (this.closest('.hidden, [hidden], [inert], [aria-hidden="true"], .api-preset-select-hidden')) return [];
    const details = this.closest("details:not([open])");
    if (details && this !== details.querySelector("summary")) return [];
    return [{ width: 44, height: 44 }];
  };
  dom.window.Headers = Headers;
  dom.window.matchMedia = () => ({ matches: false, addEventListener() {} });
  dom.window.setInterval = () => 1;
  dom.window.setTimeout = () => 1;
  dom.window.requestAnimationFrame = () => 1;
  dom.window.localStorage.setItem("devmoter-device-token", "test-device-token");
  const requests = [];
  const chatBodies = [];
  dom.window.fetch = async (input, init = {}) => {
    const path = String(input);
    requests.push({ path, method: init.method || "GET" });
    const response = payload => ({ ok: true, status: 200, json: async () => payload });
    if (path === "/api/llm/providers") return response({ providers });
    if (path === "/api/llm/presets") return response({ presets });
    if (path === "/api/llm/chat") {
      chatBodies.push(JSON.parse(init.body));
      return response({ message: { content: "Hello from DeepSeek" } });
    }
    throw new Error(`Unexpected API request: ${path}`);
  };
  dom.window.require = name => {
    if (name === "./i18n") return i18nCore;
    if (name.endsWith(".css")) return {};
    if (name === "./device-gate.mjs") return deviceGate;
    if (modules.has(name)) return modules.get(name);
    throw new Error(`Unexpected dependency: ${name}`);
  };
  dom.window.exports = {};
  dom.window.eval(compiledApi);
  document.body.classList.add("deepseek-mode");
  const switched = [];
  const controller = dom.window.exports.mountApiChat(document.querySelector("#root"), {
    ...DEEPSEEK_MOUNT_OPTIONS,
    onCodex: () => switched.push("codex"),
    onOpenCode: () => switched.push("opencode"),
    onApi: () => switched.push("api")
  });
  const query = selector => document.querySelector(selector);
  return { dom, document, query, controller, requests, chatBodies, switched };
}

test("deepseek surface shows only deepseek providers and deepseek models", async t => {
  const { document, query } = mountDeepseek(t, { providers: [openAiProvider, deepseekProvider] });
  await settle();
  await settle();

  assert.equal(query(".api-brand strong").textContent, "DeepSeek");
  assert.equal(query("#apiWelcome h1").textContent, "DeepSeek");
  assert.deepEqual(
    [...query("#apiProvider").querySelectorAll("option")].map(option => option.value),
    ["ui-deepseek"],
    "the provider picker is pinned to DeepSeek providers"
  );
  assert.deepEqual(
    [...query("#apiModel").querySelectorAll("option")].map(option => option.value),
    ["deepseek-chat", "deepseek-reasoner"]
  );

  // The agent switcher offers the other backends and marks DeepSeek current.
  assert.ok(query("#apiGoApi"), "API Chat is reachable from the DeepSeek surface");
  assert.equal(query("#apiAgentCurrent").dataset.agent, "deepseek");

  // Provider selection is remembered under the DeepSeek key, never the API Chat key.
  const providerSelect = query("#apiProvider");
  providerSelect.dispatchEvent(new document.defaultView.Event("change", { bubbles: true }));
  assert.equal(document.defaultView.localStorage.getItem("devmoter-deepseek-provider"), "ui-deepseek");
  assert.equal(document.defaultView.localStorage.getItem("devmoter-api-provider"), null);
});

test("deepseek surface sends chat through the deepseek provider", async t => {
  const { document, query, chatBodies, switched } = mountDeepseek(t, { providers: [deepseekProvider] });
  await settle();
  await settle();

  const prompt = query("#apiPrompt");
  prompt.value = "Say hello";
  query("#apiForm").dispatchEvent(new document.defaultView.Event("submit", { bubbles: true, cancelable: true }));
  await settle();
  await settle();

  assert.equal(chatBodies.length, 1);
  assert.equal(chatBodies[0].providerId, "ui-deepseek");
  assert.equal(chatBodies[0].model, "deepseek-chat");
  assert.match(query("#apiTranscript").textContent, /Hello from DeepSeek/);

  query("#apiMenu").click();
  query("#apiGoApi").click();
  query("#apiGoCodex").click();
  assert.deepEqual(switched, ["api", "codex"]);
});

test("deepseek surface without a deepseek provider guides to deepseek key setup", async t => {
  const { query } = mountDeepseek(t, { providers: [openAiProvider] });
  await settle();
  await settle();

  const providerSelect = query("#apiProvider");
  assert.deepEqual([...providerSelect.querySelectorAll("option")].map(option => option.value), [""]);
  assert.equal(query("#apiStatus").textContent, i18nCore.t("deepseekChat.addApiHint"));
  assert.equal(query("#apiSend").disabled, true);

  // The shared provider settings open with the DeepSeek preset preselected and locked.
  query("#apiSettingsTop").click();
  await settle();
  await settle();
  query("#apiSettingsBody .api-settings-toolbar .primary").click();
  await settle();
  await settle();
  const presetSelect = query('select[data-field="preset"]');
  assert.equal(presetSelect.value, "deepseek");
  assert.equal(presetSelect.disabled, true);
});
