export type CodexReasoningEffort = { reasoningEffort: string; description?: string };
export type CodexReasoningModel = {
  id: string; model: string; displayName?: string; description?: string;
  isDefault?: boolean; hidden?: boolean; defaultReasoningEffort?: string;
  supportedReasoningEfforts?: CodexReasoningEffort[];
};
export function normalizeCodexModels(payload: any): CodexReasoningModel[];
export function reconcileReasoningMode(savedMode: string, model?: CodexReasoningModel | null): string;
export function reasoningChoices(model?: CodexReasoningModel | null): Array<{ value: string; description: string }>;
export function applyReasoningToTurnStart<T extends Record<string, any>>(params: T, mode: string): T & { effort?: string };
