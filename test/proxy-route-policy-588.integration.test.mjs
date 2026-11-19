import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { classifyProxyRoute, listWriteRoutePatterns, PROXY_ROUTE_TABLE } from "../server/proxy-route-policy.mjs";
import { isAdapterOwnedRoute } from "../server/agent-mode-policy.mjs";

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

async function startServer(extraEnv = {}) {
  const home = await mkdtemp(join(tmpdir(), "devmoter-proxy-routes-588-"));
  const authPassword = "proxy-routes-588-password";
  const received = [];
  const upstream = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    let body = null;
    try {
      body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      body = null;
    }
    received.push({ method: req.method, path: req.url, body });
    res.setHeader("content-type", "application/json");
    if (req.method === "POST" && req.url === "/api/session") {
      const agent = typeof body?.agent === "string" ? body.agent : "build";
      const id = agent === "plan" ? "ses_ro_588" : "ses_rw_588";
      res.writeHead(200);
      res.end(JSON.stringify({ id, agent }));
      return;
    }
    res.writeHead(200);
    res.end(JSON.stringify({ ok: true, method: req.method, path: req.url }));
  });
  const upstreamPort = await listen(upstream);
  const port = await freePort();
  const child = spawn(process.execPath, ["server.mjs"], {
    cwd: repoRoot,
    env: {
      ...process.env,
      HOME: home,
      POCKET_HOST: "127.0.0.1",
      POCKET_PORT: String(port),
      OPENCODE_URL: `http://127.0.0.1:${upstreamPort}`,
      CODEX_BIN: "__devmoter_test_codex_not_started__",
      DEVMOTER_AUTH_PASSWORD: authPassword,
      ...extraEnv
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let stderr = "";
  child.stderr.on("data", chunk => {
    stderr += chunk.toString();
  });
  await waitForReady(child);
  const baseUrl = `http://127.0.0.1:${port}`;
  const baseHeaders = {
    authorization: `Basic ${Buffer.from(`devmoter:${authPassword}`).toString("base64")}`,
    origin: baseUrl
  };
  let opCounter = 0;
  const call = (method, path, { body, headers = {} } = {}) => fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...baseHeaders,
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
      ...(method !== "GET" && method !== "HEAD" ? { "x-pocket-operation-id": `op-588-${++opCounter}` } : {}),
      ...headers
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(5000)
  });
  const stop = async () => {
    child.kill("SIGTERM");
    await Promise.race([once(child, "exit"), new Promise(resolve => setTimeout(resolve, 1500))]);
    if (child.exitCode === null) child.kill("SIGKILL");
    await new Promise(resolve => upstream.close(resolve));
    await rm(home, { recursive: true, force: true });
  };
  return { call, received, stop, getStderr: () => stderr };
}

test("classifyProxyRoute matches only allowlisted method + route pairs", () => {
  assert.equal(classifyProxyRoute("GET", "/api/session")?.kind, "read");
  assert.equal(classifyProxyRoute("GET", "/api/session/ses_1")?.kind, "read");
  assert.equal(classifyProxyRoute("GET", "/api/agent")?.kind, "read");
  assert.equal(classifyProxyRoute("POST", "/api/session")?.kind, "write");
  assert.equal(classifyProxyRoute("POST", "/api/session/ses_1/agent")?.kind, "write");
  assert.equal(classifyProxyRoute("POST", "/api/session/ses_1/model")?.kind, "write");
  assert.equal(classifyProxyRoute("POST", "/api/session/ses_1/shell")?.kind, "write");
  assert.equal(classifyProxyRoute("POST", "/api/session/ses_1/command")?.kind, "write");
  // Unlisted routes and unlisted methods on listed paths classify as null.
  assert.equal(classifyProxyRoute("GET", "/api/experimental/unknown"), null);
  assert.equal(classifyProxyRoute("DELETE", "/api/session/ses_1"), null);
  assert.equal(classifyProxyRoute("PUT", "/api/agent"), null);
  assert.equal(classifyProxyRoute("GET", "/api/session/ses_1/shell"), null);
  assert.equal(classifyProxyRoute("POST", "/api/session/ses_1/unknown-action"), null);
  // Adapter-owned subroutes are not proxy routes and stay out of the table.
  assert.equal(classifyProxyRoute("GET", "/api/session/ses_1/message"), null);
  assert.equal(classifyProxyRoute("POST", "/api/session/ses_1/prompt"), null);
  assert.ok(listWriteRoutePatterns().length >= 5);
});

