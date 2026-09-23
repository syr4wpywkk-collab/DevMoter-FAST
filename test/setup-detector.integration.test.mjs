import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { chmod, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createSetupStatus } from "../server/setup/engine.mjs";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const password = "setup-integration-auth-password-1234";
const authorization = `Basic ${Buffer.from(`devmoter:${password}`).toString("base64")}`;

async function fakePath(t) {
  const root = await mkdtemp(join(tmpdir(), "devmoter-setup-detector-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const bin = join(root, "bin");
  await mkdir(bin);
  return { root, bin };
}

async function fakeExecutable(bin, name, options = {}) {
  const source = `#!${process.execPath}
const config = ${JSON.stringify({
    version: options.version || `${name} 1.2.3`,
    versionCode: options.versionCode ?? 0,
    versionStderr: options.versionStderr || "",
    authCode: options.authCode ?? 0,
    authOutput: options.authOutput || "",
    authStderr: options.authStderr || "",
    tailscaleState: options.tailscaleState || "Running"
  })};
const args = process.argv.slice(2);
const isVersion = args[0] === "--version" || (args.length === 1 && args[0] === "version");
if (isVersion) {
  if (config.version) process.stdout.write(config.version + "\\n");
  if (config.versionStderr) process.stderr.write(config.versionStderr);
  process.exit(config.versionCode);
}
if (args[0] === "status" && args[1] === "--json") {
  process.stdout.write(JSON.stringify({ BackendState: config.tailscaleState, Peer: { private: "never-return-this" } }));
  process.exit(0);
}
if (args[0] === "login" && args[1] === "status" || args[0] === "auth" && args[1] === "status") {
  if (config.authOutput) process.stdout.write(config.authOutput);
  if (config.authStderr) process.stderr.write(config.authStderr);
  process.exit(config.authCode);
}
if (args[0] === "auth" && args[1] === "list") {
  if (config.authOutput) process.stdout.write(config.authOutput);
  process.exit(config.authCode);
}
process.stderr.write("unexpected fixed detector arguments");
process.exit(64);
`;
  const path = join(bin, name);
  await writeFile(path, source, { mode: 0o700 });
  await chmod(path, 0o700);
  return path;
}

function detectorEnv(bin, home) {
  return { PATH: bin, HOME: home, LANG: "C.UTF-8" };
}

test("detector reports all six tools missing and repeated scans are stable", async t => {
  const { root, bin } = await fakePath(t);
  const env = detectorEnv(bin, root);
  const first = await createSetupStatus({ env });
  const second = await createSetupStatus({ env });
  assert.equal(first.phase, "experimental-phase-1");
  assert.equal(first.platform.supported, process.platform === "linux");
  assert.deepEqual(first.tools.map(tool => tool.state), Array(6).fill("missing"));
  assert.deepEqual(second, first);
});

test("installed binaries without safe auth checks stay installed and unknown", async t => {
  const { root, bin } = await fakePath(t);
  await fakeExecutable(bin, "claude");
  const result = await createSetupStatus({ env: detectorEnv(bin, root) });
  const claude = result.tools.find(tool => tool.id === "claude");
  assert.equal(claude.state, "installed");
  assert.equal(claude.installed, true);
  assert.equal(claude.version, "1.2.3");
  assert.equal(claude.authenticated, null);
  assert.equal(claude.authState, "unknown");
});

test("installed binary with a failed version check is broken with fixed diagnostics", async t => {
  const { root, bin } = await fakePath(t);
  await fakeExecutable(bin, "codex", { versionCode: 1, version: "ghp_secret-looking-version-output" });
  const result = await createSetupStatus({ env: detectorEnv(bin, root) });
  const codex = result.tools.find(tool => tool.id === "codex");
  assert.equal(codex.state, "broken");
  assert.equal(codex.installed, true);
  assert.equal(codex.version, null);
  assert.equal(JSON.stringify(codex).includes("ghp_secret"), false);
});

test("documented Codex and GitHub auth probes distinguish auth required from ready", async t => {
  const { root, bin } = await fakePath(t);
  await fakeExecutable(bin, "codex", { authCode: 1, authStderr: "not logged in" });
  await fakeExecutable(bin, "gh");
  const result = await createSetupStatus({ env: detectorEnv(bin, root) });
  const codex = result.tools.find(tool => tool.id === "codex");
  const github = result.tools.find(tool => tool.id === "github");
  assert.equal(codex.state, "auth_required");
  assert.equal(codex.authenticated, false);
  assert.equal(github.state, "ready");
  assert.equal(github.authenticated, true);
});

test("auth probes ignore env-backed credentials and only report the limitation, never the value", async t => {
  const { root, bin } = await fakePath(t);
  await fakeExecutable(bin, "gh", { authCode: 1 });
  const secret = "ghp_environment-secret-never-return";
  const result = await createSetupStatus({ env: { ...detectorEnv(bin, root), GH_TOKEN: secret } });
  const github = result.tools.find(tool => tool.id === "github");
  assert.equal(github.state, "installed");
  assert.equal(github.authState, "unknown");
  assert.ok(github.diagnostics.some(item => item.code === "auth_env_ignored"));
  assert.equal(JSON.stringify(result).includes(secret), false);
});

test("OpenCode provider state stays unknown when its output is not a stable contract; Tailscale returns only local auth state", async t => {
  const { root, bin } = await fakePath(t);
  await fakeExecutable(bin, "opencode", { authOutput: "Configured provider entries" });
  await fakeExecutable(bin, "tailscale", { tailscaleState: "NeedsLogin" });
  const result = await createSetupStatus({ env: detectorEnv(bin, root) });
  const opencode = result.tools.find(tool => tool.id === "opencode");
  const tailscale = result.tools.find(tool => tool.id === "tailscale");
  assert.equal(opencode.state, "installed");
  assert.equal(opencode.authenticated, null);
  assert.equal(opencode.providerAuth, "unknown");
  assert.equal(tailscale.state, "auth_required");
  assert.equal(JSON.stringify(result).includes("never-return-this"), false);
});

test("unsupported platform skips every tool process and reports unsupported", async t => {
  const { root, bin } = await fakePath(t);
  await fakeExecutable(bin, "codex");
  const result = await createSetupStatus({ env: detectorEnv(bin, root), platform: "win32" });
  assert.equal(result.platform.supported, false);
  assert.ok(result.tools.every(tool => tool.state === "unsupported"));
});

test("one adapter failure does not stop the remaining detectors", async t => {
  const { root, bin } = await fakePath(t);
  await fakeExecutable(bin, "codex", { versionCode: 1 });
  await fakeExecutable(bin, "claude");
  const result = await createSetupStatus({ env: detectorEnv(bin, root) });
  assert.equal(result.tools.find(tool => tool.id === "codex").state, "broken");
  assert.equal(result.tools.find(tool => tool.id === "claude").state, "installed");
  assert.equal(result.tools.find(tool => tool.id === "github").state, "missing");
});

async function freePort() {
  const probe = createServer();
  probe.listen(0, "127.0.0.1");
  await once(probe, "listening");
  const address = probe.address();
  const port = typeof address === "object" && address ? address.port : 0;
  await new Promise((resolve, reject) => probe.close(error => error ? reject(error) : resolve()));
  return port;
}

async function waitForReady(child) {
  let output = "";
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Setup API test server did not start: ${output}`)), 10_000);
    child.stdout.on("data", chunk => {
      output += chunk.toString();
      if (output.includes("DevMoter FAST:")) {
        clearTimeout(timer);
        resolve();
      }
    });
    child.once("exit", code => {
      clearTimeout(timer);
      reject(new Error(`Setup API test server exited (${code}): ${output}`));
    });
  });
}

test("setup API retains auth, ignores command-shaped browser input, and redacts tool output", async t => {
  const { root, bin } = await fakePath(t);
  const secret = "sk-proj-this-is-a-fake-secret-value";
  await fakeExecutable(bin, "codex", { authOutput: secret });
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ["server.mjs"], {
    cwd: repoRoot,
    env: {
      ...process.env,
      PATH: bin,
      HOME: root,
      POCKET_HOST: "127.0.0.1",
      POCKET_PORT: String(port),
      CODEX_BIN: "browser-must-not-control-this",
      DEVMOTER_AUTH_PASSWORD: password
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  t.after(async () => {
    child.kill("SIGTERM");
    await Promise.race([once(child, "exit"), new Promise(resolve => setTimeout(resolve, 1500))]);
    if (child.exitCode === null) child.kill("SIGKILL");
  });

  await waitForReady(child);
  const unauthorized = await fetch(`${origin}/api/setup/status`);
  assert.equal(unauthorized.status, 401);

  const response = await fetch(`${origin}/api/setup/status?executable=/tmp/evil&argv[]=--help&cwd=/tmp&env[token]=exposed`, {
    headers: { authorization }
  });
  assert.equal(response.status, 200);
  const payload = await response.json();
  const codex = payload.tools.find(tool => tool.id === "codex");
  assert.equal(codex.state, "ready");
  assert.equal(codex.version, "1.2.3");
  assert.equal(JSON.stringify(payload).includes(secret), false);
  assert.equal(JSON.stringify(payload).includes(root), false);
  assert.equal(JSON.stringify(payload).includes("resolvedPath"), false);
  assert.equal(JSON.stringify(payload).includes("browser-must-not-control-this"), false);

  const repeated = await fetch(`${origin}/api/setup/status`, { headers: { authorization } });
  assert.deepEqual(await repeated.json(), payload);
});
