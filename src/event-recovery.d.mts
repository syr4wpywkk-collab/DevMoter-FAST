export function recoverAfterEventOpen(
  refresh: () => Promise<unknown>,
  report: (error: unknown | null) => void
): Promise<void>;
