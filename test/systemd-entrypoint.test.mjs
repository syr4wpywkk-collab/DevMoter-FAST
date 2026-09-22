import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { chmod, mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

async function executable(path, content) {
  await writeFile(path, content);
  await chmod(path, 0o755);
}

test("systemd entrypoint provisions DevMoter auth and uses it for readiness", async t => {
  const root = await mkdtemp(join(tmpdir(), "devmoter-systemd-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const fakeBin = join(root, "bin");
  const home = join(root, "home");
  const capture = join(root, "capture.txt");
  const curlLog = join(root, "curl.log");
  await mkdir(fakeBin, { recursive: true });
  await mkdir(home, { recursive: true });

  await executable(join(fakeBin, "opencode"), `#!/usr/bin/env bash
trap 'exit 0' TERM INT
while :; do sleep 1; done
`);
  await executable(join(fakeBin, "codex"), "#!/usr/bin/env bash\nexit 0\n");
  await executable(join(fakeBin, "curl"), `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$DEVMOTER_CURL_LOG"
exit 0
`);
  await executable(join(fakeBin, "node"), `#!/usr/bin/env bash
printf '%s\\n%s\\n' "$DEVMOTER_AUTH_USERNAME" "$DEVMOTER_AUTH_PASSWORD" > "$DEVMOTER_TEST_CAPTURE"
exit 0
`);

  const script = resolve("scripts/systemd-entrypoint.sh");
  await execFileAsync("bash", [script], {
    cwd: process.cwd(),
    timeout: 10000,
    env: {
      ...process.env,
      HOME: home,
      XDG_CONFIG_HOME: join(home, ".config"),
      PATH: fakeBin + ":" + process.env.PATH,
      DEVMOTER_TEST_CAPTURE: capture,
      DEVMOTER_CURL_LOG: curlLog,
      POCKET_PORT: "18787",
      OPENCODE_PORT: "14937"
    }
  });

  const [user, password] = (await readFile(capture, "utf8")).trim().split("\n");
  assert.equal(user, "devmoter");
  assert.ok(password.length >= 16);

  const secret = join(home, ".config", "opencode-pocket", "devmoter-auth-password");
  assert.equal((await stat(secret)).mode & 0o777, 0o600);

  const log = await readFile(curlLog, "utf8");
  assert.match(log, /-u opencode:/);
  assert.match(log, /-u devmoter:/);
  assert.match(log, /\/api\/health/);
});
