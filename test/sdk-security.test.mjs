import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { DevMoterClient } from "../sdk/index.mjs";

const username = "synthetic-user";
const password = "synthetic-secret";
const authorization = `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;

async function listen(server) {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return server.address().port;
}

async function closeServer(server) {
  if (!server.listening) return;
  const closed = new Promise(resolve => server.close(resolve));
  server.closeAllConnections?.();
  await closed;
}

test("SDK rejects caller-supplied fetchImpl instead of using an untrusted credentialed transport", () => {
  let invocations = 0;
  const injected = async () => {
    invocations += 1;
    return new Response("{}", { status: 200 });
  };
  const options = {
    baseUrl: "http://127.0.0.1:8787",
    username,
    password,
    fetchImpl: injected
  };

  assert.throws(() => new DevMoterClient(options), /Custom fetchImpl is not supported/);
  const inheritedOptions = Object.assign(Object.create({ fetchImpl: injected }), {
    baseUrl: options.baseUrl,
    username,
    password
  });
  assert.throws(() => new DevMoterClient(inheritedOptions), /Custom fetchImpl is not supported/);
  assert.equal(invocations, 0);
});

test("SDK captured native fetch allows credentialed request and streamTask on localhost", async t => {
  const calls = [];
  const server = createServer((req, res) => {
    const chunks = [];
    req.on("data", chunk => chunks.push(chunk));
    req.on("end", () => {
      calls.push({
        url: req.url,
        method: req.method,
        authorization: req.headers.authorization,
        origin: req.headers.origin,
        operationId: req.headers["x-pocket-operation-id"],
        body: Buffer.concat(chunks).toString("utf8")
      });
      if (req.url === "/base/v2/api/automation/tasks") {
        res.writeHead(200, { "content-type": "application/x-ndjson" });
        res.end("{\"event\":\"completed\"}\n");
      } else {
        res.writeHead(200, { "content-type": "application/json" });
        res.end("{\"ok\":true}");
      }
    });
  });
  const port = await listen(server);
  t.after(() => closeServer(server));

  const client = new DevMoterClient({
    baseUrl: `http://127.0.0.1:${port}/base/v2/`,
    username,
    password
  });
  assert.deepEqual(await client.request("/health?detail=1"), { ok: true });
  const events = [];
  for await (const event of client.streamTask({ project: "synthetic", agent: "synthetic", task: "synthetic" })) {
    events.push(event);
  }

  assert.deepEqual(events, [{ event: "completed" }]);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, "/base/v2/health?detail=1");
  assert.equal(calls[0].authorization, authorization);
  assert.equal(calls[1].url, "/base/v2/api/automation/tasks");
  assert.equal(calls[1].authorization, authorization);
  assert.equal(calls[1].origin, `http://127.0.0.1:${port}`);
  assert.match(calls[1].operationId, /^task-/);
});

test("SDK rejects same-origin absolute URLs and traversal before any localhost request", async t => {
  let requests = 0;
  const server = createServer((req, res) => {
    requests += 1;
    req.resume();
    res.writeHead(200, { "content-type": "application/json" });
    res.end("{\"unexpected\":true}");
  });
  const port = await listen(server);
  t.after(() => closeServer(server));

  const baseUrl = `http://127.0.0.1:${port}/base/v2/`;
  const client = new DevMoterClient({ baseUrl, username, password });
  const invalidPaths = [
    `${baseUrl}ok`,
    "../outside",
    "../../outside",
    "/../outside",
    "/%2e%2e/outside",
    "%252e%252e/outside",
    "%2Foutside",
    "%5coutside",
    "api\\..\\outside",
    `//127.0.0.1:${port}/base/v2/ok`
  ];
  for (const path of invalidPaths) {
    await assert.rejects(client.request(path), error => error.code === "invalid_request_path", path);
  }
  assert.equal(requests, 0);
});

test("SDK keeps its import-captured transport after global fetch is replaced", async t => {
  let requests = 0;
  const server = createServer((req, res) => {
    requests += 1;
    req.resume();
    if (req.url === "/base/v2/api/automation/tasks") {
      res.writeHead(200, { "content-type": "application/x-ndjson" });
      res.end("{\"event\":\"completed\"}\n");
    } else {
      res.writeHead(200, { "content-type": "application/json" });
      res.end("{\"ok\":true}");
    }
  });
  const port = await listen(server);
  t.after(() => closeServer(server));

  const originalFetch = globalThis.fetch;
  let replacementCalls = 0;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async () => {
    replacementCalls += 1;
    throw new Error("synthetic replacement fetch must not be used");
  };

  const client = new DevMoterClient({
    baseUrl: `http://127.0.0.1:${port}/base/v2/`,
    username,
    password
  });
  assert.deepEqual(await client.request("/health"), { ok: true });
  const events = [];
  for await (const event of client.streamTask({ project: "synthetic", agent: "synthetic", task: "synthetic" })) {
    events.push(event);
  }
  assert.deepEqual(events, [{ event: "completed" }]);
  assert.equal(requests, 2);
  assert.equal(replacementCalls, 0);
});

test("captured native fetch rejects redirects for request and streamTask without contacting destination", async t => {
  const statuses = [301, 302, 303, 307, 308];
  const queuedStatuses = [];
  const sourceRequests = [];
  let destinationCalls = 0;
  const destination = createServer((req, res) => {
    destinationCalls += 1;
    res.writeHead(200, { "content-type": "application/json" });
    res.end("{\"unexpected\":true}");
  });
  const destinationPort = await listen(destination);
  const source = createServer((req, res) => {
    req.resume();
    const status = queuedStatuses.shift();
    sourceRequests.push({ status, authorization: req.headers.authorization ?? null });
    res.writeHead(status, { location: `http://127.0.0.1:${destinationPort}/collector` });
    res.end();
  });
  const sourcePort = await listen(source);
  t.after(async () => {
    await closeServer(source);
    await closeServer(destination);
  });

  const client = new DevMoterClient({
    baseUrl: `http://127.0.0.1:${sourcePort}/base/v2/`,
    username,
    password
  });
  for (const status of statuses) {
    queuedStatuses.push(status, status);
    await assert.rejects(
      client.request("/mutate", { method: "POST", body: { synthetic: true } }),
      error => error.code === "redirect_rejected" && error.status === status
    );
    await assert.rejects(async () => {
      for await (const _event of client.streamTask({ project: "synthetic", agent: "synthetic", task: "synthetic" })) {}
    }, error => error.code === "redirect_rejected" && error.status === status);
  }

  assert.equal(queuedStatuses.length, 0);
  assert.equal(sourceRequests.length, statuses.length * 2);
  assert.ok(sourceRequests.every(request => request.authorization === authorization));
  assert.equal(destinationCalls, 0);
});
