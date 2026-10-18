export function normalizeApiAttachment(
  payload: unknown,
  file: { type: string; size: number }
): { id: string; name: string; mime: string; size: number };
