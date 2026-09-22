import assert from "node:assert/strict";
import test from "node:test";
import { compileModePrompt, getBuiltinMode, listBuiltinModes, renderModePolicy, validateCustomMode } from "../src/agent-mode-core.mjs";

test("debug mode is explicit and inspectable", () => {
  const mode = getBuiltinMode("debug");
  assert.equal(mode.name, "Debug");
  assert.equal(mode.mutationPolicy, "approval-required");
  assert.ok(mode.tools.allow.includes("diagnostics"));
  assert.ok(mode.tools.allow.includes("tests"));
  assert.match(renderModePolicy(mode), /normal DevMoter\/Codex\/OpenCode approval/i);
});

test("debug prompt keeps diagnostics and fixes inside normal approval flow", () => {
  const prompt = compileModePrompt("debug", "Reproduce the flaky login test", { project: "demo" });
  assert.match(prompt, /Reproduce the flaky login test/);
  assert.match(prompt, /never bypass the backend's normal approval flow/i);
  assert.match(prompt, /file mutation/i);
  assert.match(prompt, /project: demo/);
});

test("mode list returns defensive copies", () => {
  const [mode] = listBuiltinModes();
  mode.instructions.push("mutated");
  assert.equal(getBuiltinMode("debug").instructions.includes("mutated"), false);
});

test("unknown modes and empty tasks fail closed", () => {
  assert.throws(() => getBuiltinMode("missing"), /Unknown mode/);
  assert.throws(() => compileModePrompt("debug", "   "), /Task is required/);
});

test("review mode is read-only and requests structured file findings", () => {
  const mode = getBuiltinMode("review");
  assert.equal(mode.name, "Review");
  assert.equal(mode.mutationPolicy, "read-only-until-explicit-transition");
  assert.ok(mode.tools.deny.includes("files"));
  const prompt = compileModePrompt("review", "Review the current working tree");
  assert.match(prompt, /Do not modify files/i);
  assert.match(prompt, /file:line references/i);
  assert.match(prompt, /explicit transition/i);
});

test("custom modes preserve prompt, model/provider and explicit tool permissions", () => {
  const custom = validateCustomMode({
    id: "security-review",
    name: "Security review",
    instructions: ["Inspect trust boundaries", "Do not mutate files"],
    provider: "openai",
    model: "gpt-secure",
    tools: { allow: ["read", "git"], deny: ["files", "network"] },
    mutationPolicy: "read-only-until-explicit-transition"
  });
  assert.equal(custom.provider, "openai");
  assert.equal(custom.model, "gpt-secure");
  const prompt = compileModePrompt("security-review", "Review auth", {}, [custom]);
  assert.match(prompt, /Preferred provider: openai/);
  assert.match(prompt, /Preferred model: gpt-secure/);
  assert.match(prompt, /Allowed tool groups: read, git/);
});

test("invalid custom permission combinations fail closed", () => {
  const base = {
    id: "custom-one",
    name: "Custom one",
    instructions: ["Inspect"],
    tools: { allow: ["read"], deny: [] }
  };
  assert.throws(() => validateCustomMode({ ...base, tools: { allow: [], deny: [] } }), /explicitly allow/);
  assert.throws(() => validateCustomMode({ ...base, tools: { allow: ["read", "root"], deny: [] } }), /Unknown tool group/);
  assert.throws(() => validateCustomMode({ ...base, tools: { allow: ["read"], deny: ["read"] } }), /both allowed and denied/);
  assert.throws(() => validateCustomMode({ ...base, id: "debug" }), /conflicts with built-in/);
});
