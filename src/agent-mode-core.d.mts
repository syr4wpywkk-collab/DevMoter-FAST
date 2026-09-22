export type ToolGroup = "read" | "diagnostics" | "tests" | "git" | "files" | "commands" | "network";
export type ModeConfig = {
  id: string;
  name: string;
  description: string;
  instructions: string[];
  model: string | null;
  tools: { allow: ToolGroup[]; deny: ToolGroup[] };
  mutationPolicy: "approval-required" | string;
};
export const MODE_TOOL_GROUPS: readonly ToolGroup[];
export function listBuiltinModes(): ModeConfig[];
export function getBuiltinMode(id: string): ModeConfig;
export function renderModePolicy(mode: string | ModeConfig): string;
export function compileModePrompt(modeId: string, task: string, context?: Record<string, unknown>): string;
