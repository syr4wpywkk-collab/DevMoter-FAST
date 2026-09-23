import test from "node:test";
import assert from "node:assert/strict";
import { isAllowedCodexRpc } from "../../server/security-helpers.mjs";

test("Usage can read account rate limits through the RPC allowlist", () => {
  assert.equal(isAllowedCodexRpc("account/rateLimits/read"), true);
});

test("account RPC access remains deny-by-default", () => {
  for (const method of [
    "account/login/start", "account/logout", "account/read",
    "account/rateLimits/write", "account/rateLimits/read/extra",
    " account/rateLimits/read", "account/rateLimits/read ",
    "", null, undefined, 42, {}, ["account/rateLimits/read"]
  ]) {
    assert.equal(isAllowedCodexRpc(method), false, String(method));
  }
  assert.equal(isAllowedCodexRpc("thread/list"), true);
  assert.equal(isAllowedCodexRpc("turn/start"), true);
});
