import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { normalizeCodexThreadHistory } from "../src/codex-thread-history.mjs";

test("Codex thread history accepts an empty and populated canonical thread", () => {
  const empty = { thread: { status: { type: "idle" }, turns: [] } };
  assert.equal(normalizeCodexThreadHistory(empty), empty.thread);
  const populated = { thread: { turns: [{ id: "turn-1", items: [{ type: "agentMessage" }] }] } };
  assert.equal(normalizeCodexThreadHistory(populated), populated.thread);
});

test("Codex thread history rejects malformed thread, turns and item collections", () => {
  for (const value of [
    null,
    {},
    { thread: {} },
    { thread: { turns: {} } },
    { thread: { turns: [null] } },
    { thread: { turns: [{ items: {} }] } }
  ]) {
    assert.throws(() => normalizeCodexThreadHistory(value), /invalid conversation history/);
  }
});

test("Codex validates thread/read before clearing the current transcript", async () => {
  const source = await readFile(new URL("../src/codex.ts", import.meta.url), "utf8");
  const start = source.indexOf("async function loadThreadHistory(threadId: string)");
  const end = source.indexOf("async function selectThread", start);
  const loader = source.slice(start, end);
  assert.match(loader, /normalizeCodexThreadHistory\(result\)/);
  assert.ok(loader.indexOf("normalizeCodexThreadHistory(result)") < loader.indexOf("transcript.replaceChildren()"));
  assert.match(loader, /Codexから有効な会話履歴を受け取れませんでした/);
  assert.match(loader, /return false;/);
});
