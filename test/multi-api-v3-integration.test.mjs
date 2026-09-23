import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const serverSource = await readFile(new URL("../server.mjs", import.meta.url), "utf8");
const apiChatSource = await readFile(new URL("../src/api-chat.ts", import.meta.url), "utf8");
const mainSource = await readFile(new URL("../src/main.ts", import.meta.url), "utf8");
const i18nSource = await readFile(new URL("../src/i18n.ts", import.meta.url), "utf8");

test("multi-API routes remain behind the v3 owner authentication gates", () => {
  const auth = serverSource.indexOf("if (!basicAuthenticated && !ownerSession)");
  const origin = serverSource.indexOf("if (!requireSameOriginMutation(req, res, DEVMOTER_PUBLIC_ORIGIN)) return;", auth);
  const passkey = serverSource.indexOf("PASSKEY_REQUIRED &&");
  const llm = serverSource.indexOf('url.pathname === "/api/llm/providers"');

  assert.ok(auth > 0);
  assert.ok(origin > auth);
  assert.ok(passkey > origin);
  assert.ok(llm > passkey);
  assert.match(serverSource, /claimOperation\(req, res, `\$\{req\.method\}:\$\{url\.pathname\}`\)/);
});

test("API chat bounds history and invalidates stale completions on New Chat", () => {
  assert.match(apiChatSource, /const API_CHAT_HISTORY_LIMIT = 100/);
  assert.match(apiChatSource, /messages\.slice\(-API_CHAT_HISTORY_LIMIT\)/);
  assert.match(apiChatSource, /let conversationGeneration = 0/);
  assert.match(apiChatSource, /activeChatController\?\.abort\(\)/);
  assert.match(apiChatSource, /generation !== conversationGeneration/);
});

test("API chat is mounted as a first-class v3 surface and chat content is excluded from i18n mutation", () => {
  assert.match(mainSource, /mountApiChat/);
  assert.match(mainSource, /"opencode" \| "codex" \| "api" \| "integrations"/);
  assert.match(i18nSource, /\.api-message/);
  assert.match(i18nSource, /"どのAPIで考える？"/);
});
