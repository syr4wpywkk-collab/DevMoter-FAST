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
  assert.match(codex, /shouldOpenEventSource\(online, Boolean\(events\)\)/);
  assert.match(codex, /trimTranscript\(\);/);
  assert.match(openCode, /trimTranscript\(\);/);
});


test("explicit sends restore transcript following", async () => {
  for (const file of ["../src/opencode.ts", "../src/codex.ts"]) {
    const source = await readFile(new URL(file, import.meta.url), "utf8");
    const unlockedStart = source.indexOf("async function sendMessageUnlocked()");
    const start = unlockedStart >= 0 ? unlockedStart : source.indexOf("async function sendMessage()");
    const end = source.indexOf("\n  async function ", start + 1);
    const block = source.slice(start, end > start ? end : undefined);
    assert.match(block, /followsBottom = true/);
    assert.match(block, /followLatest\(\)/);
  }
});

test("OpenCode live stream protection stays bounded", async () => {
  const source = await readFile(new URL("../src/opencode.ts", import.meta.url), "utf8");
  assert.match(source, /LIVE_STREAM_PROTECTION_LIMIT = 16/);
  assert.match(source, /function retireLiveStream\(key: string\)/);
  assert.match(source, /keys\.length - LIVE_STREAM_PROTECTION_LIMIT/);
});
