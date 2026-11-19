import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import {
  compactOutput,
  integrationChildEnv,
  publicDefinition,
  publicIntegrationError,
  sanitizeChildEnv,
  validateAntigravityRemoteUrl
} from "../server/integrations.mjs";

test("integration child environment builds from allowlist and allows only explicit provider keys", () => {
  const source = {
    PATH: "/usr/bin",
    HOME: "/home/test",
    USER: "tester",
    LOGNAME: "tester",
    SHELL: "/bin/bash",
    LANG: "C.UTF-8",
    LC_ALL: "C.UTF-8",
    TZ: "UTC",
    TMPDIR: "/tmp",
    SSH_AUTH_SOCK: "/tmp/ssh-agent.sock",
    DISPLAY: ":0",
    WAYLAND_DISPLAY: "wayland-0",
    XAUTHORITY: "/run/user/1000/Xauthority",
    DBUS_SESSION_BUS_ADDRESS: "unix:path=/run/user/1000/bus",
    XDG_RUNTIME_DIR: "/run/user/1000",
    XDG_CONFIG_HOME: "/home/test/.config",
    CLAUDE_CONFIG_DIR: "/home/test/.claude",
    QWEN_HOME: "/home/test/.qwen",
    ANTIGRAVITY_BIN: "/opt/agy",
    DEVMOTER_AUTH_PASSWORD: "do-not-leak",
    DEVMOTER_API_TOKEN: "do-not-leak-either",
    POCKET_SESSION_SECRET: "private",
    OPENCODE_SERVER_PASSWORD: "private-upstream",
    ANTHROPIC_API_KEY: "provider-secret",
    GITHUB_TOKEN: "github-secret",
    AWS_SECRET_ACCESS_KEY: "aws-secret",
    DATABASE_URL: "postgres://user:pass@localhost:5432/app",
    SUPABASE_SERVICE_ROLE_KEY: "service-role-secret",
    CUSTOM_SERVICE_ROLE_KEY: "other-service-role-secret",
    ARBITRARY_UNLISTED_VAR: "should-not-inherit",
    NODE_OPTIONS: "--require=/tmp/evil.js",
    LD_PRELOAD: "/tmp/evil.so"
  };

  const defaultEnv = sanitizeChildEnv(source);
  assert.equal(defaultEnv.DEVMOTER_AUTH_PASSWORD, undefined);
  assert.equal(defaultEnv.DEVMOTER_API_TOKEN, undefined);
  assert.equal(defaultEnv.POCKET_SESSION_SECRET, undefined);
  assert.equal(defaultEnv.OPENCODE_SERVER_PASSWORD, undefined);
  assert.equal(defaultEnv.ANTHROPIC_API_KEY, undefined);
  assert.equal(defaultEnv.GITHUB_TOKEN, undefined);
  assert.equal(defaultEnv.AWS_SECRET_ACCESS_KEY, undefined);
  assert.equal(defaultEnv.DATABASE_URL, undefined);
  assert.equal(defaultEnv.SUPABASE_SERVICE_ROLE_KEY, undefined);
  assert.equal(defaultEnv.CUSTOM_SERVICE_ROLE_KEY, undefined);
  assert.equal(defaultEnv.ARBITRARY_UNLISTED_VAR, undefined);
  assert.equal(defaultEnv.NODE_OPTIONS, undefined);
  assert.equal(defaultEnv.LD_PRELOAD, undefined);
  assert.equal(defaultEnv.PATH, "/usr/bin");
  assert.equal(defaultEnv.HOME, "/home/test");
  assert.equal(defaultEnv.LANG, "C.UTF-8");
  assert.equal(defaultEnv.LC_ALL, "C.UTF-8");
  assert.equal(defaultEnv.DISPLAY, ":0");
  assert.equal(defaultEnv.WAYLAND_DISPLAY, "wayland-0");
  assert.equal(defaultEnv.XAUTHORITY, "/run/user/1000/Xauthority");
  assert.equal(defaultEnv.DBUS_SESSION_BUS_ADDRESS, "unix:path=/run/user/1000/bus");
  assert.equal(defaultEnv.XDG_RUNTIME_DIR, "/run/user/1000");
  assert.equal(defaultEnv.CLAUDE_CONFIG_DIR, "/home/test/.claude");
  assert.equal(defaultEnv.QWEN_HOME, "/home/test/.qwen");
  assert.equal(defaultEnv.ANTIGRAVITY_BIN, "/opt/agy");

  const claudeEnv = sanitizeChildEnv(source, ["ANTHROPIC_API_KEY", "NODE_OPTIONS"]);
  assert.equal(claudeEnv.ANTHROPIC_API_KEY, "provider-secret");
  assert.equal(claudeEnv.GITHUB_TOKEN, undefined);
  assert.equal(claudeEnv.DEVMOTER_AUTH_PASSWORD, undefined);
  assert.equal(claudeEnv.DATABASE_URL, undefined);
  assert.equal(claudeEnv.SUPABASE_SERVICE_ROLE_KEY, undefined);
  assert.equal(claudeEnv.ARBITRARY_UNLISTED_VAR, undefined);
  assert.equal(claudeEnv.NODE_OPTIONS, undefined);

  assert.deepEqual(sanitizeChildEnv({ PATH: 123, HOME: "/home/x" }), { HOME: "/home/x" });
  assert.deepEqual(sanitizeChildEnv(null), {});
});

