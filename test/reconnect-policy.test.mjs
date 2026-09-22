import test from "node:test";
import assert from "node:assert/strict";
import {
  reconnectDelay,
  shouldOpenEventSource,
  shouldScheduleReconnect
} from "../src/reconnect-policy.mjs";

test("reconnect delay uses bounded exponential backoff", () => {
  assert.deepEqual(
    Array.from({ length: 7 }, (_, attempt) => reconnectDelay(attempt)),
    [1000, 2000, 4000, 8000, 15000, 15000, 15000]
  );
});

test("reconnect scheduling is suppressed while offline or a timer already exists", () => {
  assert.equal(shouldScheduleReconnect(false, false), false);
  assert.equal(shouldScheduleReconnect(true, true), false);
  assert.equal(shouldScheduleReconnect(true, false), true);
});

test("EventSource creation is suppressed while offline or a source already exists", () => {
  assert.equal(shouldOpenEventSource(false, false), false);
  assert.equal(shouldOpenEventSource(true, true), false);
  assert.equal(shouldOpenEventSource(true, false), true);
});
