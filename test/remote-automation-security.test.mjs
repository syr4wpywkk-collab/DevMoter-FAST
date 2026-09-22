import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("only the exact GitHub webhook route bypasses Basic auth for HMAC verification", async () => {
  const source = await readFile(new URL("../server.mjs", import.meta.url), "utf8");
  const handler = source.indexOf("const server = http.createServer");
  const webhook = source.indexOf('req.method === "POST" && url.pathname === "/api/control/events/github"', handler);
  const basic = source.indexOf("authorizeBasicRequest(req, res, AUTH_CONFIG)", handler);
  const origin = source.indexOf("requireSameOriginMutation(req, res, DEVMOTER_PUBLIC_ORIGIN)", handler);
  const passkey = source.indexOf("if (await passkeyRoute(req, res, url)) return", handler);
  const control = source.indexOf("if (await controlRoute(req, res, url)) return", handler);

  assert.ok(handler >= 0);
  assert.ok(webhook > handler && webhook < basic, "exact HMAC webhook must be routed before Basic auth");
  assert.ok(origin > basic, "normal mutations must still pass same-origin checks");
  assert.ok(passkey > origin, "passkey ceremonies must remain behind Basic + same-origin auth");
  assert.ok(control > passkey, "normal control-plane routes must remain behind both auth layers");

  const bypassRegion = source.slice(handler, basic);
  assert.match(bypassRegion, /githubWebhookRoute\(req, res\)/);
  assert.doesNotMatch(bypassRegion, /pathname\.startsWith\("\/api\/control/);
});

test("webhook handler requires GitHub event and HMAC signature headers", async () => {
  const source = await readFile(new URL("../server.mjs", import.meta.url), "utf8");
  const start = source.indexOf("async function githubWebhookRoute");
  const end = source.indexOf("async function proxy", start);
  const body = source.slice(start, end);

  assert.match(body, /x-github-event/);
  assert.match(body, /x-hub-signature-256/);
  assert.match(body, /64 \* 1024/);
  assert.match(body, /dispatchEvent\(\s*"github\.webhook"/);
});
