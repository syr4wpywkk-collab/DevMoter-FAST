import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DICTIONARIES } from "../src/i18n-core.mjs";

test("Codex and OpenCode background event replay requests are bounded", async () => {
  const [codex, opencode] = await Promise.all([
    readFile(new URL("../src/codex.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/opencode.ts", import.meta.url), "utf8")
  ]);
  for (const source of [codex, opencode]) {
    const start = source.indexOf("async function replayWorkspaceState(");
    const end = source.indexOf("async function resumeFromBackground()", start);
    const replay = source.slice(start, end);
    assert.match(replay, /fetchWithTimeout\(/);
    assert.match(replay, /REMOTE_REQUEST_TIMEOUT_MS/);
    assert.match(replay, /t\("(?:codex|opencode)\.reconnect\.replayTimeout"\)/);
  }
  assert.match(DICTIONARIES.en["codex.reconnect.replayTimeout"], /Background event replay timed out/);
  assert.match(DICTIONARIES.en["opencode.reconnect.replayTimeout"], /Background event replay timed out/);
});
