import assert from "node:assert/strict";
import test from "node:test";
import {
  approveOrchestrationPlan,
  createOrchestrationPlan,
  decomposeTask,
  renderOrchestrationPrompt,
  transitionChild
} from "../src/orchestrator-core.mjs";

test("orchestrator decomposes a single broad task into bounded children", () => {
  const parts = decomposeTask("Add an agent fleet dashboard");
  assert.equal(parts.length, 3);
  assert.match(parts[0], /Inspect current state/);
});

test("decomposition respects an explicit maximum", () => {
  const parts = decomposeTask("one\ntwo\nthree\nfour", { maxChildren: 2 });
  assert.deepEqual(parts, ["one", "two"]);
});

test("plan exposes child owner/state before execution", () => {
  const plan = createOrchestrationPlan("one\ntwo", { id: "p1" });
  assert.equal(plan.state, "awaiting_approval");
  assert.equal(plan.requiresDelegationApproval, true);
  assert.deepEqual(plan.children.map(child => child.state), ["planned", "planned"]);
  assert.deepEqual(plan.children.map(child => child.owner), ["planner", "executor"]);
});

test("execution prompt fails closed until explicit approval", () => {
  const plan = createOrchestrationPlan("one\ntwo");
  assert.throws(() => renderOrchestrationPrompt(plan), /explicitly approved/);
  approveOrchestrationPlan(plan);
  const prompt = renderOrchestrationPrompt(plan);
  assert.match(prompt, /approved decomposition/i);
  assert.match(prompt, /extra delegation.*explicit user approval/i);
  assert.match(prompt, /normal backend approval\/diff flow/i);
});

test("child state transitions are bounded", () => {
  const plan = createOrchestrationPlan("one");
  approveOrchestrationPlan(plan);
  transitionChild(plan, "child-1", "running", "agent-a");
  assert.equal(plan.children[0].owner, "agent-a");
  assert.equal(plan.children[0].state, "running");
  transitionChild(plan, "child-1", "done");
  assert.throws(() => transitionChild(plan, "child-1", "running"), /Invalid child transition/);
});
