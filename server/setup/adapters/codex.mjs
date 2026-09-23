import { detectCliAdapter } from "../detector.mjs";

export const codexAdapter = {
  id: "codex", displayName: "OpenAI Codex CLI", binary: "codex",
  authEnvKeys: ["OPENAI_API_KEY"],
  versionArgs: ["--version"], authCheck: { argv: ["login", "status"], failureMeansRequired: true },
  detect: context => detectCliAdapter(codexAdapter, context)
};
