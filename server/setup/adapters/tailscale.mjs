import { detectCliAdapter } from "../detector.mjs";

export const tailscaleAdapter = {
  id: "tailscale", displayName: "Tailscale", binary: "tailscale",
  installSupport: "supported", installSourceClass: "A", requiresPrivilege: "administrator", installStatus: "manual-review",
  installSource: { type: "official-package-manager", publisher: "Tailscale", label: "Signed Tailscale distribution package" },
  installChanges: ["Install the Tailscale package and its system daemon."],
  installVerification: ["Confirm tailscale reports a version and inspect read-only local status."],
  notes: ["Review required: identify a supported distribution and preserve existing daemon, login, and Serve configuration. This preview never runs tailscale up or changes Serve."],
  versionArgs: ["version"], authCheck: { argv: ["status", "--json"] },
  detect: context => detectCliAdapter(tailscaleAdapter, context)
};
