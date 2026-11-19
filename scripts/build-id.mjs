import { execFileSync } from "node:child_process";

const BUILD_ID_PATTERN = /^[0-9A-Za-z][0-9A-Za-z._-]{0,63}$/;

function git(args) {
  return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
}

// Identifier of the web bundle being built, shown in Settings > Diagnostics.
// Empty (shown as "unknown") when it cannot be determined.
export function resolveBuildId(env = process.env) {
  for (const value of [env.DEVMOTER_BUILD, env.GITHUB_SHA]) {
    const text = (value || "").trim();
    if (BUILD_ID_PATTERN.test(text)) return text;
  }
  try {
    const sha = git(["rev-parse", "HEAD"]);
    if (!/^[0-9a-f]{40}$/.test(sha)) return "";
    return git(["status", "--porcelain"]) ? `${sha.slice(0, 12)}-dirty` : sha;
  } catch {
    return "";
  }
}
