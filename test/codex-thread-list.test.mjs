import test from "node:test";
import assert from "node:assert/strict";
import { normalizeCodexThreadList } from "../src/codex-thread-list.mjs";
import { readFile } from "node:fs/promises";

test("Codex thread list accepts valid summaries and drops malformed rows", () => {
  assert.deepEqual(normalizeCodexThreadList({ data: [
    { id: "thread-1", name: "one" },
    null,
    { id: "", name: "missing identity" },
    { id: "thread-2" }
  ] }), [{ id: "thread-1", name: "one" }, { id: "thread-2" }]);
});

test("Codex thread list rejects malformed response shapes without inventing an empty list", () => {
  for (const value of [null, {}, { data: null }, { data: "thread-1" }]) {
    assert.throws(() => normalizeCodexThreadList(value), /invalid conversation list/);
  }
});

test("Codex history refresh reports failures and retains the last valid snapshot", async () => {
  const source = await readFile(new URL("../src/codex.ts", import.meta.url), "utf8");
  const start = source.indexOf("async function loadThreads()");
  const end = source.indexOf("function parseUserMessage", start);
  const loader = source.slice(start, end);
  assert.match(loader, /catch \(error\)[\s\S]*?showToast\([\s\S]*?\)[\s\S]*?return false;/);
  assert.match(loader, /allThreads = normalizeCodexThreadList\(result\)/);
  assert.match(loader, /catch \{[\s\S]*?showToast\("Codexから有効な会話一覧/);
  assert.match(loader, /return true;/);
});
