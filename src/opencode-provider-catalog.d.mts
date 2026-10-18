export function normalizeOpenCodeProviderCatalog(payload: unknown): {
  providers: Array<{ id: string; name?: string; models?: Record<string, any> | any[] }>;
  defaults: Record<string, string>;
  connected: string[];
};
