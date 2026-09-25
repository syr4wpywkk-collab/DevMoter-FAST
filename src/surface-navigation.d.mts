export type MainSurface = "home" | "opencode" | "codex" | "api" | "integrations";
export function isMainSurface(value: unknown): value is MainSurface;
export function initialMainSurface(search: string, options?: { hasProjectDeepLink?: boolean; savedBackend?: string }): MainSurface;
export function createSurfaceNavigation(options: {
  window: Window;
  hasProjectDeepLink?: boolean;
  savedBackend?: string;
  onSurface?: (surface: MainSurface) => void;
}): {
  current(): MainSurface;
  navigate(surface: MainSurface, options?: { replaceCurrent?: boolean }): boolean;
  destroy(): void;
};
