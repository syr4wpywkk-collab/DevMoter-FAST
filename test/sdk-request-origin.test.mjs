import test from "node:test";
import assert from "node:assert/strict";
import { DevMoterClient, DevMoterError } from "../sdk/index.mjs";

function client(fetchImpl) {
  return new DevMoterClient({
    baseUrl: "http://127.0.0.1:8787",
    username: "devmoter",
    password: "0123456789abcdef",
    fetchImpl
  });
}

test("SDK sends credentials only for the configured origin", async () => {
  let seen = 0;
  const api = client(async () => {
    seen += 1;
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  });
  await api.request("/api/health");
  await api.request("http://127.0.0.1:8787/api/health");
  assert.equal(seen, 2);
});

test("SDK refuses another host, scheme, or port before any request", async () => {
  const paths = [
    "https://evil.example/api/health",
    "http://evil.example/api/health",
    "http://127.0.0.1:9/api/health",
    "https://127.0.0.1:8787/api/health"
  ];
  for (const path of paths) {
    let seen = 0;
    const api = client(async () => {
      seen += 1;
      return new Response("{}", { status: 200 });
    });
    await assert.rejects(
      () => api.request(path),
      error => error instanceof DevMoterError && error.code === "invalid_request_url"
    );
    assert.equal(seen, 0);
  }
});
