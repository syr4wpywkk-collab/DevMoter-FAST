export function computeKeyboardInset(input: { layoutHeight: number; viewportHeight: number; offsetTop?: number }): number;
export function viewportMetrics(win: Window): { height: number; offsetTop: number; keyboardInset: number } | null;
export function isTextField(target: EventTarget | null): boolean;
export function startViewportSync(win?: Window): () => void;
