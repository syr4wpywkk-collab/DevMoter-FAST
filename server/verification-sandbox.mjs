import { realpath } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { buildBubblewrapCommand } from "./advanced-features.mjs";

const protectedRoots = ["/usr", "/bin", "/lib", "/lib64", "/etc", "/run", "/proc", "/dev", "/sys"];
const broadRoots = new Set(["/", "/home", "/root", "/tmp", "/var", "/opt", "/mnt", "/media", "/srv"]);

export async function verificationExecutionPlan({ projectPath, command, args, env = process.env, spawn }) {
  const requested = String(env.DEVMOTER_VERIFICATION_SANDBOX || "").toLowerCase();
  if (requested && requested !== "required") {
    throw new Error("Unsupported DEVMOTER_VERIFICATION_SANDBOX value");
  }
  const required = requested === "required" ||
    String(env.DEVMOTER_SANDBOX || "").toLowerCase() === "required";
  if (!required) {
    return { command, args, cwd: projectPath, env, mode: "host" };
  }
  if (typeof projectPath !== "string" || !isAbsolute(projectPath)) {
    throw new Error("Isolated verification requires a registered absolute project path");
  }
  const cwd = await realpath(projectPath);
  if (broadRoots.has(cwd) || protectedRoots.some(root => cwd === root || cwd.startsWith(root + "/"))) {
    throw new Error("Isolated verification requires a dedicated project directory");
  }
  const wrapped = buildBubblewrapCommand({
    projectPath: cwd,
    command,
    args,
    grants: [],
    allowNetwork: false,
    failClosed: true,
    unsharePid: true,
    privateRuntime: true,
    env,
    ...(spawn ? { spawn } : {}),
  });
  // Use a deliberately small, fixed process environment for the wrapper and
  // its payload. No inherited provider keys, home path or loader variables.
  return {
    command: wrapped.command,
    args: wrapped.args,
    cwd,
    env: {
      PATH: "/usr/local/bin:/usr/bin:/bin",
      HOME: "/tmp",
      TMPDIR: "/tmp",
      LANG: "C.UTF-8",
    },
    mode: "bubblewrap",
  };
}
