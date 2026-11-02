import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, chmod, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseQwenJson, qwenChatArgs, runQwenChat } from "../server/qwen-chat.mjs";

const SID = "123e4567-e89b-12d3-a456-426614174000";

test("qwen args keep the prompt as one argv entry and validate resume ids", () => {
  assert.deepEqual(qwenChatArgs("--yolo hi", SID), ["--output-format", "json", "--resume", SID, "--prompt", "--yolo hi"]);
  assert.throws(() => qwenChatArgs("hi", "../x"), /セッションID/);
  assert.throws(() => qwenChatArgs("  "), /空/);
});

test("qwen json result is parsed", () => {
  const out = JSON.stringify([{ type: "system", session_id: SID }, { type: "result", session_id: SID, is_error: false, result: "Paris" }]);
  assert.deepEqual(parseQwenJson(out), { text: "Paris", sessionId: SID });
  assert.throws(() => parseQwenJson("nope"), /読めません/);
});

test("runQwenChat runs the CLI headless without leaking unrelated secrets", async () => {
  const dir = await mkdtemp(join(tmpdir(), "qwen-"));
  const bin = join(dir, "qwen");
  await writeFile(bin, `#!/usr/bin/env node\nrequire("fs").writeFileSync(${JSON.stringify(join(dir, "seen.json"))}, JSON.stringify({ argv: process.argv.slice(2), secret: process.env.GITHUB_TOKEN || null, key: process.env.DASHSCOPE_API_KEY || null }));\nconsole.log(JSON.stringify([{ type: "result", session_id: "${SID}", result: "ok" }]));\n`);
  await chmod(bin, 0o755);
  process.env.GITHUB_TOKEN = "should-not-leak";
  process.env.DASHSCOPE_API_KEY = "allowed";
  try {
    assert.deepEqual(await runQwenChat({ prompt: "hi", cwd: dir, bin }), { text: "ok", sessionId: SID });
    const seen = JSON.parse(await readFile(join(dir, "seen.json"), "utf8"));
    assert.deepEqual(seen.argv, ["--output-format", "json", "--prompt", "hi"]);
    assert.equal(seen.secret, null);
    assert.equal(seen.key, "allowed");
  } finally {
    delete process.env.GITHUB_TOKEN;
    delete process.env.DASHSCOPE_API_KEY;
  }
});

test("missing qwen CLI reports not installed", async () => {
  await assert.rejects(runQwenChat({ prompt: "hi", cwd: tmpdir(), bin: "/nonexistent/qwen" }), /未インストール/);
});

test("Qwen Code is in the AI selector", async () => {
  const nav = await readFile(new URL("../src/unified-workspace-nav.ts", import.meta.url), "utf8");
  assert.match(nav, /<option value="qwen">Qwen Code<\/option>/);
});
