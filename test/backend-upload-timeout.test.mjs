import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("Codex, OpenCode and API Chat attachment upload requests have bounded deadlines", async () => {
  const [codex, opencode, api] = await Promise.all([
    readFile(new URL("../src/codex.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/opencode.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/api-chat.ts", import.meta.url), "utf8")
  ]);
  for (const source of [codex, opencode]) {
    assert.match(source, /fetchWithTimeout\(\s*\(input, init\) => fetch\(input, init\),\s*"\/api\/codex\/upload"/);
    assert.match(source, /120_000/);
  }
  assert.match(api, /fetchWithTimeout\(\s*\(input, init\) => fetch\(input, init\),\s*"\/api\/llm\/attachments"/);
});
