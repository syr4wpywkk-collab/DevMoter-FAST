import { spawn } from "node:child_process";
import { once } from "node:events";
import { writeFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import { setTimeout as delay } from "node:timers/promises";
import { assertCliReady, cliDefinition } from "./cli-launch.mjs";

// The parent passes fixed argv elements. Do not interpret commands through a shell.
const [ackPath, executable, cwd, ...args] = process.argv.slice(2);

async function report(result) {
  try {
    await writeFile(ackPath, JSON.stringify(result), { flag: "wx", mode: 0o600 });
  } catch {
    console.error("DevMoter could not return the terminal launch result.");
  }
}

async function holdFailure() {
  if (!process.stdin.isTTY || !process.stdout.isTTY) return;
  const readline = createInterface({ input: process.stdin, output: process.stdout });
  await new Promise(resolve => readline.question("Press Enter to close this terminal… ", resolve));
  readline.close();
}

async function main() {
  if (!ackPath || !executable || !cwd) {
    console.error("Invalid DevMoter terminal launch arguments.");
    process.exitCode = 2;
    return;
  }

  // Keep this runner attached to the terminal so command errors remain visible.
  // A successful emulator spawn is not sufficient: report only after CLI starts.
  let command = executable;
  if (cliDefinition(executable)) {
    try {
      command = (await assertCliReady(executable)).resolvedPath;
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      await report({ ok: false, reason: error?.code || "failed" });
      await holdFailure();
      process.exitCode = 1;
      return;
    }
  }
  const child = spawn(command, args, {
    cwd,
    stdio: "inherit",
    env: process.env,
    shell: false
  });
  const finished = new Promise(resolve => {
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });

  try {
    await once(child, "spawn");
    const early = await Promise.race([
      finished,
      delay(1000).then(() => null)
    ]);
    if (early) {
      console.error("DevMoter: the CLI exited before its interactive session was ready.");
      await report({ ok: false, reason: "early-exit" });
      await holdFailure();
      process.exitCode = early.code || 1;
      return;
    }

    await report({ ok: true });
    const exit = await finished;
    process.exitCode = exit.code ?? 1;
  } catch (error) {
    const reason = error?.code === "ENOENT" ? "missing" :
      error?.code === "EACCES" ? "permission" : "spawn-failed";
    console.error("DevMoter: could not start the CLI (" + reason + ").");
    await report({ ok: false, reason });
    await holdFailure();
    process.exitCode = 1;
  }
}

await main();
