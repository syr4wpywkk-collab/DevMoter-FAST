import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ExternalAuth } from "../server/external-auth.mjs";

function request({ cookie = "", host = "devmoter.test" } = {}) {
  return {
    headers: {
      host,
      ...(cookie ? { cookie } : {})
    },
    socket: {}
  };
}

function jsonResponse(body, ok = true) {
  return {
    ok,
    async json() {
      return body;
    }
  };
}

test("local recovery credentials mint an HttpOnly owner session", async t => {
  const dir = await mkdtemp(join(tmpdir(), "devmoter-auth-local-"));
  t.after(() => rm(dir, { recursive: true, force: true }));

  const auth = new ExternalAuth({ configDir: dir, fetchImpl: async () => {
    throw new Error("network should not be used");
  }});
  const expected = {
    username: "devmoter",
    password: "correct-horse-battery-staple"
  };

  await assert.rejects(
    () => auth.localLogin(request(), { username: "devmoter", password: "wrong" }, expected),
    error => error?.status === 401
  );

  const result = await auth.localLogin(
    request(),
    { username: "devmoter", password: "correct-horse-battery-staple" },
    expected
  );
  assert.match(result.cookie, /^devmoter_session=/);
  assert.match(result.cookie, /HttpOnly/);
  assert.match(result.cookie, /SameSite=Strict/);
  assert.equal(result.identity.provider, "local");

  const cookieHeader = result.cookie.split(";", 1)[0];
  const session = await auth.session(request({ cookie: cookieHeader }));
  assert.equal(session?.identity?.login, "devmoter");
});

test("first GitHub owner bind requires bootstrap and never persists the OAuth token", async t => {
  const dir = await mkdtemp(join(tmpdir(), "devmoter-auth-github-"));
  t.after(() => rm(dir, { recursive: true, force: true }));

  const calls = [];
  const auth = new ExternalAuth({
    configDir: dir,
    githubClientId: "client-id",
    fetchImpl: async (url, init = {}) => {
      calls.push({ url: String(url), authorization: init?.headers?.authorization || "" });
      if (String(url).endsWith("/login/device/code")) {
        return jsonResponse({
          device_code: "secret-device-code",
          user_code: "ABCD-EFGH",
          verification_uri: "https://github.com/login/device",
          expires_in: 900,
          interval: 5
        });
      }
      if (String(url).endsWith("/login/oauth/access_token")) {
        return jsonResponse({ access_token: "gho_super_secret_token", token_type: "bearer" });
      }
      if (String(url) === "https://api.github.com/user") {
        assert.equal(init.headers.authorization, "Bearer gho_super_secret_token");
        return jsonResponse({
          id: 12345,
          login: "owner-login",
          name: "Owner",
          avatar_url: "https://avatars.example/owner"
        });
      }
      throw new Error("unexpected URL " + url);
    }
  });

  await assert.rejects(
    () => auth.startGithub(request()),
    error => error?.status === 403
  );

  const start = await auth.startGithub(request(), { bootstrapAuthorized: true });
  assert.equal(start.userCode, "ABCD-EFGH");
  assert.equal(start.verificationUri, "https://github.com/login/device");
  assert.equal("deviceCode" in start, false);
  assert.equal(JSON.stringify(start).includes("secret-device-code"), false);

  auth.githubFlows.get(start.flowId).nextPollAt = 0;
  const result = await auth.pollGithub(request(), start.flowId);
  assert.equal(result.status, "complete");
  assert.equal(result.identity.provider, "github");
  assert.equal(result.identity.login, "owner-login");
  assert.match(result.cookie, /^devmoter_session=/);

  const stored = await readFile(join(dir, "auth-identities.json"), "utf8");
  assert.match(stored, /owner-login/);
  assert.equal(stored.includes("gho_super_secret_token"), false);
  assert.equal(stored.includes("secret-device-code"), false);

  const cookieHeader = result.cookie.split(";", 1)[0];
  const status = await auth.status(request({ cookie: cookieHeader }));
  assert.equal(status.authenticated, true);
  assert.equal(status.github.bound, true);
  assert.equal(status.identity.login, "owner-login");
  assert.equal(calls.some(call => call.authorization.includes("gho_super_secret_token")), true);
});

test("GitHub login rejects an account different from the bound owner", async t => {
  const dir = await mkdtemp(join(tmpdir(), "devmoter-auth-owner-"));
  t.after(() => rm(dir, { recursive: true, force: true }));

  let identity = { id: 1, login: "first-owner", name: "First" };
  const fetchImpl = async url => {
    if (String(url).endsWith("/login/device/code")) {
      return jsonResponse({
        device_code: "device",
        user_code: "CODE-1111",
        verification_uri: "https://github.com/login/device",
        expires_in: 900,
        interval: 5
      });
    }
    if (String(url).endsWith("/login/oauth/access_token")) {
      return jsonResponse({ access_token: "token" });
    }
    if (String(url) === "https://api.github.com/user") return jsonResponse(identity);
    throw new Error("unexpected URL");
  };

  const first = new ExternalAuth({ configDir: dir, githubClientId: "client-id", fetchImpl });
  const firstStart = await first.startGithub(request(), { bootstrapAuthorized: true });
  first.githubFlows.get(firstStart.flowId).nextPollAt = 0;
  await first.pollGithub(request(), firstStart.flowId);

  identity = { id: 2, login: "someone-else", name: "Other" };
  const second = new ExternalAuth({ configDir: dir, githubClientId: "client-id", fetchImpl });
  const secondStart = await second.startGithub(request());
  second.githubFlows.get(secondStart.flowId).nextPollAt = 0;
  await assert.rejects(
    () => second.pollGithub(request(), secondStart.flowId),
    error => error?.status === 403 && /bound DevMoter owner/.test(error.message)
  );
});

test("GitHub polling obeys server interval and slow_down", async t => {
  const dir = await mkdtemp(join(tmpdir(), "devmoter-auth-poll-"));
  t.after(() => rm(dir, { recursive: true, force: true }));

  let tokenPolls = 0;
  const auth = new ExternalAuth({
    configDir: dir,
    githubClientId: "client-id",
    fetchImpl: async url => {
      if (String(url).endsWith("/login/device/code")) {
        return jsonResponse({
          device_code: "device",
          user_code: "CODE-2222",
          verification_uri: "https://github.com/login/device",
          expires_in: 900,
          interval: 5
        });
      }
      if (String(url).endsWith("/login/oauth/access_token")) {
        tokenPolls += 1;
        return jsonResponse({ error: "slow_down" });
      }
      throw new Error("unexpected URL");
    }
  });

  const start = await auth.startGithub(request(), { bootstrapAuthorized: true });
  const flow = auth.githubFlows.get(start.flowId);
  flow.nextPollAt = Date.now() + 20_000;

  const early = await auth.pollGithub(request(), start.flowId);
  assert.equal(early.status, "pending");
  assert.equal(tokenPolls, 0);

  flow.nextPollAt = 0;
  const before = flow.intervalMs;
  const slowed = await auth.pollGithub(request(), start.flowId);
  assert.equal(slowed.status, "pending");
  assert.equal(tokenPolls, 1);
  assert.equal(flow.intervalMs, before + 5_000);
  assert.ok(slowed.retryAfterMs >= before + 5_000);
});
