export type StructuredMcpResult = {
  value: unknown;
  rawText: string;
  truncated: boolean;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function boundText(value: unknown, limit: number) {
  const text = String(value ?? "");
  if (text.length <= limit) return { text, truncated: false };
  return { text: text.slice(0, limit) + "\n…[truncated by DevMoter]…", truncated: true };
}

export function normalizeStructuredMcpResult(
  input: unknown,
  { maxDepth = 6, maxEntries = 200, maxText = 24_000 } = {}
): StructuredMcpResult {
  let entries = 0;
  let truncated = false;

  const visit = (value: unknown, depth: number): unknown => {
    if (entries++ >= maxEntries || depth > maxDepth) {
      truncated = true;
      return "[truncated]";
    }
    if (value === null || typeof value === "number" || typeof value === "boolean") return value;
    if (typeof value === "string") {
      const bounded = boundText(value, maxText);
      truncated ||= bounded.truncated;
      return bounded.text;
    }
    if (Array.isArray(value)) return value.slice(0, maxEntries).map(item => visit(item, depth + 1));
    if (isRecord(value)) {
      // Tool payload keys are untrusted. A null prototype preserves "__proto__"
      // as ordinary data instead of mutating the result object's prototype.
      const output: Record<string, unknown> = Object.create(null);
      for (const [key, item] of Object.entries(value)) {
        if (entries >= maxEntries) {
          truncated = true;
          break;
        }
        output[key.slice(0, 200)] = visit(item, depth + 1);
      }
      return output;
    }
    return String(value);
  };

  let parsed: unknown = input;
  if (typeof input === "string") {
    try {
      parsed = JSON.parse(input);
    } catch {
      parsed = input;
    }
  }

  const normalized = visit(parsed, 0);
  let rawSource: string;
  try {
    rawSource = typeof input === "string" ? input : JSON.stringify(input, null, 2) ?? "";
  } catch {
    // Runtime MCP providers can return circular objects. Keep rendering the
    // bounded structured view instead of crashing the whole conversation.
    rawSource = "[MCP result could not be serialized]";
    truncated = true;
  }
  const raw = boundText(rawSource, maxText);
  truncated ||= raw.truncated;

  return {
    value: normalized,
    rawText: raw.text,
    truncated
  };
}

export function isMcpToolItem(item: Record<string, any>) {
  const type = String(item?.type || "");
  if (/mcp/i.test(type)) return true;
  const server = item?.server || item?.serverName || item?.mcpServer || item?.mcp_server;
  const tool = item?.tool || item?.toolName || item?.name;
  return Boolean(server && tool && ("result" in item || "output" in item || "error" in item));
}

export function mcpToolSummary(item: Record<string, any>) {
  const server = String(item?.server || item?.serverName || item?.mcpServer || item?.mcp_server || "MCP");
  const tool = String(item?.tool || item?.toolName || item?.name || "tool");
  const status = String(item?.status || item?.state || (item?.error ? "error" : "completed"));
  const result =
    item?.result ??
    item?.output ??
    item?.content ??
    item?.error ??
    item;
  return { server, tool, status, result };
}
