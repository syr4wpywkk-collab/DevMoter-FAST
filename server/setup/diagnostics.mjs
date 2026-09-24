const SAFE_DIAGNOSTICS = Object.freeze({
  executable_missing: "Executable was not found on the server PATH.",
  version_check_failed: "The executable was found, but its version check failed.",
  auth_check_failed: "Authentication status could not be confirmed.",
  auth_env_ignored: "Only stored CLI authentication was checked; environment credentials are intentionally not inherited.",
  status_unavailable: "The local service did not provide a supported status.",
  invalid_status: "The local service returned an unsupported status format.",
  unsupported_platform: "Setup detection is supported on Linux only in this phase.",
  adapter_failed: "This tool could not be checked. Other checks continued."
});

export function diagnostic(code) {
  return {
    code: SAFE_DIAGNOSTICS[code] ? code : "adapter_failed",
    message: SAFE_DIAGNOSTICS[code] || SAFE_DIAGNOSTICS.adapter_failed
  };
}

export function sanitizedFailure(error) {
  if (error?.code === "ENOENT") return diagnostic("executable_missing");
  if (error?.code === "ETIMEDOUT" || error?.killed) return diagnostic("status_unavailable");
  return diagnostic("adapter_failed");
}