// --- Drift guard: every route the browser client sends through the generic
// proxy must be in the allowlist (or served by the DevMoter adapter). ---

function callSpan(source, openParenIndex) {
  let depth = 0;
  let quote = null;
  for (let i = openParenIndex; i < source.length; i++) {
    const ch = source[i];
    if (quote) {
      if (ch === "\\") i++;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch;
      continue;
    }
    if (ch === "(") depth++;
    else if (ch === ")") {
      depth--;
      if (depth === 0) return source.slice(openParenIndex, i + 1);
    }
  }
  return source.slice(openParenIndex);
}

function parsePathExpression(span) {
  let i = 1; // span starts at "("
  let path = "";
  let consumed = false;
  const skipWs = () => {
    while (i < span.length && /\s/.test(span[i])) i++;
  };
  while (true) {
    skipWs();
    const ch = span[i];
    if (ch === '"' || ch === "'") {
      const end = span.indexOf(ch, i + 1);
      if (end === -1) return null;
      path += span.slice(i + 1, end);
      i = end + 1;
    } else if (ch === "`") {
      let j = i + 1;
      let out = "";
      while (j < span.length && span[j] !== "`") {
        if (span[j] === "$" && span[j + 1] === "{") {
          const close = span.indexOf("}", j + 2);
          if (close === -1) return null;
          out += "{id}";
          j = close + 1;
        } else {
          out += span[j];
          j++;
        }
      }
      if (j >= span.length) return null;
      path += out;
      i = j + 1;
    } else if (span.startsWith("encodeURIComponent", i)) {
      const open = span.indexOf("(", i);
      const close = span.indexOf(")", open);
      if (close === -1) return null;
      path += "{id}";
      i = close + 1;
    } else {
      break;
    }
    consumed = true;
    skipWs();
    if (span[i] === "+") {
      i++;
      continue;
    }
    break;
  }
  return consumed && path.startsWith("/") ? path : null;
}

function extractClientCalls(source, callee) {
  const calls = [];
  const pattern = new RegExp(`\\b${callee}(?:<[^>]*>)?\\(`, "g");
  let match;
  while ((match = pattern.exec(source))) {
    if (/[A-Za-z]/.test(source[match.index - 1] || "")) continue;
    if (/function\s*$/.test(source.slice(Math.max(0, match.index - 12), match.index))) continue;
    const openParen = match.index + match[0].length - 1;
    const span = callSpan(source, openParen);
    const path = parsePathExpression(span);
    if (!path) continue;
    const methodMatch = span.match(/method:\s*"(GET|POST|PUT|PATCH|DELETE)"/);
    calls.push({ path: path.split("?")[0], method: methodMatch ? methodMatch[1] : "GET" });
  }
  return calls;
}

test("client drift guard: every browser proxy call is allowlisted or adapter-served", async () => {
  const sources = [
    ["src/opencode.ts", "api", 20],
    ["src/session-control.ts", "oc", 5]
  ];
  for (const [file, callee, minCalls] of sources) {
    const source = await readFile(join(repoRoot, file), "utf8");
    const calls = extractClientCalls(source, callee);
    assert.ok(calls.length >= minCalls, `${file}: expected at least ${minCalls} ${callee}() calls, parsed ${calls.length}`);
    for (const { method, path } of calls) {
      const policyPath = `/api${path}`;
      const adapterServed = isAdapterOwnedRoute(policyPath) || policyPath === "/api/session/active";
      assert.ok(
        adapterServed || classifyProxyRoute(method, policyPath) !== null,
        `${file}: ${method} ${path} is neither adapter-served nor in the proxy route allowlist`
      );
    }
  }
});

