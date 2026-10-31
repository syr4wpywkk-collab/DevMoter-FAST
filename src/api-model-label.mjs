/**
 * Display label for an API Chat model id. Gemini (and Vertex-style ids) carry
 * resource prefixes such as `models/` or `publishers/google/models/`; the
 * option value keeps the full id, only the visible text drops the path.
 * Vendor-routed ids like `openai/gpt-4o` (OpenRouter) stay as they are,
 * because the vendor segment is part of what the user picks.
 */
export function apiModelLabel(id) {
  const value = String(id ?? "").trim();
  const marker = "models/";
  const at = value.lastIndexOf(marker);
  if (at < 0) return value;
  if (at > 0 && value[at - 1] !== "/") return value;
  const label = value.slice(at + marker.length);
  return label || value;
}
