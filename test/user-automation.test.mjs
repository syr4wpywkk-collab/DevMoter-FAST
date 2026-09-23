import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  HOOK_SCHEMA_VERSION,
  createUserAutomationService,
  normalizeHook,
  normalizeRecipe,
  normalizeSlashCommand,
  resolveSlashCommand,
  validateRecipeParameters
} from "../server/user-automation.mjs";

function serviceAt(configDir, overrides = {}) {
  return createUserAutomationService({
    configDir,
    resolveProject: async id => ({ id, name: id, path: configDir }),
    executeTask: async (_definition, context = {}) => {
      context.setCancel?.(() => {});
      return { summary: "done", ok: true };
    },
    runVerification: async () => ({ ok: true, configured: true }),
    ...overrides
  });
}

test("hooks use versioned schema and unapproved mutating hooks fail closed", async t => {
  const dir = await mkdtemp(join(tmpdir(), "devmoter-hooks-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const service = serviceAt(dir);
  await service.writeState({
    hooks: [
      { id: "observe", name: "observe", event: "before-run", kind: "notify" },
      { id: "mutate", name: "mutate", event: "before-run", kind: "command", command: process.execPath, args: ["-e", "process.exit(0)"], approved: false }
    ]
  });
  const emitted = await service.emitHook("before-run", { projectId: "p1", runId: "r1" });
  assert.equal(emitted.schema.schemaVersion, HOOK_SCHEMA_VERSION);
  assert.equal(emitted.schema.event, "before-run");
  assert.equal(emitted.results.find(item => item.id === "observe").status, "observed");
  assert.equal(emitted.results.find(item => item.id === "mutate").status, "blocked");
});

test("approved command hook is bounded and does not wedge lifecycle dispatch", async t => {
  const dir = await mkdtemp(join(tmpdir(), "devmoter-hook-timeout-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const service = serviceAt(dir);
  await service.writeState({
    hooks: [{
      id: "slow",
      name: "slow",
      event: "after-run",
      kind: "command",
      command: process.execPath,
      args: ["-e", "setTimeout(()=>{}, 5000)"],
      approved: true,
      timeoutMs: 250
    }]
  });
  const started = Date.now();
  const emitted = await service.emitHook("after-run", { projectId: "p1" });
  assert.equal(emitted.results[0].status, "failed");
  assert.ok(Date.now() - started < 3000);
});

test("custom slash commands reserve built-ins and expand arguments safely", () => {
  assert.throws(
    () => normalizeSlashCommand({ name: "help", kind: "prompt", template: "x" }),
    /reserved/i
  );
  const command = normalizeSlashCommand({
    name: "review-now",
    description: "review this",
    kind: "prompt",
    template: "Review exactly this request: {{args}}"
  });
  const resolved = resolveSlashCommand([command], "/review-now src/main.ts");
  assert.equal(resolved.prompt, "Review exactly this request: src/main.ts");
});

test("recipe parameters are typed and reject unknown values", () => {
  const recipe = normalizeRecipe({
    id: "release-check",
    parameters: {
      count: { type: "number" },
      strict: { type: "boolean", default: false, required: false },
      target: { type: "enum", values: ["main", "staging"] }
    },
    steps: [{ type: "verify" }]
  });
  assert.deepEqual(
    validateRecipeParameters(recipe, { count: "2", strict: "true", target: "main" }),
    { count: 2, strict: true, target: "main" }
  );
  assert.throws(() => validateRecipeParameters(recipe, { count: "x", target: "main" }), /must be a number/);
  assert.throws(() => validateRecipeParameters(recipe, { count: 2, target: "prod" }), /must be one of/);
  assert.throws(() => validateRecipeParameters(recipe, { count: 2, target: "main", surprise: 1 }), /Unknown recipe parameter/);
});

test("recipe execution is inspectable and cancellable during a prompt step", async t => {
  const dir = await mkdtemp(join(tmpdir(), "devmoter-recipe-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  let release;
  const blocked = new Promise(resolve => { release = resolve; });
  let cancelled = false;
  const service = serviceAt(dir, {
    executeTask: async (_definition, context = {}) => {
      context.setCancel?.(() => {
        cancelled = true;
        release({ summary: "cancelled" });
      });
      return blocked;
    }
  });
  await service.writeState({
    recipes: [{
      id: "long-task",
      name: "Long task",
      parameters: { target: { type: "string" } },
      steps: [
        { id: "prompt", type: "prompt", prompt: "Work on {{target}}", backend: "codex" },
        { id: "verify", type: "verify" }
      ]
    }]
  });
  const started = await service.startRecipe("long-task", {
    projectId: "p1",
    parameters: { target: "src" }
  });
  assert.equal(started.status, "queued");
  await new Promise(resolve => setImmediate(resolve));
  const active = service.getRun(started.id);
  assert.equal(active.status, "running");
  assert.equal(active.currentStep, 0);

  await service.cancelRecipe(started.id);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(cancelled, true);
  assert.equal(service.getRun(started.id).status, "cancelled");
});

test("user automation state is private config data and round-trips normalized content", async t => {
  const dir = await mkdtemp(join(tmpdir(), "devmoter-user-automation-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const service = serviceAt(dir);
  const state = await service.writeState({
    slashCommands: [{
      name: "summarize",
      kind: "prompt",
      template: "Summarize {{args}}"
    }],
    recipes: [{
      id: "verify-only",
      steps: [{ type: "verify" }]
    }]
  });
  assert.equal(state.version, 1);
  assert.equal(state.slashCommands[0].precedence, 20);
  const raw = JSON.parse(await readFile(join(dir, "user-automation.json"), "utf8"));
  assert.equal(raw.slashCommands[0].source, "user");
});
