import { detectCliAdapter } from "../detector.mjs";

export const githubAdapter = {
  id: "github", displayName: "GitHub CLI", binary: "gh",
  authEnvKeys: ["GH_TOKEN", "GITHUB_TOKEN"],
  versionArgs: ["--version"], authCheck: { argv: ["auth", "status", "--active", "--hostname", "github.com"], failureMeansRequired: true },
  detect: context => detectCliAdapter(githubAdapter, context)
};
