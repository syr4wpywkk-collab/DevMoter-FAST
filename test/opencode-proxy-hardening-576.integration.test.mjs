import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));

async function freePort() {
  const probe = createNetServer();
  probe.listen(0, "127.0.0.1");
  await once(probe, "listening");
  const address = probe.address();
  const port = typeof address === "object" && address ? address.port : 0;
  await new Promise((resolve, reject) => probe.close(error => (error ? reject(error) : resolve())));
  return port;
}

async function listen(server) {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  return typeof address === "object" && address ? address.port : 0;
}

async function waitForReady(child, timeoutMs = 30000) {
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

function assertProxySecurityHeaders(headers, label) {
  assert.equal(headers.get("x-content-type-options"), "nosniff", `${label}: nosniff`);
  const csp = headers.get("content-security-policy") || "";
  assert.match(csp, /default-src 'none'/, `${label}: CSP default-src none`);
  assert.match(csp, /frame-ancestors 'none'/, `${label}: CSP frame-ancestors none`);
  assert.match(csp, /\bsandbox\b/, `${label}: CSP sandbox`);
  assert.equal(headers.get("x-frame-options"), "DENY", `${label}: x-frame-options`);
  assert.equal(headers.get("referrer-policy"), "no-referrer", `${label}: referrer-policy`);
}

test("OpenCode proxy and SSE paths harden headers, redact secrets, and enforce agent mode authority", async () => {
  const home = await mkdtemp(join(tmpdir(), "devmoter-proxy-hardening-576-"));
  const projectDir = join(home, "project");
  await mkdir(projectDir);

  const authPassword = "sentinel-devmoter-auth-password-576";
  const openCodePassword = "sentinel-opencode-upstream-secret-576";
  const received = [];

  const upstream = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const rawBody = Buffer.concat(chunks).toString("utf8");
    let parsedBody = null;
    try {
      parsedBody = rawBody ? JSON.parse(rawBody) : null;
    } catch {}
    const path = req.url.split("?")[0];
    received.push({ method: req.method, path, body: parsedBody });

    if (req.method === "GET" && path === "/global/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ healthy: true, version: "1.19.5" }));
      return;
    }

    if (req.method === "GET" && path === "/api/location") {
      res.writeHead(200, {
        "content-type": "application/json; charset=utf-8",
        "set-cookie": "opencode_session=secret-cookie-value; HttpOnly; Path=/",
        "x-powered-by": "opencode-upstream",
        "server": "internal-opencode/1.0",
        "x-internal-debug": "leak-internal-header",
        "location": "https://evil.example/redirect",
        "www-authenticate": "Basic realm=\"internal\"",
        "retry-after": "12"
      });
      const body = JSON.stringify({ directory: projectDir, secretEcho: openCodePassword, [`key-${authPassword}`]: [openCodePassword] });
      res.end(body.replaceAll("sentinel", "\\u0073entinel"));
      return;
    }

    if (req.method === "GET" && path === "/api/session/sess_invalid_json") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end("{");
      return;
    }

    if (req.method === "GET" && path === "/api/session/sess_large_json") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify("a".repeat(8 * 1024 * 1024)));
      return;
    }

    if (req.method === "GET" && path === "/api/session/sess_html") {
      res.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "set-cookie": "html_cookie=evil"
      });
      res.end(`<html><body><script>alert(1)</script>${authPassword}</body></html>`);
      return;
    }

    if (req.method === "GET" && path === "/api/session/sess_svg") {
      res.writeHead(200, { "content-type": "image/svg+xml" });
      res.end(`<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>`);
      return;
    }

    if (req.method === "GET" && path === "/api/session/sess_text") {
      res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
      res.end(`plain body with ${openCodePassword} and ${authPassword}`);
      return;
    }

    if (req.method === "GET" && path === "/api/session/sess_sse") {
      res.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        "set-cookie": "sse_cookie=should-not-leak"
      });
      const splitAt = 12;
      res.write(`event: delta\ndata: {"text":"first ${openCodePassword.slice(0, splitAt)}`);
      setTimeout(() => {
        res.write(`${openCodePassword.slice(splitAt)} middle"}\n\n`);
        res.end(`data: {"text":"second ${authPassword}"}\n\n`);
      }, 20);
      return;
    }

    if (req.method === "GET" && path === "/event") {
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "set-cookie": "events_cookie=should-not-leak"
      });
      const event1 = {
        type: "message.part.delta",
        properties: {
          sessionID: "ses_ro_created",
          messageID: "msg_1",
          partID: "prt_1",
          field: "text",
          delta: `upstream token ${openCodePassword} and ${authPassword}`
        }
      };
      res.end(`data: ${JSON.stringify(event1)}\n\n`);
      return;
    }

    if (req.method === "POST" && path === "/api/session") {
      const agent = parsedBody?.agent || "build";
      const id = agent === "plan" ? "ses_ro_created" : "ses_rw_created";
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ id, agent }));
      return;
    }

    if (req.method === "GET" && path === "/api/session/ses_ro_existing") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ data: { id: "ses_ro_existing", agent: "ask" } }));
      return;
    }

    if (req.method === "GET" && path === "/api/session/ses_ro_created") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ data: { id: "ses_ro_created", agent: "plan" } }));
      return;
    }

    if (req.method === "GET" && path === "/api/session/ses_rw_created") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ data: { id: "ses_rw_created", agent: "build" } }));
      return;
    }

    if (req.method === "POST" && /^\/api\/session\/[^/]+\/agent$/.test(path)) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ data: null }));
      return;
    }

    if (req.method === "POST" && /^\/api\/session\/[^/]+\/(?:shell|command)$/.test(path)) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ executed: path }));
      return;
    }

    if (req.method === "POST" && /^\/session\/[^/]+\/prompt_async$/.test(path)) {
      res.writeHead(204);
      res.end();
      return;
    }

    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "not found" }));
  });
  const upstreamPort = await listen(upstream);

  const fakeCodex = join(home, "fake-codex.mjs");
  await writeFile(fakeCodex, `#!/usr/bin/env node
import readline from "node:readline";
if (process.argv.includes("--version")) {
  console.log("0.0.0-test");
  process.exit(0);
}
const rl = readline.createInterface({ input: process.stdin });
rl.on("line", line => {
  const message = JSON.parse(line);
  if (!("id" in message)) return;
  if (message.method === "initialize") {
    process.stdout.write(JSON.stringify({ id: message.id, result: { server: "fake-codex" } }) + "\\n");
    return;
  }
  if (message.method === "thread/list") {
    process.stdout.write(JSON.stringify({
      method: "item/agentMessage/delta",
      params: { threadId: "th_576", delta: "codex leak ${authPassword} and ${openCodePassword}", "key-${authPassword}": "codex key leak" }
    }) + "\\n");
    process.stdout.write(JSON.stringify({ id: message.id, result: { data: [] } }) + "\\n");
    return;
  }
  process.stdout.write(JSON.stringify({ id: message.id, result: {} }) + "\\n");
});
`);
  await chmod(fakeCodex, 0o755);

  const appPort = await freePort();
  const child = spawn(process.execPath, ["server.mjs"], {
    cwd: repoRoot,
    env: {
      ...process.env,
      HOME: home,
      POCKET_HOST: "127.0.0.1",
      POCKET_PORT: String(appPort),
      OPENCODE_URL: `http://127.0.0.1:${upstreamPort}`,
      OPENCODE_SERVER_PASSWORD: openCodePassword,
      OPENCODE_DIRECTORY: projectDir,
      CODEX_CWD: projectDir,
      CODEX_BIN: fakeCodex,
      DEVMOTER_AUTH_PASSWORD: authPassword,
      DEVMOTER_SANDBOX: "off"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  try {
    await waitForReady(child);
    const baseUrl = `http://127.0.0.1:${appPort}`;
    const authorization = `Basic ${Buffer.from(`devmoter:${authPassword}`).toString("base64")}`;
    const baseHeaders = { authorization, origin: baseUrl };

    // 1. Response header allowlist, content-type downgrade, and security headers.
    const locationRes = await fetch(`${baseUrl}/api/opencode/location`, {
      headers: baseHeaders,
      signal: AbortSignal.timeout(4000)
    });
    assert.equal(locationRes.status, 200);
    assert.equal(locationRes.headers.get("set-cookie"), null);
    assert.equal(locationRes.headers.get("x-powered-by"), null);
    assert.equal(locationRes.headers.get("server"), null);
    assert.equal(locationRes.headers.get("x-internal-debug"), null);
    assert.equal(locationRes.headers.get("location"), null);
    assert.equal(locationRes.headers.get("www-authenticate"), null);
    assert.equal(locationRes.headers.get("retry-after"), "12");
    assert.equal(locationRes.headers.get("cache-control"), "no-store");
    assert.match(locationRes.headers.get("content-type") || "", /^application\/json/);
    assertProxySecurityHeaders(locationRes.headers, "/api/opencode/location");
    const locationJson = await locationRes.json();
    assert.equal(locationJson.secretEcho, "[REDACTED]");
    assert.deepEqual(locationJson["key-[REDACTED]"], ["[REDACTED]"]);

    for (const id of ["sess_invalid_json", "sess_large_json"]) {
      const response = await fetch(`${baseUrl}/api/opencode/session/${id}`, { headers: baseHeaders });
      assert.equal(response.status, 502);
      assert.deepEqual(await response.json(), { error: "OpenCode returned an invalid or oversized JSON response" });
    }

    const htmlRes = await fetch(`${baseUrl}/api/opencode/session/sess_html`, {
      headers: baseHeaders,
      signal: AbortSignal.timeout(4000)
    });
    assert.equal(htmlRes.status, 200);
    assert.equal(htmlRes.headers.get("set-cookie"), null);
    assert.equal(htmlRes.headers.get("content-type"), "application/octet-stream");
    assertProxySecurityHeaders(htmlRes.headers, "/api/opencode/session/sess_html");
    const htmlBody = await htmlRes.text();
    assert.equal(htmlBody.includes(authPassword), false);
    assert.match(htmlBody, /\[REDACTED\]/);

    const svgRes = await fetch(`${baseUrl}/api/opencode/session/sess_svg`, {
      headers: baseHeaders,
      signal: AbortSignal.timeout(4000)
    });
    assert.equal(svgRes.status, 200);
    assert.equal(svgRes.headers.get("content-type"), "application/octet-stream");
    assertProxySecurityHeaders(svgRes.headers, "/api/opencode/session/sess_svg");

    const plainRes = await fetch(`${baseUrl}/api/opencode/session/sess_text`, {
      headers: baseHeaders,
      signal: AbortSignal.timeout(4000)
    });
    assert.equal(plainRes.status, 200);
    assert.equal(plainRes.headers.get("content-type"), "text/plain; charset=utf-8");
    assertProxySecurityHeaders(plainRes.headers, "/api/opencode/session/sess_text");
    const plainBody = await plainRes.text();
    assert.equal(plainBody.includes(openCodePassword), false);
    assert.equal(plainBody.includes(authPassword), false);
    assert.equal(plainBody, "plain body with [REDACTED] and [REDACTED]");

    // 2. Redaction across proxy() SSE, opencodeEvents() SSE, and codexEvents() SSE without breaking framing.
    const proxySseRes = await fetch(`${baseUrl}/api/opencode/session/sess_sse`, {
      headers: { ...baseHeaders, accept: "text/event-stream" },
      signal: AbortSignal.timeout(4000)
    });
    assert.equal(proxySseRes.status, 200);
    assert.equal(proxySseRes.headers.get("set-cookie"), null);
    assert.equal(proxySseRes.headers.get("content-type"), "text/event-stream; charset=utf-8");
    assert.equal(proxySseRes.headers.get("cache-control"), "no-cache, no-transform");
    assertProxySecurityHeaders(proxySseRes.headers, "/api/opencode/session/sess_sse");
    const proxySseText = await proxySseRes.text();
    assert.equal(proxySseText.includes(openCodePassword), false);
    assert.equal(proxySseText.includes(authPassword), false);
    const proxyFrames = proxySseText.trim().split("\n\n");
    assert.equal(proxyFrames.length, 2);
    assert.match(proxyFrames[0], /^event: delta\ndata: /);
    const firstPayload = JSON.parse(proxyFrames[0].split("\n")[1].slice(6));
    const secondPayload = JSON.parse(proxyFrames[1].slice(6));
    assert.equal(firstPayload.text, "first [REDACTED] middle");
    assert.equal(secondPayload.text, "second [REDACTED]");

    const ocEventsRes = await fetch(`${baseUrl}/api/opencode/event`, {
      headers: { ...baseHeaders, accept: "text/event-stream" },
      signal: AbortSignal.timeout(4000)
    });
    assert.equal(ocEventsRes.status, 200);
    assert.equal(ocEventsRes.headers.get("set-cookie"), null);
    assert.equal(ocEventsRes.headers.get("content-type"), "text/event-stream; charset=utf-8");
    assertProxySecurityHeaders(ocEventsRes.headers, "/api/opencode/event");
    const ocEventsText = await ocEventsRes.text();
    assert.equal(ocEventsText.includes(openCodePassword), false);
    assert.equal(ocEventsText.includes(authPassword), false);
    const ocEventObj = JSON.parse(ocEventsText.trim().replace(/^data: /, ""));
    assert.equal(ocEventObj.properties.delta, "upstream token [REDACTED] and [REDACTED]");

    const codexAbort = new AbortController();
    const codexEventsRes = await fetch(`${baseUrl}/api/codex/events`, {
      headers: { ...baseHeaders, accept: "text/event-stream" },
      signal: codexAbort.signal
    });
    assert.equal(codexEventsRes.status, 200);
    assert.equal(codexEventsRes.headers.get("content-type"), "text/event-stream; charset=utf-8");
    assertProxySecurityHeaders(codexEventsRes.headers, "/api/codex/events");
    const codexReader = codexEventsRes.body.getReader();
    const codexDecoder = new TextDecoder();
    let codexBuffer = "";
    const readUntil = async predicate => {
      const deadline = Date.now() + 5000;
      while (!predicate(codexBuffer)) {
        if (Date.now() > deadline) throw new Error(`Timed out waiting for Codex SSE event; got: ${codexBuffer}`);
        const { done, value } = await codexReader.read();
        if (done) break;
        codexBuffer += codexDecoder.decode(value, { stream: true });
      }
    };
    await readUntil(text => text.includes("event: ready\n"));
    const rpcRes = await fetch(`${baseUrl}/api/codex/rpc`, {
      method: "POST",
      headers: { ...baseHeaders, "content-type": "application/json", "x-pocket-operation-id": "codex-list-576" },
      body: JSON.stringify({ method: "thread/list", params: {} }),
      signal: AbortSignal.timeout(4000)
    });
    assert.equal(rpcRes.status, 200);
    await readUntil(text => text.includes("event: notification\n") && text.includes("\n\n", text.indexOf("event: notification\n")));
    codexAbort.abort();
    await codexReader.cancel().catch(() => {});
    assert.equal(codexBuffer.includes(authPassword), false);
    assert.equal(codexBuffer.includes(openCodePassword), false);
    const notifStart = codexBuffer.indexOf("event: notification\n");
    const notifFrame = codexBuffer.slice(notifStart, codexBuffer.indexOf("\n\n", notifStart));
    const notifDataLine = notifFrame.split("\n").find(line => line.startsWith("data: "));
    assert.ok(notifDataLine);
    const notifPayload = JSON.parse(notifDataLine.slice(6));
    assert.equal(notifPayload.params.delta, "codex leak [REDACTED] and [REDACTED]");
    assert.match(codexBuffer, /key-\[REDACTED\]/, "secrets appearing as JSON keys must be redacted on SSE paths");
    assert.equal(notifPayload.params["key-[REDACTED]"], "codex key leak");

    // 3. Agent mode authority: spoofing x-pocket-agent-mode cannot escalate read-only sessions.
    // 3a. Create a plan session (even while sending a spoofed build header at creation).
    const createRo = await fetch(`${baseUrl}/api/opencode/session`, {
      method: "POST",
      headers: {
        ...baseHeaders,
        "content-type": "application/json",
        "x-pocket-agent-mode": "build",
        "x-pocket-operation-id": "create-ro-576"
      },
      body: JSON.stringify({ agent: "plan" }),
      signal: AbortSignal.timeout(4000)
    });
    assert.equal(createRo.status, 200);
    const roSession = await createRo.json();
    assert.equal(roSession.id, "ses_ro_created");

    for (const route of ["/api/opencode/session/ses_ro_created/shell", "/api/opencode/session/ses_ro_created/command"]) {
      const blocked = await fetch(`${baseUrl}${route}`, {
        method: "POST",
        headers: {
          ...baseHeaders,
          "content-type": "application/json",
          "x-pocket-agent-mode": "build",
          "x-pocket-operation-id": `spoof-${route}`
        },
        body: JSON.stringify({ command: "id" }),
        signal: AbortSignal.timeout(4000)
      });
      assert.equal(blocked.status, 403, `${route} must remain blocked`);
    }

    // Prompt with spoofed build header still passes read-only tools to upstream.
    const roPrompt = await fetch(`${baseUrl}/api/opencode/session/ses_ro_created/prompt`, {
      method: "POST",
      headers: {
        ...baseHeaders,
        "content-type": "application/json",
        "x-pocket-agent-mode": "build",
        "x-pocket-operation-id": "ro-prompt-spoof-576"
      },
      body: JSON.stringify({ text: "inspect" }),
      signal: AbortSignal.timeout(4000)
    });
    assert.equal(roPrompt.status, 200);
    assertProxySecurityHeaders(roPrompt.headers, "/api/opencode/session/ses_ro_created/prompt");
    const roPromptUpstream = received.filter(r => r.path === "/session/ses_ro_created/prompt_async").at(-1);
    assert.equal(roPromptUpstream.body.tools["*"], false);
    assert.equal(roPromptUpstream.body.tools.read, true);

    // Prompt body trying to override agent to build on a read-only session is rejected.
    const roPromptBuildAgent = await fetch(`${baseUrl}/api/opencode/session/ses_ro_created/prompt`, {
      method: "POST",
      headers: {
        ...baseHeaders,
        "content-type": "application/json",
        "x-pocket-agent-mode": "build",
        "x-pocket-operation-id": "ro-prompt-agent-spoof-576"
      },
      body: JSON.stringify({ text: "write file", agent: "build" }),
      signal: AbortSignal.timeout(4000)
    });
    assert.equal(roPromptBuildAgent.status, 403);

    // 3b. Pre-existing upstream read-only session ("ask") not yet in memory cannot be escalated.
    const existingShell = await fetch(`${baseUrl}/api/opencode/session/ses_ro_existing/shell`, {
      method: "POST",
      headers: {
        ...baseHeaders,
        "content-type": "application/json",
        "x-pocket-agent-mode": "build",
        "x-pocket-operation-id": "existing-ro-shell-576"
      },
      body: JSON.stringify({ command: "id" }),
      signal: AbortSignal.timeout(4000)
    });
    assert.equal(existingShell.status, 403);
    assert.equal(
      received.some(r => r.path === "/api/session/ses_ro_existing/shell" || r.path === "/api/session/ses_ro_created/shell"),
      false,
      "blocked shell mutations must never reach upstream"
    );

    // 3c. Headers cannot change a build session. An explicit /agent transition can.
    const createRw = await fetch(`${baseUrl}/api/opencode/session`, {
      method: "POST",
      headers: {
        ...baseHeaders,
        "content-type": "application/json",
        "x-pocket-agent-mode": "build",
        "x-pocket-operation-id": "create-rw-576"
      },
      body: JSON.stringify({ agent: "build" }),
      signal: AbortSignal.timeout(4000)
    });
    assert.equal(createRw.status, 200);
    assert.equal((await createRw.json()).id, "ses_rw_created");

    const rwPrompt = await fetch(`${baseUrl}/api/opencode/session/ses_rw_created/prompt`, {
      method: "POST",
      headers: {
        ...baseHeaders,
        "content-type": "application/json",
        "x-pocket-agent-mode": "plan",
        "x-pocket-operation-id": "rw-downgrade-prompt-576"
      },
      body: JSON.stringify({ text: "read only check" }),
      signal: AbortSignal.timeout(4000)
    });
    assert.equal(rwPrompt.status, 200);
    const rwPromptUpstream = received.filter(r => r.path === "/session/ses_rw_created/prompt_async").at(-1);
    assert.equal(rwPromptUpstream.body.tools, undefined);

    // Subsequent shell on the build session still works when not downgraded.
    const rwShell = await fetch(`${baseUrl}/api/opencode/session/ses_rw_created/shell`, {
      method: "POST",
      headers: {
        ...baseHeaders,
        "content-type": "application/json",
        "x-pocket-operation-id": "rw-shell-576"
      },
      body: JSON.stringify({ command: "pwd" }),
      signal: AbortSignal.timeout(4000)
    });
    assert.equal(rwShell.status, 200);

    // Legitimately switch session to plan via /agent (even with spoofed build header); subsequent shell is blocked.
    const switchToPlan = await fetch(`${baseUrl}/api/opencode/session/ses_rw_created/agent`, {
      method: "POST",
      headers: {
        ...baseHeaders,
        "content-type": "application/json",
        "x-pocket-agent-mode": "build",
        "x-pocket-operation-id": "rw-to-plan-576"
      },
      body: JSON.stringify({ agent: "plan" }),
      signal: AbortSignal.timeout(4000)
    });
    assert.equal(switchToPlan.status, 200);

    // Calling /agent without an agent field on a now read-only session is
    // refused outright (fail closed), so it cannot escalate back to build.
    const emptyAgentUpdate = await fetch(`${baseUrl}/api/opencode/session/ses_rw_created/agent`, {
      method: "POST",
      headers: {
        ...baseHeaders,
        "content-type": "application/json",
        "x-pocket-agent-mode": "build",
        "x-pocket-operation-id": "rw-empty-agent-576"
      },
      body: JSON.stringify({}),
      signal: AbortSignal.timeout(4000)
    });
    assert.equal(emptyAgentUpdate.status, 403);

    const rwNowBlocked = await fetch(`${baseUrl}/api/opencode/session/ses_rw_created/shell`, {
      method: "POST",
      headers: {
        ...baseHeaders,
        "content-type": "application/json",
        "x-pocket-agent-mode": "build",
        "x-pocket-operation-id": "rw-now-blocked-576"
      },
      body: JSON.stringify({ command: "id" }),
      signal: AbortSignal.timeout(4000)
    });
    assert.equal(rwNowBlocked.status, 403);

    // 4. Audit fix round: /agent transitions, encoded paths, and unverifiable
    //    sessions must not bypass the mode authority established above.
    // 4a. A read-only session cannot be switched to build through the proxy
    //     /agent route, whatever shape the request body takes.
    for (const [label, payload] of [
      ["agent-build", { agent: "build" }],
      ["mode-build", { mode: "build" }],
      ["empty", {}]
    ]) {
      const rejected = await fetch(`${baseUrl}/api/opencode/session/ses_ro_created/agent`, {
        method: "POST",
        headers: {
          ...baseHeaders,
          "content-type": "application/json",
          "x-pocket-agent-mode": "build",
          "x-pocket-operation-id": `ro-agent-${label}-576`
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(4000)
      });
      assert.equal(rejected.status, 403, `/agent with ${label} on a read-only session must be rejected`);
    }
    assert.equal(
      received.some(r => r.method === "POST" && r.path === "/api/session/ses_ro_created/agent"),
      false,
      "rejected agent updates must never reach upstream"
    );
    const roShellAfterAgentAttempts = await fetch(`${baseUrl}/api/opencode/session/ses_ro_created/shell`, {
      method: "POST",
      headers: {
        ...baseHeaders,
        "content-type": "application/json",
        "x-pocket-operation-id": "ro-shell-after-agent-576"
      },
      body: JSON.stringify({ command: "id" }),
      signal: AbortSignal.timeout(4000)
    });
    assert.equal(roShellAfterAgentAttempts.status, 403, "read-only session must stay read-only after /agent attempts");

    // 4b. Percent-encoded and trailing-slash action segments are classified
    //     by their decoded canonical path, not the raw request path.
    const encodedShell = await fetch(`${baseUrl}/api/opencode/session/ses_ro_created/%73hell`, {
      method: "POST",
      headers: {
        ...baseHeaders,
        "content-type": "application/json",
        "x-pocket-agent-mode": "build",
        "x-pocket-operation-id": "ro-encoded-shell-576"
      },
      body: JSON.stringify({ command: "id" }),
      signal: AbortSignal.timeout(4000)
    });
    assert.equal(encodedShell.status, 403, "encoded shell segment must hit the mutation guard");

    const beforeEncodedPrompt = received.length;
    const encodedPrompt = await fetch(`${baseUrl}/api/opencode/session/ses_ro_created/%70rompt`, {
      method: "POST",
      headers: {
        ...baseHeaders,
        "content-type": "application/json",
        "x-pocket-operation-id": "ro-encoded-prompt-576"
      },
      body: JSON.stringify({ text: "hello" }),
      signal: AbortSignal.timeout(4000)
    });
    assert.equal(encodedPrompt.status, 200, "canonical prompt must use the adapter");
    const promptCalls = received.slice(beforeEncodedPrompt);
    assert.ok(promptCalls.some(r => r.path === "/session/ses_ro_created/prompt_async"));
    assert.ok(!promptCalls.some(r => r.path === "/api/session/ses_ro_created/prompt"));

    const trailingSlashShell = await fetch(`${baseUrl}/api/opencode/session/ses_ro_created/shell/`, {
      method: "POST",
      headers: {
        ...baseHeaders,
        "content-type": "application/json",
        "x-pocket-agent-mode": "build",
        "x-pocket-operation-id": "ro-trailing-shell-576"
      },
      body: JSON.stringify({ command: "id" }),
      signal: AbortSignal.timeout(4000)
    });
    assert.equal(trailingSlashShell.status, 403, "trailing-slash shell must hit the mutation guard");
    assert.equal(
      received.some(r => r.path === "/api/session/ses_ro_created/shell"),
      false,
      "blocked shell mutations must never reach upstream"
    );

    // 4c. A session the upstream cannot resolve fails closed on mutations
    //     instead of falling back to "build".
    const unknownShell = await fetch(`${baseUrl}/api/opencode/session/ses_unresolvable/shell`, {
      method: "POST",
      headers: {
        ...baseHeaders,
        "content-type": "application/json",
        "x-pocket-agent-mode": "build",
        "x-pocket-operation-id": "unknown-shell-576"
      },
      body: JSON.stringify({ command: "id" }),
      signal: AbortSignal.timeout(4000)
    });
    assert.equal(unknownShell.status, 403, "unverifiable session mode must fail closed");
    assert.equal(
      received.some(r => r.method === "POST" && r.path === "/api/session/ses_unresolvable/shell"),
      false,
      "unverifiable session mutations must never reach upstream"
    );

    // 5. Downgrade sync: an explicit read-only prompt agent on a build
    //    session persists server-side, so later mutations stay blocked even
    //    without a downgrade header.
    const recreateRw = await fetch(`${baseUrl}/api/opencode/session`, {
      method: "POST",
      headers: {
        ...baseHeaders,
        "content-type": "application/json",
        "x-pocket-operation-id": "recreate-rw-576"
      },
      body: JSON.stringify({ agent: "build" }),
      signal: AbortSignal.timeout(4000)
    });
    assert.equal(recreateRw.status, 200);
    assert.equal((await recreateRw.json()).id, "ses_rw_created");

    const downgradePrompt = await fetch(`${baseUrl}/api/opencode/session/ses_rw_created/prompt`, {
      method: "POST",
      headers: {
        ...baseHeaders,
        "content-type": "application/json",
        "x-pocket-operation-id": "rw-agent-downgrade-prompt-576"
      },
      body: JSON.stringify({ text: "switch to planning", agent: "plan" }),
      signal: AbortSignal.timeout(4000)
    });
    assert.equal(downgradePrompt.status, 200);
    const downgradeUpstream = received.filter(r => r.path === "/session/ses_rw_created/prompt_async").at(-1);
    assert.equal(downgradeUpstream.body.agent, "plan");
    assert.equal(downgradeUpstream.body.tools["*"], false);

    const shellAfterDowngrade = await fetch(`${baseUrl}/api/opencode/session/ses_rw_created/shell`, {
      method: "POST",
      headers: {
        ...baseHeaders,
        "content-type": "application/json",
        "x-pocket-operation-id": "rw-shell-after-downgrade-576"
      },
      body: JSON.stringify({ command: "id" }),
      signal: AbortSignal.timeout(4000)
    });
    assert.equal(shellAfterDowngrade.status, 403, "mode map must follow the explicit prompt-agent downgrade");
  } finally {
    child.kill("SIGTERM");
    await Promise.race([once(child, "exit"), new Promise(resolve => setTimeout(resolve, 1500))]);
    if (child.exitCode === null) child.kill("SIGKILL");
    await new Promise(resolve => upstream.close(resolve));
    await rm(home, { recursive: true, force: true });
  }
});