test("integration child environment preserves exact proxy and CA-trust keys without unrelated secrets", () => {
  const networkEnv = {
    HTTP_PROXY: "http://user:password@proxy.example.test:8080",
    HTTPS_PROXY: "http://secure-proxy.example.test:8080",
    NO_PROXY: "localhost,.example.test",
    ALL_PROXY: "socks5://proxy.example.test:1080",
    http_proxy: "http://lower-proxy.example.test:8080",
    https_proxy: "http://user:password@lower-secure-proxy.example.test:8080",
    no_proxy: "127.0.0.1,::1",
    all_proxy: "socks5://lower-proxy.example.test:1080",
    NODE_EXTRA_CA_CERTS: "/etc/company/node-ca.pem",
    SSL_CERT_FILE: "/etc/company/ca.pem",
    SSL_CERT_DIR: "/etc/company/certs"
  };
  const source = {
    ...networkEnv,
    Http_Proxy: "http://mixed-case.example.test",
    Https_Proxy: "http://mixed-case.example.test",
    No_Proxy: "mixed-case.example.test",
    All_Proxy: "socks5://mixed-case.example.test",
    node_extra_ca_certs: "/unlisted/ca.pem",
    ssl_cert_file: "/unlisted/ca.pem",
    ssl_cert_dir: "/unlisted/certs",
    DATABASE_URL: "postgres://user:password@db.example.test/app",
    SUPABASE_SERVICE_ROLE_KEY: "private-role-key",
    DEVMOTER_AUTH_PASSWORD: "private-password",
    ANTHROPIC_API_KEY: "private-provider-key",
    GITHUB_TOKEN: "private-token",
    NODE_OPTIONS: "--require=/tmp/injected.js",
    LD_PRELOAD: "/tmp/injected.so"
  };

  assert.deepEqual(sanitizeChildEnv(source), networkEnv);
  for (const id of ["claude", "qwen", "antigravity"]) {
    const expected = id === "claude"
      ? { ...networkEnv, ANTHROPIC_API_KEY: source.ANTHROPIC_API_KEY }
      : networkEnv;
    assert.deepEqual(integrationChildEnv(id, source), expected);
  }
  assert.deepEqual(sanitizeChildEnv({ HTTP_PROXY: "", SSL_CERT_FILE: "" }), {
    HTTP_PROXY: "",
    SSL_CERT_FILE: ""
  });
  assert.deepEqual(sanitizeChildEnv({ HTTP_PROXY: null, https_proxy: 123, SSL_CERT_DIR: {} }), {});
});

