import test from "node:test";
import assert from "node:assert/strict";
import {
  ALLOW_INSECURE_HTTP_ENV,
  assertAuthPassword,
  assertSafeHttpBind,
  credentialsMatch,
  evaluateHttpBindSafety,
  expectedRequestOrigin,
  isLoopbackAddress,
  isLoopbackBindHost,
  mutationOriginMatches,
  parseBasicAuthorization
} from "../server/auth.mjs";
import {
  createStreamingBufferRedactor,
  createStreamingTextRedactor,
  redactSecretsInText
} from "../server/secret-redaction.mjs";

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

test("configured secrets are redacted from browser/log text", () => {
  const secret = 's3cret-"quoted"-value';
  const text = redactSecretsInText(
    `upstream failed with credential ${secret} in response`,
    [secret]
  );
  assert.equal(text.includes(secret), false);
  assert.match(text, /\[REDACTED\]/);
});

test("streaming text and buffer redactors mask split secrets without holding normal SSE frames", () => {
  const secret = 'sentinel-"secret"-576';
  const redactor = createStreamingTextRedactor([secret]);

  // Normal SSE frame that does not end in a prefix of the secret flushes immediately.
  assert.equal(redactor.push("data: hold\n\n"), "data: hold\n\n");

  // Secret split across chunks (and JSON-escaped) is masked cleanly across SSE boundaries.
  const jsonEscaped = JSON.stringify(secret).slice(1, -1);
  const splitAt = 10;
  const part1 = redactor.push(`data: {"token":"${jsonEscaped.slice(0, splitAt)}`);
  const part2 = redactor.push(`${jsonEscaped.slice(splitAt)}"}\n\n`);
  const tail = redactor.flush();
  const full = part1 + part2 + tail;
  assert.equal(full, 'data: {"token":"[REDACTED]"}\n\n');
  assert.equal(full.includes(secret), false);
  assert.equal(full.includes(jsonEscaped), false);

  // Buffer redactor masks split secret bytes without altering arbitrary binary bytes.
  const binSecret = "binary-secret-token-576";
  const bufRedactor = createStreamingBufferRedactor([binSecret]);
  const b1 = bufRedactor.push(Buffer.concat([Buffer.from([0xff, 0x00, 0x80]), Buffer.from(binSecret.slice(0, 7))]));
  const b2 = bufRedactor.push(Buffer.concat([Buffer.from(binSecret.slice(7)), Buffer.from([0xfe, 0x01])]));
  const bTail = bufRedactor.flush();
  const fullBuf = Buffer.concat([b1, b2, bTail]);
  assert.equal(fullBuf.includes(Buffer.from(binSecret)), false);
  assert.deepEqual(
    fullBuf,
    Buffer.concat([Buffer.from([0xff, 0x00, 0x80]), Buffer.from("[REDACTED]"), Buffer.from([0xfe, 0x01])])
  );
});

test("loopback detection covers 127.0.0.0/8, localhost, ::1, and [::1] and rejects lookalikes", () => {
  for (const addr of ["127.0.0.1", "127.0.0.0", "127.0.1.1", "127.255.255.254", "::1", "[::1]", "0:0:0:0:0:0:0:1", "::ffff:127.0.0.1", "::ffff:127.1.2.3"]) {
    assert.equal(isLoopbackAddress(addr), true, `expected ${addr} to be loopback address`);
    assert.equal(isLoopbackBindHost(addr), true, `expected ${addr} to be loopback bind host`);
  }
  assert.equal(isLoopbackAddress("localhost"), false);
  assert.equal(isLoopbackBindHost("localhost"), true);
  assert.equal(isLoopbackBindHost("LOCALHOST"), true);

  for (const nonLoopback of [
    "0.0.0.0",
    "::",
    "[::]",
    "192.168.1.10",
    "10.0.0.5",
    "100.64.0.1",
    "126.0.0.1",
    "128.0.0.1",
    "127.0.0.1.nip.io",
    "localhost.evil.com",
    "127.1",
    "[127.0.0.1]",
    "::ffff:7f:0",
    "::ffff:128.0.0.1",
    "",
    "   ",
    null,
    undefined
  ]) {
    assert.equal(isLoopbackAddress(nonLoopback), false, `expected ${String(nonLoopback)} not to be loopback address`);
    assert.equal(isLoopbackBindHost(nonLoopback), false, `expected ${String(nonLoopback)} not to be loopback bind host`);
  }
});

test("non-loopback HTTP binds require DEVMOTER_ALLOW_INSECURE_HTTP=1 and ignore DEVMOTER_PUBLIC_ORIGIN", () => {
  for (const host of ["127.0.0.1", "127.0.1.1", "localhost", "::1", "[::1]"]) {
    const warnings = [];
    const result = assertSafeHttpBind(
      host,
      { DEVMOTER_PUBLIC_ORIGIN: "https://device.tailnet.ts.net" },
      { warn: msg => warnings.push(msg) }
    );
    assert.equal(result.ok, true);
    assert.equal(result.loopback, true);
    assert.equal(result.warning, null);
    assert.equal(result.error, null);
    assert.deepEqual(warnings, []);
  }

  for (const host of ["0.0.0.0", "::", "192.168.1.20", "100.64.0.1", ""]) {
    for (const env of [
      {},
      { DEVMOTER_PUBLIC_ORIGIN: "https://device.tailnet.ts.net" },
      { [ALLOW_INSECURE_HTTP_ENV]: "true" },
      { [ALLOW_INSECURE_HTTP_ENV]: "0" }
    ]) {
      const evaluated = evaluateHttpBindSafety(host, env);
      assert.equal(evaluated.ok, false);
      assert.equal(evaluated.loopback, false);
      assert.match(evaluated.error, /unencrypted/i);
      assert.match(evaluated.error, /Basic/i);
      assert.match(evaluated.error, /DEVMOTER_ALLOW_INSECURE_HTTP=1/);

      const warnings = [];
      assert.throws(
        () => assertSafeHttpBind(host, env, { warn: msg => warnings.push(msg) }),
        /Basic auth credentials will traverse the network unencrypted.*DEVMOTER_ALLOW_INSECURE_HTTP=1/s
      );
      assert.deepEqual(warnings, []);
    }
  }

  const warnings = [];
  const allowed = assertSafeHttpBind(
    "0.0.0.0",
    { [ALLOW_INSECURE_HTTP_ENV]: "1" },
    { warn: msg => warnings.push(msg) }
  );
  assert.equal(allowed.ok, true);
  assert.equal(allowed.loopback, false);
  assert.equal(allowed.error, null);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /Basic auth credentials will traverse the network unencrypted over plain HTTP/);
  assert.match(warnings[0], /DEVMOTER_ALLOW_INSECURE_HTTP=1/);
});
