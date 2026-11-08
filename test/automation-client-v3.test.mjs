import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { DevMoterClient, sdkInternals } from "../sdk/index.mjs";
import { parseArgs } from "../cli/devmoter.mjs";

test("SDK uses Basic auth, same-origin mutation headers, and operation ids", async t => {
  const calls = [];
  const server = createServer((req, res) => {
    const chunks = [];
    req.on("data", chunk => chunks.push(chunk));
    req.on("end", () => {
      calls.push({
        url: req.url,
        method: req.method,
        headers: req.headers,
        body: Buffer.concat(chunks).toString("utf8")
      });
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(async () => {
    const closed = new Promise(resolve => server.close(resolve));
    server.closeAllConnections?.();
    await closed;
  });

  const client = new DevMoterClient({
    baseUrl: `http://127.0.0.1:${server.address().port}`,
    username: "devmoter",
    password: "0123456789abcdef"
  });

  await client.projects();
  await client.runTask({
    project: "p1",
    agent: "build",
    backend: "opencode",
    task: "test"
  }, { operationId: "op-fixed" });

  const getHeaders = new Headers(calls[0].headers);
  const postHeaders = new Headers(calls[1].headers);
  assert.match(getHeaders.get("authorization") || "", /^Basic /);
  assert.equal(getHeaders.get("origin"), null);
  assert.match(postHeaders.get("authorization") || "", /^Basic /);
  assert.equal(postHeaders.get("origin"), `http://127.0.0.1:${server.address().port}`);
  assert.equal(postHeaders.get("x-pocket-operation-id"), "op-fixed");
  assert.equal(
    Buffer.from((postHeaders.get("authorization") || "").slice(6), "base64").toString("utf8"),
    "devmoter:0123456789abcdef"
  );
});

test("SDK refuses insecure non-loopback HTTP targets and URL credentials", () => {
  assert.throws(
    () => new DevMoterClient({ baseUrl: "http://example.test:8787" }),
    /requires HTTPS/
  );
  assert.throws(
    () => new DevMoterClient({ baseUrl: "https://user:pass@example.test" }),
    /embed DevMoter credentials/
  );
  assert.doesNotThrow(
    () => new DevMoterClient({ baseUrl: "https://example.test" })
  );
});

test("CLI no longer exposes bearer token options", () => {
  const parsed = parseArgs([
    "task",
    "--project", "p",
    "--agent", "build",
    "--task", "run",
    "--password-file", "/tmp/devmoter-password"
  ]);
  assert.equal(parsed.options["password-file"], "/tmp/devmoter-password");
  assert.equal(parsed.options.token, undefined);
});

test("SDK helper classifies mutation methods", () => {
  assert.equal(sdkInternals.isMutation("GET"), false);
  assert.equal(sdkInternals.isMutation("HEAD"), false);
  assert.equal(sdkInternals.isMutation("POST"), true);
});
