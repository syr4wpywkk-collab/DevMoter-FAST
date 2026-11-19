// Issue #589 verification tests. See docs/opencode-upstream-boundary.md.
//
// These tests pin down the OpenCode upstream credential boundary with
// throwaway secrets in temp dirs, fully offline (loopback only):
//   1. The launcher bootstrap (scripts/start-pocket.sh) creates the
//      credential store owner-only: dir 700, files 600, even when the
//      caller runs with a default umask, and reuses the secret on restart
//      (there is no rotation).
//   2. A separate process running as the same OS user can read the
//      credential file and reach the upstream directly, bypassing
//      DevMoter entirely — the accepted residual risk. Without the
//      credential the upstream refuses it.
//   3. DevMoter's upstream client (server/opencode-api.mjs) sends the
//      configured credential and fails closed: a wrong or absent
//      credential surfaces as an error, never as an unauthenticated
//      fallback.

import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { createOpenCodeClient } from "../server/opencode-api.mjs";

const execFileAsync = promisify(execFile);
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

const modeOf = async path => (await stat(path)).mode & 0o777;

// Extract the credential-bootstrap block of scripts/start-pocket.sh (from
// the STATE_DIR assignment through the secret setup that precedes
// stop_pidfile) so the test executes the script's real logic instead of a
// copy of it.
async function launcherBootstrap() {
  const script = await readFile(join(repoRoot, "scripts/start-pocket.sh"), "utf8");
  const lines = script.split("\n");
  const start = lines.findIndex(line => line.startsWith("STATE_DIR="));
  const end = lines.findIndex((line, index) => index > start && line.startsWith("stop_pidfile()"));
  assert.ok(start >= 0 && end > start, "bootstrap block anchors must exist in start-pocket.sh");
  return { script, block: lines.slice(start, end).join("\n") };
}

async function runBootstrap(home, launcher = "start-pocket.sh") {
  let block;
  if (launcher === "start-pocket.sh") {
    ({ block } = await launcherBootstrap());
  } else {
    const source = await readFile(join(repoRoot, "scripts", launcher), "utf8");
    const lines = source.split("\n");
    const start = lines.findIndex(line => line.startsWith("STATE_DIR="));
    const setup = lines.findIndex(line => line === 'PREV_UMASK="$(umask)"');
    const end = lines.findIndex(line => line === 'umask "$PREV_UMASK"');
    assert.ok(start >= 0 && setup > start + 2 && end > setup, "systemd bootstrap anchors must exist");
    block = [...lines.slice(start, start + 3), ...lines.slice(setup, end + 1)].join("\n");
  }
  // umask 022 simulates a default interactive shell: the script must
  // harden the credential files itself, not inherit safe permissions.
  await execFileAsync("bash", ["-c", "umask 022\nset -euo pipefail\n" + block], {
    cwd: home,
    env: { PATH: process.env.PATH, HOME: home }
  });
  const dir = join(home, ".config", "opencode-pocket");
  return {
    dir,
    ocSecretPath: join(dir, "opencode-server-password"),
    authSecretPath: join(dir, "devmoter-auth-password")
  };
}

for (const launcher of ["start-pocket.sh", "systemd-entrypoint.sh"]) {
  test(`${launcher}: bootstrap creates owner-only credentials and reuses them`, async t => {
    const home = await mkdtemp(join(tmpdir(), "devmoter-589-"));
    t.after(() => rm(home, { recursive: true, force: true }));
    const { dir, ocSecretPath, authSecretPath } = await runBootstrap(home, launcher);

    assert.equal(await modeOf(dir), 0o700, "credential directory must be 700");
    assert.equal(await modeOf(ocSecretPath), 0o600, "OpenCode password file must be 600");
    assert.equal(await modeOf(authSecretPath), 0o600, "DevMoter password file must be 600");

    const ocSecret = (await readFile(ocSecretPath, "utf8")).trim();
    const authSecret = (await readFile(authSecretPath, "utf8")).trim();
    assert.ok(ocSecret.length >= 40, "generated OpenCode password is a long random token");
    assert.ok(authSecret.length >= 40, "generated DevMoter password is a long random token");
    assert.notEqual(ocSecret, authSecret, "the two credentials are independent");

    // A restart reuses the existing files: the bootstrap never rotates.
    await runBootstrap(home, launcher);
    assert.equal((await readFile(ocSecretPath, "utf8")).trim(), ocSecret, "restart must reuse the OpenCode password");
    assert.equal((await readFile(authSecretPath, "utf8")).trim(), authSecret, "restart must reuse the DevMoter password");
  });
}

