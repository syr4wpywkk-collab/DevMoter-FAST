export function reconnectAfterSync<T>(
  sync: () => Promise<T>,
  reconnect: () => void
): Promise<{ error: unknown | null; value: T | undefined }>;
