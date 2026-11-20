import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { reconnectDelay, shouldOpenEventSource, shouldScheduleReconnect } from "../src/reconnect-policy.mjs";

// #327: a dropped event stream must reconnect with bounded backoff, never stack
// timers or sources, stay quiet while offline, and reset after a good open.
const backends = await Promise.all([
  ["codex", "events"],
  ["opencode", "eventSource"]
].map(async ([name, source]) => [name, source, await readFile(new URL(`../src/${name}.ts`, import.meta.url), "utf8")]));

function functionBody(source, signature) {
  const start = source.indexOf(signature);
  assert.notEqual(start, -1, signature);
  return source.slice(start, source.indexOf("\n  }\n", start));
}

test("#327: repeated drops back off to the cap and a successful open starts over", () => {
  let attempts = 0;
  const delays = [];
  for (let drop = 0; drop < 7; drop += 1) {
    delays.push(reconnectDelay(attempts));
    attempts += 1;
  }
  assert.deepEqual(delays, [1000, 2000, 4000, 8000, 15000, 15000, 15000]);
  attempts = 0;
  assert.equal(reconnectDelay(attempts), 1000);
  assert.equal(shouldScheduleReconnect(true, true), false, "no second timer while one is pending");
  assert.equal(shouldScheduleReconnect(false, false), false, "no reconnect while offline");
  assert.equal(shouldOpenEventSource(true, true), false, "no second stream");
  assert.equal(shouldOpenEventSource(false, false), false);
});

test("#327: both backends close the dropped stream and schedule one reconnect", () => {
  for (const [name, ref, source] of backends) {
    const connect = functionBody(source, "function connectEvents()");
    assert.match(connect, new RegExp(`if \\(!shouldOpenEventSource\\(online, Boolean\\(${ref}\\)\\)\\) return;`), `${name}: guarded open`);
    assert.match(connect, /\.onerror = \(\) => \{\s*\w+\?\.close\(\);\s*\w+ = null;\s*scheduleEventReconnect\(\);/, `${name}: onerror`);
    assert.match(connect, /\.onopen = \(\) => \{\s*reconnectAttempts = 0;/, `${name}: onopen resets backoff`);
    assert.match(connect, /executionState === "reconnecting"[\s\S]*recoverAfterEventOpen/, `${name}: resync after reconnect`);

    const schedule = functionBody(source, "function scheduleEventReconnect()");
    assert.match(schedule, /if \(!shouldScheduleReconnect\(online, reconnectTimer !== null\)\) return;/, `${name}: one timer`);
    assert.match(schedule, /const delay = reconnectDelay\(reconnectAttempts\);\s*reconnectAttempts \+= 1;\s*setExecutionState\("reconnecting"\);/, `${name}: backoff + visible state`);
    assert.match(schedule, /reconnectTimer = null;\s*connectEvents\(\);/, `${name}: timer reconnects`);
  }
});
