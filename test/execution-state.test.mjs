import test from "node:test";
import assert from "node:assert/strict";
import {
  codexThreadStatusToExecutionState,
  codexTurnStatusToExecutionState,
  isExecutionActive,
  isExecutionTerminal,
  openCodeIdleOutcomeToExecutionState
} from "../src/execution-state.mjs";

test("shared execution states expose active and terminal semantics", () => {
  for (const state of ["running", "waiting_for_approval", "waiting_for_input"]) {
    assert.equal(isExecutionActive(state), true, state);
  }
  for (const state of ["idle", "completed", "failed", "interrupted", "offline", "reconnecting"]) {
    assert.equal(isExecutionActive(state), false, state);
  }

  for (const state of ["completed", "failed", "interrupted"]) {
    assert.equal(isExecutionTerminal(state), true, state);
  }
});

test("Codex turn statuses map to canonical execution states", () => {
  assert.equal(codexTurnStatusToExecutionState("in_progress"), "running");
  assert.equal(codexTurnStatusToExecutionState("completed"), "completed");
  assert.equal(codexTurnStatusToExecutionState("failed"), "failed");
  assert.equal(codexTurnStatusToExecutionState("interrupted"), "interrupted");
});

test("Codex thread status detects approval/input waits and errors", () => {
  assert.equal(codexThreadStatusToExecutionState({ type: "active", activeFlags: [] }), "running");
  assert.equal(
    codexThreadStatusToExecutionState({ type: "active", activeFlags: ["waitingOnApproval"] }),
    "waiting_for_approval"
  );
  assert.equal(
    codexThreadStatusToExecutionState({ type: "active", active_flags: ["waiting_on_user_input"] }),
    "waiting_for_input"
  );
  assert.equal(codexThreadStatusToExecutionState({ type: "systemError" }), "failed");
  assert.equal(codexThreadStatusToExecutionState({ type: "idle" }), "idle");
});

test("OpenCode idle outcomes reconcile to canonical terminal states", () => {
  assert.equal(openCodeIdleOutcomeToExecutionState("succeeded"), "completed");
  assert.equal(openCodeIdleOutcomeToExecutionState("failed"), "failed");
  assert.equal(openCodeIdleOutcomeToExecutionState("interrupted"), "interrupted");
  assert.equal(openCodeIdleOutcomeToExecutionState(undefined), "idle");
});
