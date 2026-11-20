// Preflight checks (SPEC §6): verify the devin binary works (`--version`,
// `devin doctor`) and, for sandbox mode, that bubblewrap/socat exist.

import { runCommand, which } from "../util/exec.js";

const SANDBOX_INSTALL_HINT = "sudo apt-get install -y bubblewrap socat";

/** Extract the failure count from `devin doctor` output ("N failure(s)"). */
export function doctorFailureCount(doctorOutput: string): number | null {
  const m = doctorOutput.match(/(\d+)\s+failure\(s\)/);
  return m ? Number(m[1]) : null;
}

export async function devinPreflight(opts: {
  devinBin: string;
  needSandbox: boolean;
}): Promise<{ version: string; doctorOutput: string }> {
  const versionRes = await runCommand(opts.devinBin, ["--version"]);
  if (versionRes.code !== 0) {
    throw new Error(
      `devin --version failed (exit ${versionRes.code ?? "null"}): ` +
        `${(versionRes.stderr || versionRes.stdout).trim().slice(0, 500)}`,
    );
  }
  const version = versionRes.stdout.trim().split("\n")[0] ?? "";

  const doctorRes = await runCommand(opts.devinBin, ["doctor"]);
  const doctorOutput = [doctorRes.stdout, doctorRes.stderr]
    .filter(Boolean)
    .join("\n")
    .trim();
  const failures = doctorFailureCount(doctorOutput);
  if (doctorRes.code !== 0 || (failures !== null && failures > 0)) {
    throw new Error(
      `devin doctor reported problems (exit ${doctorRes.code ?? "null"}` +
        `${failures !== null ? `, ${failures} failure(s)` : ""}):\n${doctorOutput}`,
    );
  }

  if (opts.needSandbox) {
    const missing: string[] = [];
    if ((await which("bwrap")) === null) missing.push("bwrap (bubblewrap)");
    if ((await which("socat")) === null) missing.push("socat");
    if (missing.length > 0) {
      throw new Error(
        `sandbox mode (--sandbox) requires ${missing.join(" and ")}, ` +
          `which was not found on PATH. Install with: ${SANDBOX_INSTALL_HINT}`,
      );
    }
  }

  return { version, doctorOutput };
}