test("launcher scripts keep the chmod/umask contract (static guardrails)", async () => {
  const { script } = await launcherBootstrap();
  assert.ok(script.includes('chmod 700 "$STATE_DIR"'), "start-pocket.sh chmods the credential directory 700");
  assert.ok(script.includes('chmod 600 "$SECRET_FILE"'), "start-pocket.sh chmods the OpenCode password file 600");
  assert.ok(script.includes('chmod 600 "$AUTH_SECRET_FILE"'), "start-pocket.sh chmods the DevMoter password file 600");
  // NOTE: the static ordering assertions in this test are what actually
  // pin the create-then-chmod race fix. The runtime mode assertions in
  // the bootstrap tests cannot distinguish the fixed scripts from the
  // old create-then-chmod ones, because both end at 600 once the chmod
  // runs — only the ordering (umask restricted *before* the redirection
  // creates the file, restored only after both secrets exist) proves
  // the secret never exists at a weaker mode.
  const umaskAt = script.indexOf("umask 077");
  const createAt = script.indexOf('> "$SECRET_FILE"');
  assert.ok(umaskAt >= 0 && createAt >= 0 && umaskAt < createAt,
    "start-pocket.sh restricts the umask before creating the OpenCode password file");
  const createAuthAt = script.indexOf('> "$AUTH_SECRET_FILE"');
  const restoreAt = script.indexOf('umask "$PREV_UMASK"');
  const stopAt = script.indexOf("stop_pidfile()");
  assert.ok(createAuthAt >= 0 && restoreAt > createAt && restoreAt > createAuthAt && stopAt > restoreAt,
    "start-pocket.sh restores the caller's umask after both secrets exist and before the rest of the launcher runs");

  const entrypoint = await readFile(join(repoRoot, "scripts/systemd-entrypoint.sh"), "utf8");
  assert.ok(entrypoint.includes('chmod 700 "$STATE_DIR"'), "systemd-entrypoint.sh chmods the credential directory 700");
  assert.ok(entrypoint.includes('chmod 600 "$file"'), "systemd-entrypoint.sh chmods secret files 600 in ensure_secret()");
  const epUmaskAt = entrypoint.indexOf("umask 077");
  const epCreateAt = entrypoint.indexOf('>"$file"');
  assert.ok(epUmaskAt >= 0 && epCreateAt >= 0 && epUmaskAt < epCreateAt,
    "systemd-entrypoint.sh restricts the umask before ensure_secret() creates a secret file");
  const epRestoreAt = entrypoint.indexOf('umask "$PREV_UMASK"');
  const epLastEnsureAt = entrypoint.lastIndexOf('ensure_secret "');
  assert.ok(epLastEnsureAt >= 0 && epRestoreAt > epLastEnsureAt,
    "systemd-entrypoint.sh restores the caller's umask after the last ensure_secret() call");
});

test("launcher bootstrap repairs pre-existing loose secret files to 600 (self-heal)", async () => {
  const home = await mkdtemp(join(tmpdir(), "devmoter-589-"));
  const dir = join(home, ".config", "opencode-pocket");
  await mkdir(dir, { recursive: true });
  const ocSecretPath = join(dir, "opencode-server-password");
  const authSecretPath = join(dir, "devmoter-auth-password");
  // Simulate files left behind by a pre-hardening bootstrap that was
  // interrupted between redirection and chmod: real content, mode 644.
  await writeFile(ocSecretPath, "preexisting-opencode-secret-589\n");
  await writeFile(authSecretPath, "preexisting-devmoter-secret-589\n");
  await chmod(ocSecretPath, 0o644);
  await chmod(authSecretPath, 0o644);
  assert.equal(await modeOf(ocSecretPath), 0o644, "precondition: OpenCode password file starts at 644");
  assert.equal(await modeOf(authSecretPath), 0o644, "precondition: DevMoter password file starts at 644");

  await runBootstrap(home);

  assert.equal(await modeOf(ocSecretPath), 0o600,
    "bootstrap must re-apply 600 to the existing OpenCode password file");
  assert.equal(await modeOf(authSecretPath), 0o600,
    "bootstrap must re-apply 600 to the existing DevMoter password file");
  // The existing credentials are repaired, not rotated.
  assert.equal((await readFile(ocSecretPath, "utf8")).trim(), "preexisting-opencode-secret-589");
  assert.equal((await readFile(authSecretPath, "utf8")).trim(), "preexisting-devmoter-secret-589");
});

