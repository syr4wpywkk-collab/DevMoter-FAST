import test from "node:test";
import assert from "node:assert/strict";
import { createTerminalHistory } from "../server/terminal-history.mjs";

test("terminal history stays bounded and exposes truncation", () => {
  const history = createTerminalHistory({ maxEntries: 3, maxBytes: 4096 });
  history.append("term-1", "one");
  history.append("term-1", "two");
  history.append("term-1", "three");
  history.append("term-1", "four");

  const snapshot = history.snapshot("term-1");
  assert.deepEqual(snapshot.entries.map(entry => entry.text), ["two", "three", "four"]);
  assert.equal(snapshot.truncated, true);
  assert.equal(snapshot.latestSequence, 4);
});

test("reattach can replay a bounded snapshot then receive live events", () => {
  const history = createTerminalHistory({ maxEntries: 10, maxBytes: 4096 });
  history.append("term-2", "before");

  const live = [];
  const unsubscribe = history.subscribe("term-2", entry => live.push(entry.text));
  const replay = history.snapshot("term-2");
  history.append("term-2", "after");
  unsubscribe();
  history.append("term-2", "ignored");

  assert.deepEqual(replay.entries.map(entry => entry.text), ["before"]);
  assert.deepEqual(live, ["after"]);
});
