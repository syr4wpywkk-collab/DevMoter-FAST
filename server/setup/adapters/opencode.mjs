import { detectCliAdapter } from "../detector.mjs";

export const opencodeAdapter = {
  id: "opencode", displayName: "OpenCode CLI", binary: "opencode",
  versionArgs: ["--version"], authCheck: { argv: ["auth", "list"] },
  detect: context => detectCliAdapter(opencodeAdapter, context)
};
