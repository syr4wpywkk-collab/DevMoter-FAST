import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import http from "node:http";
import { createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// The browser speaks one DevMoter shape to /api/opencode/session/…; the server
// translates it to the running OpenCode generation. A fake OpenCode records
// what reached it, answering with shapes captured from real 1.19.5 / 2.0.9.

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));

async function freePort() {
  const probe = createNetServer();
  probe.listen(0, "127.0.0.1");
  await once(probe, "listening");
  const address = probe.address();
  const port = typeof address === "object" && address ? address.port : 0;
  await new Promise((resolve, reject) => probe.close(error => error ? reject(error) : resolve()));
  return port;
}

async function waitForReady(child, timeoutMs = 30000) {
  let output = "";
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`server did not become ready: ${output}`)), timeoutMs);
    const onData = chunk => {
      output += chunk.toString();
      if (output.includes("DevMoter FAST:")) {
        clearTimeout(timer);
        child.stdout.off("data", onData);
        resolve();
      }
    };
    child.stdout.on("data", onData);
    child.once("exit", code => {
      clearTimeout(timer);
      reject(new Error(`server exited early with code ${code}: ${output}`));
    });
  });
}

const session = { id: "ses_1", agent: "build", model: { id: "mock-1", providerID: "mock", variant: "default" } };

const v1Routes = {
  "GET /global/health": { healthy: true, version: "1.19.5" },
  "GET /api/session/ses_1": { data: session },
  "POST /session/ses_1/prompt_async": null,
  "GET /session/ses_1/message": [
    { info: { id: "msg_u", sessionID: "ses_1", role: "user", time: { created: 10 } }, parts: [{ type: "text", text: "hi" }] },
    { info: { id: "msg_a", sessionID: "ses_1", role: "assistant", time: { created: 11, completed: 12 }, modelID: "mock-1", providerID: "mock", agent: "build", cost: 0 }, parts: [{ type: "text", text: "Hello from the mock model." }] }
  ],
  "GET /api/session/ses_1/context": { data: [] },
  "GET /session/status": { ses_1: { type: "busy" } },
  "POST /session/ses_1/abort": true,
  "GET /permission": [{ id: "per_1", sessionID: "ses_1", permission: "bash", patterns: ["echo ok"], metadata: { command: "echo ok" }, always: ["echo *"], tool: { messageID: "msg_a", callID: "call_1" } }],
  "POST /permission/per_1/reply": true,
  "GET /question": [{ id: "que_1", sessionID: "ses_1", questions: [{ question: "Pick a color", header: "Color", options: [{ label: "red" }, { label: "blue" }] }] }],
  "POST /question/que_1/reply": true,
  "POST /question/que_1/reject": true,
  "SSE /event": [
    { type: "message.part.delta", properties: { sessionID: "ses_1", messageID: "msg_a", partID: "prt_1", field: "text", delta: "Hello" } },
    { type: "permission.asked", properties: { id: "per_1", sessionID: "ses_1", permission: "bash", patterns: ["echo ok"], metadata: { command: "echo ok" }, always: ["echo *"], tool: { messageID: "msg_a", callID: "call_1" } } },
    { type: "question.asked", properties: { id: "que_1", sessionID: "ses_1", questions: [{ question: "Pick a color", header: "Color", options: [{ label: "red" }, { label: "blue" }] }] } }
  ]
};

const form = { id: "que_1", sessionID: "ses_1", fields: [{ key: "q0", type: "string", title: "Color", description: "Pick a color", options: [{ value: "red" }, { value: "blue" }], custom: true }] };
const v2Routes = {
  "GET /api/info": { version: "2.0.9", pid: 1, urls: [] },
  "GET /api/session/ses_1": { data: session },
  "POST /api/session/ses_1/model": { data: null },
  "POST /api/session/ses_1/agent": { data: null },
  "POST /api/session/ses_1/prompt": { data: { id: "msg_u", type: "user" } },
  "GET /api/session/ses_1/context": { data: [
    { id: "msg_u", type: "user", text: "hi", time: { created: 10 } },
    { id: "msg_a", type: "assistant", time: { created: 11, completed: 12 }, agent: "build", model: { id: "mock-1", providerID: "mock" }, content: [{ type: "text", text: "Hello from the mock model." }], cost: 0, tokens: null },
    { id: "msg_i", type: "idle", time: { created: 12 }, outcome: "succeeded" }
  ] },
  "GET /api/session/active": { data: { ses_1: { type: "running" } } },
  "POST /api/session/ses_1/interrupt": null,
  "GET /api/session/ses_1/permission": { data: [{ id: "per_1", sessionID: "ses_1", action: "shell", resources: ["echo ok"], save: ["echo *"], source: { type: "tool", messageID: "msg_a", id: "call_1" } }] },
  "POST /api/session/ses_1/permission/per_1/reply": null,
  "GET /api/session/ses_1/form": { data: [form] },
  "GET /api/session/ses_1/form/que_1": { data: form },
  "POST /api/session/ses_1/form/que_1/reply": null,
  "DELETE /api/session/ses_1/form/que_1": null,
  "SSE /api/event": [
    { type: "session.text.delta", data: { sessionID: "ses_1", assistantMessageID: "msg_a", ordinal: 0, delta: "Hello" } },
    { type: "permission.asked", data: { id: "per_1", sessionID: "ses_1", action: "shell", resources: ["echo ok"], save: ["echo *"], source: { type: "tool", messageID: "msg_a", id: "call_1" } } },
    { type: "form.created", data: { form } }
  ]
};

