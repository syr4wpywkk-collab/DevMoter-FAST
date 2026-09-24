import test from "node:test";
import assert from "node:assert/strict";
import {
  applyReasoningToTurnStart,
  normalizeCodexModels,
  reasoningChoices,
  reconcileReasoningMode
} from "../src/codex-reasoning.mjs";

const currentModelListFixture = {
  data: [
    {
      id: "gpt-5.6-sol",
      model: "gpt-5.6-sol",
      displayName: "GPT-5.6 Sol",
      isDefault: true,
      defaultReasoningEffort: "medium",
      supportedReasoningEfforts: [
        { reasoningEffort: "low", description: "Faster" },
        { reasoningEffort: "medium", description: "Balanced" },
        { reasoningEffort: "high", description: "Deeper" }
      ]
    },
    {
      id: "compat-model",
      model: "compat-model",
      displayName: "Compatibility Model"
    }
  ]
};

test("Codex model/list reasoning metadata normalizes into advertised choices", () => {
  const models = normalizeCodexModels(currentModelListFixture);
  assert.equal(models.length, 2);
  const sol = models[0];
  assert.equal(sol.defaultReasoningEffort, "medium");
  assert.deepEqual(
    reasoningChoices(sol).map(item => item.value),
    ["auto", "low", "medium", "high"]
  );
});

test("unsupported saved reasoning resets to Auto while supported values survive", () => {
  const [sol] = normalizeCodexModels(currentModelListFixture);
  assert.equal(reconcileReasoningMode("high", sol), "high");
  assert.equal(reconcileReasoningMode("xhigh", sol), "auto");
});

test("selected reasoning effort reaches turn/start params and Auto omits it", () => {
  const base = { threadId: "thread-1", input: [{ type: "text", text: "hi" }] };
  assert.deepEqual(
    applyReasoningToTurnStart(base, "high"),
    { ...base, effort: "high" }
  );
  assert.deepEqual(
    applyReasoningToTurnStart({ ...base, effort: "high" }, "auto"),
    base
  );
});

test("missing reasoning metadata falls back to Auto-only without rejecting saved mode", () => {
  const models = normalizeCodexModels({ models: [{ id: "legacy", model: "legacy" }] });
  assert.deepEqual(reasoningChoices(models[0]).map(item => item.value), ["auto"]);
  assert.equal(reconcileReasoningMode("medium", models[0]), "medium");
});

test("invalid model/list payload produces an empty catalog", () => {
  assert.deepEqual(normalizeCodexModels({ data: null }), []);
});
