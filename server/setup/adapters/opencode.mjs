import { detectCliAdapter } from "../detector.mjs";

export const opencodeAdapter = {
  id: "opencode", displayName: "OpenCode CLI", binary: "opencode",
  installSupport: "supported", installSourceClass: "A", requiresPrivilege: "user", installStatus: "candidate",
  installSource: { type: "official-package-manager", publisher: "OpenCode", label: "Official npm distribution" },
  installChanges: ["Install OpenCode CLI into a user-writable npm global prefix."],
  installVerification: ["Confirm the opencode executable version and DevMoter compatibility."],
  notes: ["Automatic install is limited to the current official npm package and a user-owned global prefix; existing provider configuration is preserved."],
  versionArgs: ["--version"], authCheck: { argv: ["auth", "list"] },
  detect: context => detectCliAdapter(opencodeAdapter, context)
};
