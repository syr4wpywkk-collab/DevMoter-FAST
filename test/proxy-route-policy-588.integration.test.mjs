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
import ts from "typescript";
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

function pathVariants(node) {
  if (!node) throw new Error("Missing path");
  if (ts.isStringLiteralLike(node)) return [node.text];
  if (ts.isParenthesizedExpression(node)) return pathVariants(node.expression);
  if (ts.isConditionalExpression(node)) return [...pathVariants(node.whenTrue), ...pathVariants(node.whenFalse)];
  if (ts.isTemplateExpression(node)) {
    return node.templateSpans.reduce((prefixes, span) => {
      const values = pathVariants(span.expression);
      return prefixes.flatMap(prefix => values.map(value => prefix + value + span.literal.text));
    }, [node.head.text]);
  }
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const right = pathVariants(node.right);
    return pathVariants(node.left).flatMap(left => right.map(suffix => left + suffix));
  }
  if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "encodeURIComponent") {
    return ["{id}"];
  }
  throw new Error("Unsupported path expression: " + node.getText());
}

function clientMethod(init) {
  if (!init) return "GET";
  assert.ok(ts.isObjectLiteralExpression(init), "request options must be statically inspectable");
  let method = "GET";
  for (const property of init.properties) {
    assert.ok(ts.isPropertyAssignment(property) && !ts.isComputedPropertyName(property.name),
      "request options must use static properties");
    if (property.name.text === "method") {
      assert.ok(ts.isStringLiteralLike(property.initializer), "request method must be a string literal");
      method = property.initializer.text;
    }
  }
  return method;
}

function extractClientCalls(file, source, callee) {
  const calls = [];
  const script = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  function visit(node) {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === callee) {
      const { line } = script.getLineAndCharacterOfPosition(node.getStart());
      try {
        const method = clientMethod(node.arguments[1]);
        for (const path of pathVariants(node.arguments[0])) {
          assert.ok(path.startsWith("/"), "expected an absolute proxy path");
          calls.push({ path: path.split("?")[0], method });
        }
      } catch (error) {
        assert.fail(`${file}:${line + 1}: ${error.message}`);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(script);
  return calls;
}

test("client drift guard: every browser proxy call is allowlisted or adapter-served", async () => {
  const sources = [
    ["src/opencode.ts", "api", 20],
    ["src/session-control.ts", "oc", 5]
  ];
  for (const [file, callee, minCalls] of sources) {
    const source = await readFile(join(repoRoot, file), "utf8");
    const calls = extractClientCalls(file, source, callee);
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
