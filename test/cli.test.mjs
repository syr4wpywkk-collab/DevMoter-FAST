import test from "node:test";
import assert from "node:assert/strict";
import { parseArgs, EXIT } from "../cli/devmoter.mjs";
import { createEventEnvelope, DEVMOTER_API_VERSION } from "../sdk/index.mjs";

test("CLI parser keeps machine-output flags separate from task inputs", () => {
  const parsed = parseArgs([
    "task",
    "--project", "demo",
    "--agent", "build",
    "--task", "run tests",
    "--backend", "opencode",
    "--stream-json"
  ]);

  assert.equal(parsed.command, "task");
  assert.equal(parsed.options.project, "demo");
  assert.equal(parsed.options.agent, "build");
  assert.equal(parsed.options.task, "run tests");
  assert.equal(parsed.options.backend, "opencode");
  assert.equal(parsed.options["stream-json"], true);
  assert.equal(EXIT.USAGE, 2);
});

test("event envelopes are stable and versioned", () => {
  const event = createEventEnvelope("task.accepted", { ok: true }, {
    operationId: "op-1",
    timestamp: "2026-09-22T00:00:00.000Z"
  });

  assert.deepEqual(event, {
    version: DEVMOTER_API_VERSION,
    type: "task.accepted",
    timestamp: "2026-09-22T00:00:00.000Z",
    operationId: "op-1",
    data: { ok: true }
  });
});