// An OpenCode-shaped upstream that enforces HTTP Basic auth the way
// OpenCode does when OPENCODE_SERVER_PASSWORD is set: the configured
// credential gets JSON answers, anything else gets a 401.
async function authCheckingUpstream(password) {
  const expected = "Basic " + Buffer.from(`opencode:${password}`).toString("base64");
  const server = createServer((req, res) => {
    if (req.headers.authorization !== expected) {
      res.writeHead(401, { "content-type": "application/json" });
      res.end(JSON.stringify({ message: "unauthorized" }));
      return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(req.url === "/global/health" ? { version: "1.19.5" } : { ok: true }));
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  return { server, url: `http://127.0.0.1:${server.address().port}` };
}

// A standalone process: no DevMoter code, it just reads a credential file
// and talks to the upstream directly, like any same-user process could.
const DIRECT_ACCESS_CHILD = `
import { readFile } from "node:fs/promises";
const [secretPath, url] = process.argv.slice(1);
const password = (await readFile(secretPath, "utf8")).trim();
const response = await fetch(url, {
  headers: { authorization: "Basic " + Buffer.from("opencode:" + password).toString("base64") }
});
console.log(response.status);
`;

test("a same-user process can read the credential file and reach the upstream directly (residual risk)", async () => {
  const home = await mkdtemp(join(tmpdir(), "devmoter-589-"));
  const { ocSecretPath } = await runBootstrap(home);
  const password = (await readFile(ocSecretPath, "utf8")).trim();
  const { server, url } = await authCheckingUpstream(password);
  try {
    const direct = await execFileAsync(process.execPath, [
      "--input-type=module", "-e", DIRECT_ACCESS_CHILD, ocSecretPath, url + "/api/session"
    ]);
    assert.equal(direct.stdout.trim(), "200",
      "same-user process with the file's credential gets full upstream access, bypassing DevMoter");

    const wrongPath = join(home, "wrong-secret");
    await writeFile(wrongPath, "throwaway-wrong-password\n", { mode: 0o600 });
    const refused = await execFileAsync(process.execPath, [
      "--input-type=module", "-e", DIRECT_ACCESS_CHILD, wrongPath, url + "/api/session"
    ]);
    assert.equal(refused.stdout.trim(), "401", "without the real credential the upstream refuses direct access");

    const anonymous = await fetch(url + "/api/session");
    assert.equal(anonymous.status, 401, "no credential at all is refused too");
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

// Mirrors server.mjs openCodeHeaders(): the Authorization header exists
// only when a password is configured. server.mjs does not export the
// function, so the composition is reproduced here against the real
// client from server/opencode-api.mjs.
const basicHeaders = password => extra =>
  password
    ? { ...extra, authorization: "Basic " + Buffer.from(`opencode:${password}`).toString("base64") }
    : { ...extra };

test("DevMoter's upstream client sends the configured credential and fails closed without it", async () => {
  const password = "throwaway-upstream-password-589";
  const { server, url } = await authCheckingUpstream(password);
  try {
    const authed = createOpenCodeClient({ baseUrl: url, headers: basicHeaders(password) });
    assert.deepEqual(await authed.info(), { generation: "v1", version: "1.19.5", source: "/global/health" });
    assert.deepEqual(await authed.fetchJson("/api/session"), { ok: true });

    const wrong = createOpenCodeClient({ baseUrl: url, headers: basicHeaders("throwaway-wrong-password") });
    await assert.rejects(wrong.fetchJson("/api/session"), error => error.status === 401);
    await assert.rejects(wrong.info(), /Could not detect the OpenCode API version/);

    const absent = createOpenCodeClient({ baseUrl: url, headers: basicHeaders("") });
    await assert.rejects(absent.fetchJson("/api/session"), error => error.status === 401);
    await assert.rejects(absent.info(), /Could not detect the OpenCode API version/);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
