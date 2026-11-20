import { spawn } from "node:child_process";
import { access, constants } from "node:fs/promises";
import * as path from "node:path";

export interface ExecResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

const DEFAULT_MAX_BYTES = 8 * 1024 * 1024;

export function runCommand(
  bin: string,
  args: string[],
  opts?: {
    cwd?: string;
    timeoutMs?: number;
    input?: string | Buffer;
    env?: NodeJS.ProcessEnv;
  },
): Promise<ExecResult> {
  return new Promise((resolve) => {
    const child = spawn(bin, args, {
      cwd: opts?.cwd,
      env: opts?.env ?? process.env,
      shell: false,
      detached: true,
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let timedOut = false;
    let settled = false;

    const timer =
      opts?.timeoutMs && opts.timeoutMs > 0
        ? setTimeout(() => {
            timedOut = true;
            try {
              if (child.pid) process.kill(-child.pid, "SIGKILL");
            } catch {
              try {
                child.kill("SIGKILL");
              } catch {
                /* already gone */
              }
            }
          }, opts.timeoutMs)
        : null;

    const append = (
      current: string,
      used: number,
      chunk: Buffer,
    ): [string, number] => {
      if (used >= DEFAULT_MAX_BYTES) return [current, used];
      const room = DEFAULT_MAX_BYTES - used;
      const slice = chunk.length > room ? chunk.subarray(0, room) : chunk;
      return [current + slice.toString("utf8"), used + slice.length];
    };

    child.stdout?.on("data", (chunk: Buffer) => {
      [stdout, stdoutBytes] = append(stdout, stdoutBytes, chunk);
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      [stderr, stderrBytes] = append(stderr, stderrBytes, chunk);
    });

    const finish = (code: number | null) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve({ code, stdout, stderr, timedOut });
    };

    child.on("error", () => finish(null));
    child.on("close", (code) => finish(code));

    if (opts?.input !== undefined) {
      // Never log input contents.
      child.stdin?.end(opts.input);
    } else {
      child.stdin?.end();
    }
  });
}

export async function which(bin: string): Promise<string | null> {
  if (bin.includes("/") || bin.includes("\\")) {
    try {
      await access(bin, constants.X_OK);
      return bin;
    } catch {
      return null;
    }
  }
  const pathEnv = process.env.PATH ?? "";
  const exts =
    process.platform === "win32" ? [".exe", ".cmd", ".bat", ""] : [""];
  for (const dir of pathEnv.split(path.delimiter)) {
    if (!dir) continue;
    for (const ext of exts) {
      const candidate = path.join(dir, bin + ext);
      try {
        await access(candidate, constants.X_OK);
        return candidate;
      } catch {
        /* keep searching */
      }
    }
  }
  return null;
}
