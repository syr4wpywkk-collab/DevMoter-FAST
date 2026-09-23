import { detectCliAdapter } from "../detector.mjs";

export const claudeAdapter = {
  id: "claude", displayName: "Claude Code", binary: "claude",
  versionArgs: ["--version"],
  detect: context => detectCliAdapter(claudeAdapter, context)
};
