import test from "node:test";
import assert from "node:assert/strict";
import { assertAuthPassword, credentialsMatch, MAX_CREDENTIAL_BYTES } from "../server/auth.mjs";
import { errorMessage } from "../server/error-message.mjs";

const expected = { username: "devmoter", password: "correct-horse-battery-staple" };

test("credentials compare exactly, including length", () => {
  assert.equal(credentialsMatch({ ...expected }, expected), true);
  assert.equal(credentialsMatch({ username: "devmoter", password: "correct-horse-battery-stapl" }, expected), false);
  assert.equal(credentialsMatch({ username: "devmoter", password: "correct-horse-battery-staple!" }, expected), false);
  assert.equal(credentialsMatch({ username: "devmoter\0", password: expected.password }, expected), false);
  assert.equal(credentialsMatch({ username: "Devmoter", password: expected.password }, expected), false);
  assert.equal(credentialsMatch(null, expected), false);
});

test("oversized credentials never match and oversized passwords are rejected at startup", () => {
  const long = "x".repeat(MAX_CREDENTIAL_BYTES + 1);
  assert.equal(credentialsMatch({ username: "devmoter", password: long }, { username: "devmoter", password: long }), false);
  assert.throws(() => assertAuthPassword(long), /at most/);
  assert.equal(assertAuthPassword("x".repeat(MAX_CREDENTIAL_BYTES)).length, MAX_CREDENTIAL_BYTES);
});

test("errorMessage exposes only an Error's message", () => {
  assert.equal(errorMessage(new Error("boom")), "boom");
  assert.equal(errorMessage("Error: x\n    at secret (/home/u/app.js:1:1)"), "Unexpected error");
  assert.equal(errorMessage({ stack: "at secret" }, "Failed"), "Failed");
  assert.equal(errorMessage(new Error("")), "Unexpected error");
});

test("registered host health URL is rebuilt from the parsed address", async () => {
  const { hostHealthUrl } = await import("../server/control-plane.mjs");
  assert.equal(hostHealthUrl("https://devbox.tail1234.ts.net/"), "https://devbox.tail1234.ts.net/api/health");
  assert.equal(hostHealthUrl("http://10.0.0.5:8787/devmoter/?x=1#y"), "http://10.0.0.5:8787/devmoter/api/health");
  assert.throws(() => hostHealthUrl("file:///etc/passwd"), /http or https/);
  assert.throws(() => hostHealthUrl("https://u:p@devbox/"), /Credentials/);
});
