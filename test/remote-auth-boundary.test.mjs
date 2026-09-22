import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("only the exact GitHub webhook route is handled before Basic auth", async () => {
  const source = await readFile(new URL("../server.mjs", import.meta.url), "utf8");
  const serverStart = source.indexOf("const server = http.createServer");
  const webhook = source.indexOf('url.pathname === "/api/control/events/github"', serverStart);
  const auth = source.indexOf("authorizeBasicRequest", serverStart);
  const origin = source.indexOf("requireSameOriginMutation", serverStart);
  const passkey = source.indexOf("await passkeyRoute(req, res, url)", serverStart);
  const control = source.indexOf("await controlRoute(req, res, url)", serverStart);

  assert.ok(webhook > serverStart && webhook < auth);
  assert.ok(auth < origin);
  assert.ok(origin < passkey);
  assert.ok(passkey < control);
  assert.equal(source.indexOf('url.pathname === "/api/control/events/github"', webhook + 1), -1);
});

test("control-plane task execution explicitly reuses backend context", async () => {
  const source = await readFile(new URL("../server.mjs", import.meta.url), "utf8");
  assert.match(source, /context\?\.backendContext\?\.backend === "opencode"/);
  assert.match(source, /context\?\.backendContext\?\.backend === "codex"/);
  assert.match(source, /setBackendContext\?\.\(backendContext\)/);
  assert.match(source, /context: backendContext/);
});

test("passkey and control APIs stay behind Basic auth and same-origin mutation checks", async () => {
  const source = await readFile(new URL("../server.mjs", import.meta.url), "utf8");
  const serverStart = source.indexOf("const server = http.createServer");
  const auth = source.indexOf("authorizeBasicRequest", serverStart);
  const origin = source.indexOf("requireSameOriginMutation", serverStart);
  const passkey = source.indexOf("await passkeyRoute(req, res, url)", serverStart);
  const control = source.indexOf("await controlRoute(req, res, url)", serverStart);
  assert.ok(passkey > auth && passkey > origin);
  assert.ok(control > auth && control > origin);
});
