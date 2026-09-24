import { detectCliAdapter } from "../detector.mjs";

export const claudeAdapter = {
  id: "claude", displayName: "Claude Code", binary: "claude",
  installSupport: "supported", installSourceClass: "C", requiresPrivilege: "user", installStatus: "confirmation-required",
  installSource: { type: "official-bootstrap-script", publisher: "Anthropic", label: "Official Claude Code native installer" },
  installChanges: ["Install Claude Code launcher and versions in the current user's profile."],
  installVerification: ["Confirm the claude executable reports a version."],
  notes: ["Source class C: a later install phase must show the fixed official source and obtain explicit user confirmation before use."],
  versionArgs: ["--version"],
  detect: context => detectCliAdapter(claudeAdapter, context)
};
