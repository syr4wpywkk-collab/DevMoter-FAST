import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { spawn } from "node:child_process";
import { createHmac } from "node:crypto";
import { once } from "node:events";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

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

async function listen(server) {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  return typeof address === "object" && address ? address.port : 0;
}

async function waitForReady(child, timeoutMs = 8000) {
  let output = "";
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`DevMoter did not become ready: ${output}`)), timeoutMs);
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
      reject(new Error(`DevMoter exited early with code ${code}: ${output}`));
    });
  });
}

test("DevMoter integrates with mocked OpenCode and Codex happy/failure paths", async t => {
  const home = await mkdtemp(join(tmpdir(), "devmoter-backend-integration-"));
  const projectDir = join(home, "project");
  await mkdir(projectDir);
  const authPassword = "integration-test-password-123";

  const openCodePrompts = [];
  let openCodeActivePolls = 0;
  const openCode = http.createServer(async (req, res) => {
    res.setHeader("content-type", "application/json");
    if (req.url === "/api/location") {
      res.writeHead(200);
      res.end(JSON.stringify({ directory: projectDir, project: { name: "mock" } }));
      return;
    }
    if (req.url === "/api/session/fail") {
      res.writeHead(503);
      res.end(JSON.stringify({ message: "synthetic OpenCode failure" }));
      return;
    }
    if (req.method === "GET" && req.url === "/api/info") {
      res.end(JSON.stringify({ version: "2.0.9" }));
      return;
    }
    if (req.method === "POST" && req.url === "/api/session") {
      req.resume();
      res.end(JSON.stringify({ data: { id: "webhook-session" } }));
      return;
    }
    if (req.method === "POST" && req.url === "/api/session/webhook-session/prompt") {
      const body = await new Response(req).json();
      openCodePrompts.push(body);
      res.end(JSON.stringify({ data: { id: "webhook-prompt" } }));
      return;
    }
    if (req.method === "GET" && req.url === "/api/session/active") {
      const running = openCodePrompts.length > 0 && openCodeActivePolls++ === 0;
      res.end(JSON.stringify({ data: running ? { "webhook-session": { type: "running" } } : {} }));
      return;
    }
    if (req.method === "GET" && req.url === "/api/session/webhook-session/context") {
      res.end(JSON.stringify({ data: [{ type: "assistant", content: [{ type: "text", text: "OpenCode reviewed the event." }] }] }));
      return;
    }
    res.writeHead(404);
    res.end(JSON.stringify({ message: "not found" }));
  });
  const openCodePort = await listen(openCode);

  const fakeCodex = join(home, "fake-codex.mjs");
  const codexTurnFile = join(home, "codex-webhook-turn.json");
  await writeFile(fakeCodex, `#!/usr/bin/env node
import readline from "node:readline";
import { writeFileSync } from "node:fs";
if (process.argv.includes("--version")) {
  console.log("0.0.0-test");
  process.exit(0);
}
const rl = readline.createInterface({ input: process.stdin });
rl.on("line", line => {
  const message = JSON.parse(line);
  if (!("id" in message)) return;
  if (message.id === 77 && "result" in message) {
    const turnId = "webhook-turn";
    const threadId = "thread-created";
    const delta = "Approval response: " + message.result.decision;
    process.stdout.write(JSON.stringify({ method: "item/agentMessage/delta", params: { threadId, turnId, delta } }) + "\\n");
    process.stdout.write(JSON.stringify({ method: "turn/completed", params: { threadId, turn: { id: turnId, status: "completed" } } }) + "\\n");
    return;
  }
  if (message.method === "initialize") {
    process.stdout.write(JSON.stringify({ id: message.id, result: { server: "fake-codex" } }) + "\\n");
    return;
  }
  if (message.method === "thread/list") {
    process.stdout.write(JSON.stringify({ id: message.id, result: { data: [] } }) + "\\n");
    return;
  }
  if (message.method === "thread/read") {
    process.stdout.write(JSON.stringify({ id: message.id, error: { message: "synthetic Codex failure" } }) + "\\n");
    return;
  }
  if (message.method === "thread/start") {
    process.stdout.write(JSON.stringify({
      id: message.id,
      result: { thread: { id: "thread-created" }, cwd: message.params?.cwd ?? null }
    }) + "\\n");
    return;
  }
  if (message.method === "turn/start") {
    writeFileSync(${JSON.stringify(codexTurnFile)}, JSON.stringify(message.params));
    const turnId = "webhook-turn";
    const threadId = "thread-created";
    process.stdout.write(JSON.stringify({ id: message.id, result: { turn: { id: turnId } } }) + "\\n");
    process.stdout.write(JSON.stringify({
      id: 77,
      method: "item/fileChange/requestApproval",
      params: { threadId, turnId, reason: "Mock approval request" }
    }) + "\\n");
    return;
  }
  process.stdout.write(JSON.stringify({ id: message.id, result: {} }) + "\\n");
});
`);
  await chmod(fakeCodex, 0o755);

  const port = await freePort();
  const child = spawn(process.execPath, ["server.mjs"], {
    cwd: repoRoot,
    env: {
      ...process.env,
      HOME: home,
      POCKET_HOST: "127.0.0.1",
      POCKET_PORT: String(port),
      OPENCODE_URL: `http://127.0.0.1:${openCodePort}`,
      OPENCODE_DIRECTORY: projectDir,
      CODEX_CWD: projectDir,
      CODEX_BIN: fakeCodex,
      DEVMOTER_AUTH_PASSWORD: authPassword
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  try {
    await waitForReady(child);

    const baseUrl = `http://127.0.0.1:${port}`;
    const authorization = `Basic ${Buffer.from(`devmoter:${authPassword}`).toString("base64")}`;
    const headers = (extra = {}) => ({
      authorization,
      origin: baseUrl,
      ...extra
    });

    const unauthorized = await fetch(`${baseUrl}/api/health`);
    assert.equal(unauthorized.status, 401);

    const openCodeOk = await fetch(`${baseUrl}/api/opencode/location`, {
      headers: headers()
    });
    assert.equal(openCodeOk.status, 200);
    assert.equal((await openCodeOk.json()).directory, projectDir);

    const openCodeFailure = await fetch(`${baseUrl}/api/opencode/session/fail`, {
      headers: headers()
    });
    assert.equal(openCodeFailure.status, 503);
    assert.match(JSON.stringify(await openCodeFailure.json()), /synthetic OpenCode failure/);

    const badOrigin = await fetch(`${baseUrl}/api/codex/rpc`, {
      method: "POST",
      headers: {
        authorization,
        origin: "https://attacker.example",
        "content-type": "application/json",
        "x-pocket-operation-id": "codex-bad-origin"
      },
      body: JSON.stringify({ method: "thread/list", params: {} })
    });
    assert.equal(badOrigin.status, 403);

    const codexOk = await fetch(`${baseUrl}/api/codex/rpc`, {
      method: "POST",
      headers: headers({ "content-type": "application/json", "x-pocket-operation-id": "codex-happy" }),
      body: JSON.stringify({ method: "thread/list", params: {} })
    });
    assert.equal(codexOk.status, 200);
    assert.deepEqual((await codexOk.json()).result, { data: [] });

    const projectsResponse = await fetch(`${baseUrl}/api/projects`, { headers: headers() });
    assert.equal(projectsResponse.status, 200);
    const projectsPayload = await projectsResponse.json();
    const registeredProject = projectsPayload.projects.find(project => project.path === projectDir);
    assert.ok(registeredProject?.id);

    const arbitraryCwd = await fetch(`${baseUrl}/api/codex/rpc`, {
      method: "POST",
      headers: headers({ "content-type": "application/json", "x-pocket-operation-id": "codex-raw-cwd" }),
      body: JSON.stringify({ method: "thread/start", params: { cwd: "/tmp/not-registered" } })
    });
    assert.equal(arbitraryCwd.status, 400);

    const projectBound = await fetch(`${baseUrl}/api/codex/rpc`, {
      method: "POST",
      headers: headers({ "content-type": "application/json", "x-pocket-operation-id": "codex-project-bound" }),
      body: JSON.stringify({ method: "thread/start", params: { projectId: registeredProject.id } })
    });
    assert.equal(projectBound.status, 200);
    assert.equal((await projectBound.json()).result.cwd, projectDir);

    const codexFailure = await fetch(`${baseUrl}/api/codex/rpc`, {
      method: "POST",
      headers: headers({ "content-type": "application/json", "x-pocket-operation-id": "codex-failure" }),
      body: JSON.stringify({ method: "thread/read", params: { threadId: "missing" } })
    });
    assert.equal(codexFailure.status, 502);
    assert.match((await codexFailure.json()).error, /synthetic Codex failure/);

    for (const backend of ["codex", "opencode"]) {
      await t.test(`signed webhook reaches the production ${backend} executor`, async () => {
        const event = `test-${backend}`;
        const task = "Summarize the issue";
        const mutationHeaders = operation => headers({
          "content-type": "application/json",
          "x-pocket-operation-id": operation
        });
        const create = await fetch(`${baseUrl}/api/control/triggers`, {
          method: "POST",
          headers: mutationHeaders(`create-${event}`),
          body: JSON.stringify({ source: "github.webhook", event, task, backend, projectId: registeredProject.id })
        });
        assert.equal(create.status, 201);
        const { trigger, secret } = await create.json();
        const getRun = async () => {
          const response = await fetch(`${baseUrl}/api/control/runs`, { headers: headers() });
          assert.equal(response.status, 200);
          return (await response.json()).runs.find(run => run.sourceId === trigger.id);
        };

        const events = backend === "codex" ? await fetch(`${baseUrl}/api/codex/events`, {
          headers: headers(),
          signal: AbortSignal.timeout(8000)
        }) : null;
        if (events) assert.equal(events.status, 200);
        const payload = { issue: { body: "<b>Reported issue</b>" } };
        const body = JSON.stringify(payload);
        const signature = "sha256=" + createHmac("sha256", secret).update(body).digest("hex");
        const webhook = await fetch(`${baseUrl}/api/control/events/github`, {
          method: "POST",
          headers: { "content-type": "application/json", "x-github-event": event, "x-hub-signature-256": signature },
          body
        });
        assert.equal(webhook.status, 202);
        assert.deepEqual(await webhook.json(), { accepted: 1 });

        if (events) {
          let received = "";
          for await (const text of events.body.pipeThrough(new TextDecoderStream())) {
            received += text;
            if (received.includes('event: server-request\ndata: {"id":77,')) break;
          }
          assert.match(received, /item\/fileChange\/requestApproval/);
          assert.equal((await getRun()).status, "running");
          const declined = await fetch(`${baseUrl}/api/codex/approval`, {
            method: "POST",
            headers: mutationHeaders(`decline-${event}`),
            body: JSON.stringify({ id: 77, decision: "decline" })
          });
          assert.equal(declined.status, 200);
          assert.deepEqual(await declined.json(), { ok: true });
        }

        let run;
        const deadline = Date.now() + 8000;
        do {
          run = await getRun();
          if (run?.endedAt != null) break;
          await delay(25);
        } while (Date.now() < deadline);
        assert.equal(run?.status, "completed", run?.summary);
        assert.equal(run.backend, backend);
        assert.equal(run.approvalPolicy, "normal");
        assert.equal(run.summary, backend === "codex" ? "Approval response: decline" : "OpenCode reviewed the event.");
        const prompt = backend === "codex"
          ? JSON.parse(await readFile(codexTurnFile, "utf8")).input[0].text
          : openCodePrompts[0].text;
        assert.equal(prompt.startsWith(task + "\n\n"), true);
        assert.match(prompt, /UNTRUSTED EXTERNAL DATA/);
        const block = prompt.match(/<event-payload-([a-f0-9]{32})>\n([^\n]+)\n<\/event-payload-\1>/);
        assert.ok(block);
        assert.doesNotMatch(block[2], /[<>]/);
        assert.deepEqual(JSON.parse(block[2]), payload);
        assert.equal(prompt.includes(secret), false);
      });
    }
  } finally {
    child.kill("SIGTERM");
    await Promise.race([once(child, "exit"), new Promise(resolve => setTimeout(resolve, 1500))]);
    if (child.exitCode === null) child.kill("SIGKILL");
    await new Promise(resolve => openCode.close(resolve));
    await rm(home, { recursive: true, force: true });
  }
});
