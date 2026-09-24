import { detectCliAdapter } from "../detector.mjs";

export const opencodeAdapter = {
  id: "opencode", displayName: "OpenCode CLI", binary: "opencode",
  installSupport: "supported", installSourceClass: "A", requiresPrivilege: "user", installStatus: "manual-review",
  installSource: { type: "official-package-manager", publisher: "OpenCode", label: "Official npm distribution" },
  installChanges: ["Install OpenCode CLI into a user-writable npm global prefix."],
  installVerification: ["Confirm the opencode executable version and DevMoter compatibility."],
  notes: ["Review required: verify the currently documented package and detected CLI protocol compatibility before a future installer phase."],
  versionArgs: ["--version"], authCheck: { argv: ["auth", "list"] },
  detect: context => detectCliAdapter(opencodeAdapter, context)
};
