import { detectCliAdapter } from "../detector.mjs";

// NOTE on authCheck: intentionally omitted.
// `devin auth status` exits 0 both when logged in ("Logged in (via Devin).")
// and when not ("Not logged in."), but detector.mjs's authFrom() only
// inspects the exit code (result.code === 0 => authenticated). Adding an
// exit-code authCheck here would therefore always report Devin as
// authenticated, even when logged out. Login state is instead checked
// correctly by DevinBridge.health() in server/devin-bridge.mjs, which
// parses the leading text of `devin auth status`. Without authCheck,
// detectCliAdapter reports authState "unknown" / state "installed",
// which is the honest result for this detector.
export const devinAdapter = {
  id: "devin", displayName: "Devin CLI", binary: "devin",
  installSupport: "supported", installSourceClass: "C", requiresPrivilege: "user", installStatus: "confirmation-required",
  installSource: { type: "official-bootstrap-script", publisher: "Devin", label: "Official Devin CLI installer" },
  installChanges: ["Install Devin CLI into the current user's local bin directory via the official installer (curl -fsSL https://cli.devin.ai/install.sh | bash)."],
  installVerification: ["Confirm the devin executable reports a version."],
  notes: ["Source class C: a later install phase must show the fixed official source and obtain explicit user confirmation before use.", "Devin auth status exits 0 even when not logged in, so setup detection does not use an exit-code authCheck; login is checked by DevinBridge health via output text."],
  authEnvKeys: [],
  versionArgs: ["--version"],
  detect: context => detectCliAdapter(devinAdapter, context)
};
