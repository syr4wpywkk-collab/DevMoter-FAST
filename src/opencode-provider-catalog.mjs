import { normalizeModelPricing } from "./model-pricing.mjs";

const PROVIDER_CATALOG_TTL_MS = 45_000;

export function normalizeOpenCodeProviderCatalog(payload) {
  const providers = payload?.all;
  const defaults = payload?.default ?? {};
  const connected = payload?.connected ?? [];
  const ids = new Set();
  if (
    !Array.isArray(providers) ||
    providers.some(provider => {
      const models = provider?.models;
      const validModels = models == null || Array.isArray(models) ||
        (models && typeof models === "object" && Object.getPrototypeOf(models) === Object.prototype);
      if (
        !provider ||
        typeof provider.id !== "string" || !provider.id || ids.has(provider.id) ||
        (provider.name !== undefined && typeof provider.name !== "string") ||
        !validModels
      ) return true;
      ids.add(provider.id);
      return false;
    }) ||
    !defaults || typeof defaults !== "object" || Array.isArray(defaults) ||
    Object.values(defaults).some(value => typeof value !== "string") ||
    !Array.isArray(connected) || connected.some(id => typeof id !== "string")
  ) {
    throw new Error("OpenCode returned an invalid provider catalog");
  }
  return { providers, defaults, connected };
}

function listPayload(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data)) return payload.data;
  return null;
}

// OpenCode reports model cost as pricing tiers. The base tier is the one
// without a `tier` qualifier (context-size surcharges carry one).
function baseCostTier(cost) {
  if (!Array.isArray(cost)) return cost;
  return cost.find(tier => tier && typeof tier === "object" && tier.tier == null) ?? cost[0] ?? null;
}

function integrationEnvKeys(integration) {
  const keys = [];
  for (const method of Array.isArray(integration?.methods) ? integration.methods : []) {
    if (method?.type !== "env" || !Array.isArray(method.names)) continue;
    for (const name of method.names) {
      const key = String(name || "").trim();
      if (key && !keys.includes(key)) keys.push(key);
    }
  }
  return keys;
}

/**
 * Build DevMoter's provider/model catalog from OpenCode's `/api` catalog
 * routes, which have the same meaning on OpenCode 1.x and 2.x:
 *   GET /api/provider  -> providers that are currently available
 *   GET /api/model     -> enabled models of available providers
 * OpenCode 2.x adds GET /api/integration (display names, env keys) and
 * GET /api/model/default. Neither generation exposes models of providers that
 * are not connected, so every model in this catalog is usable.
 */
export function buildOpenCodeProviderCatalog({
  generation,
  version = null,
  providers,
  models,
  integrations = null,
  defaultModel = null,
  directory = null
} = {}) {
  if (generation !== "v1" && generation !== "v2") throw new Error("OpenCode API generation is unknown");
  const providerList = listPayload(providers);
  const modelList = listPayload(models);
  if (!providerList) throw new Error("OpenCode GET /api/provider returned no provider list");
  if (!modelList) throw new Error("OpenCode GET /api/model returned no model list");

  const integrationById = new Map();
  for (const integration of listPayload(integrations) ?? []) {
    const id = String(integration?.id ?? "");
    if (id) integrationById.set(id, integration);
  }

  const entries = new Map();
  const providerEntry = (id, provider = null) => {
    let entry = entries.get(id);
    if (!entry) {
      const integration = integrationById.get(String(provider?.integrationID ?? id)) ?? integrationById.get(id) ?? null;
      const name = typeof provider?.name === "string" && provider.name
        ? provider.name
        : typeof integration?.name === "string" && integration.name ? integration.name : id;
      entry = { id, name, env: integrationEnvKeys(integration), models: {} };
      entries.set(id, entry);
    } else if (provider && typeof provider.name === "string" && provider.name) {
      entry.name = provider.name;
    }
    return entry;
  };

  for (const provider of providerList) {
    const id = String(provider?.id ?? "").trim();
    if (id) providerEntry(id, provider);
  }

  for (const model of modelList) {
    const providerID = String(model?.providerID ?? "").trim();
    const id = String(model?.id ?? "").trim();
    if (!providerID || !id) continue;
    const entry = providerEntry(providerID);
    const status = typeof model?.status === "string" ? model.status : null;
    const cost = normalizeModelPricing(baseCostTier(model?.cost));
    entry.models[id] = {
      id,
      modelID: String(model?.modelID ?? id),
      providerID,
      name: typeof model?.name === "string" && model.name ? model.name : id,
      family: model?.family ?? null,
      status,
      enabled: model?.enabled !== false,
      capabilities: model?.capabilities ?? null,
      cost,
      variants: Array.isArray(model?.variants)
        ? model.variants.map(variant => ({ id: String(variant?.id ?? "") })).filter(variant => variant.id)
        : [],
      limit: model?.limit ?? null,
      free: cost?.input === 0 && cost?.output === 0,
      available: true,
      requiresKey: [],
      deprecated: status === "deprecated"
    };
  }

  const all = [...entries.values()];
  const connected = all.map(provider => provider.id);
  const defaults = {};
  const defaultInfo = defaultModel?.data !== undefined ? defaultModel.data : defaultModel;
  if (defaultInfo && typeof defaultInfo === "object") {
    const providerID = String(defaultInfo.providerID ?? "");
    const id = String(defaultInfo.id ?? "");
    if (providerID && id && entries.get(providerID)?.models[id]) defaults[providerID] = id;
  }

  return {
    apiVersion: generation,
    opencodeVersion: version,
    source: generation === "v2"
      ? "/api/provider + /api/model + /api/integration + /api/model/default"
      : "/api/provider + /api/model + /api/integration",
    modelSource: "/api/model",
    directory,
    all,
    default: defaults,
    connected,
    cacheTtlMs: PROVIDER_CATALOG_TTL_MS
  };
}

