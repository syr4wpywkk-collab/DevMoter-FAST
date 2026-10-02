import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createDispatcher } from "../server/tools-ai/dispatcher.mjs";
import { projectResult, LIMITS } from "../server/tools-ai/projection.mjs";
import { createRunStore } from "../server/tools-ai/run-store.mjs";
import { createToolsAiService } from "../server/tools-ai/service.mjs";
import { createProjectIndex } from "../server/project-index.mjs";
import { getGitStatus, listChangedFiles, getFileDiff } from "../server/git-workspace.mjs";
const exec = promisify(execFile);
const permissions = ["project-read", "host-observation"];
const identity = { ownerId: "owner", deviceId: null };
const waitFor = async (predicate) => { for (let i = 0; i < 200; i++) { if (predicate()) return; await new Promise(r => setTimeout(r, 5)); } throw new Error("State did not settle"); };
const deferred = () => { let release; return { promise: new Promise(r => { release = r; }), release: value => release(value) }; };

test("dispatcher runs real Git/index/Markdown helpers, preserving saved-index freshness and absence", async () => {
  const root = await mkdtemp(join(tmpdir(), "tools-ai-dispatch-"));
  try {
    const project = { id: "p1", path: join(root, "project") }; await mkdir(project.path);
    await exec("git", ["init", "-q"], { cwd: project.path });
    await writeFile(join(project.path, "README.md"), "# Fixture\nRun npm start\n");
    await writeFile(join(project.path, "auth.ts"), "export function authenticateUser() { return true; }\n");
    await exec("git", ["add", "."], { cwd: project.path });
    await exec("git", ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-qm", "fixture"], { cwd: project.path });
    await writeFile(join(project.path, "README.md"), "# Fixture\nRun npm start\nActual changed line\n");
    const index = createProjectIndex({ stateDir: join(root, "index"), resolveProject: async () => project });
    const context = { project, permissions };
    let observed = 0;
    const dispatch = createDispatcher({ resolveProject: async id => { assert.equal(id, project.id); return project; },
      gitStatus: getGitStatus, changedFiles: listChangedFiles, fileDiff: getFileDiff, index,
      readMarkdown: async (p, path) => ({ path, size: 48, content: await readFile(join(p.path, path), "utf8") }),
      diagnostics: async () => { observed++; return { app: { version: "fixture" }, prerequisites: { missing: ["codex"] }, network: { message: "local" }, backends: { codex: { online: false } } }; } });
    const call = (operationId, input = {}) => dispatch({ operationId, input }, context);
    const git = await call("git.inspect");
    assert.equal(git.data.files.total, 1); assert.match(git.data.diffs[0].diff, /Actual changed line/);
    for (const operation of ["project.search", "project.map"]) assert.equal((await call(operation, operation.endsWith("search") ? { query: "authenticateUser" } : {})).unavailable, true);
    assert.equal((await index.status(project.id)).ready, false, "no auto rebuild");
    await index.rebuild(project.id);
    const builtAt = (await index.status(project.id)).builtAt;
    await writeFile(join(project.path, "auth.ts"), "// changed after index build\n");
    const search = await call("project.search", { query: "authenticateUser" });
    assert.equal(search.builtAt, builtAt); assert.match(search.data.results[0].snippet, /authenticateUser/);
    assert.equal((await call("project.search", { query: "missing-symbol" })).data.results.length, 0);
    const map = await call("project.map"); assert.equal(map.builtAt, builtAt); assert.equal(map.data.totalFiles, 2);
    const document = await call("doc.read", { path: "README.md" }); assert.match(document.data.content, /npm start/);
    await assert.rejects(call("doc.read", { path: "auth.ts" }), /Markdown/);
    assert.equal((await call("diagnostics.read")).source, "bounded-host-diagnostics"); assert.equal(observed, 1);
    await assert.rejects(dispatch({ operationId: "git.inspect", input: {} }, { ...context, project: { ...project, path: "/changed" } }), /scope changed/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("projection excludes credential-like content BEFORE byte truncation, caps oversized diff/map", () => {
  const secret = "fixture-private-value";
  const document = projectResult("document", { source: "doc", path: "README.md", size: 50_000, content: "a".repeat(30_000) + `\napi_key = '${secret}'` });
  assert.equal(document.sharing.excluded, true); assert.ok(!JSON.stringify(document).includes(secret));
  const mixed = projectResult("document", { source: "doc", path: "README.md", size: 80, content: `Run npm start\nAPI_KEY='${secret}'\nThen open localhost` });
  assert.match(mixed.data.content, /npm start/); assert.ok(!mixed.data.content.includes(secret));
  const multiline = projectResult("document", { source: "doc", path: "README.md", size: 80, content: `password =\n '${secret}'` });
  assert.ok(!JSON.stringify(multiline).includes(secret));
  for (const assignment of ["AWS_SECRET_ACCESS_KEY", "privateKey", "authToken"]) {
    const result = projectResult("document", { source: "doc", path: "a.md", content: `${assignment}='${secret}'`, size: 50 });
    assert.ok(!JSON.stringify(result).includes(secret), assignment);
  }
  const snippet = projectResult("search", { source: "index", builtAt: 123, query: "token", results: [{ path: "auth.ts", line: 2, snippet: `const password = '${secret}';` }] });
  assert.equal(snippet.sharing.excluded, true); assert.ok(!JSON.stringify(snippet).includes(secret));
  const git = projectResult("git", { source: "git", status: { isGit: true, branch: "main" }, files: { total: 1, files: [{ path: "a.ts", status: ["modified"] }] }, diffs: [{ path: "a.ts", diff: "x".repeat(200_000) }] });
  assert.equal(git.sharing.truncated, true); assert.ok(Buffer.byteLength(JSON.stringify(git)) <= LIMITS.bytes);
  const credentialDiff = projectResult("git", { source: "git", status: { isGit: true }, files: { total: 1, files: [{ path: "a.ts", status: [] }] }, diffs: [{ path: "a.ts", diff: `+SECRET=${secret}` }] });
  assert.equal(credentialDiff.sharing.excluded, true);
  const map = projectResult("map", { source: "index", builtAt: 1, totalFiles: 2500, files: Array.from({ length: 2500 }, (_, i) => ({ path: `src/${i}.ts` })), directories: [], symbols: [] });
  assert.equal(map.data.files.length, 40); assert.equal(map.sharing.truncated, true); assert.ok(Buffer.byteLength(JSON.stringify(map)) <= LIMITS.bytes);
});

test("run completion, failure, durable reconnect, restart unknown, duplicate request and step IDs", async () => {
  const root = await mkdtemp(join(tmpdir(), "tools-ai-runs-"));
  try {
    const filePath = join(root, "runs.json"); const store = createRunStore({ filePath });
    const context = { project: null, deviceId: null, permissions, planner: { providerId: "p", model: "m" } };
    const service = createToolsAiService({ store, authorize: async () => {}, prepareChat: async () => ({ context, secrets: [], chat: async messages => messages[0].content.includes("ONE") ? '{"operationId":"diagnostics.read","input":{}}' : '{"factIds":["f0"]}' }), dispatch: async () => ({ type: "diagnostics", facts: [{ id: "f0", text: "actual observation" }] }) });
    const payload = { goal: "diagnose", requestId: "request-1" };
    const run = await service.start(payload, identity); await waitFor(() => store.get(run.runId).status === "completed");
    assert.match(store.get(run.runId).explanation.rawText, /actual observation/);
    await assert.rejects(service.start(payload, identity), error => error.status === 409 && error.runId === run.runId);
    const restored = createRunStore({ filePath }); await restored.ready(); assert.equal(restored.get(run.runId).status, "completed");
    const migratedIdentity = { ownerId: "owner:new-uuid", legacyOwnerIds: ["owner"], deviceId: null };
    assert.equal((await service.get(run.runId, migratedIdentity)).runId, run.runId, "owner migration preserves reconnect to existing runs");
    await assert.rejects(service.start(payload, migratedIdentity), error => error.status === 409 && error.runId === run.runId);
    await assert.rejects(service.get(run.runId, { ...migratedIdentity, deviceId: "other-device" }), /scope denied/);
    await assert.rejects(service.get(run.runId, { ...identity, ownerId: "other" }), /scope denied/);
    await assert.rejects(service.get(run.runId, { ...identity, deviceId: "other-device" }), /scope denied/);
    const active = await store.create({ requestId: "request-2", ownerId: "owner", goal: "pending", context, catalogVersion: "v1" });
    await store.beginStep(active.runId, { operationId: "diagnostics.read", input: {} }, "step-id");
    await assert.rejects(store.beginStep(active.runId, { operationId: "diagnostics.read", input: {} }, "step-id"), error => error.status === 409);
    const restarted = createRunStore({ filePath }); await restarted.ready(); assert.equal(restarted.get(active.runId).status, "unknown");
    assert.equal(restarted.get(active.runId).steps[0].status, "unknown");
    const failedService = createToolsAiService({ store, authorize: async () => {}, prepareChat: async () => ({ context, secrets: [], chat: async () => "broken json" }), dispatch: () => assert.fail("must not dispatch") });
    const failed = await failedService.start({ goal: "x", requestId: "request-3" }, identity);
    await waitFor(() => store.get(failed.runId).status === "failed"); assert.equal(store.get(failed.runId).steps.length, 0);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("Stop suppresses late planning and future calls, preserves completed bounded read results", async () => {
  for (const phase of ["planning", "running"]) {
    const root = await mkdtemp(join(tmpdir(), "tools-ai-stop-"));
    try {
      const store = createRunStore({ filePath: join(root, "runs.json") }); const gate = deferred(); let calls = 0;
      const context = { project: null, deviceId: null, permissions, planner: { providerId: "p", model: "m" } };
      const service = createToolsAiService({ store, authorize: async () => {}, prepareChat: async () => ({ context, secrets: [], chat: async () => { if (phase === "planning") await gate.promise; return '{"operationId":"diagnostics.read","input":{}}'; } }),
        dispatch: async () => { calls++; await gate.promise; return { facts: [{ id: "f0", text: "actual" }] }; } });
      const run = await service.start({ goal: "x", requestId: "stop-request" }, identity);
      await waitFor(() => store.get(run.runId).status === phase);
      assert.equal((await service.stop(run.runId, identity)).status, "stop_requested"); gate.release();
      await waitFor(() => store.get(run.runId).status === "stopped");
      assert.equal(calls, phase === "planning" ? 0 : 1);
      if (phase === "running") assert.equal(store.get(run.runId).steps[0].status, "completed");
      assert.equal(store.get(run.runId).explanation, null);
    } finally { await rm(root, { recursive: true, force: true }); }
  }
});

test("Stop during git status suppresses later file/diff helper calls", async () => {
  const controller = new AbortController(); let files = 0;
  const project = { id: "p", path: "/fixture" };
  const dispatch = createDispatcher({ resolveProject: async () => project, gitStatus: async () => { controller.abort(); return {}; }, changedFiles: async () => { files++; return { files: [] }; } });
  await assert.rejects(dispatch({ operationId: "git.inspect", input: {} }, { project, permissions }, { signal: controller.signal }), /abort/i);
  assert.equal(files, 0);
});

test("completion wins a Stop authorization race without being overwritten as unknown", async () => {
  const root = await mkdtemp(join(tmpdir(), "tools-ai-stop-race-"));
  try {
    const store = createRunStore({ filePath: join(root, "runs.json") });
    const readGate = deferred(), authorizationGate = deferred(); let entered = false;
    const context = { project: null, deviceId: null, permissions, planner: { providerId: "p", model: "m" } };
    const service = createToolsAiService({ store, authorize: async (_context, caller) => { if (caller.delay) { entered = true; await authorizationGate.promise; } },
      prepareChat: async () => ({ context, secrets: [], chat: async messages => messages[0].content.includes("ONE") ? '{"operationId":"diagnostics.read","input":{}}' : '{"factIds":["f0"]}' }),
      dispatch: async () => { await readGate.promise; return { facts: [{ id: "f0", text: "actual" }] }; } });
    const run = await service.start({ goal: "x", requestId: "race-request" }, identity);
    await waitFor(() => store.get(run.runId).status === "running");
    const stopping = service.stop(run.runId, { ...identity, delay: true }); await waitFor(() => entered);
    readGate.release(); await waitFor(() => store.get(run.runId).status === "completed");
    authorizationGate.release(); assert.equal((await stopping).status, "completed"); assert.equal(store.get(run.runId).status, "completed");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("Stop during initial persistence prevents a planner from starting after reconciliation", async () => {
  const root = await mkdtemp(join(tmpdir(), "tools-ai-initial-stop-"));
  try {
    const underlying = createRunStore({ filePath: join(root, "runs.json") });
    const gate = deferred(); let allocated; let calls = 0;
    const store = { ...underlying, create: async options => { allocated = await underlying.create(options); await gate.promise; return underlying.get(allocated.runId); } };
    const context = { project: null, deviceId: null, permissions, planner: { providerId: "p", model: "m" } };
    const service = createToolsAiService({ store, authorize: async () => {}, prepareChat: async () => ({ context, secrets: [], chat: async () => { calls++; return "{}"; } }), dispatch: () => assert.fail("must not execute") });
    const starting = service.start({ goal: "x", requestId: "initial-stop-request" }, identity);
    await waitFor(() => allocated);
    const reconciled = await service.findRequest("initial-stop-request", identity);
    assert.equal((await service.stop(reconciled.runId, identity)).status, "unknown");
    gate.release(); assert.equal((await starting).status, "unknown"); assert.equal(calls, 0);
  } finally { await rm(root, { recursive: true, force: true }); }
});


test("run store publishes only durable state and terminal outcomes cannot be rolled back", async () => {
  const root = await mkdtemp(join(tmpdir(), "tools-ai-durable-publish-"));
  try {
    const store = createRunStore({ filePath: join(root, "runs.json") });
    const context = { project: null, deviceId: null, permissions, planner: { providerId: "p", model: "m" } };
    const run = await store.create({ requestId: "durable-request", ownerId: "owner", goal: "x", context, catalogVersion: "v1" });
    const completing = store.update(run.runId, { status: "completed", explanation: { rawText: "done" } });
    assert.equal(store.get(run.runId).status, "planning", "unpersisted completion must not be observable");
    assert.equal((await completing).status, "completed");
    assert.equal(store.get(run.runId).status, "completed");

    const lateStop = await store.update(run.runId, { status: "stop_requested", cancellation: { requested: true, stage: "late", providerMayContinue: true } });
    assert.equal(lateStop.status, "completed");
    assert.equal(store.get(run.runId).status, "completed");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("Stop stays stopped when durable cancellation persistence lags the provider abort", async () => {
  const root = await mkdtemp(join(tmpdir(), "tools-ai-stop-durable-race-"));
  try {
    const underlying = createRunStore({ filePath: join(root, "runs.json") });
    const stopWriteGate = deferred();
    const store = {
      ...underlying,
      update(id, patch) {
        if (patch?.status === "stop_requested") return stopWriteGate.promise.then(() => underlying.update(id, patch));
        return underlying.update(id, patch);
      }
    };
    const context = { project: null, deviceId: null, permissions, planner: { providerId: "p", model: "m" } };
    const service = createToolsAiService({
      store,
      authorize: async () => {},
      prepareChat: async () => ({
        context,
        secrets: [],
        chat: async (_messages, signal) => new Promise((resolve, reject) => {
          const abort = () => reject(signal.reason || new DOMException("Stopped", "AbortError"));
          if (signal.aborted) return abort();
          signal.addEventListener("abort", abort, { once: true });
        })
      }),
      dispatch: () => assert.fail("must not execute")
    });
    const run = await service.start({ goal: "x", requestId: "durable-stop-request" }, identity);
    await waitFor(() => underlying.get(run.runId).status === "planning");
    const stopping = service.stop(run.runId, identity);
    await waitFor(() => underlying.get(run.runId).status === "stopped");
    stopWriteGate.release();
    assert.equal((await stopping).status, "stopped");
    assert.equal(underlying.get(run.runId).status, "stopped");
  } finally { await rm(root, { recursive: true, force: true }); }
});
