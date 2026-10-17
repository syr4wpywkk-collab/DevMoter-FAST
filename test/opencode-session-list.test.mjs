import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { normalizeOpenCodeSessionList } from "../src/opencode-session-list.mjs";

test("OpenCode session list accepts valid sessions and filters invalid rows", () => {
  assert.deepEqual(normalizeOpenCodeSessionList([
    { id: "session-1", title: "one" }, null, { id: "" }, { id: "session-2" }
  ]), [{ id: "session-1", title: "one" }, { id: "session-2" }]);
});

test("OpenCode session list rejects malformed payloads instead of replacing history with empty", () => {
  for (const value of [null, {}, "session", { data: [] }]) {
    assert.throws(() => normalizeOpenCodeSessionList(value), /invalid session list/);
  }
});

test("OpenCode loader catches request and schema errors before replacing sessions", async () => {
  const source = await readFile(new URL("../src/opencode.ts", import.meta.url), "utf8");
  const start = source.indexOf("async function loadSessions()");
  const end = source.indexOf("async function syncPendingPermission", start);
  const loader = source.slice(start, end);
  assert.match(loader, /catch \(error\)[\s\S]*?showToast\([\s\S]*?return false;/);
  assert.match(loader, /sessions = normalizeOpenCodeSessionList\(data\)/);
  assert.match(loader, /catch \{[\s\S]*?showToast\("OpenCode returned an invalid session history/);
  assert.match(loader, /return true;/);
});
