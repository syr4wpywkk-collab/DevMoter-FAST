import test from "node:test";
import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  HOOK_SCHEMA_VERSION,
  createUserAutomationService,
  hookChildEnvironment,
  normalizeHook,
  normalizeRecipe,
  normalizeSlashCommand,
  resolveSlashCommand,
  userAutomationPolicy,
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

test("hook audit skips malformed and non-object records before applying the valid-entry limit", async t => {
  const dir = await mkdtemp(join(tmpdir(), "devmoter-hook-audit-read-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const service = serviceAt(dir);
  assert.deepEqual(await service.readHookAudit(), []);
  await writeFile(join(dir, "hook-audit.jsonl"), [
    '{"id":"first"}', "garbage", '{"id":"second"}', "null", "[]", "123", '"text"', '{"torn":'
  ].join("\n"));
  assert.deepEqual(await service.readHookAudit(), [{ id: "first" }, { id: "second" }]);
  assert.deepEqual(await service.readHookAudit(1), [{ id: "second" }]);
  await writeFile(join(dir, "hook-audit.jsonl"), "garbage\nnull\n[]\n");
  assert.deepEqual(await service.readHookAudit(), []);
});

test("audit write failures are logged and retain executed and blocked hook results", async t => {
  const dir = await mkdtemp(join(tmpdir(), "devmoter-hook-audit-write-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const logs = [];
  t.mock.method(console, "error", (...args) => logs.push(args));
  let executions = 0;
  const service = serviceAt(dir, {
    env: { DEVMOTER_SANDBOX: "off", DEVMOTER_ALLOW_UNSANDBOXED_HOOKS: "1" },
    execFile: async () => {
      executions++;
      return { stdout: "executed", stderr: "" };
    }
  });
  await service.writeState({ hooks: [
    { id: "run", event: "after-run", kind: "command", command: "test-command", approved: true },
    { id: "unapproved", event: "after-run", kind: "command", command: "test-command", approved: false }
  ] });
  await mkdir(join(dir, "hook-audit.jsonl"));
  const emitted = await service.emitHook("after-run");
  assert.equal(executions, 1);
  assert.equal(emitted.results[0].status, "completed");
  assert.equal(emitted.results[0].stdout, "executed");
  assert.equal(emitted.results[1].status, "blocked");
  const blockedService = serviceAt(dir, { env: { DEVMOTER_SANDBOX: "off" } });
  const blocked = await blockedService.emitHook("after-run");
  assert.ok(blocked.results.every(result => result.status === "blocked"));
  for (const result of [...emitted.results, ...blocked.results]) {
    assert.match(result.auditError, /EISDIR/);
  }
  assert.equal(logs.length, 4);
  assert.ok(logs.every(args => args[0] === "Hook audit persistence failed" && /EISDIR/.test(args[1])));
  await rm(join(dir, "hook-audit.jsonl"), { recursive: true });
  const recovered = await service.emitHook("after-run");
  assert.ok(recovered.results.every(result => !Object.hasOwn(result, "auditError")));
  assert.equal((await service.readHookAudit()).length, 2);
});

test("hook audit rotates one generation past 5 MiB and keeps the file private", async t => {
  const dir = await mkdtemp(join(tmpdir(), "devmoter-hook-audit-rotate-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const service = serviceAt(dir, { env: { DEVMOTER_SANDBOX: "off" } });
  await service.writeState({ hooks: [
    { id: "blocked", event: "after-run", kind: "command", command: "test-command", approved: true }
  ] });
  const auditFile = join(dir, "hook-audit.jsonl");
  const oversized = '{"id":"old"}\n'.padEnd(5 * 1024 * 1024 + 1, " ");
  await writeFile(auditFile, oversized);
  const emitted = await service.emitHook("after-run");
  assert.ok(emitted.results.every(result => !Object.hasOwn(result, "auditError")));
  assert.equal((await readFile(auditFile + ".1", "utf8")).length, oversized.length);
  const current = (await readFile(auditFile, "utf8")).trim().split("\n");
  assert.equal(current.length, 1);
  assert.equal(JSON.parse(current[0]).hookId, "blocked");
  if (process.platform !== "win32") assert.equal((await stat(auditFile)).mode & 0o777, 0o600);
});

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
  const service = serviceAt(dir, {
    env: {
      ...process.env,
      DEVMOTER_SANDBOX: "preferred",
      DEVMOTER_ALLOW_UNSANDBOXED_HOOKS: "1"
    }
  });
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
  assert.equal(typeof emitted.results[0].sandboxed, "boolean");
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

test("approved hook subprocess env inherits only allowlisted variables, strips secrets/unlisted vars, and blocks injection hooks", () => {
  const schema = { schemaVersion: 1, event: "after-run", payload: {} };
  const env = hookChildEnvironment("after-run", schema, {
    PATH: "/usr/bin",
    LANG: "C.UTF-8",
    DEVMOTER_PRIVATE_TOKEN: "hidden",
    OPENAI_API_KEY: "hidden",
    DATABASE_URL: "postgres://hidden",
    SUPABASE_SERVICE_ROLE_KEY: "hidden-role-key",
    NODE_OPTIONS: "--require=attacker.js",
    LD_PRELOAD: "/tmp/injected.so",
    UNLISTED_VAR: "not-allowlisted"
  });
  assert.equal(env.PATH, "/usr/bin");
  assert.equal(env.LANG, "C.UTF-8");
  assert.equal(env.UNLISTED_VAR, undefined);
  assert.equal(env.DATABASE_URL, undefined);
  assert.equal(env.SUPABASE_SERVICE_ROLE_KEY, undefined);
  assert.equal(env.DEVMOTER_PRIVATE_TOKEN, undefined);
  assert.equal(env.OPENAI_API_KEY, undefined);
  assert.equal(env.NODE_OPTIONS, undefined);
  assert.equal(env.LD_PRELOAD, undefined);
  assert.equal(env.DEVMOTER_HOOK_EVENT, "after-run");
  assert.deepEqual(JSON.parse(env.DEVMOTER_HOOK_EVENT_JSON), schema);
});

test("command hooks fail closed when bwrap is unavailable without explicit opt-in", async t => {
  const dir = await mkdtemp(join(tmpdir(), "devmoter-hook-no-bwrap-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const marker = join(dir, "ran.txt");
  const service = serviceAt(dir, {
    env: { DEVMOTER_SANDBOX: "preferred" },
    spawnSync: () => ({ status: 127, stdout: "" })
  });
  await service.writeState({
    hooks: [{
      id: "cmd-hook",
      name: "cmd-hook",
      event: "before-run",
      kind: "command",
      command: process.execPath,
      args: ["-e", `require("node:fs").writeFileSync(${JSON.stringify(marker)}, "ran")`],
      approved: true
    }]
  });

  const emitted = await service.emitHook("before-run", { projectId: "p1" });
  const result = emitted.results[0];
  assert.equal(result.status, "blocked");
  assert.equal(result.sandboxed, false);
  assert.match(result.sandboxReason, /bubblewrap \(bwrap\) is unavailable/i);
  assert.match(result.sandboxReason, /DEVMOTER_ALLOW_UNSANDBOXED_HOOKS=1/);
  await assert.rejects(() => access(marker), { code: "ENOENT" });

  const audit = await service.readHookAudit();
  assert.equal(audit.length, 1);
  assert.equal(audit[0].status, "blocked");
  assert.equal(audit[0].sandboxed, false);
  assert.equal(audit[0].optInUsed, false);
  assert.equal(audit[0].sandboxReason, result.sandboxReason);
});

test("command hooks do not run implicitly when projectId is missing or boundary is unresolvable", async t => {
  const dir = await mkdtemp(join(tmpdir(), "devmoter-hook-no-project-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const marker = join(dir, "ran.txt");
  const bwrapAvailable = () => ({ status: 0, stdout: "bubblewrap 0.10.0" });

  let executions = 0;
  const serviceNull = serviceAt(dir, {
    env: { DEVMOTER_SANDBOX: "preferred" },
    spawnSync: bwrapAvailable,
    resolveProject: async id => (id === "relative" ? { id, path: "relative/dir" } : null),
    execFile: async () => { executions += 1; return { stdout: "", stderr: "" }; }
  });
  await serviceNull.writeState({
    hooks: [{
      id: "hook-boundary",
      name: "hook-boundary",
      event: "after-tool",
      kind: "command",
      command: process.execPath,
      args: ["-e", `require("node:fs").writeFileSync(${JSON.stringify(marker)}, "ran")`],
      approved: true
    }]
  });

  const missingProjectId = await serviceNull.emitHook("after-tool", {});
  assert.equal(missingProjectId.results[0].status, "blocked");
  assert.equal(missingProjectId.results[0].sandboxed, false);
  assert.match(missingProjectId.results[0].sandboxReason, /missing registered project boundary/i);

  const unresolvedProject = await serviceNull.emitHook("after-tool", { projectId: "missing" });
  assert.equal(unresolvedProject.results[0].status, "blocked");
  assert.equal(unresolvedProject.results[0].sandboxed, false);
  assert.match(unresolvedProject.results[0].sandboxReason, /could not be resolved/i);

  const relativeProject = await serviceNull.emitHook("after-tool", { projectId: "relative" });
  assert.equal(relativeProject.results[0].status, "blocked");
  assert.equal(relativeProject.results[0].sandboxed, false);
  assert.match(relativeProject.results[0].sandboxReason, /could not be resolved/i);

  const serviceThrowing = serviceAt(dir, {
    env: { DEVMOTER_SANDBOX: "preferred" },
    spawnSync: bwrapAvailable,
    resolveProject: async () => { throw new Error("Project not found"); },
    execFile: async () => { executions += 1; return { stdout: "", stderr: "" }; }
  });
  const threwProject = await serviceThrowing.emitHook("after-tool", { projectId: "ghost" });
  assert.equal(threwProject.results[0].status, "failed");
  assert.equal(threwProject.results[0].sandboxed, false);
  assert.match(threwProject.results[0].sandboxReason, /Project not found/);

  assert.equal(executions, 0);
  await assert.rejects(() => access(marker), { code: "ENOENT" });
  const audit = await serviceNull.readHookAudit();
  assert.equal(audit.length, 4);
  assert.ok(audit.every(entry => entry.sandboxed === false && typeof entry.sandboxReason === "string" && entry.sandboxReason.length > 0));
});

test("command hooks run unsandboxed only with DEVMOTER_ALLOW_UNSANDBOXED_HOOKS=1 and record sandboxed=false and reason", async t => {
  const dir = await mkdtemp(join(tmpdir(), "devmoter-hook-opt-in-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const marker = join(dir, "allowed.txt");
  const env = { ...process.env, DEVMOTER_SANDBOX: "preferred", DEVMOTER_ALLOW_UNSANDBOXED_HOOKS: "1" };

  const serviceNoBwrap = serviceAt(dir, {
    env,
    spawnSync: () => ({ status: 127, stdout: "" })
  });
  await serviceNoBwrap.writeState({
    hooks: [{
      id: "opt-in-ok",
      name: "opt-in-ok",
      event: "before-run",
      kind: "command",
      command: process.execPath,
      args: ["-e", `require("node:fs").writeFileSync(${JSON.stringify(marker)}, "ok"); console.log("done");`],
      approved: true
    }, {
      id: "opt-in-fail",
      name: "opt-in-fail",
      event: "after-run",
      kind: "command",
      command: process.execPath,
      args: ["-e", "process.exit(2)"],
      approved: true
    }]
  });

  const completed = await serviceNoBwrap.emitHook("before-run", { projectId: "p1" });
  assert.equal(completed.results[0].status, "completed");
  assert.equal(completed.results[0].sandboxed, false);
  assert.match(completed.results[0].sandboxReason, /bubblewrap \(bwrap\) is unavailable; allowed via DEVMOTER_ALLOW_UNSANDBOXED_HOOKS=1/);
  assert.equal(completed.results[0].stdout.trim(), "done");
  assert.equal(await readFile(marker, "utf8"), "ok");

  const failed = await serviceNoBwrap.emitHook("after-run", { projectId: "p1" });
  assert.equal(failed.results[0].status, "failed");
  assert.equal(failed.results[0].sandboxed, false);
  assert.match(failed.results[0].sandboxReason, /DEVMOTER_ALLOW_UNSANDBOXED_HOOKS=1/);

  const noProjectMarker = join(dir, "no-project-allowed.txt");
  const serviceNoProject = serviceAt(dir, {
    env,
    spawnSync: () => ({ status: 0, stdout: "bubblewrap 0.10.0" }),
    resolveProject: async () => null
  });
  await serviceNoProject.writeState({
    hooks: [{
      id: "no-project-ok",
      name: "no-project-ok",
      event: "after-tool",
      kind: "command",
      command: process.execPath,
      args: ["-e", `require("node:fs").writeFileSync(${JSON.stringify(noProjectMarker)}, "ok");`],
      approved: true
    }]
  });
  const noProjectRes = await serviceNoProject.emitHook("after-tool", {});
  assert.equal(noProjectRes.results[0].status, "completed");
  assert.equal(noProjectRes.results[0].sandboxed, false);
  assert.match(noProjectRes.results[0].sandboxReason, /missing registered project boundary; allowed via DEVMOTER_ALLOW_UNSANDBOXED_HOOKS=1/);
  assert.equal(await readFile(noProjectMarker, "utf8"), "ok");

  const audit = await serviceNoBwrap.readHookAudit();
  assert.equal(audit.length, 3);
  assert.deepEqual(
    audit.map(entry => [entry.hookId, entry.status, entry.sandboxed, entry.optInUsed]),
    [
      ["opt-in-ok", "completed", false, true],
      ["opt-in-fail", "failed", false, true],
      ["no-project-ok", "completed", false, true]
    ]
  );
  assert.ok(audit.every(entry => typeof entry.sandboxReason === "string" && entry.sandboxReason.includes("DEVMOTER_ALLOW_UNSANDBOXED_HOOKS=1")));
});

test("command hooks use bwrap when available and respect required and off sandbox modes", async t => {
  const dir = await mkdtemp(join(tmpdir(), "devmoter-hook-sandbox-modes-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const spawned = [];

  const serviceSandboxed = serviceAt(dir, {
    env: { DEVMOTER_SANDBOX: "preferred", DEVMOTER_ALLOW_UNSANDBOXED_HOOKS: "1" },
    spawnSync: () => ({ status: 0, stdout: "bubblewrap 0.10.0" }),
    execFile: async (command, args) => {
      spawned.push({ command, args });
      return { stdout: "sandboxed-ok", stderr: "" };
    }
  });
  await serviceSandboxed.writeState({
    hooks: [{
      id: "sandboxed-hook",
      name: "sandboxed-hook",
      event: "before-run",
      kind: "command",
      command: "echo",
      args: ["hello"],
      approved: true
    }]
  });

  const sandboxedResult = await serviceSandboxed.emitHook("before-run", { projectId: "p1" });
  assert.equal(sandboxedResult.results[0].status, "completed");
  assert.equal(sandboxedResult.results[0].sandboxed, true);
  assert.equal("sandboxReason" in sandboxedResult.results[0], false);
  assert.equal(spawned[0].command, "bwrap");
  assert.ok(spawned[0].args.includes("--unshare-net"));
  assert.ok(spawned[0].args.includes(dir));

  const requiredWithOptIn = serviceAt(dir, {
    env: { DEVMOTER_SANDBOX: "required", DEVMOTER_ALLOW_UNSANDBOXED_HOOKS: "1" },
    spawnSync: () => ({ status: 127, stdout: "" }),
    execFile: async () => { throw new Error("must not execute"); }
  });
  const requiredBlocked = await requiredWithOptIn.emitHook("before-run", { projectId: "p1" });
  assert.equal(requiredBlocked.results[0].status, "blocked");
  assert.equal(requiredBlocked.results[0].sandboxed, false);
  assert.match(requiredBlocked.results[0].sandboxReason, /DEVMOTER_SANDBOX=required/);

  const offWithoutOptIn = serviceAt(dir, {
    env: { DEVMOTER_SANDBOX: "off" },
    spawnSync: () => ({ status: 0, stdout: "bubblewrap 0.10.0" }),
    execFile: async () => { throw new Error("must not execute"); }
  });
  const offBlocked = await offWithoutOptIn.emitHook("before-run", { projectId: "p1" });
  assert.equal(offBlocked.results[0].status, "blocked");
  assert.equal(offBlocked.results[0].sandboxed, false);
  assert.match(offBlocked.results[0].sandboxReason, /DEVMOTER_SANDBOX=off/);

  const offWithOptIn = serviceAt(dir, {
    env: { DEVMOTER_SANDBOX: "off", DEVMOTER_ALLOW_UNSANDBOXED_HOOKS: "1" },
    spawnSync: () => ({ status: 0, stdout: "bubblewrap 0.10.0" }),
    execFile: async (command, args) => {
      spawned.push({ command, args });
      return { stdout: "off-ok", stderr: "" };
    }
  });
  const offAllowed = await offWithOptIn.emitHook("before-run", { projectId: "p1" });
  assert.equal(offAllowed.results[0].status, "completed");
  assert.equal(offAllowed.results[0].sandboxed, false);
  assert.match(offAllowed.results[0].sandboxReason, /DEVMOTER_SANDBOX=off.*DEVMOTER_ALLOW_UNSANDBOXED_HOOKS=1/);
  assert.equal(spawned[1].command, "echo");

  const sandboxedFailService = serviceAt(dir, {
    env: { DEVMOTER_SANDBOX: "required" },
    spawnSync: () => ({ status: 0, stdout: "bubblewrap 0.10.0" }),
    execFile: async () => { throw new Error("hook command exited 1"); }
  });
  const sandboxedFailed = await sandboxedFailService.emitHook("before-run", { projectId: "p1" });
  assert.equal(sandboxedFailed.results[0].status, "failed");
  assert.equal(sandboxedFailed.results[0].sandboxed, true);
  assert.equal("sandboxReason" in sandboxedFailed.results[0], false);

  assert.match(userAutomationPolicy.hookSandbox, /DEVMOTER_ALLOW_UNSANDBOXED_HOOKS=1/);
  const auditLines = (await readFile(join(dir, "hook-audit.jsonl"), "utf8")).trim().split("\n").map(line => JSON.parse(line));
  assert.equal(auditLines.length, 5);
  assert.equal(auditLines[0].sandboxed, true);
  assert.equal("sandboxReason" in auditLines[0], false);
  assert.equal(auditLines[0].optInUsed, false);
  assert.equal(auditLines[4].status, "failed");
  assert.equal(auditLines[4].sandboxed, true);
  assert.equal("sandboxReason" in auditLines[4], false);
});
