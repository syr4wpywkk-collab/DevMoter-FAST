export function normalizeApiProviderCatalog(payload: unknown): Array<{
  id: string;
  name: string;
  protocol: "openai-compatible" | "anthropic";
  baseUrl: string;
  ready: boolean;
  models: string[];
}>;
