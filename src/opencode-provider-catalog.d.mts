export function normalizeOpenCodeProviderCatalog(payload: unknown): {
  providers: Array<{ id: string; name?: string; models?: Record<string, any> | any[] }>;
  defaults: Record<string, string>;
  connected: string[];
};

export function buildOpenCodeProviderCatalog(input: {
  generation: "v1" | "v2";
  version?: string | null;
  providers: unknown;
  models: unknown;
  integrations?: unknown;
  defaultModel?: unknown;
  directory?: string | null;
}): {
  apiVersion: "v1" | "v2";
  opencodeVersion: string | null;
  source: string;
  modelSource: string;
  directory: string | null;
  all: Array<{ id: string; name: string; env: string[]; models: Record<string, any> }>;
  default: Record<string, string>;
  connected: string[];
  cacheTtlMs: number;
};

export function openCodeModelChoice(model: any): {
  requiresKey: string[];
  available: boolean;
  deprecated: boolean;
  enabled: boolean;
  needsKey: boolean;
  selectable: boolean;
  reason: string;
  free: boolean;
};

export function filterOpenCodePickerModels(providers: any[], options?: {
  query?: string;
  free?: boolean;
  available?: boolean;
  needsKey?: boolean;
  connected?: string[];
}): {
  active: Array<{
    providerID: string;
    providerName: string;
    model: any;
    requiresKey: string[];
    available: boolean;
    deprecated: boolean;
    enabled: boolean;
    needsKey: boolean;
    selectable: boolean;
    reason: string;
    free: boolean;
  }>;
  deprecated: Array<{
    providerID: string;
    providerName: string;
    model: any;
    requiresKey: string[];
    available: boolean;
    deprecated: boolean;
    enabled: boolean;
    needsKey: boolean;
    selectable: boolean;
    reason: string;
    free: boolean;
  }>;
  counts: { shown: number; free: number; available: number; needsKey: number };
};

export type OpenCodePickerRow = ReturnType<typeof filterOpenCodePickerModels>["active"][number];

export type OpenCodePickerItem =
  | { kind: "group"; name: string; count: number }
  | { kind: "provider"; name: string; id: string }
  | { kind: "keyProvider"; name: string; id: string; count: number; expanded: boolean }
  | { kind: "model"; row: OpenCodePickerRow };

export function flattenOpenCodePickerRows(
  result: ReturnType<typeof filterOpenCodePickerModels>,
  options?: { free?: boolean; deprecatedOpen?: boolean; expandedKeyProviders?: Set<string> }
): OpenCodePickerItem[];

export function openCodePickerWindow(scrollTop: number, height: number, count: number, rowPx?: number): { start: number; end: number };

export const PROVIDER_CATALOG_TTL_MS: number;
