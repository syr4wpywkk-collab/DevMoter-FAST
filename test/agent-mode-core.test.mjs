import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { compileModePrompt, getBuiltinMode, listBuiltinModes, renderModePolicy } from "../src/agent-mode-core.mjs";

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

test("agent console never submits while the active composer is in Stop state", async () => {
  const source = await readFile(new URL("../src/agent-console.ts", import.meta.url), "utf8");
  assert.match(source, /classList\.contains\("stop"\)/);
  assert.match(source, /if \(busy\) throw new Error/);
  assert.ok(source.indexOf("if (busy) throw new Error") < source.indexOf("requestSubmit()"));
});
