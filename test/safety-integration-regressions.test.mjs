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

test("closed terminal sessions are still attached once to replay buffered output", async () => {
  const source = await readFile(new URL("../src/control-center.ts", import.meta.url), "utf8");
  assert.match(source, /void attachTerminalStream\(\)/);
  assert.match(source, /let replayClosed = Boolean\(terminalRecord\.session\.closed\)/);
});

test("terminal UI does not execute remote CDN JavaScript", async () => {
  const source = await readFile(new URL("../src/control-center.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /cdn\.jsdelivr\.net/);
  assert.doesNotMatch(source, /@vite-ignore/);
});
