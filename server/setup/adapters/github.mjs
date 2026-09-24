import { detectCliAdapter } from "../detector.mjs";

export const githubAdapter = {
  id: "github", displayName: "GitHub CLI", binary: "gh",
  installSupport: "supported", installSourceClass: "A", requiresPrivilege: "administrator", installStatus: "manual-review",
  installSource: { type: "official-package-manager", publisher: "GitHub CLI maintainers", label: "Signed Linux distribution package" },
  installChanges: ["Install GitHub CLI as a system package from the supported distribution source."],
  installVerification: ["Confirm gh reports a version; preserve existing auth configuration."],
  notes: ["Review required: Phase 1 does not identify the Linux distribution, so a matching official package source cannot yet be selected."],
  authEnvKeys: ["GH_TOKEN", "GITHUB_TOKEN"],
  versionArgs: ["--version"], authCheck: { argv: ["auth", "status", "--active", "--hostname", "github.com"], failureMeansRequired: true },
  detect: context => detectCliAdapter(githubAdapter, context)
};
