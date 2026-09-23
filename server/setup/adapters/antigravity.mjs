import { detectCliAdapter } from "../detector.mjs";

export const antigravityAdapter = {
  id: "antigravity", displayName: "Antigravity CLI", binary: "agy",
  versionArgs: ["--version"],
  detect: context => detectCliAdapter(antigravityAdapter, context)
};