async function withDevMoter(routes, run) {
  const home = await mkdtemp(join(tmpdir(), "devmoter-oc-adapter-"));
  const upstreamPort = await freePort();
  const appPort = await freePort();
  const authPassword = "adapter-integration-password-123";
  const received = [];
  const upstream = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const path = req.url.split("?")[0];
    const text = Buffer.concat(chunks).toString("utf8");
    received.push({ method: req.method, path, body: text ? JSON.parse(text) : null });
    const sse = routes["SSE " + path];
    if (sse && req.method === "GET") {
      res.writeHead(200, { "content-type": "text/event-stream" });
      // Split a frame across writes to exercise the frame reader.
      const body = sse.map(event => "data: " + JSON.stringify(event) + "\n\n").join("");
      res.write(body.slice(0, 17));
      res.end(body.slice(17));
      return;
    }
    const key = req.method + " " + path;
    if (!(key in routes)) {
      res.writeHead(200, { "content-type": "text/html" });
      res.end("<!doctype html>web ui");
      return;
    }
    const value = routes[key];
    if (value === null) {
      res.writeHead(204);
      res.end();
      return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(value));
  });
  upstream.listen(upstreamPort, "127.0.0.1");
  await once(upstream, "listening");

  const child = spawn(process.execPath, ["server.mjs"], {
    cwd: repoRoot,
    env: {
      ...process.env,
      HOME: home,
      POCKET_HOST: "127.0.0.1",
      POCKET_PORT: String(appPort),
      OPENCODE_URL: `http://127.0.0.1:${upstreamPort}`,
      CODEX_BIN: "__devmoter_test_codex_not_started__",
      DEVMOTER_AUTH_PASSWORD: authPassword
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  const authorization = `Basic ${Buffer.from(`devmoter:${authPassword}`).toString("base64")}`;
  const call = async (method, path, body, headers = {}) => {
    const response = await fetch(`http://127.0.0.1:${appPort}/api/opencode${path}`, {
      method,
      headers: { authorization, origin: `http://127.0.0.1:${appPort}`, ...(body !== undefined ? { "content-type": "application/json" } : {}), ...headers },
      ...(body !== undefined ? { body: typeof body === "string" ? body : JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(5000)
    });
    const text = await response.text();
    let payload = text;
    try { payload = JSON.parse(text); } catch {}
    return { status: response.status, payload, text };
  };
  try {
    await waitForReady(child);
    await run({ call, received });
  } finally {
    child.kill("SIGTERM");
    await Promise.race([once(child, "exit"), new Promise(resolve => setTimeout(resolve, 1500))]);
    if (child.exitCode === null) child.kill("SIGKILL");
    await new Promise(resolve => upstream.close(resolve));
    await rm(home, { recursive: true, force: true });
  }
}

const upstreamCall = (received, method, path) => received.filter(item => item.method === method && item.path === path);

async function exerciseSameSurface({ call }) {
  // One request/response shape, whatever OpenCode runs.
  const context = await call("GET", "/session/ses_1/context");
  assert.equal(context.status, 200);
  const visible = context.payload.map(item => ({ type: item.type, text: item.text ?? item.content?.[0]?.text, outcome: item.outcome }));
  assert.deepEqual(visible.slice(0, 2), [
    { type: "user", text: "hi", outcome: undefined },
    { type: "assistant", text: "Hello from the mock model.", outcome: undefined }
  ]);

  assert.deepEqual((await call("GET", "/session/active")).payload, { ses_1: { type: "running" } });

  const permissions = await call("GET", "/session/ses_1/permission");
  assert.equal(permissions.status, 200);
  assert.deepEqual(
    permissions.payload.map(({ id, sessionID, resources, save, metadata, tool }) => ({ id, sessionID, resources, save, metadata, tool })),
    [{ id: "per_1", sessionID: "ses_1", resources: ["echo ok"], save: ["echo *"], metadata: { command: "echo ok" }, tool: { messageID: "msg_a", callID: "call_1" } }]
  );

  const questions = await call("GET", "/session/ses_1/question");
  assert.deepEqual(questions.payload, [{
    id: "que_1", sessionID: "ses_1",
    questions: [{ header: "Color", question: "Pick a color", options: [{ label: "red" }, { label: "blue" }], multiple: false, custom: true }]
  }]);

  for (const [path, body] of [
    ["/session/ses_1/permission/per_1/reply", { decision: "once" }],
    ["/session/ses_1/question/que_1/reply", { answers: [["blue"]] }],
    ["/session/ses_1/question/que_1/reject", undefined],
    ["/session/ses_1/interrupt", undefined]
  ]) {
    const result = await call("POST", path, body);
    assert.equal(result.status, 200, path + " " + result.text);
    assert.deepEqual(result.payload, { ok: true });
  }

  const prompt = await call("POST", "/session/ses_1/prompt", { text: "hi", agent: "plan", model: { providerID: "opencode", modelID: "deepseek-v4.1-flash-free" } }, { "x-pocket-agent-mode": "plan" });
  assert.equal(prompt.status, 200, prompt.text);

  // Validation happens before OpenCode sees anything.
  assert.equal((await call("POST", "/session/ses_1/prompt", { prompt: { text: "old shape" } })).status, 400);
  assert.equal((await call("POST", "/session/ses_1/prompt", "{not json")).status, 400);
  assert.equal((await call("POST", "/session/ses_1/permission/per_1/reply", { reply: "once" })).status, 400);
  assert.equal((await call("POST", "/session/ses_1/question/que_1/reply", { answers: "blue" })).status, 400);
  assert.equal((await call("GET", "/session/ses_1/prompt")).status, 405);
  assert.equal((await call("POST", "/session/ses_1/permission/x.y/reply", { decision: "once" })).status, 400);

  // Generation-specific routes are never forwarded by the generic proxy.
  for (const path of ["/api/session/ses_1/prompt", "/session/ses_1/prompt_async", "/session/ses_1/message", "/session/ses_1/form", "/api/session/ses_1/permission/per_1/reply"]) {
    const refused = await call("POST", path, { text: "x" });
    assert.equal(refused.status, 404, path);
  }
}

async function readEvents(call) {
  const result = await call("GET", "/event", undefined, { accept: "text/event-stream" });
  assert.equal(result.status, 200);
  return result.text.trim().split("\n\n").map(frame => JSON.parse(frame.replace(/^data: /, "")));
}

test("OpenCode 1.x: DevMoter routes drive the classic runner", async () => {
  await withDevMoter(v1Routes, async ({ call, received }) => {
    await exerciseSameSurface({ call });
    const [prompt] = upstreamCall(received, "POST", "/session/ses_1/prompt_async");
    assert.deepEqual(prompt.body, {
      parts: [{ type: "text", text: "hi" }],
      model: { providerID: "opencode", modelID: "deepseek-v4.1-flash-free" },
      agent: "plan",
      tools: { "*": false, read: true, glob: true, grep: true, list: true, webfetch: true, websearch: true, lsp: true }
    });
    assert.deepEqual(upstreamCall(received, "POST", "/permission/per_1/reply")[0].body, { reply: "once" });
    assert.deepEqual(upstreamCall(received, "POST", "/question/que_1/reply")[0].body, { answers: [["blue"]] });
    assert.equal(upstreamCall(received, "POST", "/question/que_1/reject").length, 1);
    assert.equal(upstreamCall(received, "POST", "/session/ses_1/abort").length, 1);
    assert.equal(received.filter(item => item.path === "/api/session/ses_1/prompt").length, 0, "the 1.x new runner is never used");

    const events = await readEvents(call);
    assert.deepEqual(events.map(event => event.type), ["message.part.delta", "permission.asked", "question.asked"]);
    assert.equal(events[1].properties.action, "bash");
    assert.equal(events[2].properties.questions[0].question, "Pick a color");
  });
});

test("OpenCode 2.x: the same DevMoter routes drive /api/session", async () => {
  await withDevMoter(v2Routes, async ({ call, received }) => {
    await exerciseSameSurface({ call });
    assert.deepEqual(upstreamCall(received, "POST", "/api/session/ses_1/model")[0].body, { model: { id: "deepseek-v4.1-flash-free", providerID: "opencode" } });
    assert.deepEqual(upstreamCall(received, "POST", "/api/session/ses_1/agent")[0].body, { agent: "plan" });
    assert.deepEqual(upstreamCall(received, "POST", "/api/session/ses_1/prompt")[0].body, { text: "hi" });
    assert.deepEqual(upstreamCall(received, "POST", "/api/session/ses_1/permission/per_1/reply")[0].body, { decision: "once" });
    assert.deepEqual(upstreamCall(received, "POST", "/api/session/ses_1/form/que_1/reply")[0].body, { answer: { q0: "blue" } });
    assert.equal(upstreamCall(received, "DELETE", "/api/session/ses_1/form/que_1").length, 1);
    assert.equal(upstreamCall(received, "POST", "/api/session/ses_1/interrupt").length, 1);

    const events = await readEvents(call);
    assert.deepEqual(events.map(event => event.type), ["session.text.delta", "permission.asked", "question.asked"]);
    assert.equal(events[1].properties.action, "shell");
    assert.equal(events[2].properties.questions[0].question, "Pick a color");
  });
});
