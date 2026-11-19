import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { chmod, copyFile, mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

async function executable(path, content) {
  await writeFile(path, content);
  await chmod(path, 0o755);
}

async function runWithPermissiveUmask(scriptPath, options) {
  return execFileAsync("bash", ["-c", 'umask 000; exec bash "$1"', "_", scriptPath], options);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function decodeBasicAuth(header) {
  if (!header || !header.startsWith("Basic ")) return null;
  return Buffer.from(header.slice(6), "base64").toString("utf8");
}

async function startMockServer(t, handler) {
  const server = createServer((req, res) => {
    handler(req, res);
  });
  await new Promise(resolveListen => server.listen(0, "127.0.0.1", resolveListen));
  t.after(() => new Promise(resolveClose => server.close(resolveClose)));
  const address = server.address();
  return address.port;
}

const MOCK_OPENCODE_DAEMON = `#!/usr/bin/env bash
trap 'kill $! 2>/dev/null || true; exit 0' TERM INT
sleep 30 &
wait $!
`;

const MOCK_CURL_SCRIPT = `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$DEVMOTER_CURL_LOG"
case " $* " in
  *" -K - "*)
    stdin_cfg="$(cat)"
    printf '%s\\n' "$stdin_cfg" >> "$DEVMOTER_CURL_STDIN_LOG"
    ;;
esac
case "$*" in
  *"/api/info"*) printf '%s\\n' '{"version":"2.0.9"}' ;;
  *"/global/health"*) printf '%s\\n' '<!doctype html>' ;;
  *"/api/location"*) printf '%s\\n' '{"directory":"/srv/project"}' ;;
  *"/api/model"*) printf '%s\\n' '{"data":[{"id":"mock-model"}]}' ;;
  *"/api/health"*) printf '%s\\n' '{"backends":{"opencode":{"online":true},"codex":{"online":true}}}' ;;
  *"/api/opencode/pocket/providers"*) printf '%s\\n' '{"all":[{"id":"opencode","models":{"m1":{"id":"m1"}}}]}' ;;
esac
exit 0
`;

async function assertCurlCredentialsOutOfArgv(curlLogPath, curlStdinLogPath, ocPassword, authPassword) {
  const log = await readFile(curlLogPath, "utf8");
  const stdinLog = await readFile(curlStdinLogPath, "utf8");
  assert.match(log, /-K -/);
  assert.doesNotMatch(log, /(?:^|\s)(?:-[A-Za-z]*u|--user(?:=|\s|$))/);
  assert.ok(!log.includes(ocPassword), "OpenCode secret must not appear in curl argv");
  assert.ok(!log.includes(authPassword), "DevMoter secret must not appear in curl argv");
  assert.match(stdinLog, new RegExp(`user = "opencode:${escapeRegExp(ocPassword)}"`));
  assert.match(stdinLog, new RegExp(`user = "devmoter:${escapeRegExp(authPassword)}"`));
  return log;
}

test("systemd entrypoint provisions DevMoter auth, sets umask 077, and keeps curl credentials out of argv", async t => {
  const root = await mkdtemp(join(tmpdir(), "devmoter-systemd-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const fakeBin = join(root, "bin");
  const home = join(root, "home");
  const capture = join(root, "capture.txt");
  const curlLog = join(root, "curl.log");
  const curlStdinLog = join(root, "curl-stdin.log");
  await mkdir(fakeBin, { recursive: true });
  await mkdir(home, { recursive: true });

  await executable(join(fakeBin, "opencode"), MOCK_OPENCODE_DAEMON);
  await executable(join(fakeBin, "codex"), "#!/usr/bin/env bash\nexit 0\n");
  await executable(join(fakeBin, "curl"), MOCK_CURL_SCRIPT);
  await executable(join(fakeBin, "node"), `#!/usr/bin/env bash
printf '%s\\n%s\\n' "$DEVMOTER_AUTH_USERNAME" "$DEVMOTER_AUTH_PASSWORD" > "$DEVMOTER_TEST_CAPTURE"
exit 0
`);

  const script = resolve("scripts/systemd-entrypoint.sh");
  await runWithPermissiveUmask(script, {
    cwd: process.cwd(),
    timeout: 10000,
    env: {
      ...process.env,
      HOME: home,
      XDG_CONFIG_HOME: join(home, ".config"),
      PATH: fakeBin + ":" + process.env.PATH,
      DEVMOTER_TEST_CAPTURE: capture,
      DEVMOTER_CURL_LOG: curlLog,
      DEVMOTER_CURL_STDIN_LOG: curlStdinLog,
      POCKET_PORT: "18787",
      OPENCODE_PORT: "14937"
    }
  });

  const [user, password] = (await readFile(capture, "utf8")).trim().split("\n");
  assert.equal(user, "devmoter");
  assert.ok(password.length >= 16);

  const stateDir = join(home, ".config", "opencode-pocket");
  const ocSecretPath = join(stateDir, "opencode-server-password");
  const authSecretPath = join(stateDir, "devmoter-auth-password");
  const ocPassword = (await readFile(ocSecretPath, "utf8")).trim();

  assert.equal((await stat(stateDir)).mode & 0o777, 0o700);
  assert.equal((await stat(ocSecretPath)).mode & 0o777, 0o600);
  assert.equal((await stat(authSecretPath)).mode & 0o777, 0o600);

  const log = await assertCurlCredentialsOutOfArgv(curlLog, curlStdinLog, ocPassword, password);
  assert.match(log, /\/api\/info/);
  assert.match(log, /\/global\/health/);
  assert.match(log, /\/api\/location/);
  assert.match(log, /\/api\/model/);
  assert.match(log, /\/api\/health/);
});

test("systemd entrypoint authenticates real curl via stdin config with special characters", async t => {
  const root = await mkdtemp(join(tmpdir(), "devmoter-systemd-real-curl-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const fakeBin = join(root, "bin");
  const home = join(root, "home");
  await mkdir(fakeBin, { recursive: true });
  await mkdir(home, { recursive: true });

  const ocAuthHeaders = [];
  const pocketAuthHeaders = [];

  const ocPort = await startMockServer(t, (req, res) => {
    ocAuthHeaders.push(decodeBasicAuth(req.headers.authorization));
    res.setHeader("content-type", "application/json");
    if (req.url === "/api/info") return res.end('{"version":"2.0.9"}');
    if (req.url === "/global/health") {
      res.setHeader("content-type", "text/html");
      return res.end("<!doctype html>");
    }
    if (req.url === "/api/location") return res.end('{"directory":"/srv/project"}');
    if (req.url === "/api/model") return res.end('{"data":[{"id":"mock-model"}]}');
    res.statusCode = 404;
    res.end();
  });

  const pocketPort = await startMockServer(t, (req, res) => {
    pocketAuthHeaders.push(decodeBasicAuth(req.headers.authorization));
    res.setHeader("content-type", "application/json");
    if (req.url === "/api/health") {
      return res.end('{"backends":{"opencode":{"online":true},"codex":{"online":true}}}');
    }
    res.statusCode = 404;
    res.end();
  });

  await executable(join(fakeBin, "opencode"), MOCK_OPENCODE_DAEMON);
  await executable(join(fakeBin, "codex"), "#!/usr/bin/env bash\nexit 0\n");
  await executable(join(fakeBin, "node"), "#!/usr/bin/env bash\nexit 0\n");

  const customUser = 'custom"user';
  const customPass = 'pass"with\\quotes\tand:colons';
  const script = resolve("scripts/systemd-entrypoint.sh");
  await execFileAsync("bash", [script], {
    cwd: process.cwd(),
    timeout: 10000,
    env: {
      ...process.env,
      HOME: home,
      XDG_CONFIG_HOME: join(home, ".config"),
      PATH: fakeBin + ":" + process.env.PATH,
      DEVMOTER_AUTH_USERNAME: customUser,
      DEVMOTER_AUTH_PASSWORD: customPass,
      POCKET_PORT: String(pocketPort),
      OPENCODE_PORT: String(ocPort)
    }
  });

  const ocPassword = (await readFile(join(home, ".config", "opencode-pocket", "opencode-server-password"), "utf8")).trim();
  assert.ok(ocAuthHeaders.length >= 4);
  for (const auth of ocAuthHeaders) {
    assert.equal(auth, `opencode:${ocPassword}`);
  }
  assert.deepEqual(pocketAuthHeaders, [`${customUser}:${customPass}`]);
});

test("start-pocket launcher sets umask 077, uses npm ci, and keeps curl credentials out of argv", async t => {
  const root = await mkdtemp(join(tmpdir(), "devmoter-start-pocket-"));
  const stateDir = join(root, "home", ".config", "opencode-pocket");
  t.after(async () => {
    for (const pidName of ["opencode.pid", "pocket.pid"]) {
      try {
        const pid = Number((await readFile(join(stateDir, pidName), "utf8")).trim());
        if (Number.isInteger(pid) && pid > 0) process.kill(pid, "SIGTERM");
      } catch {
        // Process already exited or pidfile missing.
      }
    }
    await rm(root, { recursive: true, force: true });
  });

  const fakeRepo = join(root, "repo");
  const fakeScripts = join(fakeRepo, "scripts");
  const fakeBin = join(root, "bin");
  const home = join(root, "home");
  const npmLog = join(root, "npm.log");
  const curlLog = join(root, "curl.log");
  const curlStdinLog = join(root, "curl-stdin.log");
  await mkdir(fakeScripts, { recursive: true });
  await mkdir(fakeBin, { recursive: true });
  await mkdir(home, { recursive: true });

  const scriptCopy = join(fakeScripts, "start-pocket.sh");
  await copyFile(resolve("scripts/start-pocket.sh"), scriptCopy);
  await chmod(scriptCopy, 0o755);

  await executable(join(fakeBin, "pkill"), "#!/usr/bin/env bash\nexit 0\n");
  await executable(join(fakeBin, "tailscale"), "#!/usr/bin/env bash\nexit 0\n");
  await executable(join(fakeBin, "npm"), `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$DEVMOTER_NPM_LOG"
if [ "$1" = "ci" ]; then
  mkdir -p node_modules
fi
exit 0
`);
  await executable(join(fakeBin, "opencode"), "#!/usr/bin/env bash\necho 'mock opencode'\nexit 0\n");
  await executable(join(fakeBin, "codex"), "#!/usr/bin/env bash\nexit 0\n");
  await executable(join(fakeBin, "node"), "#!/usr/bin/env bash\necho 'mock node'\nexit 0\n");
  await executable(join(fakeBin, "curl"), MOCK_CURL_SCRIPT);

  await runWithPermissiveUmask(scriptCopy, {
    cwd: fakeRepo,
    timeout: 15000,
    env: {
      ...process.env,
      HOME: home,
      XDG_CONFIG_HOME: join(home, ".config"),
      PATH: fakeBin + ":" + process.env.PATH,
      DEVMOTER_NPM_LOG: npmLog,
      DEVMOTER_CURL_LOG: curlLog,
      DEVMOTER_CURL_STDIN_LOG: curlStdinLog,
      POCKET_PORT: "18788",
      OPENCODE_PORT: "14938"
    }
  });

  const npmInvocations = (await readFile(npmLog, "utf8")).trim().split("\n");
  assert.deepEqual(npmInvocations, ["ci", "run build"]);

  assert.equal((await stat(stateDir)).mode & 0o777, 0o700);
  for (const fileName of [
    "opencode-server-password",
    "devmoter-auth-password",
    "opencode.pid",
    "pocket.pid",
    "opencode.log",
    "pocket.log"
  ]) {
    assert.equal(
      (await stat(join(stateDir, fileName))).mode & 0o777,
      0o600,
      `${fileName} must be owner-only (0600)`
    );
  }

  const ocPassword = (await readFile(join(stateDir, "opencode-server-password"), "utf8")).trim();
  const authPassword = (await readFile(join(stateDir, "devmoter-auth-password"), "utf8")).trim();
  const log = await assertCurlCredentialsOutOfArgv(curlLog, curlStdinLog, ocPassword, authPassword);
  assert.match(log, /\/api\/health/);
  assert.match(log, /\/api\/opencode\/pocket\/providers/);
});

test("manual and systemd launchers keep the same readiness contract", async () => {
  const manual = await readFile(resolve("scripts/start-pocket.sh"), "utf8");
  const service = await readFile(resolve("scripts/systemd-entrypoint.sh"), "utf8");

  for (const source of [manual, service]) {
    // OpenCode 2.x reports its version on /api/info, 1.x on /global/health.
    assert.match(source, /\/api\/info/);
    assert.match(source, /\/global\/health/);
    assert.match(source, /\/api\/location/);
    assert.match(source, /\/api\/model/);
    assert.match(source, /\/api\/health/);
    assert.match(source, /backends.*opencode.*online/s);
    assert.match(source, /backends.*codex.*online/s);
  }
});
