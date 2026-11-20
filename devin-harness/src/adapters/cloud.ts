// Devin Cloud API usage hook (SPEC §4) — v1 stub.
//
// The real provider would query the Devin Cloud API v3 organization usage
// endpoints with a `cog_` API token from $DEVIN_API_TOKEN. This stub only
// reports whether a token is configured; it performs NO network calls and
// NEVER includes the token value in logs or return values.

export interface CloudUsageProvider {
  name: string;
  fetchOrgUsage(): Promise<{
    configured: boolean;
    usage?: unknown;
    note: string;
  }>;
}

export class StubCloudUsageProvider implements CloudUsageProvider {
  readonly name = "devin-cloud-stub";

  async fetchOrgUsage(): Promise<{
    configured: boolean;
    usage?: unknown;
    note: string;
  }> {
    const configured = Boolean(process.env.DEVIN_API_TOKEN);
    return {
      configured,
      note:
        "v1 stub: no network call is made. Devin Cloud API v3 org usage " +
        "lookup is not implemented yet; local ATIF usage is authoritative." +
        (configured
          ? " A DEVIN_API_TOKEN is present in the environment."
          : " Set DEVIN_API_TOKEN to enable the future cloud lookup."),
    };
  }
}
