import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  isAdapterOwnedRoute,
  isDirectMutationRoute,
  isSessionAgentRoute,
  isSessionCreateRoute,
  modeFromAgent,
  normalizeProxyRoutePath,
  parseAgentMode,
  READ_ONLY_TOOLS,
  readOnlyToolsFor,
  resolveEffectiveAgentMode,
  sessionIdFromOpenCodePath
} from "../server/agent-mode-policy.mjs";

test("plan and ask modes restrict a run to the read-only tool allowlist", () => {
  for (const mode of ["plan", "ask"]) {
    const tools = readOnlyToolsFor(mode);
    assert.deepEqual(tools, READ_ONLY_TOOLS);
    assert.notEqual(tools, READ_ONLY_TOOLS, "callers get a copy");
    assert.equal(tools["*"], false);
    assert.equal(tools.read, true);
    assert.equal(tools.glob, true);
    assert.equal(tools.grep, true);
    assert.equal(tools.bash, undefined);
    assert.equal(tools.write, undefined);
  }
});

test("build mode leaves the run's tools alone", () => {
  assert.equal(readOnlyToolsFor("build"), null);
  assert.equal(readOnlyToolsFor(null), null);
});

test("mode and session route parsing are strict and query-safe", () => {
  assert.equal(parseAgentMode("plan"), "plan");
  assert.equal(parseAgentMode("BUILD"), "build");
  assert.equal(parseAgentMode("ask"), "ask");
  assert.equal(parseAgentMode("unknown"), null);
  assert.equal(sessionIdFromOpenCodePath("/api/session/abc%201/prompt?x=1"), "abc 1");
  for (const route of ["prompt?x=1", "prompt_async", "message?foo=bar", "interrupt", "abort", "context", "permission", "permission/per_1/reply", "permissions/per_1", "question/que_1/reject", "form/frm_1/reply"]) {
    assert.equal(isAdapterOwnedRoute("/api/session/abc/" + route), true, route);
  }
  for (const route of ["/api/session/abc", "/api/session/abc/agent", "/api/session/abc/model", "/api/session", "/api/agent"]) {
    assert.equal(isAdapterOwnedRoute(route), false, route);
  }
  assert.equal(isDirectMutationRoute("/api/session/abc/shell?x=1"), true);
  assert.equal(isDirectMutationRoute("/api/session/abc/command?x=1"), true);
  assert.equal(isDirectMutationRoute("/api/session/abc/shell-extra?x=1"), false);
});

test("session create/agent route matchers tolerate trailing slashes and queries", () => {
  // A trailing slash is the same route: it must not slip past the guards
  // that match on the canonical shape (#591 audit).
  assert.equal(normalizeProxyRoutePath("/"), "/");
  assert.equal(normalizeProxyRoutePath("/api/session///"), "/api/session");
  assert.equal(normalizeProxyRoutePath("/api/session/ses_1/agent/?x=1"), "/api/session/ses_1/agent");
  assert.equal(isSessionCreateRoute("/api/session"), true);
  assert.equal(isSessionCreateRoute("/api/session/"), true);
  assert.equal(isSessionCreateRoute("/api/session?x=1"), true);
  assert.equal(isSessionCreateRoute("/api/session/ses_1"), false);
  assert.equal(isSessionAgentRoute("/api/session/ses_1/agent"), true);
  assert.equal(isSessionAgentRoute("/api/session/ses_1/agent/"), true);
  assert.equal(isSessionAgentRoute("/api/session/ses_1/agent//"), true);
  assert.equal(isSessionAgentRoute("/api/session/ses_1/agent?x=1"), true);
  assert.equal(isSessionAgentRoute("/api/session/ses_1/shell"), false);
  assert.equal(isSessionAgentRoute("/api/session/agent"), false);
  assert.equal(isSessionAgentRoute("/api/session/ses_1/agent/extra"), false);
});

test("agent identifiers map to modes; unknown agents are build-class", () => {
  assert.equal(modeFromAgent("plan"), "plan");
  assert.equal(modeFromAgent(" ASK "), "ask");
  assert.equal(modeFromAgent("build"), "build");
  assert.equal(modeFromAgent("coder"), "build");
  assert.equal(modeFromAgent(""), null);
  assert.equal(modeFromAgent("   "), null);
  assert.equal(modeFromAgent(undefined), null);
  assert.equal(modeFromAgent(42), null);
});

test("effective mode resolution never escalates a read-only server mode", () => {
  // Server-side mode is the base; an explicit operation parameter may keep
  // or lower privileges, never raise them (#591).
  assert.equal(resolveEffectiveAgentMode("plan", "build"), "plan");
  assert.equal(resolveEffectiveAgentMode("ask", "build"), "ask");
  assert.equal(resolveEffectiveAgentMode("plan", "ask"), "ask");
  assert.equal(resolveEffectiveAgentMode("ask", "plan"), "plan");
  assert.equal(resolveEffectiveAgentMode("plan", null), "plan");
  assert.equal(resolveEffectiveAgentMode("build", "plan"), "plan");
  assert.equal(resolveEffectiveAgentMode("build", "ask"), "ask");
  assert.equal(resolveEffectiveAgentMode("build", "build"), "build");
  assert.equal(resolveEffectiveAgentMode("build", null), "build");
  assert.equal(resolveEffectiveAgentMode(null, null), "build");
});

test("OpenCode sends the read-only mode derived from the agent, without a prompt prefix or mode toggle", async () => {
  const source = await readFile(new URL("../src/opencode.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /DevMoter Ask mode:/);
  assert.match(source, /"x-pocket-agent-mode": agentModeFor\(selectedAgent\)/);
  assert.match(source, /return agentID === "plan" \? "plan" : "build";/);
  assert.doesNotMatch(source, /ocxPlanMode|ocxAskMode|ocxBuildMode|ocxAgentButton|ocxModelPricing|opencode-pocket-opencode-mode/);
  assert.match(source, /text: promptText/);
});
