import test from "node:test";
import assert from "node:assert/strict";
import { shortModelName } from "../src/opencode-model-label.mjs";

test("model names drop a repeated vendor prefix", () => {
  assert.equal(shortModelName("Anthropic: Claude Sonnet 4", "anthropic/claude-sonnet-4"), "Claude Sonnet 4");
  assert.equal(shortModelName("GPT-5", "gpt-5"), "GPT-5");
  assert.equal(shortModelName("Qwen3 Coder 480B A35B (free)", "qwen/qwen3-coder:free"), "Qwen3 Coder 480B A35B (free)");
});

test("without a name the last id segment is shown", () => {
  assert.equal(shortModelName("", "openrouter/anthropic/claude-sonnet-4"), "claude-sonnet-4");
  assert.equal(shortModelName(undefined, "gpt-4o"), "gpt-4o");
  assert.equal(shortModelName(null, ""), "");
});

test("very long names are returned whole; the row truncates them visually", () => {
  const long = "Meta Llama 3.1 405B Instruct Turbo With An Extremely Long Marketing Suffix Preview 2026-10";
  assert.equal(shortModelName(long, "x"), long);
});
