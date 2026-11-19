import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
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

test("terminal runner rejects a CLI that exits before the startup window", async t => {
  const dir = await mkdtemp(join(tmpdir(), "devmoter-issue-210-exit-"));
  t.after(async () => rm(dir, { recursive: true, force: true }));
  const receipt = join(dir, "ack.json");
  const exit = join(dir, "exit-fast.mjs");
  // A slow-loading CLI can outlast the old 450ms window and exit before it is usable.
  await writeFile(exit, "await new Promise(resolve => setTimeout(resolve, 650)); process.exit(5);\n");
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

test("x-terminal-emulator receives single-command -e launcher and preserves cwd, PATH, and literal args", async t => {
  const dir = await mkdtemp(join(tmpdir(), "devmoter-issue-210-xterm-"));
  t.after(async () => rm(dir, { recursive: true, force: true }));
  const projectDir = join(dir, "project dir");
  const serviceBinDir = join(dir, "service-bin");
  await mkdir(projectDir);
  await mkdir(serviceBinDir);

  const script = join(dir, "fake agy.mjs");
  const observed = join(dir, "observed.json");
  await writeFile(script, `import { writeFileSync } from "node:fs";
writeFileSync(process.argv[2], JSON.stringify({
  cwd: process.cwd(),
  args: process.argv.slice(3),
  path: process.env.PATH || "",
  display: process.env.DISPLAY || ""
}));
setTimeout(() => process.exit(0), 1200);`);

  const injection = "a'b; touch /tmp/should-not-run";
  let capturedArgs = null;
  let capturedLauncherBody = null;

  const result = await launchCheckedInTerminal(process.execPath, projectDir, [script, observed, injection], {
    PATH: `${serviceBinDir}:/usr/bin:/bin`,
    HOME: dir,
    DISPLAY: ":99",
    GEMINI_API_KEY: "secret-should-not-hit-disk"
  }, {
    resolveExecutable: async bin => bin === "x-terminal-emulator" ? "/usr/bin/x-terminal-emulator" : null,
    spawnDetached: async (bin, args) => {
      assert.equal(bin, "/usr/bin/x-terminal-emulator");
      capturedArgs = [...args];
      assert.equal(args.length, 2, "x-terminal-emulator -e must receive a single command argument");
      assert.equal(args[0], "-e");
      capturedLauncherBody = await readFile(args[1], "utf8");
      // Simulate a terminal daemon that executes only args[1] from "/" with a minimal env.
      const child = spawn(args[1], [], {
        cwd: "/",
        env: { HOME: dir, PATH: "/usr/bin:/bin" },
        stdio: "ignore"
      });
      child.on("error", () => {});
      child.unref();
    },
    ackTimeoutMs: 4000,
    pollMs: 20
  });

  assert.equal(result.ok, true);
  assert.equal(result.terminal, "x-terminal-emulator");
  assert.equal(result.cliSpawnConfirmed, true);
  assert.ok(capturedLauncherBody && !capturedLauncherBody.includes("secret-should-not-hit-disk"));
  assert.equal(capturedArgs.length, 2);

  const actual = JSON.parse(await readFile(observed, "utf8"));
  assert.equal(actual.cwd, projectDir);
  assert.deepEqual(actual.args, [injection]);
  assert.ok(actual.path.split(":").includes(serviceBinDir));
  assert.equal(actual.display, ":99");
});

test("launchIntegration runs Antigravity and keeps Claude Code unchanged under strict single-arg x-terminal-emulator", async t => {
  const dir = await mkdtemp(join(tmpdir(), "devmoter-issue-210-e2e-"));
  t.after(async () => rm(dir, { recursive: true, force: true }));
  const binDir = join(dir, "bin");
  const projectDir = join(dir, "my project");
  await mkdir(binDir);
  await mkdir(projectDir);

  const agyObserved = join(dir, "agy-observed.json");
  const claudeObserved = join(dir, "claude-observed.json");
  const terminalLog = join(dir, "terminal-calls.jsonl");
  const fakeAgy = join(binDir, "agy");
  const fakeClaude = join(binDir, "claude");
  const fakeTerminal = join(binDir, "x-terminal-emulator");
  const fakeWhich = join(binDir, "which");
  const nodeBinDir = dirname(process.execPath);

  await writeFile(fakeWhich, `#!${process.execPath}
import { existsSync } from "node:fs";
import { join } from "node:path";
const name = process.argv[2] || "";
if (!name) process.exit(1);
if (name.startsWith("/")) {
  if (existsSync(name)) {
    console.log(name);
    process.exit(0);
  }
  process.exit(1);
}
const candidate = join(${JSON.stringify(binDir)}, name);
if (existsSync(candidate)) {
  console.log(candidate);
  process.exit(0);
}
process.exit(1);
`);
  await chmod(fakeWhich, 0o700);

  await writeFile(fakeAgy, `#!${process.execPath}
import { writeFileSync } from "node:fs";
if (process.argv.includes("--version")) {
  console.log("agy 2.0.0-test");
  process.exit(0);
}
writeFileSync(${JSON.stringify(agyObserved)}, JSON.stringify({
  cwd: process.cwd(),
  path: process.env.PATH || "",
  display: process.env.DISPLAY || ""
}));
setTimeout(() => process.exit(0), 1200);
`);
  await chmod(fakeAgy, 0o700);

  await writeFile(fakeClaude, `#!${process.execPath}
import { writeFileSync } from "node:fs";
if (process.argv.includes("--version")) {
  console.log("claude 1.0.0-test");
  process.exit(0);
}
writeFileSync(${JSON.stringify(claudeObserved)}, JSON.stringify({ cwd: process.cwd() }));
`);
  await chmod(fakeClaude, 0o700);

  // Strict terminal emulator: rejects >1 arg after -e and drops inherited PATH/DISPLAY.
  await writeFile(fakeTerminal, `#!${process.execPath}
import { appendFileSync } from "node:fs";
import { spawn } from "node:child_process";
const args = process.argv.slice(2);
appendFileSync(${JSON.stringify(terminalLog)}, JSON.stringify(args) + "\\n");
if (args.length !== 2 || args[0] !== "-e") {
  process.exit(2);
}
const child = spawn(args[1], [], {
  cwd: "/tmp",
  env: { HOME: ${JSON.stringify(dir)}, PATH: "/usr/bin:/bin" },
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
const claudeResult = await launchIntegration("claude", ${JSON.stringify(projectDir)});
const agyResult = await launchIntegration("antigravity", ${JSON.stringify(projectDir)});
console.log(JSON.stringify({ claudeResult, agyResult }));
`);

  const output = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [driver], {
      cwd: dir,
      env: {
        PATH: [binDir, nodeBinDir].join(delimiter),
        HOME: dir,
        DISPLAY: ":42",
        ANTIGRAVITY_BIN: fakeAgy,
        CLAUDE_BIN: fakeClaude
      },
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", chunk => { stdout += chunk; });
    child.stderr.on("data", chunk => { stderr += chunk; });
    child.once("error", reject);
    child.once("exit", code => {
      if (code !== 0) reject(new Error(`driver exited ${code}: ${stderr || stdout}`));
      else resolve(stdout.trim());
    });
  });

  const parsed = JSON.parse(output);
  assert.equal(parsed.claudeResult.ok, true);
  assert.equal(parsed.claudeResult.terminal, "x-terminal-emulator");
  assert.equal(parsed.agyResult.ok, true);
  assert.equal(parsed.agyResult.terminal, "x-terminal-emulator");
  assert.equal(parsed.agyResult.cliSpawnConfirmed, true);

  const calls = (await readFile(terminalLog, "utf8"))
    .trim()
    .split("\n")
    .map(line => JSON.parse(line));
  assert.deepEqual(calls[0], ["-e", fakeClaude]);
  assert.equal(calls[1].length, 2);
  assert.equal(calls[1][0], "-e");
  assert.match(calls[1][1], /launch-\d+\.sh$/);

  const agyActual = JSON.parse(await readFile(agyObserved, "utf8"));
  assert.equal(agyActual.cwd, projectDir);
  assert.ok(agyActual.path.split(":").includes(binDir));
  assert.equal(agyActual.display, ":42");
});
