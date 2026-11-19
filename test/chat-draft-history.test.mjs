import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  CHAT_DRAFT_MAX_CHARS,
  chatDraftKey,
  createChatDraftBinding,
  readChatDraft,
  writeChatDraft
} from "../src/chat-draft.mjs";
import { createHistoryRetryNotice, latestAssistantText } from "../src/chat-transcript-actions.mjs";

function memoryStorage() {
  const map = new Map();
  return {
    map,
    getItem: key => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => void map.set(key, String(value)),
    removeItem: key => void map.delete(key)
  };
}

function fakeInput(value = "") {
  const listeners = new Map();
  return {
    value,
    addEventListener: (type, handler) => listeners.set(type, handler),
    emit: type => listeners.get(type)?.()
  };
}

test("drafts are keyed by provider and project", () => {
  const storage = memoryStorage();
  writeChatDraft(storage, "codex", "p1", "codex p1");
  writeChatDraft(storage, "codex", "p2", "codex p2");
  writeChatDraft(storage, "opencode", "p1", "opencode p1");

  assert.equal(readChatDraft(storage, "codex", "p1"), "codex p1");
  assert.equal(readChatDraft(storage, "codex", "p2"), "codex p2");
  assert.equal(readChatDraft(storage, "opencode", "p1"), "opencode p1");
  assert.equal(readChatDraft(storage, "api-chat", "p1"), "");
  assert.equal(readChatDraft(storage, "opencode", "p2"), "");
  assert.notEqual(chatDraftKey("codex", "a:b"), chatDraftKey("codex", "a"));
  assert.throws(() => chatDraftKey("other", "p1"), TypeError);
});

test("blank and oversized drafts are removed, storage failures are contained", () => {
  const storage = memoryStorage();
  writeChatDraft(storage, "codex", "p1", "keep");
  assert.equal(writeChatDraft(storage, "codex", "p1", "   "), false);
  assert.equal(storage.map.size, 0);
  assert.equal(writeChatDraft(storage, "codex", "p1", "x".repeat(CHAT_DRAFT_MAX_CHARS + 1)), false);
  assert.equal(storage.map.size, 0);

  const broken = {
    getItem() { throw new Error("denied"); },
    setItem() { throw new Error("denied"); },
    removeItem() { throw new Error("denied"); }
  };
  assert.equal(writeChatDraft(broken, "codex", "p1", "text"), false);
  assert.equal(readChatDraft(broken, "codex", "p1"), "");
  assert.equal(readChatDraft(null, "codex", "p1"), "");
});

test("binding restores after reload and swaps drafts and attachments on project change", () => {
  const storage = memoryStorage();
  let project = "p1";
  let attachments = [];
  const input = fakeInput();
  const binding = createChatDraftBinding({
    provider: "codex",
    input,
    storage,
    getProjectId: () => project,
    takeExtras: () => attachments,
    restoreExtras: extras => { attachments = extras ?? []; }
  });

  input.value = "draft for p1";
  input.emit("input");
  attachments = [{ id: "a1" }];

  project = "p2";
  assert.equal(binding.sync(), true);
  assert.equal(input.value, "");
  assert.deepEqual(attachments, []);
  assert.equal(binding.sync(), false);

  input.value = "draft for p2";
  input.emit("input");

  project = "p1";
  input.emit("focus");
  assert.equal(input.value, "draft for p1");
  assert.deepEqual(attachments, [{ id: "a1" }]);

  // A reload builds a new binding over the same storage.
  const reloaded = fakeInput();
  createChatDraftBinding({ provider: "codex", input: reloaded, storage, getProjectId: () => "p2" });
  assert.equal(reloaded.value, "draft for p2");

  const otherProvider = fakeInput();
  createChatDraftBinding({ provider: "opencode", input: otherProvider, storage, getProjectId: () => "p2" });
  assert.equal(otherProvider.value, "");
});

test("latestAssistantText returns the last non-empty answer of the given conversation", () => {
  assert.equal(latestAssistantText([]), "");
  assert.equal(latestAssistantText(null), "");
  assert.equal(latestAssistantText(["", undefined, "  "]), "");
  assert.equal(latestAssistantText(["first", "", "second", "  "]), "second");
});

test("history retry notice only calls the retry callback", async () => {
  const created = [];
  const doc = {
    createElement(tag) {
      const listeners = new Map();
      const element = {
        tag,
        dataset: {},
        attributes: {},
        children: [],
        setAttribute(name, value) { this.attributes[name] = value; },
        addEventListener: (type, handler) => listeners.set(type, handler),
        append(...nodes) { this.children.push(...nodes); },
        click: () => listeners.get("click")?.()
      };
      created.push(element);
      return element;
    }
  };
  let retries = 0;
  let release;
  const notice = createHistoryRetryNotice(doc, {
    className: "x-retry",
    message: "failed",
    retryLabel: "Retry",
    onRetry: () => { retries += 1; return new Promise(resolve => { release = resolve; }); }
  });
  const button = created.find(element => element.tag === "button");

  assert.equal(notice.attributes.role, "alert");
  assert.equal(button.type, "button");
  const first = button.click();
  assert.equal(button.disabled, true);
  await button.click();
  assert.equal(retries, 1);
  release();
  await first;
  assert.equal(button.disabled, false);
});

test("chat surfaces wire drafts, latest-answer copy and history retry without sending", async () => {
  const [codex, opencode, apiChat] = await Promise.all(
    ["codex", "opencode", "api-chat"].map(name => readFile(new URL(`../src/${name}.ts`, import.meta.url), "utf8"))
  );

  for (const [provider, source] of [["codex", codex], ["opencode", opencode], ["api-chat", apiChat]]) {
    assert.match(source, new RegExp(`provider: "${provider}"`));
    assert.match(source, /storage: window\.sessionStorage/);
    assert.match(source, /if \(drafts\.sync\(\)\) \{/);
    assert.match(source, /"devmoter:surface-changed", \(\) => \{?\s*(if \(uploadingCount === 0\) )?drafts\.sync\(\)/);
    assert.match(source, /t\("chat\.copyLatest\.none"\)/);
  }

  const codexFailure = codex.slice(codex.indexOf("function showHistoryLoadFailure"), codex.indexOf("async function loadThreadHistory"));
  assert.match(codexFailure, /if \(activeThreadId === threadId\) await loadThreadHistory\(threadId\)/);
  assert.doesNotMatch(codexFailure, /sendMessage|turn\/start|activeThreadId = /);

  const opencodeFailure = opencode.slice(opencode.indexOf("function showContextLoadFailure"), opencode.indexOf("async function loadContext"));
  assert.match(opencodeFailure, /if \(activeSession\?\.id !== sessionId\) return;/);
  assert.match(opencodeFailure, /await loadContext\(\)/);
  assert.doesNotMatch(opencodeFailure, /sendMessage|prompt_async|activeSession = /);

  // A failed switch must not leave the previous conversation's answers on screen to be copied.
  assert.match(codexFailure, /if \(unloadedSwitchThreadId === threadId\) transcript\.replaceChildren\(\);/);
  assert.match(opencodeFailure, /if \(unloadedSwitchSessionId === sessionId\) \{\s*transcript\.replaceChildren\(\);/);
  assert.match(codex, /if \(activeThreadId !== thread\.id\) unloadedSwitchThreadId = thread\.id;/);
  assert.match(opencode, /if \(activeSession\?\.id !== session\.id\) unloadedSwitchSessionId = session\.id;/);
});
