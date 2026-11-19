import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter, once } from "node:events";
import { chmod, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { AcpAdapter, acpChildEnv, createAgentAdapterRegistry } from "../server/acp-adapter.mjs";

function fakeAcpChild(onMessage) {
  const child = new EventEmitter();
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.killed = false;
  child.kill = () => {
    child.killed = true;
    return true;
  };

  let buffer = "";
  child.stdin.on("data", chunk => {
    buffer += chunk.toString("utf8");
    while (buffer.includes("\n")) {
      const index = buffer.indexOf("\n");
      const line = buffer.slice(0, index);
      buffer = buffer.slice(index + 1);
      if (!line.trim()) continue;
      onMessage(JSON.parse(line), message => {
        child.stdout.write(JSON.stringify(message) + "\n");
      });
    }
  });
  return child;
}

test("ACP adapter performs v1 initialize and creates a session over stdio JSON-RPC", async () => {
  const seen = [];
  const child = fakeAcpChild((message, respond) => {
    seen.push(message);
    if (message.method === "initialize") {
      respond({
        jsonrpc: "2.0",
        id: message.id,
        result: {
          protocolVersion: 1,
          agentCapabilities: { loadSession: true },
          authMethods: []
        }
      });
    }
    if (message.method === "session/new") {
      respond({
        jsonrpc: "2.0",
        id: message.id,
        result: { sessionId: "session-1" }
      });
    }
  });

  const adapter = new AcpAdapter({
    command: "fake-acp",
    cwd: "/workspace",
    spawnImpl: () => child
  });

  const init = await adapter.connect();
  assert.equal(init.protocolVersion, 1);
  assert.equal(seen[0].jsonrpc, "2.0");
  assert.equal(seen[0].params.clientCapabilities.terminal, false);

  const session = await adapter.newSession({ cwd: "/workspace", mcpServers: [] });
  assert.equal(session.sessionId, "session-1");
  assert.equal(seen[1].method, "session/new");
  assert.equal(seen[1].params.cwd, "/workspace");

  adapter.close();
});

test("ACP adapter refuses relative session cwd", async () => {
  const adapter = new AcpAdapter({ command: "unused" });
  await assert.rejects(adapter.newSession({ cwd: "relative" }), /absolute/);
});

test("adapter registry keeps native adapters ahead of optional ACP", () => {
  const adapters = createAgentAdapterRegistry({
    adapters: {
      acp: {
        enabled: true,
        command: "agent",
        args: ["--acp"],
        capabilities: ["chat"]
      }
    }
  });

  assert.deepEqual(adapters.map(item => item.id), ["codex", "opencode", "acp"]);
  assert.equal(adapters[0].native, true);
  assert.equal(adapters[2].native, false);
  assert.equal(adapters[2].enabled, true);
});

function setTempProcessEnv(t, overrides) {
  const previous = new Map();
  for (const [key, value] of Object.entries(overrides)) {
    previous.set(key, Object.hasOwn(process.env, key) ? process.env[key] : undefined);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  t.after(() => {
    for (const [key, value] of previous.entries()) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

async function closeRealAdapter(adapter) {
  const child = adapter.child;
  const exited = child && child.exitCode === null && child.signalCode === null
    ? once(child, "exit").catch(() => {})
    : Promise.resolve();
  adapter.close();
  await exited;
}

test("acpChildEnv allowlists operational CLI variables and excludes parent secrets and arbitrary sentinels", () => {
  const allowedVars = {
    PATH: "/usr/local/bin:/usr/bin",
    HOME: "/home/devmoter",
    USER: "devmoter",
    LOGNAME: "devmoter",
    SHELL: "/bin/bash",
    TERM: "xterm-256color",
    COLORTERM: "truecolor",
    NO_COLOR: "1",
    LANG: "C.UTF-8",
    LANGUAGE: "en_US:en",
    TZ: "UTC",
    TMPDIR: "/tmp/custom-tmp",
    TMP: "/tmp/custom-tmp",
    TEMP: "/tmp/custom-tmp",
    LC_ALL: "C.UTF-8",
    LC_CTYPE: "en_US.UTF-8",
    LC_MESSAGES: "en_US.UTF-8",
    XDG_CONFIG_HOME: "/home/devmoter/.config",
    XDG_DATA_HOME: "/home/devmoter/.local/share",
    XDG_STATE_HOME: "/home/devmoter/.local/state",
    XDG_CACHE_HOME: "/home/devmoter/.cache",
    XDG_RUNTIME_DIR: "/run/user/1000",
    XDG_CONFIG_DIRS: "/etc/xdg",
    XDG_DATA_DIRS: "/usr/local/share:/usr/share"
  };
  const blockedVars = {
    DEVMOTER_AUTH_PASSWORD: "owner-password-secret",
    DEVMOTER_API_TOKEN: "devmoter-token-secret",
    DEVMOTER_GOOGLE_CLIENT_SECRET: "google-oauth-secret",
    DEVMOTER_MICROSOFT_CLIENT_SECRET: "microsoft-oauth-secret",
    OPENCODE_SERVER_PASSWORD: "opencode-server-password",
    OPENCODE_SERVER_USERNAME: "opencode-admin",
    OAUTH_CLIENT_SECRET: "oauth-client-secret",
    OIDC_CLIENT_SECRET: "oidc-client-secret",
    CLIENT_SECRET: "generic-client-secret",
    OPENAI_API_KEY: "sk-test-openai",
    ANTHROPIC_API_KEY: "sk-ant-test",
    GITHUB_TOKEN: "ghp_testtoken",
    AWS_SECRET_ACCESS_KEY: "aws-secret",
    NODE_OPTIONS: "--require=/tmp/evil.js",
    LD_PRELOAD: "/tmp/evil.so",
    LD_LIBRARY_PATH: "/tmp/evil-lib",
    DYLD_INSERT_LIBRARIES: "/tmp/evil.dylib",
    BASH_ENV: "/tmp/evil.sh",
    ENV: "/tmp/evil.sh",
    PROMPT_COMMAND: "evil",
    PYTHONPATH: "/tmp/evil-py",
    LC_SECRET: "not-a-posix-locale",
    XDG_SECRET_TOKEN: "not-an-xdg-dir",
    ARBITRARY_SENTINEL_SECRET: "sentinel-value",
    CUSTOM_PARENT_FLAG: "must-not-inherit"
  };

  const result = acpChildEnv({ ...allowedVars, ...blockedVars });
  assert.deepEqual(result, allowedVars);
  for (const key of Object.keys(blockedVars)) {
    assert.equal(Object.hasOwn(result, key), false, `${key} must not be inherited`);
  }
});

test("acpChildEnv honors explicit per-agent env entries without merging parent env", () => {
  const baseEnv = {
    PATH: "/usr/bin",
    HOME: "/home/devmoter",
    TERM: "xterm-256color",
    DEVMOTER_AUTH_PASSWORD: "parent-password",
    OPENCODE_SERVER_PASSWORD: "parent-opencode-password",
    ARBITRARY_SENTINEL: "parent-sentinel"
  };
  const explicitEnv = {
    ACP_AGENT_API_KEY: "explicit-agent-key",
    ACP_ENDPOINT: "https://agent.internal",
    TERM: "dumb",
    HOME: undefined
  };

  const result = acpChildEnv(baseEnv, explicitEnv);
  assert.deepEqual(result, {
    PATH: "/usr/bin",
    TERM: "dumb",
    ACP_AGENT_API_KEY: "explicit-agent-key",
    ACP_ENDPOINT: "https://agent.internal"
  });
  assert.equal(result.DEVMOTER_AUTH_PASSWORD, undefined);
  assert.equal(result.OPENCODE_SERVER_PASSWORD, undefined);
  assert.equal(result.ARBITRARY_SENTINEL, undefined);

  assert.throws(() => acpChildEnv(baseEnv, { "BAD=KEY": "1" }), /Invalid ACP environment variable name/);
  assert.throws(() => acpChildEnv(baseEnv, JSON.parse('{"__proto__":"polluted"}')), /Invalid ACP environment variable name/);
  assert.throws(() => acpChildEnv(baseEnv, { GOOD_KEY: "bad\0value" }), /Invalid ACP environment variable value/);
});

test("spawned mock ACP CLI receives allowlisted and explicit env without DEVMOTER_*, OPENCODE_SERVER_*, or sentinel secrets", async t => {
  const root = await mkdtemp(join(tmpdir(), "devmoter-acp-env-"));
  t.after(() => rm(root, { recursive: true, force: true }));

  const mockCliPath = join(root, "mock-acp-cli.mjs");
  await writeFile(mockCliPath, `
import readline from "node:readline";

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on("line", line => {
  const trimmed = line.trim();
  if (!trimmed) return;
  const message = JSON.parse(trimmed);
  if (message.method === "initialize") {
    process.stdout.write(JSON.stringify({
      jsonrpc: "2.0",
      id: message.id,
      result: {
        protocolVersion: 1,
        agentCapabilities: { loadSession: false },
        receivedEnv: { ...process.env }
      }
    }) + "\\n");
  } else if (message.method === "session/new") {
    process.stdout.write(JSON.stringify({
      jsonrpc: "2.0",
      id: message.id,
      result: { sessionId: "real-child-session" }
    }) + "\\n");
  } else if (message.method === "session/prompt") {
    process.stdout.write(JSON.stringify({
      jsonrpc: "2.0",
      id: message.id,
      result: { stopReason: "end_turn", receivedEnv: { ...process.env } }
    }) + "\\n");
  }
});
rl.on("close", () => process.exit(0));
`, "utf8");

  const sentinelSecret = "arbitrary-sentinel-secret-98765";
  const allowlistedOverrides = {
    HOME: join(root, "home"),
    USER: "acp-tester",
    LOGNAME: "acp-tester",
    LANG: "C.UTF-8",
    LC_ALL: "C.UTF-8",
    LC_CTYPE: "en_US.UTF-8",
    TERM: "xterm-256color",
    TMPDIR: join(root, "tmp"),
    XDG_CONFIG_HOME: join(root, "xdg-config"),
    XDG_DATA_HOME: join(root, "xdg-data"),
    XDG_STATE_HOME: join(root, "xdg-state"),
    XDG_CACHE_HOME: join(root, "xdg-cache"),
    XDG_RUNTIME_DIR: join(root, "xdg-runtime")
  };
  const secretOverrides = {
    DEVMOTER_AUTH_PASSWORD: "super-secret-devmoter-password",
    DEVMOTER_GOOGLE_CLIENT_SECRET: "google-oauth-client-secret",
    DEVMOTER_MICROSOFT_CLIENT_SECRET: "microsoft-oauth-client-secret",
    OPENCODE_SERVER_PASSWORD: "super-secret-opencode-password",
    OPENCODE_SERVER_USERNAME: "opencode-owner",
    OAUTH_CLIENT_SECRET: "generic-oauth-secret",
    ACP_SENTINEL_SECRET: sentinelSecret,
    UNRELATED_PARENT_ENV: "should-not-leak-either"
  };
  setTempProcessEnv(t, { ...allowlistedOverrides, ...secretOverrides });

  const defaultAdapter = new AcpAdapter({
    command: process.execPath,
    args: [mockCliPath],
    cwd: root
  });
  try {
    const init = await defaultAdapter.connect();
    const session = await defaultAdapter.newSession({ cwd: root });
    assert.equal(session.sessionId, "real-child-session");
    const promptResult = await defaultAdapter.prompt(session.sessionId, "check env");

    for (const childEnv of [init.receivedEnv, promptResult.receivedEnv]) {
      assert.equal(childEnv.PATH, process.env.PATH);
      for (const [key, expected] of Object.entries(allowlistedOverrides)) {
        assert.equal(childEnv[key], expected, `${key} should be passed to ACP child`);
      }
      for (const key of Object.keys(secretOverrides)) {
        assert.equal(childEnv[key], undefined, `${key} must not leak to ACP child`);
        assert.equal(Object.hasOwn(childEnv, key), false);
      }
    }
  } finally {
    await closeRealAdapter(defaultAdapter);
  }

  const configuredAdapter = new AcpAdapter({
    command: process.execPath,
    args: [mockCliPath],
    cwd: root,
    env: {
      ACP_AGENT_TOKEN: "explicit-agent-token",
      ACP_CUSTOM_FLAG: "enabled",
      TERM: "dumb"
    }
  });
  try {
    const init = await configuredAdapter.connect();
    const childEnv = init.receivedEnv;
    assert.equal(childEnv.ACP_AGENT_TOKEN, "explicit-agent-token");
    assert.equal(childEnv.ACP_CUSTOM_FLAG, "enabled");
    assert.equal(childEnv.TERM, "dumb");
    assert.equal(childEnv.HOME, allowlistedOverrides.HOME);
    assert.equal(childEnv.TMPDIR, allowlistedOverrides.TMPDIR);
    assert.equal(childEnv.PATH, process.env.PATH);
    for (const key of Object.keys(secretOverrides)) {
      assert.equal(childEnv[key], undefined, `${key} must not leak even when explicit env is set`);
    }
  } finally {
    await closeRealAdapter(configuredAdapter);
  }
});

test("ACP adapter filters environment during cliDefinition readiness checks as well as child spawn", async t => {
  const root = await mkdtemp(join(tmpdir(), "devmoter-acp-cli-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const binDir = join(root, "bin");
  await mkdir(binDir, { recursive: true });

  const probeEnvFile = join(root, "probe-env.json");
  const fakeCodexPath = join(binDir, "codex");
  await writeFile(fakeCodexPath, `#!${process.execPath}
import { writeFileSync } from "node:fs";
import readline from "node:readline";

if (process.argv.includes("--version")) {
  writeFileSync(${JSON.stringify(probeEnvFile)}, JSON.stringify({ ...process.env }));
  process.stdout.write("codex 0.0.1-test\\n");
  process.exit(0);
}

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on("line", line => {
  const trimmed = line.trim();
  if (!trimmed) return;
  const message = JSON.parse(trimmed);
  if (message.method === "initialize") {
    process.stdout.write(JSON.stringify({
      jsonrpc: "2.0",
      id: message.id,
      result: { protocolVersion: 1, receivedEnv: { ...process.env } }
    }) + "\\n");
  }
});
rl.on("close", () => process.exit(0));
`, { mode: 0o700 });
  await chmod(fakeCodexPath, 0o700);

  const adapter = new AcpAdapter({
    command: "codex",
    cwd: root,
    baseEnv: {
      PATH: binDir,
      HOME: root,
      TERM: "xterm-256color",
      DEVMOTER_AUTH_PASSWORD: "secret-password",
      OPENCODE_SERVER_PASSWORD: "secret-opencode-password",
      ARBITRARY_SENTINEL: "secret-sentinel"
    }
  });
  try {
    const init = await adapter.connect();
    const probeEnv = JSON.parse(await readFile(probeEnvFile, "utf8"));
    for (const seenEnv of [probeEnv, init.receivedEnv]) {
      assert.equal(seenEnv.PATH, binDir);
      assert.equal(seenEnv.HOME, root);
      assert.equal(seenEnv.DEVMOTER_AUTH_PASSWORD, undefined);
      assert.equal(seenEnv.OPENCODE_SERVER_PASSWORD, undefined);
      assert.equal(seenEnv.ARBITRARY_SENTINEL, undefined);
    }
  } finally {
    await closeRealAdapter(adapter);
  }
});