test("proxy enforces the deny-by-default route allowlist and read-only write blocks", async () => {
  const { call, received, stop } = await startServer();
  try {
    // Happy path: session creation works for build and for plan (creating a
    // read-only session is how one comes to exist; see proxy() guard scope).
    const createRw = await call("POST", "/api/opencode/session", { body: { agent: "build" } });
    assert.equal(createRw.status, 200);
    assert.equal((await createRw.json()).id, "ses_rw_588");
    const createRo = await call("POST", "/api/opencode/session", {
      body: { agent: "plan" },
      headers: { "x-pocket-agent-mode": "plan" }
    });
    assert.equal(createRo.status, 200);
    assert.equal((await createRo.json()).id, "ses_ro_588");

    // Happy path: listed read routes forward.
    for (const path of [
      "/api/opencode/session",
      "/api/opencode/session/ses_rw_588",
      "/api/opencode/agent",
      "/api/opencode/command",
      "/api/opencode/skill",
      "/api/opencode/location"
    ]) {
      const response = await call("GET", path);
      assert.equal(response.status, 200, `${path} should forward`);
      await response.json();
    }

    // Happy path: listed write routes forward on a build session.
    for (const [path, body] of [
      ["/api/opencode/session/ses_rw_588/agent", { agent: "build" }],
      ["/api/opencode/session/ses_rw_588/model", { model: { id: "m1", providerID: "p1" } }],
      ["/api/opencode/session/ses_rw_588/shell", { command: "pwd" }],
      ["/api/opencode/session/ses_rw_588/command", { command: "ls" }]
    ]) {
      const response = await call("POST", path, { body });
      assert.equal(response.status, 200, `${path} should forward on a build session`);
      await response.json();
    }

    const hitsBefore = received.length;

    // Unlisted routes are rejected and never reach upstream.
    const unknownGet = await call("GET", "/api/opencode/experimental/unknown");
    assert.equal(unknownGet.status, 404);
    assert.equal((await unknownGet.json()).error, "OpenCode proxy route is not allowed");
    const unknownAction = await call("POST", "/api/opencode/session/ses_rw_588/unknown-action", { body: {} });
    assert.equal(unknownAction.status, 404);
    assert.equal((await unknownAction.json()).error, "OpenCode proxy route is not allowed");

    // Unlisted methods on listed paths are rejected and never reach upstream.
    const deleteSession = await call("DELETE", "/api/opencode/session/ses_rw_588");
    assert.equal(deleteSession.status, 404);
    const putAgent = await call("PUT", "/api/opencode/agent", { body: {} });
    assert.equal(putAgent.status, 404);

    assert.equal(received.length, hitsBefore, "rejected requests must not contact upstream");

    // Adapter-owned routes keep their dedicated rejection (not forwarded).
    const owned = await call("GET", "/api/opencode/session/ses_rw_588/message");
    assert.equal(owned.status, 404);
    assert.match((await owned.json()).error, /served by DevMoter/);
    assert.equal(received.length, hitsBefore, "adapter-owned routes must not contact upstream via proxy");

    // Read-only mode: EVERY session-scoped write-classified route is rejected.
    const sessionWrites = PROXY_ROUTE_TABLE.filter(entry => entry.kind === "write" && entry.template.includes("{id}"));
    assert.ok(sessionWrites.length >= 4);
    for (const entry of sessionWrites) {
      const upstreamPath = entry.template.replace("{id}", "ses_ro_588");
      const clientPath = `/api/opencode${entry.template.slice("/api".length).replace("{id}", "ses_ro_588")}`;
      const response = await call(entry.method, clientPath, {
        body: {},
        headers: { "x-pocket-agent-mode": "plan" }
      });
      assert.equal(response.status, 403, `${entry.method} ${clientPath} must be blocked in plan mode`);
      await response.json();
      assert.ok(
        !received.some(hit => hit.method === entry.method && hit.path === upstreamPath),
        `${entry.method} ${upstreamPath} must not reach upstream in plan mode`
      );
    }

    // Read-only mode: listed reads still forward.
    const roFetch = await call("GET", "/api/opencode/session/ses_ro_588", {
      headers: { "x-pocket-agent-mode": "plan" }
    });
    assert.equal(roFetch.status, 200);
    await roFetch.json();
  } finally {
    await stop();
  }
});

test("sandbox-required mode blocks every write-classified proxy route but not reads", async () => {
  const { call, received, stop } = await startServer({ DEVMOTER_SANDBOX: "required" });
  try {
    const create = await call("POST", "/api/opencode/session", { body: { agent: "build" } });
    assert.equal(create.status, 409);
    await create.json();
    const shell = await call("POST", "/api/opencode/session/ses_x/shell", { body: { command: "id" } });
    assert.equal(shell.status, 409);
    await shell.json();
    const agent = await call("POST", "/api/opencode/session/ses_x/agent", { body: { agent: "plan" } });
    assert.equal(agent.status, 409);
    await agent.json();

    const list = await call("GET", "/api/opencode/session");
    assert.equal(list.status, 200);
    await list.json();
    assert.ok(received.every(hit => hit.method === "GET"), "only reads may reach upstream when the sandbox blocks execution");
  } finally {
    await stop();
  }
});
