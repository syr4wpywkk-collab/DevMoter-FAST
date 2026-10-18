import test from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createSessionControl } from "../server/session-control.mjs";

function statePath(homeDir) {
  return join(homeDir, ".local", "state", "devmoter-fast", "session-control.json");
}

async function request(control, method, pathname, payload) {
  const req = Readable.from(payload === undefined ? [] : [Buffer.from(JSON.stringify(payload))]);
  req.method = method;
  const res = {
    status: null,
    writeHead(status) { this.status = status; },
    end(content) { this.body = JSON.parse(content); }
  };
  assert.equal(await control.handle(req, res, new URL(pathname, "http://localhost")), true);
  return { status: res.status, ...res.body };
}

async function withHome(run) {
  const homeDir = await mkdtemp(join(tmpdir(), "devmoter-session-control-"));
  try { await run(homeDir); } finally { await rm(homeDir, { recursive: true, force: true }); }
}

async function enqueue(control, text = "continue") {
  return request(control, "POST", "/api/session-control/queue", {
    backend: "codex", sessionId: "session-1", text
  });
}

test("queued follow-ups dispatch in order and persist the acknowledgement", async () => withHome(async homeDir => {
  const sends = [];
  const control = createSessionControl({
    homeDir,
    inspectSession: async () => ({ active: false, turns: 0, tokens: 0 }),
    dispatchQueued: async (_backend, _id, text) => { sends.push(text); },
    interruptSession: async () => {}
  });
  assert.equal((await enqueue(control, "first")).status, 201);
  assert.equal((await enqueue(control, "second")).status, 201);
  await control.reconcile();
  assert.deepEqual(sends, ["first"]);
  assert.equal((await request(control, "GET", "/api/session-control/state")).queue.length, 1);
  await control.reconcile();
  assert.deepEqual(sends, ["first", "second"]);
  assert.equal((await request(control, "GET", "/api/session-control/state")).queue.length, 0);
}));

test("ambiguous dispatch failures require explicit review and retry", async () => withHome(async homeDir => {
  let sends = 0;
  const control = createSessionControl({
    homeDir,
    inspectSession: async () => ({ active: false }),
    dispatchQueued: async () => { sends++; if (sends === 1) throw Error("network broke after send"); },
    interruptSession: async () => {}
  });
  const item = (await enqueue(control)).item;
  await control.reconcile();
  let state = (await request(control, "GET", "/api/session-control/state"));
  assert.equal(state.queue[0].status, "needs-review");
  assert.match(state.events.at(-1).detail, /manual review required/);
  await control.reconcile();
  assert.equal(sends, 1, "must not automatically retry an ambiguous send");
  assert.equal((await request(control, "PATCH", "/api/session-control/queue/" + item.id, { retry: true })).status, 200);
  await control.reconcile();
  assert.equal(sends, 2);
  assert.equal((await request(control, "GET", "/api/session-control/state")).queue.length, 0);
}));

test("unacknowledged dispatch remains quarantined after restart", async () => withHome(async homeDir => {
  let resolveSend;
  let hasDispatched = false;
  const control = createSessionControl({
    homeDir,
    inspectSession: async () => ({ active: false }),
    dispatchQueued: async () => { hasDispatched = true; await new Promise(resolve => { resolveSend = resolve; }); },
    interruptSession: async () => {}
  });
  const item = (await enqueue(control)).item;
  const ongoing = control.reconcile();
  for (let attempt = 0; attempt < 100 && !hasDispatched; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  assert.equal(hasDispatched, true);
  const diskState = JSON.parse(await readFile(statePath(homeDir), "utf8"));
  assert.equal(diskState.queue[0].status, "dispatching", "write intent before calling an agent");
  let repeats = 0;
  const restarted = createSessionControl({
    homeDir,
    inspectSession: async () => ({ active: false }),
    dispatchQueued: async () => { repeats++; },
    interruptSession: async () => {}
  });
  await restarted.reconcile();
  const recovered = await request(restarted, "GET", "/api/session-control/state");
  assert.equal(recovered.queue[0].status, "needs-review");
  assert.equal(repeats, 0, "never replay after crash without owner approval");
  assert.equal((await request(restarted, "PATCH", "/api/session-control/queue/" + item.id, { retry: false })).item.status, "needs-review");
  resolveSend();
  await ongoing;
}));

test("in-flight queue items cannot be edited or deleted as if unsent", async () => withHome(async homeDir => {
  let resolveSend;
  let sending = false;
  const control = createSessionControl({
    homeDir,
    inspectSession: async () => ({ active: false }),
    dispatchQueued: async () => { sending = true; await new Promise(resolve => { resolveSend = resolve; }); },
    interruptSession: async () => {}
  });
  const item = (await enqueue(control)).item;
  const ongoing = control.reconcile();
  for (let attempt = 0; attempt < 100 && !sending; attempt++) await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(sending, true);
  assert.equal((await request(control, "PATCH", "/api/session-control/queue/" + item.id, { text: "override" })).status, 400);
  assert.equal((await request(control, "DELETE", "/api/session-control/queue/" + item.id)).status, 400);
  resolveSend();
  await ongoing;
}));

test("durable queue applies a finite item limit", async () => withHome(async homeDir => {
  const stateFile = statePath(homeDir);
  await mkdir(dirname(stateFile), { recursive: true });
  await writeFile(stateFile, JSON.stringify({
    version: 1,
    queue: Array.from({ length: 200 }, (_, i) => ({
      id: String(i), backend: "codex", sessionId: "session-1",
      sessionKey: "codex:session-1", text: "queued", createdAt: Date.now()
    }))
  }));
  const control = createSessionControl({
    homeDir,
    inspectSession: async () => ({ active: true }),
    dispatchQueued: async () => {},
    interruptSession: async () => {}
  });
  assert.equal((await enqueue(control)).status, 400);
  assert.equal((await request(control, "GET", "/api/session-control/state")).queue.length, 200);
}));

test("budget stop failures remain pending and retry safely until acknowledged", async () => withHome(async homeDir => {
  let turns = 0;
  let attempts = 0;
  const control = createSessionControl({
    homeDir,
    inspectSession: async () => ({ active: turns > 0, turns, tokens: 0 }),
    dispatchQueued: async () => {},
    interruptSession: async () => { attempts++; if (attempts === 1) throw Error("agent unreachable"); }
  });
  const url = "/api/session-control/budget/codex/session-1";
  assert.equal((await request(control, "PUT", url, { maxTurns: 1, maxTokens: null })).status, 200);
  turns = 1;
  await control.reconcile();
  let state = await request(control, "GET", "/api/session-control/state");
  assert.equal(state.budgets["codex:session-1"].interruptPending, true);
  assert.match(state.budgets["codex:session-1"].stopReason, /Turn budget reached/);
  await control.reconcile();
  state = await request(control, "GET", "/api/session-control/state");
  assert.equal(attempts, 2);
  assert.equal(state.budgets["codex:session-1"].interruptPending, false);
  assert.equal(state.events.at(-1).detail, "Stop request acknowledged by agent");
}));
