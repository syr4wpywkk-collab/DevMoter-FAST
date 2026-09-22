import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("session control stays behind DevMoter auth and same-origin checks", async () => {
  const source = await readFile(new URL("../server.mjs", import.meta.url), "utf8");
  const route = source.indexOf('url.pathname.startsWith("/api/session-control")');
  assert.ok(route > source.indexOf("authorizeBasicRequest"));
  assert.ok(route > source.indexOf("requireSameOriginMutation"));
});

test("session control creates Codex threads through registered project ids", async () => {
  const source = await readFile(new URL("../src/session-control.ts", import.meta.url), "utf8");
  const start = source.indexOf('codex<Json>("thread/start"');
  assert.ok(start >= 0);
  const block = source.slice(start, start + 260);
  assert.match(block, /projectId/);
  assert.doesNotMatch(block, /cwd\s*:/);
});

test("session control state is bounded and stored privately", async () => {
  const source = await readFile(new URL("../server/session-control.mjs", import.meta.url), "utf8");
  assert.match(source, /MAX_QUEUE_TEXT = 16_000/);
  assert.match(source, /MAX_EVENTS = 400/);
  assert.match(source, /MAX_CHECKPOINTS = 30/);
  assert.match(source, /mode: 0o600/);
  assert.match(source, /rename\(temp, stateFile\)/);
});
