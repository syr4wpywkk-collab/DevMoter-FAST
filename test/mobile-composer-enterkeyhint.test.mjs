import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// #352: Enter sends on every chat surface, so mobile keyboards should label it "Send".
test("#352: every chat prompt tells mobile keyboards that Enter sends", async () => {
  for (const [file, id] of [["codex.ts", "cxPromptInput"], ["opencode.ts", "ocxPromptInput"], ["api-chat.ts", "apiPrompt"], ["qwen-chat.ts", "data-qwen-input"]]) {
    const source = await readFile(new URL(`../src/${file}`, import.meta.url), "utf8");
    const tag = source.match(new RegExp(`<textarea[^>]*${id}[^>]*>`))?.[0];
    assert.ok(tag, `${file} renders its prompt textarea`);
    assert.match(tag, /enterkeyhint="send"/, `${file} prompt`);
  }
});
