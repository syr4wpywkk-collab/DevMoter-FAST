export const QUERY_KEYS: readonly ["agent", "project", "state"];
export const AGENT_VALUES: string[];
export const STATE_VALUES: string[];
export type SessionQuery = { text: string; agent: string; project: string; state: string };
export function parseSessionQuery(input: string): SessionQuery;
export function suggestSessionTokens(input: string, options?: { projects?: string[] }): { label: string; value: string }[];
export function matchesSessionFilters(session: { backend: string; status: string; project?: string }, query: SessionQuery): boolean;
