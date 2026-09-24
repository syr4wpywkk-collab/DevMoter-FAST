import { detectCliAdapter } from "../detector.mjs";

export const codexAdapter = {
  id: "codex", displayName: "OpenAI Codex CLI", binary: "codex",
  installSupport: "supported", installSourceClass: "A", requiresPrivilege: "user", installStatus: "candidate",
  installSource: { type: "official-package-manager", publisher: "OpenAI", label: "Official npm distribution" },
  installChanges: ["Install Codex CLI into a user-writable npm global prefix."],
  installVerification: ["Confirm the codex executable reports a version."],
  notes: ["A user-owned npm prefix must be available. Never use sudo or change npm configuration automatically."],
  authEnvKeys: ["OPENAI_API_KEY"],
  versionArgs: ["--version"], authCheck: { argv: ["login", "status"], failureMeansRequired: true },
  detect: context => detectCliAdapter(codexAdapter, context)
};
