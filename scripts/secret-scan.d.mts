export const SECRET_PATTERNS: { name: string; regex: RegExp }[];
export function isSensitivePath(path: string): boolean;
export function findSecrets(body: string): string[];
export function isBinary(buffer: Uint8Array): boolean;
