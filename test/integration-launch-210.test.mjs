import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  desktopTerminalCandidates,
  launchCheckedInTerminal
} from "../server/integrations.mjs";

test("XFCE uses argv-safe execute mode before the generic terminal alias", () => {
  const entries = desktopTerminalCandidates("linux", "/opt/agy", ["--flag", "literal;name"]);
  assert.equal(entries[0].bin, "xfce4-terminal");
  assert.deepEqual(entries[0].args, ["--disable-server", "-x", "/opt/agy", "--flag", "literal;name"]);
  assert.ok(entries.some(entry => entry.bin === "x-terminal-emulator"));
  assert.deepEqual(desktopTerminalCandidates("darwin", "/opt/agy"), []);
});

test("Antigravity cannot claim graphical startup when systemd lacks the display", async () => {
  await assert.rejects(
    launchCheckedInTerminal("/opt/agy", "/tmp", [], { PATH: "/usr/bin" }),
    /No graphical session/
  );
});

test("Antigravity returns an explicit error when no GUI terminal is installed", async () => {
  await assert.rejects(
    launchCheckedInTerminal("/opt/agy", "/tmp", [], { DISPLAY: ":0" }, {
      resolveExecutable: async () => null
    }),
    /No supported graphical terminal/
  );
});

test("Antigravity does not claim startup merely because an emulator starts", async () => {
  await assert.rejects(
    launchCheckedInTerminal("/opt/agy", "/tmp", [], { DISPLAY: ":0" }, {
      resolveExecutable: async bin => bin === "xfce4-terminal" ? "/usr/bin/xfce4-terminal" : null,
      spawnDetached: async () => {},
      ackTimeoutMs: 40,
      pollMs: 5
    }),
    /did not confirm startup/
  );
});

test("interactive CLI receipt proves process launch in selected project without a shell", async t => {
  const dir = await mkdtemp(join(tmpdir(), "devmoter-issue-210-"));
  t.after(async () => rm(dir, { recursive: true, force: true }));
  const script = join(dir, "fake antigravity.mjs");
  const observed = join(dir, "observed.json");
  await writeFile(script, `import { writeFileSync } from "node:fs";
writeFileSync(process.argv[2], JSON.stringify({ cwd: process.cwd(), args: process.argv.slice(3) }));
setTimeout(() => process.exit(0), 1200);`);
  const attempts = [];
  const injection = "a; touch /tmp/should-not-run";
  const result = await launchCheckedInTerminal(process.execPath, dir, [script, observed, injection], {
    ...process.env,
    DISPLAY: ":0"
  }, {
    resolveExecutable: async bin => ["xfce4-terminal", "gnome-terminal"].includes(bin) ? "/bin/fake-terminal" : null,
    spawnDetached: async (bin, args, cwd, env) => {
      attempts.push({ bin, args, cwd });
      if (attempts.length === 1) throw new Error("XFCE unavailable");
      const offset = args.indexOf(process.execPath);
      assert.ok(offset >= 0);
      const runner = spawn(process.execPath, args.slice(offset + 1), {
        cwd,
        env,
        stdio: "ignore"
      });
      runner.on("error", () => {});
      runner.unref();
    },
    ackTimeoutMs: 3000,
    pollMs: 20
  });
  assert.equal(result.ok, true);
  assert.equal(result.cliSpawnConfirmed, true);
  assert.equal(result.terminal, "gnome-terminal");
  const actual = JSON.parse(await readFile(observed, "utf8"));
  assert.equal(actual.cwd, dir);
  assert.deepEqual(actual.args, [injection]);
  assert.equal(attempts.length, 2);
});

test("terminal runner rejects a CLI that exits immediately", async t => {
  const dir = await mkdtemp(join(tmpdir(), "devmoter-issue-210-exit-"));
  t.after(async () => rm(dir, { recursive: true, force: true }));
  const receipt = join(dir, "ack.json");
  const exit = join(dir, "exit-fast.mjs");
  await writeFile(exit, "process.exit(5);\n");
  const entry = fileURLToPath(new URL("../server/integration-terminal-runner.mjs", import.meta.url));
  const child = spawn(process.execPath, [entry, receipt, process.execPath, dir, exit], {
    cwd: dir,
    stdio: "ignore"
  });
  const code = await new Promise((resolve, reject) => {
    child.once("exit", resolve);
    child.once("error", reject);
  });
  const ack = JSON.parse(await readFile(receipt, "utf8"));
  assert.equal(code, 5);
  assert.deepEqual(ack, { ok: false, reason: "early-exit" });
});
