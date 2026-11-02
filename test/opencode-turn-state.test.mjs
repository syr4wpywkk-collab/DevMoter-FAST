import test from "node:test";
import assert from "node:assert/strict";
import { latestTurnIdle, shouldKeepAwaitingReply } from "../src/opencode-turn-state.mjs";

const previousTurn = [
  { type: "user", text: "hi" },
  { type: "assistant", content: [{ type: "text", text: "hello" }] },
  { type: "idle", outcome: "completed" }
];

test("previous turn's idle does not end a just-sent prompt (reply-missing repro)", () => {
  // Context polled right after sending, before OpenCode reports the session busy.
  const list = [...previousTurn, { type: "user", text: "next" }];
  assert.equal(latestTurnIdle(list), null);
  assert.equal(shouldKeepAwaitingReply({ awaitingUntil: 10_000, now: 1_000, turnIdle: null, busy: false }), true);
});

test("idle of the latest turn finishes the run", () => {
  const list = [...previousTurn, { type: "user", text: "next" }, { type: "assistant", content: [] }, { type: "idle", outcome: "completed" }];
  assert.equal(latestTurnIdle(list)?.type, "idle");
  assert.equal(shouldKeepAwaitingReply({ awaitingUntil: 10_000, now: 1_000, turnIdle: list.at(-1), busy: false }), false);
});

test("awaiting expires and busy always keeps running", () => {
  assert.equal(shouldKeepAwaitingReply({ awaitingUntil: 10, now: 20, turnIdle: null, busy: false }), false);
  assert.equal(shouldKeepAwaitingReply({ awaitingUntil: NaN, now: 0, turnIdle: null, busy: true }), true);
  assert.equal(latestTurnIdle(previousTurn)?.type, "idle");
});
