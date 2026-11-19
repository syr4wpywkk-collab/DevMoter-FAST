export type PromptTemplate = {
  id: string;
  name: string;
  description: string;
  body: string;
  projectId: string | null;
  createdAt: string;
  updatedAt: string;
};

export function extractVariables(body: string): string[];
export function expandTemplate(body: string, values?: Record<string, string>): { text: string; missing: string[] };
export function searchTemplates<T extends { name: string; description?: string }>(templates: readonly T[], query: string): T[];
export function templatesForScope<T extends { projectId: string | null }>(templates: readonly T[], projectId: string | null): T[];
export function draftNeedsConfirmation(draft: string): boolean;
export function mergeIntoDraft(draft: string, text: string, mode: "replace" | "append"): string;
