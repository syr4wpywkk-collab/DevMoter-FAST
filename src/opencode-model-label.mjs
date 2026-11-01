/**
 * Short, display-only model name for the OpenCode model picker. Catalog names
 * often repeat the vendor ("Anthropic: Claude Sonnet 4") or are missing, in
 * which case the id can carry a path ("openrouter/anthropic/claude-sonnet-4").
 * The provider is shown separately as muted text, so it is dropped here.
 */
export function shortModelName(name, id) {
  const label = String(name ?? "").trim();
  if (label) {
    const vendorPrefix = label.match(/^[^:/]{1,32}:\s+(.+)$/);
    return vendorPrefix ? vendorPrefix[1].trim() : label;
  }
  const value = String(id ?? "").trim();
  const last = value.split("/").filter(Boolean).pop();
  return last || value;
}
