import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { JSDOM } from "jsdom";
import { CHAT_HISTORY_ICON, chatHistoryTriggerMarkup } from "../src/chat-history-trigger.mjs";
import { DICTIONARIES } from "../src/i18n-core.mjs";

const source = path => readFile(new URL(`../src/${path}`, import.meta.url), "utf8");

test("history trigger reuses the registry history line icon", async () => {
  const registry = await source("app-registry.ts");
  const match = registry.match(/^\s+"history": '(<svg[^']*)',$/m);
  assert.ok(match, "app-registry.ts defines the history icon");
  assert.equal(CHAT_HISTORY_ICON, match[1]);
});

test("history trigger markup is an escaped, labelled icon button", () => {
  const { document } = new JSDOM("").window;
  document.body.innerHTML = chatHistoryTriggerMarkup({ id: "x", className: "a b", ariaLabel: 'Open "history"', title: "<History>" });
  const button = document.querySelector("button#x");
  assert.equal(button.type, "button");
  assert.equal(button.className, "a b");
  assert.equal(button.getAttribute("aria-label"), 'Open "history"');
  assert.equal(button.title, "<History>");
  assert.ok(button.hasAttribute("data-chat-history-trigger"));
  assert.equal(button.textContent, "", "no ☰ glyph: the icon is the only content");
  assert.ok(button.querySelector("svg[aria-hidden='true']"));
});

test("Codex, OpenCode and API Chat share one history trigger distinct from ☰", async () => {
  const files = { codex: ["codex.ts", "cxMenu"], opencode: ["opencode.ts", "ocxMenu"], api: ["api-chat.ts", "apiMenu"] };
  for (const [surface, [file, id]] of Object.entries(files)) {
    const code = await source(file);
    assert.ok(code.includes(`chatHistoryTriggerMarkup({ id: "${id}"`), `${surface} renders the shared trigger`);
    assert.ok(code.includes('ariaLabel: t("nav.openChatHistoryAria"), title: t("nav.chatHistoryTitle")'), `${surface} uses the shared label`);
    assert.ok(!new RegExp(`id="${id}"[^>]*>☰<`).test(code), `${surface} history trigger is not a ☰ glyph`);
  }
  const nav = await source("unified-workspace-nav.ts");
  assert.match(nav, /data-workspace-menu-button[^>]*>☰</, "☰ stays the screen/AI switcher");
  for (const [language, dictionary] of Object.entries(DICTIONARIES)) {
    assert.ok(dictionary["nav.openChatHistoryAria"], `${language} names the history trigger`);
    assert.ok(dictionary["nav.chatHistoryTitle"], `${language} titles the history trigger`);
    assert.notEqual(dictionary["nav.openChatHistoryAria"], dictionary["nav.switchScreenAria"], `${language} labels differ from ☰`);
  }
});
