export function normalizeOpenCodeProviderCatalog(payload: unknown): {
  providers: Array<{ id: string; name?: string; models?: Record<string, any> | any[] }>;
  defaults: Record<string, string>;
  connected: string[];
};

export function buildOpenCodeProviderCatalog(input: {
  v1: unknown;
  modelOverrides?: unknown;
  directory?: string | null;
  modelSource?: string | null;
}): {
  apiVersion: string;
  source: string;
  modelSource: string | null;
  directory: string | null;
  all: Array<{ id: string; name: string; env: string[]; models: Record<string, any> }>;
  default: Record<string, unknown>;
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
};

export const PROVIDER_CATALOG_TTL_MS: number;
