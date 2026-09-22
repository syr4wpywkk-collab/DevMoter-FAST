import test from "node:test";
import assert from "node:assert/strict";
import {
  assertAuthPassword,
  credentialsMatch,
  expectedRequestOrigin,
  mutationOriginMatches,
  parseBasicAuthorization
} from "../server/auth.mjs";

test("DevMoter auth password fails closed when weak or missing", () => {
  assert.throws(() => assertAuthPassword(""), /at least 16 characters/);
  assert.throws(() => assertAuthPassword("too-short"), /at least 16 characters/);
  assert.equal(
    assertAuthPassword("correct-horse-battery-staple"),
    "correct-horse-battery-staple"
  );
});

test("Basic authorization parses and compares credentials", () => {
  const header = `Basic ${Buffer.from("devmoter:correct-horse-battery-staple").toString("base64")}`;
  const parsed = parseBasicAuthorization(header);
  assert.deepEqual(parsed, {
    username: "devmoter",
    password: "correct-horse-battery-staple"
  });
  assert.equal(
    credentialsMatch(parsed, {
      username: "devmoter",
      password: "correct-horse-battery-staple"
    }),
    true
  );
  assert.equal(
    credentialsMatch(parsed, {
      username: "devmoter",
      password: "wrong-password-value"
    }),
    false
  );
  assert.equal(parseBasicAuthorization("Bearer nope"), null);
});

test("expected origin honors reverse-proxy headers and explicit public origin", () => {
  const req = {
    headers: {
      host: "127.0.0.1:8787",
      "x-forwarded-proto": "https",
      "x-forwarded-host": "devmoter.example.test"
    },
    socket: {}
  };
  assert.equal(expectedRequestOrigin(req), "https://devmoter.example.test");
  assert.equal(
    expectedRequestOrigin(req, "https://pocket.example.test/path"),
    "https://pocket.example.test"
  );
});

test("mutating requests require an exact same Origin", () => {
  const base = {
    method: "POST",
    headers: {
      host: "127.0.0.1:8787",
      origin: "http://127.0.0.1:8787"
    },
    socket: {}
  };
  assert.equal(mutationOriginMatches(base), true);
  assert.equal(
    mutationOriginMatches({
      ...base,
      headers: { ...base.headers, origin: "https://evil.example" }
    }),
    false
  );
  assert.equal(
    mutationOriginMatches({
      ...base,
      headers: { host: "127.0.0.1:8787" }
    }),
    false
  );
  assert.equal(
    mutationOriginMatches({
      ...base,
      method: "GET",
      headers: { host: "127.0.0.1:8787" }
    }),
    true
  );
});
