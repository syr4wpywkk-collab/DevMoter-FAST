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

// #591: a session's execution mode is server-side state. It is fixed by the
// create request body, changed only through POST /api/session/{id}/agent
// under server-side transition rules, and resolved from the upstream session
// otherwise. The x-pocket-agent-mode header must never drive authorization.
// A stateful fake OpenCode (1.x shapes) records everything that reaches it.

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

test("session mode authority is server-side; the agent-mode header is ignored", async () => {
  const home = await mkdtemp(join(tmpdir(), "devmoter-591-"));
  const upstreamPort = await freePort();
  const appPort = await freePort();
  const authPassword = "session-mode-591-password";
  const received = [];
  const sessions = new Map();
  let createCount = 0;
  // Sessions that exist only upstream (never created through this DevMoter
  // run, so the server-side mode map starts cold for them): one read-only,
  // and one whose record carries neither an agent nor a mode.
  sessions.set("ses_cold", { id: "ses_cold", agent: "plan" });
  sessions.set("ses_nomode", { id: "ses_nomode" });

  const upstream = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const path = req.url.split("?")[0];
    const text = Buffer.concat(chunks).toString("utf8");
    let body = null;
    try { body = text ? JSON.parse(text) : null; } catch { body = null; }
    received.push({ method: req.method, path, body });
    const reply = (status, value) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(value));
    };

    if (req.method === "GET" && path === "/global/health") {
      return reply(200, { healthy: true, version: "1.19.5" });
    }
    if (req.method === "POST" && path === "/api/session") {
      createCount += 1;
      // Test hook ("strictResponse"): the upstream-reported agent for the
      // created session is stricter than the request body's agent.
      const reported = body?.strictResponse === "plan"
        ? "plan"
        : (typeof body?.agent === "string" ? body.agent : "build");
      const created = { id: `ses_c${createCount}`, agent: reported };
      sessions.set(created.id, created);
      return reply(200, { data: created });
    }
    const sessionMatch = path.match(/^\/api\/session\/([^/]+)$/);
    if (req.method === "GET" && sessionMatch) {
      const found = sessions.get(decodeURIComponent(sessionMatch[1]));
      return found ? reply(200, { data: found }) : reply(404, { error: { message: "session not found" } });
    }
    const agentMatch = path.match(/^\/api\/session\/([^/]+)\/agent$/);
    if (req.method === "POST" && agentMatch) {
      const found = sessions.get(decodeURIComponent(agentMatch[1]));
      if (!found) return reply(404, { error: { message: "session not found" } });
      if (typeof body?.agent === "string") found.agent = body.agent;
      return reply(200, { data: null });
    }
    if (req.method === "POST" && /^\/api\/session\/[^/]+\/(?:shell|command)$/.test(path)) {
      return reply(200, { data: true });
    }
    if (req.method === "POST" && /^\/session\/[^/]+\/prompt_async$/.test(path)) {
      res.writeHead(204);
      return res.end();
    }
    return reply(404, { error: { message: "unknown upstream route" } });
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
      ["DEVMOTER_AUTH" + "_PASSWORD"]: authPassword
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  const authorization = `Basic ${Buffer.from(`devmoter:${authPassword}`).toString("base64")}`;
  const call = async (method, path, body, headers = {}) => {
    const response = await fetch(`http://127.0.0.1:${appPort}${path}`, {
      method,
      headers: {
        authorization,
        origin: `http://127.0.0.1:${appPort}`,
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
        ...headers
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(5000)
    });
    const text = await response.text();
    let payload = text;
    try { payload = JSON.parse(text); } catch {}
    return { status: response.status, payload, text };
  };
  const upstreamCalls = (method, path) => received.filter(item => item.method === method && item.path === path);
  const promptsFor = id => upstreamCalls("POST", `/session/${id}/prompt_async`);

  try {
    await waitForReady(child);
    const base = "/api/opencode";

    // Creation: a spoofed build header cannot override the body's plan agent.
    const createPlan = await call("POST", `${base}/session`, { agent: "plan" }, { "x-pocket-agent-mode": "build" });
    assert.equal(createPlan.status, 200, createPlan.text);
    assert.equal(createPlan.payload.data.id, "ses_c1");

    // The read-only session's shell stays blocked even with a build header,
    // and the blocked mutation never reaches upstream.
    const roShell = await call("POST", `${base}/session/ses_c1/shell`, { command: "id" }, { "x-pocket-agent-mode": "build" });
    assert.equal(roShell.status, 403);
    assert.equal(upstreamCalls("POST", "/api/session/ses_c1/shell").length, 0);

    for (const route of ["shell", "command"]) {
      const blocked = await call("POST", `${base}/session/ses_c1/${route}/`, { command: "id" });
      assert.equal(blocked.status, 403, blocked.text);
      assert.equal(upstreamCalls("POST", `/api/session/ses_c1/${route}/`).length, 0);
    }

    // Its prompt keeps read-only tools even with a build header.
    const roPrompt = await call("POST", `${base}/session/ses_c1/prompt`, { text: "inspect" }, { "x-pocket-agent-mode": "build" });
    assert.equal(roPrompt.status, 200, roPrompt.text);
    assert.equal(promptsFor("ses_c1").length, 1);
    assert.equal(promptsFor("ses_c1")[0].body.tools["*"], false);
    assert.equal(promptsFor("ses_c1")[0].body.tools.read, true);

    // plan -> build through the agent endpoint is rejected before forwarding.
    const escalate = await call("POST", `${base}/session/ses_c1/agent`, { agent: "build" });
    assert.equal(escalate.status, 403);
    assert.equal(upstreamCalls("POST", "/api/session/ses_c1/agent").length, 0);
    const stillBlocked = await call("POST", `${base}/session/ses_c1/shell`, { command: "id" });
    assert.equal(stillBlocked.status, 403);

    // An agent update with no target at all is likewise rejected read-only-side.
    const emptyUpdate = await call("POST", `${base}/session/ses_c1/agent`, {});
    assert.equal(emptyUpdate.status, 403);
    assert.equal(upstreamCalls("POST", "/api/session/ses_c1/agent").length, 0);

    // plan -> ask is a permitted read-only-to-read-only transition and sticks.
    const toAsk = await call("POST", `${base}/session/ses_c1/agent`, { agent: "ask" });
    assert.equal(toAsk.status, 200, toAsk.text);
    assert.deepEqual(upstreamCalls("POST", "/api/session/ses_c1/agent")[0].body, { agent: "ask" });
    const askShell = await call("POST", `${base}/session/ses_c1/command`, { command: "id" });
    assert.equal(askShell.status, 403);

    // A trailing slash must not slip the agent route past the transition
    // guard: ask -> build via ".../agent/" is rejected before forwarding.
    const slashEscalate = await call("POST", `${base}/session/ses_c1/agent/`, { agent: "build" });
    assert.equal(slashEscalate.status, 403);
    assert.equal(upstreamCalls("POST", "/api/session/ses_c1/agent/").length, 0);
    const encodedEscalate = await call("POST", `${base}/session/ses_c1/%61gent/`, { agent: "build" });
    assert.equal(encodedEscalate.status, 403, encodedEscalate.text);
    assert.equal(upstreamCalls("POST", "/api/session/ses_c1/agent").length, 1, "only the earlier plan -> ask update reached upstream");
    const slashStillBlocked = await call("POST", `${base}/session/ses_c1/shell`, { command: "id" });
    assert.equal(slashStillBlocked.status, 403);

    // A build session ignores a plan header: no per-request downgrade.
    const createBuild = await call("POST", `${base}/session`, { agent: "build" }, { "x-pocket-agent-mode": "plan" });
    assert.equal(createBuild.status, 200, createBuild.text);
    assert.equal(createBuild.payload.data.id, "ses_c2");
    const buildShellWithPlanHeader = await call("POST", `${base}/session/ses_c2/shell`, { command: "pwd" }, { "x-pocket-agent-mode": "plan" });
    assert.equal(buildShellWithPlanHeader.status, 200, buildShellWithPlanHeader.text);
    const buildPromptWithPlanHeader = await call("POST", `${base}/session/ses_c2/prompt`, { text: "work" }, { "x-pocket-agent-mode": "plan" });
    assert.equal(buildPromptWithPlanHeader.status, 200, buildPromptWithPlanHeader.text);
    assert.equal(promptsFor("ses_c2").length, 1);
    assert.equal("tools" in promptsFor("ses_c2")[0].body, false, "header must not impose read-only tools");

    // build -> plan through the agent endpoint works and sticks.
    const toPlan = await call("POST", `${base}/session/ses_c2/agent`, { agent: "plan" });
    assert.equal(toPlan.status, 200, toPlan.text);
    const nowBlocked = await call("POST", `${base}/session/ses_c2/shell`, { command: "id" }, { "x-pocket-agent-mode": "build" });
    assert.equal(nowBlocked.status, 403);

    // Only POST may change a session's agent: a PUT on the agent route is
    // rejected before forwarding, whatever mode it asks for.
    const putUpdate = await call("PUT", `${base}/session/ses_c2/agent`, { agent: "build" });
    assert.equal(putUpdate.status, 405);
    assert.equal(upstreamCalls("PUT", "/api/session/ses_c2/agent").length, 0);
    const patchUpdate = await call("PATCH", `${base}/session/ses_c2/agent/`, { agent: "build" });
    assert.equal(patchUpdate.status, 405);
    assert.equal(upstreamCalls("PATCH", "/api/session/ses_c2/agent/").length, 0);

    // A prompt body cannot escalate the now-read-only session either.
    const escalatePrompt = await call("POST", `${base}/session/ses_c2/prompt`, { text: "write", agent: "build" });
    assert.equal(escalatePrompt.status, 403);
    assert.equal(promptsFor("ses_c2").length, 1, "escalating prompt must not reach upstream");

    // A prompt body's read-only agent is an allowed downgrade on a build
    // session, and the downgrade is recorded server-side.
    const createBuild2 = await call("POST", `${base}/session`, { agent: "build" });
    assert.equal(createBuild2.payload.data.id, "ses_c3");
    const downgradePrompt = await call("POST", `${base}/session/ses_c3/prompt`, { text: "look", agent: "plan" });
    assert.equal(downgradePrompt.status, 200, downgradePrompt.text);
    assert.equal(promptsFor("ses_c3")[0].body.tools["*"], false);
    const downgradedShell = await call("POST", `${base}/session/ses_c3/shell`, { command: "id" });
    assert.equal(downgradedShell.status, 403, "recorded downgrade must bind later mutations");

    // Sessions the upstream cannot resolve fail closed on guarded routes.
    const ghostShell = await call("POST", `${base}/session/ses_ghost/shell`, { command: "id" });
    assert.equal(ghostShell.status, 403);
    assert.equal(upstreamCalls("POST", "/api/session/ses_ghost/shell").length, 0);
    const ghostAgent = await call("POST", `${base}/session/ses_ghost/agent`, { agent: "plan" });
    assert.equal(ghostAgent.status, 403);
    assert.equal(upstreamCalls("POST", "/api/session/ses_ghost/agent").length, 0);

    // Cold cache: a session that exists only upstream, whose record says
    // plan, is resolved from the upstream record and enforced read-only.
    const coldShell = await call("POST", `${base}/session/ses_cold/shell`, { command: "id" });
    assert.equal(coldShell.status, 403);
    assert.equal(upstreamCalls("POST", "/api/session/ses_cold/shell").length, 0);
    assert.ok(upstreamCalls("GET", "/api/session/ses_cold").length >= 1, "mode must be resolved from the upstream session record");

    // An upstream session record with neither agent nor mode cannot be
    // verified: guarded mutations fail closed, and the unverifiable mode is
    // not cached as "build" (each attempt re-resolves and re-blocks).
    const noModeShell1 = await call("POST", `${base}/session/ses_nomode/shell`, { command: "id" });
    assert.equal(noModeShell1.status, 403);
    assert.match(noModeShell1.text, /could not be verified/);
    const noModeShell2 = await call("POST", `${base}/session/ses_nomode/shell`, { command: "id" });
    assert.equal(noModeShell2.status, 403);
    assert.equal(upstreamCalls("POST", "/api/session/ses_nomode/shell").length, 0);
    assert.ok(upstreamCalls("GET", "/api/session/ses_nomode").length >= 2, "unverifiable mode must not be cached");

    const noModePrompt = await call("POST", `${base}/session/ses_nomode/prompt`, { text: "inspect" });
    assert.equal(noModePrompt.status, 200, noModePrompt.text);
    assert.equal(promptsFor("ses_nomode").length, 1);
    assert.equal(promptsFor("ses_nomode")[0].body.tools["*"], false);
    assert.equal(promptsFor("ses_nomode")[0].body.tools.read, true);
    const noModeAgent = await call("POST", `${base}/session/ses_nomode/agent`, { agent: "build" });
    assert.equal(noModeAgent.status, 403, noModeAgent.text);
    assert.equal(upstreamCalls("POST", "/api/session/ses_nomode/agent").length, 0);

    // Create-response sync: when the upstream reports a stricter mode for
    // the created session than the request body asked for, the recorded
    // server-side mode follows the response, not the body.
    const strictCreate = await call("POST", `${base}/session`, { agent: "build", strictResponse: "plan" });
    assert.equal(strictCreate.status, 200, strictCreate.text);
    assert.equal(strictCreate.payload.data.id, "ses_c4");
    assert.equal(strictCreate.payload.data.agent, "plan");
    const strictShell = await call("POST", `${base}/session/ses_c4/shell`, { command: "id" });
    assert.equal(strictShell.status, 403, "recorded mode must follow the create response (plan), not the body (build)");
    assert.equal(upstreamCalls("POST", "/api/session/ses_c4/shell").length, 0);
  } finally {
    child.kill("SIGTERM");
    await Promise.race([once(child, "exit"), new Promise(resolve => setTimeout(resolve, 1500))]);
    if (child.exitCode === null) child.kill("SIGKILL");
    await new Promise(resolve => upstream.close(resolve));
    await rm(home, { recursive: true, force: true });
  }
});
