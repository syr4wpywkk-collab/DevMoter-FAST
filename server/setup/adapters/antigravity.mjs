import { detectCliAdapter } from "../detector.mjs";

export const antigravityAdapter = {
  id: "antigravity", displayName: "Antigravity CLI", binary: "agy",
  installSupport: "supported", installSourceClass: "C", requiresPrivilege: "user", installStatus: "confirmation-required",
  installSource: { type: "official-bootstrap-script", publisher: "Google", label: "Official Antigravity CLI installer" },
  installChanges: ["Install agy into the current user's local bin directory.", "The official script may edit shell PATH/alias settings unless its documented opt-out flags are used."],
  installVerification: ["Confirm the agy executable reports a version."],
  notes: ["Source class C: later use requires explicit confirmation. The official script can edit shell profiles unless its documented opt-out flags are used."],
  versionArgs: ["--version"],
  detect: context => detectCliAdapter(antigravityAdapter, context)
};
