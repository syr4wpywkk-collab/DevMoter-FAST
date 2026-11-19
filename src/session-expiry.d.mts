export function isSessionExpiredResponse(status: number, body: unknown): boolean;
export function watchSessionExpiry(win: Window, onExpired: () => void): () => void;
export function showSessionExpiredBanner(doc?: Document): HTMLElement;
export function startSessionExpiryWatch(win?: Window): () => void;