test("integrationChildEnv isolates parent env secrets and passes only each integration's keys", () => {
  const injected = {
    PATH: "/usr/local/bin:/usr/bin",
    HOME: "/home/tester",
    DISPLAY: ":1",
    QWEN_HOME: "/home/tester/.qwen-custom",
    CLAUDE_CONFIG_DIR: "/home/tester/.claude-custom",
    DATABASE_URL: "postgres://postgres:pw@db.internal:5432/prod",
    SUPABASE_SERVICE_ROLE_KEY: "eyJ-supabase-service-role",
    BILLING_SERVICE_ROLE_KEY: "eyJ-billing-service-role",
    ARBITRARY_UNLISTED_VAR: "unexpected-future-secret",
    DEVMOTER_AUTH_PASSWORD: "owner-password-value",
    GITHUB_TOKEN: "ghp_secret",
    NODE_OPTIONS: "--require=/tmp/hook.js",
    ANTHROPIC_API_KEY: "sk-ant-123",
    ANTHROPIC_AUTH_TOKEN: "ant-token-456",
    GEMINI_API_KEY: "gem-key-789",
    GOOGLE_API_KEY: "goog-key-012",
    DASHSCOPE_API_KEY: "dash-key-345",
    OPENAI_API_KEY: "sk-openai-678",
    OPENAI_BASE_URL: "https://api.example.test/v1",
    OPENAI_MODEL: "qwen3-coder-plus"
  };

  const saved = new Map();
  for (const key of Object.keys(injected)) {
    saved.set(key, Object.hasOwn(process.env, key) ? process.env[key] : undefined);
    process.env[key] = injected[key];
  }

  try {
    const claude = integrationChildEnv("claude");
    assert.equal(claude.PATH, injected.PATH);
    assert.equal(claude.HOME, injected.HOME);
    assert.equal(claude.DISPLAY, injected.DISPLAY);
    assert.equal(claude.CLAUDE_CONFIG_DIR, injected.CLAUDE_CONFIG_DIR);
    assert.equal(claude.ANTHROPIC_API_KEY, injected.ANTHROPIC_API_KEY);
    assert.equal(claude.ANTHROPIC_AUTH_TOKEN, injected.ANTHROPIC_AUTH_TOKEN);
    assert.equal(claude.DATABASE_URL, undefined);
    assert.equal(claude.SUPABASE_SERVICE_ROLE_KEY, undefined);
    assert.equal(claude.BILLING_SERVICE_ROLE_KEY, undefined);
    assert.equal(claude.ARBITRARY_UNLISTED_VAR, undefined);
    assert.equal(claude.DEVMOTER_AUTH_PASSWORD, undefined);
    assert.equal(claude.GITHUB_TOKEN, undefined);
    assert.equal(claude.NODE_OPTIONS, undefined);
    assert.equal(claude.GEMINI_API_KEY, undefined);
    assert.equal(claude.GOOGLE_API_KEY, undefined);
    assert.equal(claude.DASHSCOPE_API_KEY, undefined);
    assert.equal(claude.OPENAI_API_KEY, undefined);
    assert.equal(claude.OPENAI_BASE_URL, undefined);
    assert.equal(claude.OPENAI_MODEL, undefined);

    const antigravity = integrationChildEnv("antigravity");
    assert.equal(antigravity.GEMINI_API_KEY, injected.GEMINI_API_KEY);
    assert.equal(antigravity.GOOGLE_API_KEY, injected.GOOGLE_API_KEY);
    assert.equal(antigravity.DATABASE_URL, undefined);
    assert.equal(antigravity.SUPABASE_SERVICE_ROLE_KEY, undefined);
    assert.equal(antigravity.BILLING_SERVICE_ROLE_KEY, undefined);
    assert.equal(antigravity.ARBITRARY_UNLISTED_VAR, undefined);
    assert.equal(antigravity.ANTHROPIC_API_KEY, undefined);
    assert.equal(antigravity.OPENAI_API_KEY, undefined);

    const qwen = integrationChildEnv("qwen");
    assert.equal(qwen.QWEN_HOME, injected.QWEN_HOME);
    assert.equal(qwen.DASHSCOPE_API_KEY, injected.DASHSCOPE_API_KEY);
    assert.equal(qwen.OPENAI_API_KEY, injected.OPENAI_API_KEY);
    assert.equal(qwen.OPENAI_BASE_URL, injected.OPENAI_BASE_URL);
    assert.equal(qwen.OPENAI_MODEL, injected.OPENAI_MODEL);
    assert.equal(qwen.DATABASE_URL, undefined);
    assert.equal(qwen.SUPABASE_SERVICE_ROLE_KEY, undefined);
    assert.equal(qwen.ARBITRARY_UNLISTED_VAR, undefined);
    assert.equal(qwen.ANTHROPIC_API_KEY, undefined);
    assert.equal(qwen.GEMINI_API_KEY, undefined);

    for (const unknownId of ["unknown", "toString", "__proto__"]) {
      const unknown = integrationChildEnv(unknownId);
      assert.equal(unknown.PATH, injected.PATH);
      assert.equal(unknown.DATABASE_URL, undefined);
      assert.equal(unknown.SUPABASE_SERVICE_ROLE_KEY, undefined);
      assert.equal(unknown.ARBITRARY_UNLISTED_VAR, undefined);
      assert.equal(unknown.ANTHROPIC_API_KEY, undefined);
      assert.equal(unknown.GEMINI_API_KEY, undefined);
      assert.equal(unknown.OPENAI_API_KEY, undefined);
    }
  } finally {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("launched integration child processes do not inherit DATABASE_URL, SUPABASE_SERVICE_ROLE_KEY, or unlisted vars", async t => {
  const dir = await mkdtemp(join(tmpdir(), "devmoter-issue-583-"));
  t.after(async () => rm(dir, { recursive: true, force: true }));

  const binDir = join(dir, "bin");
  const projectDir = join(dir, "project");
  await mkdir(binDir);
  await mkdir(projectDir);

  const claudeEnvPath = join(dir, "claude-env.json");
  const qwenEnvPath = join(dir, "qwen-env.json");
  const agyEnvPath = join(dir, "agy-env.json");
  const fakeWhich = join(binDir, "which");
  const fakeClaude = join(binDir, "claude");
  const fakeQwen = join(binDir, "qwen");
  const fakeAgy = join(binDir, "agy");
  const fakeTerminal = join(binDir, "gnome-terminal");
  const nodeBinDir = dirname(process.execPath);

  await writeFile(fakeWhich, `#!${process.execPath}
import { existsSync } from "node:fs";
import { join } from "node:path";
const name = process.argv[2] || "";
if (!name) process.exit(1);
if (name.startsWith("/") && existsSync(name)) {
  console.log(name);
  process.exit(0);
}
const candidate = join(${JSON.stringify(binDir)}, name);
if (existsSync(candidate)) {
  console.log(candidate);
  process.exit(0);
}
process.exit(1);
`);
  await chmod(fakeWhich, 0o700);

  await writeFile(fakeClaude, `#!${process.execPath}
import { writeFileSync } from "node:fs";
if (process.argv.includes("--version")) {
  console.log("claude 1.0.0-test");
  process.exit(0);
}
writeFileSync(${JSON.stringify(claudeEnvPath)}, JSON.stringify(process.env));
`);
  await chmod(fakeClaude, 0o700);

  await writeFile(fakeQwen, `#!${process.execPath}
import { writeFileSync } from "node:fs";
if (process.argv.includes("--version")) {
  console.log("qwen 1.0.0-test");
  process.exit(0);
}
writeFileSync(${JSON.stringify(qwenEnvPath)}, JSON.stringify(process.env));
`);
  await chmod(fakeQwen, 0o700);

  await writeFile(fakeAgy, `#!${process.execPath}
import { writeFileSync } from "node:fs";
if (process.argv.includes("--version")) {
  console.log("agy 2.0.0-test");
  process.exit(0);
}
writeFileSync(${JSON.stringify(agyEnvPath)}, JSON.stringify(process.env));
setTimeout(() => process.exit(0), 1200);
`);
  await chmod(fakeAgy, 0o700);

  await writeFile(fakeTerminal, `#!${process.execPath}
import { spawn } from "node:child_process";
const args = process.argv.slice(2);
const separator = args.indexOf("--");
const cmd = args.slice(separator + 1);
const child = spawn(cmd[0], cmd.slice(1), {
  cwd: process.cwd(),
  env: process.env,
  detached: true,
  stdio: "ignore"
});
child.unref();
`);
  await chmod(fakeTerminal, 0o700);

  const driver = join(dir, "driver.mjs");
  const integrationsUrl = new URL("../server/integrations.mjs", import.meta.url).href;
  await writeFile(driver, `
import { launchIntegration } from ${JSON.stringify(integrationsUrl)};
await launchIntegration("claude", ${JSON.stringify(projectDir)});
await launchIntegration("qwen", ${JSON.stringify(projectDir)});
await launchIntegration("antigravity", ${JSON.stringify(projectDir)});
`);

  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [driver], {
      cwd: dir,
      env: {
        PATH: [binDir, nodeBinDir].join(delimiter),
        HOME: dir,
        DISPLAY: ":77",
        ANTIGRAVITY_BIN: fakeAgy,
        CLAUDE_BIN: fakeClaude,
        QWEN_BIN: fakeQwen,
        ANTHROPIC_API_KEY: "claude-explicit-key",
        GEMINI_API_KEY: "agy-explicit-key",
        DASHSCOPE_API_KEY: "qwen-dashscope-key",
        OPENAI_API_KEY: "qwen-only-key",
        DATABASE_URL: "postgres://secret@db/prod",
        SUPABASE_SERVICE_ROLE_KEY: "sb-service-role-secret",
        CUSTOM_SERVICE_ROLE_KEY: "custom-service-role-secret",
        ARBITRARY_UNLISTED_VAR: "unlisted-secret-value"
      },
      stdio: ["ignore", "pipe", "pipe"]
    });
    let output = "";
    child.stdout.on("data", chunk => { output += chunk; });
    child.stderr.on("data", chunk => { output += chunk; });
    child.once("error", reject);
    child.once("exit", code => {
      if (code === 0) resolve();
      else reject(new Error(`driver exited ${code}: ${output}`));
    });
  });

  async function readObserved(path) {
    const deadline = Date.now() + 3_000;
    while (Date.now() < deadline) {
      try {
        return JSON.parse(await readFile(path, "utf8"));
      } catch {
        await new Promise(resolve => setTimeout(resolve, 25));
      }
    }
    return null;
  }

  const claudeObserved = await readObserved(claudeEnvPath);
  assert.ok(claudeObserved, "fake claude should have written observed env");
  assert.equal(claudeObserved.ANTHROPIC_API_KEY, "claude-explicit-key");
  assert.equal(claudeObserved.GEMINI_API_KEY, undefined);
  assert.equal(claudeObserved.DASHSCOPE_API_KEY, undefined);
  assert.equal(claudeObserved.OPENAI_API_KEY, undefined);
  assert.equal(claudeObserved.DATABASE_URL, undefined);
  assert.equal(claudeObserved.SUPABASE_SERVICE_ROLE_KEY, undefined);
  assert.equal(claudeObserved.CUSTOM_SERVICE_ROLE_KEY, undefined);
  assert.equal(claudeObserved.ARBITRARY_UNLISTED_VAR, undefined);

  const qwenObserved = await readObserved(qwenEnvPath);
  assert.ok(qwenObserved, "fake qwen should have written observed env");
  assert.equal(qwenObserved.DASHSCOPE_API_KEY, "qwen-dashscope-key");
  assert.equal(qwenObserved.OPENAI_API_KEY, "qwen-only-key");
  assert.equal(qwenObserved.ANTHROPIC_API_KEY, undefined);
  assert.equal(qwenObserved.GEMINI_API_KEY, undefined);
  assert.equal(qwenObserved.DATABASE_URL, undefined);
  assert.equal(qwenObserved.SUPABASE_SERVICE_ROLE_KEY, undefined);
  assert.equal(qwenObserved.CUSTOM_SERVICE_ROLE_KEY, undefined);
  assert.equal(qwenObserved.ARBITRARY_UNLISTED_VAR, undefined);

  const agyObserved = JSON.parse(await readFile(agyEnvPath, "utf8"));
  assert.equal(agyObserved.GEMINI_API_KEY, "agy-explicit-key");
  assert.equal(agyObserved.ANTHROPIC_API_KEY, undefined);
  assert.equal(agyObserved.DASHSCOPE_API_KEY, undefined);
  assert.equal(agyObserved.OPENAI_API_KEY, undefined);
  assert.equal(agyObserved.DATABASE_URL, undefined);
  assert.equal(agyObserved.SUPABASE_SERVICE_ROLE_KEY, undefined);
  assert.equal(agyObserved.CUSTOM_SERVICE_ROLE_KEY, undefined);
  assert.equal(agyObserved.ARBITRARY_UNLISTED_VAR, undefined);
});

test("Antigravity remote URLs are restricted to the official HTTPS origin", () => {
  assert.equal(
    validateAntigravityRemoteUrl("https://antigravity.google.com/r/instance?p=conversation"),
    "https://antigravity.google.com/r/instance?p=conversation"
  );
  assert.equal(validateAntigravityRemoteUrl("http://antigravity.google.com/r/nope"), null);
  assert.equal(validateAntigravityRemoteUrl("https://evil.example/r/nope"), null);
  assert.equal(validateAntigravityRemoteUrl("https://antigravity.google.com:444/r/nope"), null);
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
