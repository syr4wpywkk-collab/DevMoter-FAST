export const SECRET_KINDS: readonly string[];
export function detectSecretKinds(text: unknown): string[];
export function startPasteSecretGuard(doc?: Document): () => void;
