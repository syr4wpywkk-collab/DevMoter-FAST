import test from "node:test";
import assert from "node:assert/strict";
import {
  compactOutput,
  publicDefinition,
  publicIntegrationError,
  sanitizeChildEnv,
  validateAntigravityRemoteUrl
} from "../server/integrations.mjs";

test("integration child environment strips DevMoter and OpenCode secrets", () => {
  const env = sanitizeChildEnv({
    PATH: "/usr/bin",
    HOME: "/home/test",
    DEVMOTER_AUTH_PASSWORD: "do-not-leak",
    DEVMOTER_API_TOKEN: "do-not-leak-either",
    POCKET_SESSION_SECRET: "private",
    OPENCODE_SERVER_PASSWORD: "private-upstream",
    ANTHROPIC_API_KEY: "provider-secret",
    GITHUB_TOKEN: "github-secret",
    AWS_SECRET_ACCESS_KEY: "aws-secret",
    NODE_OPTIONS: "--require=/tmp/evil.js",
    LD_PRELOAD: "/tmp/evil.so",
    DISPLAY: ":0"
  });

  assert.equal(env.DEVMOTER_AUTH_PASSWORD, undefined);
  assert.equal(env.DEVMOTER_API_TOKEN, undefined);
  assert.equal(env.POCKET_SESSION_SECRET, undefined);
  assert.equal(env.OPENCODE_SERVER_PASSWORD, undefined);
  assert.equal(env.ANTHROPIC_API_KEY, undefined);
  assert.equal(env.GITHUB_TOKEN, undefined);
  assert.equal(env.AWS_SECRET_ACCESS_KEY, undefined);
  assert.equal(env.NODE_OPTIONS, undefined);
  assert.equal(env.LD_PRELOAD, undefined);
  assert.equal(env.PATH, "/usr/bin");
  assert.equal(env.DISPLAY, ":0");
});

test("Antigravity remote URLs are restricted to the official HTTPS origin", () => {
  assert.equal(
    validateAntigravityRemoteUrl("https://antigravity.google.com/r/instance?p=conversation"),
    "https://antigravity.google.com/r/instance?p=conversation"
  );
  assert.equal(validateAntigravityRemoteUrl("http://antigravity.google.com/r/nope"), null);
  assert.equal(validateAntigravityRemoteUrl("https://evil.example/r/nope"), null);
  assert.equal(validateAntigravityRemoteUrl("https://antigravity.google.com.evil.example/r/nope"), null);
  assert.equal(validateAntigravityRemoteUrl("https://user:pass@antigravity.google.com/r/nope"), null);
});

test("integration output strips terminal controls and stays bounded", () => {
  assert.equal(compactOutput("\u001b[31mhello\u001b[0m\u0007"), "hello");
  assert.equal(compactOutput("abcdef", 3), "abc");
});

test("public integration metadata never exposes executable configuration", () => {
  const value = publicDefinition({
    id: "test",
    name: "Test",
    bin: "/home/user/private/tool",
    versionArgs: ["--secret-version-mode"],
    webUrl: "https://example.test",
    capabilities: { launch: true }
  });

  assert.deepEqual(value, {
    id: "test",
    name: "Test",
    webUrl: "https://example.test",
    capabilities: { launch: true }
  });
  assert.equal("bin" in value, false);
  assert.equal("versionArgs" in value, false);
});

test("unexpected integration failures are not reflected to clients", () => {
  const safe = publicIntegrationError(new Error("/home/user/private/path: secret failure"));
  assert.deepEqual(safe, {
    status: 500,
    error: "Integration operation failed"
  });
});
