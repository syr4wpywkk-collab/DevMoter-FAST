import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("frontends cap rendered transcript nodes and keep EventSource singleton guards", async () => {
  for (const file of ["../src/opencode.ts", "../src/codex.ts"]) {
    const source = await readFile(new URL(file, import.meta.url), "utf8");
    assert.match(source, /TRANSCRIPT_NODE_LIMIT = 400/);
    assert.match(source, /function trimTranscript\(\)/);
  }

  const openCode = await readFile(new URL("../src/opencode.ts", import.meta.url), "utf8");
  assert.match(openCode, /shouldOpenEventSource\(online, Boolean\(eventSource\)\)/);

  const codex = await readFile(new URL("../src/codex.ts", import.meta.url), "utf8");
  assert.match(codex, /if \(events \|\| !online\) return;/);
  assert.match(codex, /trimTranscript\(\);/);
  assert.match(openCode, /trimTranscript\(\);/);
});
