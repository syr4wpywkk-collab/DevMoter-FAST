export const AGENT_ROLES = Object.freeze([
  "planner",
  "executor",
  "reviewer",
  "vision",
  "summarizer"
]);

const ROLE_REQUIREMENTS = Object.freeze({
  planner: Object.freeze(["text"]),
  executor: Object.freeze(["text"]),
  reviewer: Object.freeze(["text"]),
  vision: Object.freeze(["text", "vision"]),
  summarizer: Object.freeze(["text"])
});

export function validateModelRoute(input) {
  if (!input || typeof input !== "object") throw new Error("Model route must be an object");
  const role = String(input.role || "").trim();
  if (!AGENT_ROLES.includes(role)) throw new Error(`Unsupported agent role: ${role}`);
  const model = String(input.model || "").trim();
  if (!model) throw new Error(`Model is required for role: ${role}`);
  const provider = String(input.provider || "").trim() || null;
  const backend = String(input.backend || "codex").trim() || "codex";
  const capabilities = [...new Set(
    (Array.isArray(input.capabilities) ? input.capabilities : String(input.capabilities || "").split(","))
      .map(item => String(item).trim().toLowerCase())
      .filter(Boolean)
  )];
  if (!capabilities.length) capabilities.push("text");
  return { role, model, provider, backend, capabilities };
}

export function normalizeModelRoutes(routes = []) {
  if (!Array.isArray(routes)) throw new Error("Model routes must be an array");
  const result = [];
  const seen = new Set();
  for (const input of routes) {
    const route = validateModelRoute(input);
    if (seen.has(route.role)) throw new Error(`Duplicate model route for role: ${route.role}`);
    seen.add(route.role);
    result.push(route);
  }
  return result;
}

export function resolveRoleModel(role, routes = [], options = {}) {
  const normalizedRole = String(role || "").trim();
  if (!AGENT_ROLES.includes(normalizedRole)) {
    throw new Error(`Unsupported agent role: ${normalizedRole}`);
  }
  const normalized = normalizeModelRoutes(routes);
  const route = normalized.find(item => item.role === normalizedRole);
  if (!route) {
    if (options.allowDefault !== false) {
      return {
        role: normalizedRole,
        model: null,
        provider: null,
        backend: "codex",
        capabilities: [],
        source: "default"
      };
    }
    throw new Error(`No model configured for role: ${normalizedRole}`);
  }

  const required = [...new Set([
    ...(ROLE_REQUIREMENTS[normalizedRole] || []),
    ...(Array.isArray(options.requiredCapabilities) ? options.requiredCapabilities : [])
  ].map(String))];

  const missing = required.filter(capability => !route.capabilities.includes(capability));
  if (missing.length) {
    throw new Error(
      `Model ${route.model} does not support required capabilities for ${normalizedRole}: ${missing.join(", ")}`
    );
  }

  return { ...route, capabilities: [...route.capabilities], source: "configured" };
}

export function describeModelRoutes(routes = []) {
  const normalized = normalizeModelRoutes(routes);
  if (!normalized.length) return "Role model routing: backend defaults";
  return [
    "Role model routing:",
    ...normalized.map(route =>
      `- ${route.role} -> ${route.provider ? `${route.provider}/` : ""}${route.model} [${route.capabilities.join(", ")}]`
    )
  ].join("\n");
}
