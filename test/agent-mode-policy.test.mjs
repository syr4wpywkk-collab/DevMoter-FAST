import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  applyModeToPrompt,
  isDirectMutationRoute,
  isPromptRoute,
  parseAgentMode,
  READ_ONLY_TOOLS,
  sessionIdFromOpenCodePath
} from "../server/agent-mode-policy.mjs";

test("plan and ask modes replace client tool choices with a read-only allowlist", () => {
  for (const mode of ["plan", "ask"]) {
    const payload = applyModeToPrompt({
      text: "inspect this project",
      tools: { bash: true, write: true, custom_mutator: true }
    }, mode);

    assert.equal(payload.text, "inspect this project");
    assert.deepEqual(payload.tools, READ_ONLY_TOOLS);
    assert.equal(payload.tools["*"], false);
    assert.equal(payload.tools.read, true);
    assert.equal(payload.tools.glob, true);
    assert.equal(payload.tools.grep, true);
    assert.equal(payload.tools.bash, undefined);
    assert.equal(payload.tools.write, undefined);
  }
});

test("build mode leaves prompt tools unchanged", () => {
  const original = { text: "do it", tools: { bash: true } };
  assert.equal(applyModeToPrompt(original, "build"), original);
});

test("mode and session route parsing are strict and query-safe", () => {
  assert.equal(parseAgentMode("plan"), "plan");
  assert.equal(parseAgentMode("BUILD"), "build");
  assert.equal(parseAgentMode("ask"), "ask");
  assert.equal(parseAgentMode("unknown"), null);
  assert.equal(sessionIdFromOpenCodePath("/api/session/abc%201/prompt?x=1"), "abc 1");
  assert.equal(isPromptRoute("/api/session/abc/prompt?x=1"), true);
  assert.equal(isPromptRoute("/api/session/abc/message?foo=bar"), true);
  assert.equal(isDirectMutationRoute("/api/session/abc/shell?x=1"), true);
  assert.equal(isDirectMutationRoute("/api/session/abc/command?x=1"), true);
  assert.equal(isDirectMutationRoute("/api/session/abc/shell-extra?x=1"), false);
});

test("Ask mode does not persist a hidden instruction prefix in the user prompt", async () => {
  const source = await readFile(new URL("../src/opencode.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /DevMoter Ask mode:/);
  assert.match(source, /"x-pocket-agent-mode": selectedMode/);
  assert.match(source, /text: promptText/);
});
