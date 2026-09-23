import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("only the exact GitHub webhook bypasses owner auth outside explicit login routes", async () => {
  const source = await readFile(new URL("../server.mjs", import.meta.url), "utf8");
  const handler = source.indexOf("const server = http.createServer");
  const webhook = source.indexOf('req.method === "POST" && url.pathname === "/api/control/events/github"', handler);
  const login = source.indexOf('url.pathname === "/login.html"', handler);
  const owner = source.indexOf("if (!basicAuthenticated && !ownerSession)", handler);
  const origin = source.indexOf("requireSameOriginMutation(req, res, DEVMOTER_PUBLIC_ORIGIN)", owner);
  const passkey = source.indexOf("if (await passkeyRoute(req, res, url)) return", handler);
  const control = source.indexOf("if (await controlRoute(req, res, url)) return", handler);

  assert.ok(handler >= 0);
  assert.ok(webhook > handler && webhook < login, "exact HMAC webhook must be routed before login/auth handling");
  assert.ok(owner > login, "owner auth must follow only explicit login routes");
  assert.ok(origin > owner, "normal mutations must still pass same-origin checks");
  assert.ok(passkey > origin, "passkey ceremonies must remain behind owner + same-origin auth");
  assert.ok(control > passkey, "normal control-plane routes must remain behind both auth layers");

  const webhookRegion = source.slice(handler, login);
  assert.match(webhookRegion, /githubWebhookRoute\(req, res\)/);
  assert.doesNotMatch(webhookRegion, /pathname\.startsWith\("\/api\/control/);
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
