export type AgentRole = "planner" | "executor" | "reviewer" | "vision" | "summarizer";
export type ModelRoute = {
  role: AgentRole;
  model: string;
  provider: string | null;
  backend: string;
  capabilities: string[];
};
export const AGENT_ROLES: readonly AgentRole[];
export function validateModelRoute(input: unknown): ModelRoute;
export function normalizeModelRoutes(routes?: unknown[]): ModelRoute[];
export function resolveRoleModel(
  role: AgentRole | string,
  routes?: unknown[],
  options?: { allowDefault?: boolean; requiredCapabilities?: string[] }
): ModelRoute & { source: "configured" | "default" };
export function describeModelRoutes(routes?: unknown[]): string;
