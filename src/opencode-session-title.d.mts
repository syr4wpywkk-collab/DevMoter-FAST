export function isDefaultOpenCodeTitle(title: unknown): boolean;
export function summarizePrompt(text: unknown, max?: number): string;
export function shortSessionTime(time: Date | string | number, timeZone?: string): string;
export function openCodeSessionLabel(
  session: { title?: string; time?: { created?: number } } | null | undefined,
  options?: { firstPrompt?: string; timeZone?: string; max?: number }
): string;
