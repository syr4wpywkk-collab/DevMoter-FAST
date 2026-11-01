export function isDefaultSessionTitle(title: unknown): boolean;
export function shortSessionTime(time: Date | string | number, timeZone?: string): string;
export function displaySessionTitle(
  title: unknown,
  options?: { language?: string; timeZone?: string; created?: number | string | Date }
): string;
