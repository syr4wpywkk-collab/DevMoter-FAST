/**
 * Unified Workspace is the normal presentation at the existing DevMoter URL.
 * Keep ?unifiedUI=1 backward compatible; ?unifiedUI=0 is a documented
 * escape hatch if a device has a visual/layout regression.
 * No location, cookies, session IDs or localStorage are changed here.
 */
export function shouldUseUnifiedWorkspace(search = "") {
  const params = new URLSearchParams(search);
  return params.get("unifiedUI") !== "0";
}
