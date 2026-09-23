import { detectCliAdapter } from "../detector.mjs";

export const tailscaleAdapter = {
  id: "tailscale", displayName: "Tailscale", binary: "tailscale",
  versionArgs: ["version"], authCheck: { argv: ["status", "--json"] },
  detect: context => detectCliAdapter(tailscaleAdapter, context)
};
