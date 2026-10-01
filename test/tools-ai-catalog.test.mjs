import test from "node:test";
import assert from "node:assert/strict";
import { catalogFor, validateProposal } from "../server/tools-ai/catalog.mjs";
const context = { project: { id: "p1" }, permissions: ["project-read", "host-observation"] };
test("catalog exposes only five scoped observations, never arbitrary execution", () => {
  assert.equal(catalogFor(context).filter(o => o.status === "supported").length, 5);
  const diagnostics = catalogFor(context).find(o => o.operationId === "diagnostics.read");
  assert.equal(diagnostics.observationKind, "bounded-exec-read");
  assert.deepEqual(diagnostics.requiredPermissions, ["host-observation"]);
  assert.equal(catalogFor({ ...context, project: null }).filter(o => o.status === "supported").length, 1);
});
test("validation rejects unknown, unsupported, invalid, scope-changing and escaping proposals", () => {
  assert.throws(() => validateProposal({ operationId: "shell", input: {} }, context), /Unknown/);
  assert.throws(() => validateProposal({ operationId: "git.inspect", input: {} }, { ...context, project: null }), /unavailable/);
  assert.throws(() => validateProposal({ operationId: "project.search", input: { query: "" } }, context), /Invalid/);
  assert.throws(() => validateProposal({ operationId: "git.inspect", input: { projectId: "p2" } }, context), /scope/);
  assert.throws(() => validateProposal({ operationId: "git.inspect", input: {}, projectId: "p2" }, context), /server-owned/);
  for (const path of ["../README.md", "/tmp/a.md", "C:/a.md", "a/../../b.md", "src/app.ts", "a\\b.md"]) {
    assert.throws(() => validateProposal({ operationId: "doc.read", input: { path } }, context));
  }
  assert.throws(() => validateProposal({ operationId: "git.inspect", input: { maxFiles: 99 } }, context));
  assert.deepEqual(validateProposal({ operationId: "doc.read", input: { path: "README.md" } }, context).input, { path: "README.md" });
});
