import test from "node:test";
import assert from "node:assert/strict";
import {
  applyModeToPrompt,
  isDirectMutationRoute,
  isPromptRoute,
  parseAgentMode,
  READ_ONLY_TOOLS,
  sessionIdFromOpenCodePath
} from "../server/agent-mode-policy.mjs";

test("plan mode replaces client tool choices with a read-only allowlist", () => {
  const payload = applyModeToPrompt({
    text: "inspect this project",
    tools: { bash: true, write: true, custom_mutator: true }
  }, "plan");

  assert.equal(payload.text, "inspect this project");
  assert.deepEqual(payload.tools, READ_ONLY_TOOLS);
  assert.equal(payload.tools["*"], false);
  assert.equal(payload.tools.read, true);
  assert.equal(payload.tools.glob, true);
  assert.equal(payload.tools.grep, true);
  assert.equal(payload.tools.bash, undefined);
  assert.equal(payload.tools.write, undefined);
});

test("build mode leaves prompt tools unchanged", () => {
  const original = { text: "do it", tools: { bash: true } };
  assert.equal(applyModeToPrompt(original, "build"), original);
});

test("mode and session route parsing are strict", () => {
  assert.equal(parseAgentMode("plan"), "plan");
  assert.equal(parseAgentMode("BUILD"), "build");
  assert.equal(parseAgentMode("ask"), "ask");
  const askPayload = applyModeToPrompt({ text: "explain", tools: { bash: true } }, "ask");
  assert.deepEqual(askPayload.tools, READ_ONLY_TOOLS);
  assert.equal(sessionIdFromOpenCodePath("/api/session/abc%201/prompt"), "abc 1");
  assert.equal(isPromptRoute("/api/session/abc/prompt"), true);
  assert.equal(isPromptRoute("/api/session/abc/message"), true);
  assert.equal(isDirectMutationRoute("/api/session/abc/shell"), true);
  assert.equal(isDirectMutationRoute("/api/session/abc/command"), true);
});