export function openCodeModelChoice(model) {
  const requiresKey = Array.isArray(model?.requiresKey) ? model.requiresKey.map(key => String(key)).filter(Boolean) : [];
  const available = model?.available === true;
  const deprecated = model?.deprecated === true || model?.status === "deprecated";
  const enabled = model?.enabled !== false && model?.status !== "unavailable";
  const needsKey = !available && requiresKey.length > 0;
  const selectable = available && enabled;
  const cost = model?.cost;
  const free = !!cost && cost.input === 0 && cost.output === 0;
  const reason = needsKey
    ? `Needs key (${requiresKey.join(", ")})`
    : !available
      ? "provider unavailable"
      : !enabled
        ? "unavailable"
        : "";
  return { requiresKey, available, deprecated, enabled, needsKey, selectable, reason, free };
}

export function filterOpenCodePickerModels(providers, options = {}) {
  const query = String(options.query || "").trim().toLowerCase();
  const wantFree = Boolean(options.free);
  const wantAvailable = Boolean(options.available);
  const wantNeedsKey = Boolean(options.needsKey);
  const connected = new Set((options.connected || []).map(id => String(id)));
  const active = [];
  const deprecated = [];
  const counts = { shown: 0, free: 0, available: 0, needsKey: 0 };
  const sorted = [...(Array.isArray(providers) ? providers : [])].sort((a, b) => {
    const aConnected = connected.has(a.id) ? 0 : 1;
    const bConnected = connected.has(b.id) ? 0 : 1;
    return aConnected - bConnected || String(a.name || a.id).localeCompare(String(b.name || b.id));
  });

  for (const provider of sorted) {
    const models = provider?.models;
    const entries = models && typeof models === "object"
      ? Object.entries(models).map(([id, model]) => ({ id, ...(model && typeof model === "object" ? model : {}) }))
      : [];
    entries.sort((a, b) => String(a.name || a.id).localeCompare(String(b.name || b.id)));
    for (const model of entries) {
      const choice = openCodeModelChoice(model);
      const haystack = `${provider.name || ""} ${provider.id || ""} ${model.name || ""} ${model.id || ""}`.toLowerCase();
      if (query && !haystack.includes(query)) continue;
      const passesFree = !wantFree || choice.free;
      const passesAvailability = (!wantAvailable || choice.available) && (!wantNeedsKey || choice.needsKey);
      if (choice.free && passesAvailability) counts.free += 1;
      if (choice.available && (!wantFree || choice.free)) counts.available += 1;
      if (choice.needsKey && (!wantFree || choice.free)) counts.needsKey += 1;
      if (!passesFree || !passesAvailability) continue;
      counts.shown += 1;
      const row = {
        providerID: String(provider.id),
        providerName: provider.name || provider.id,
        model,
        ...choice
      };
      (choice.deprecated ? deprecated : active).push(row);
    }
  }
  if (wantFree) {
    active.sort((a, b) => Number(a.needsKey) - Number(b.needsKey)
      || String(a.providerName).localeCompare(String(b.providerName))
      || String(a.model.name || a.model.id).localeCompare(String(b.model.name || b.model.id)));
  }
  return { active, deprecated, counts };
}

/**
 * Flatten filtered picker rows into the virtual list. In the Free view, the
 * "キーが必要" models (thousands of $0 rows across unconnected providers) are
 * folded to one row per provider; only providers in `expandedKeyProviders`
 * list their models.
 */
export function flattenOpenCodePickerRows(result, options = {}) {
  const free = Boolean(options.free);
  const deprecatedOpen = Boolean(options.deprecatedOpen);
  const expanded = options.expandedKeyProviders instanceof Set ? options.expandedKeyProviders : new Set();
  const flat = [];
  const pushGroup = rows => {
    let previous = "";
    for (const row of rows) {
      if (row.providerID !== previous) {
        flat.push({ kind: "provider", name: row.providerName, id: row.providerID });
        previous = row.providerID;
      }
      flat.push({ kind: "model", row });
    }
  };
  const active = Array.isArray(result?.active) ? result.active : [];
  if (free) {
    const ready = active.filter(row => !row.needsKey);
    const keyed = active.filter(row => row.needsKey);
    if (ready.length) {
      flat.push({ kind: "group", name: "使える", count: ready.length });
      pushGroup(ready);
    }
    if (keyed.length) {
      flat.push({ kind: "group", name: "キーが必要", count: keyed.length });
      const byProvider = new Map();
      for (const row of keyed) {
        const bucket = byProvider.get(row.providerID);
        if (bucket) bucket.rows.push(row);
        else byProvider.set(row.providerID, { name: row.providerName, rows: [row] });
      }
      for (const [id, { name, rows }] of byProvider) {
        const open = expanded.has(id);
        flat.push({ kind: "keyProvider", id, name, count: rows.length, expanded: open });
        if (open) for (const row of rows) flat.push({ kind: "model", row });
      }
    }
  } else {
    pushGroup(active);
  }
  const deprecated = Array.isArray(result?.deprecated) ? result.deprecated : [];
  if (deprecatedOpen && deprecated.length) {
    flat.push({ kind: "group", name: "非推奨", count: deprecated.length });
    pushGroup(deprecated);
  }
  return flat;
}

export function openCodePickerWindow(scrollTop, height, count, rowPx = 56) {
  if (count <= 0 || height <= 0) return { start: 0, end: 0 };
  const start = Math.max(0, Math.floor(scrollTop / rowPx) - 2);
  const end = Math.min(count, Math.ceil((scrollTop + height) / rowPx) + 3);
  return { start, end };
}

export { PROVIDER_CATALOG_TTL_MS };
