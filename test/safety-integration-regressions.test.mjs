import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("dangerous Codex session approvals are downgraded to one-time", async () => {
  const source = await readFile(new URL("../src/codex.ts", import.meta.url), "utf8");
  assert.match(source, /commandRisk\.dangerous && decision === "acceptForSession"/);
  assert.match(source, /effectiveDecision = "accept"/);
  assert.match(source, /High-risk commands can only be approved once/);
});

test("dangerous OpenCode always approvals are downgraded to once", async () => {
  const source = await readFile(new URL("../src/opencode.ts", import.meta.url), "utf8");
  assert.match(source, /commandRisk\.dangerous && reply === "always"/);
  assert.match(source, /effectiveReply = "once"/);
});

test("closed terminal sessions replay buffered output through an authorized websocket attach", async () => {
  const source = await readFile(new URL("../src/control-center.ts", import.meta.url), "utf8");
  const terminal = await readFile(new URL("../server/terminal.mjs", import.meta.url), "utf8");
  assert.match(source, /void connectTerminalSocket\(\)/);
  assert.match(source, /socketUrl = `\$\{protocol\}\/\/\$\{location\.host\}\/api\/terminal\/sessions\/\$\{encodeURIComponent\(record\.session\.id\)\}\/socket\?after=\$\{lastSeq\}`/);
  assert.match(terminal, /if \(session\.closed\) \{\s+socket\.close\(1000, "Terminal process exited\."\);/);
});

test("terminal UI does not execute remote CDN JavaScript", async () => {
  const source = await readFile(new URL("../src/control-center.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /cdn\.jsdelivr\.net/);
  assert.doesNotMatch(source, /@vite-ignore/);
});
