import assert from "node:assert/strict";
import test from "node:test";
import {
  describeModelRoutes,
  normalizeModelRoutes,
  resolveRoleModel,
  validateModelRoute
} from "../src/model-routing.mjs";

test("role to model mappings are normalized and inspectable", () => {
  const routes = normalizeModelRoutes([
    { role: "planner", provider: "openai", model: "model-plan", capabilities: ["text"] },
    { role: "reviewer", model: "model-review", capabilities: "text" }
  ]);
  assert.equal(routes[0].model, "model-plan");
  assert.match(describeModelRoutes(routes), /planner -> openai\/model-plan/);
  assert.match(describeModelRoutes(routes), /reviewer -> model-review/);
});

test("configured model is resolved for an execution role", () => {
  const route = resolveRoleModel("executor", [
    { role: "executor", model: "model-code", capabilities: ["text", "tools"] }
  ]);
  assert.equal(route.model, "model-code");
  assert.equal(route.source, "configured");
});

test("unconfigured roles can intentionally use backend default", () => {
  const route = resolveRoleModel("summarizer", []);
  assert.equal(route.model, null);
  assert.equal(route.source, "default");
});

test("unsupported capabilities fail clearly before execution", () => {
  assert.throws(
    () => resolveRoleModel("vision", [
      { role: "vision", model: "text-only", capabilities: ["text"] }
    ]),
    /does not support required capabilities.*vision/
  );
  assert.throws(
    () => resolveRoleModel("executor", [
      { role: "executor", model: "plain", capabilities: ["text"] }
    ], { requiredCapabilities: ["tools"] }),
    /tools/
  );
});

test("invalid and duplicate role mappings fail closed", () => {
  assert.throws(() => validateModelRoute({ role: "unknown", model: "x" }), /Unsupported agent role/);
  assert.throws(() => validateModelRoute({ role: "planner", model: "" }), /Model is required/);
  assert.throws(() => normalizeModelRoutes([
    { role: "planner", model: "a" },
    { role: "planner", model: "b" }
  ]), /Duplicate model route/);
});
