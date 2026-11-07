import test from "node:test";
import assert from "node:assert/strict";
import { DevMoterClient, DevMoterError } from "../sdk/index.mjs";

function recordingFetch() {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), headers: new Headers(init.headers) });
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } });
  };
  return { calls, fetchImpl };
}

test("SDK sends credentials for paths on the configured origin", async () => {
  const { calls, fetchImpl } = recordingFetch();
  const client = new DevMoterClient({ baseUrl: "http://127.0.0.1:8787", password: "synthetic-secret", fetchImpl });
  await client.request("/api/health");
  await client.request("api/health");
  assert.equal(calls.length, 2);
  for (const call of calls) {
    assert.equal(new URL(call.url).origin, "http://127.0.0.1:8787");
    assert.match(call.headers.get("authorization") || "", /^Basic /);
  }
});

test("SDK refuses request URLs outside the configured origin before any network call", async () => {
  const { calls, fetchImpl } = recordingFetch();
  const client = new DevMoterClient({ baseUrl: "https://devmoter.example.ts.net", password: "synthetic-secret", fetchImpl });
  for (const target of [
    "https://other.example.invalid/api/health",
    "http://devmoter.example.ts.net/api/health",
    "https://devmoter.example.ts.net:8443/api/health"
  ]) {
    await assert.rejects(
      client.request(target),
      error => error instanceof DevMoterError && error.code === "invalid_request_url"
    );
  }
  assert.equal(calls.length, 0);
});
