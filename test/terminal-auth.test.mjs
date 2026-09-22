import test from "node:test";
import assert from "node:assert/strict";
import { authenticateTerminalRequest } from "../server/terminal.mjs";

function requestWithPassword(password) {
  const token = Buffer.from(`devmoter:${password}`, "utf8").toString("base64");
  return {
    headers: {
      authorization: `Basic ${token}`
    }
  };
}

test("terminal authentication fails closed when password is not configured", () => {
  const result = authenticateTerminalRequest({ headers: {} }, "");
  assert.equal(result.ok, false);
  assert.equal(result.status, 503);
  assert.match(result.error, /DEVMOTER_AUTH_PASSWORD/);
});

test("terminal authentication rejects bad password and accepts exact password", () => {
  const configured = "correct-horse-battery";
  const bad = authenticateTerminalRequest(requestWithPassword("wrong-password"), configured);
  assert.equal(bad.ok, false);
  assert.equal(bad.status, 401);

  const good = authenticateTerminalRequest(requestWithPassword(configured), configured);
  assert.deepEqual(good, { ok: true });
});
