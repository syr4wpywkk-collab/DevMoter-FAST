type Json = Record<string, any>;

export function openCodeToolStateSummary(part: Json) {
  const state = part?.state ?? {};
  const status = String(state?.status || "tool");
  const name = String(part?.tool || part?.name || "tool");
  const input = state?.input;
  const target = input?.command ?? input?.filePath ?? input?.path;
  const hint = typeof target === "string" ? target.replace(/\s+/g, " ").slice(0, 100) : "";
  return `${status === "completed" ? "✓" : status === "error" ? "!" : status === "running" ? "●" : "·"} ${name} · ${status}${hint ? ` — ${hint}` : ""}`;
}
