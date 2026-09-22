import test from "node:test";
import assert from "node:assert/strict";
import { DevMoterClient, sdkInternals } from "../sdk/index.mjs";
import { parseArgs } from "../cli/devmoter.mjs";

test("SDK uses Basic auth, same-origin mutation headers, and operation ids", async () => {
  const calls = [];
  const client = new DevMoterClient({
    baseUrl: "http://127.0.0.1:8787",
    username: "devmoter",
    password: "0123456789abcdef",
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), init });
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
  });

  await client.projects();
  await client.runTask({
    project: "p1",
    agent: "build",
    backend: "opencode",
    task: "test"
  }, { operationId: "op-fixed" });

  const getHeaders = new Headers(calls[0].init.headers);
  const postHeaders = new Headers(calls[1].init.headers);
  assert.match(getHeaders.get("authorization") || "", /^Basic /);
  assert.equal(getHeaders.get("origin"), null);
  assert.match(postHeaders.get("authorization") || "", /^Basic /);
  assert.equal(postHeaders.get("origin"), "http://127.0.0.1:8787");
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
