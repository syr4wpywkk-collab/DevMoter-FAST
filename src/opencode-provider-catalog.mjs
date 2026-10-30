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

function modelEntries(models) {
  if (!models || typeof models !== "object") return [];
  if (Array.isArray(models)) {
    return models
      .map(model => [String(model?.id ?? model?.modelID ?? ""), model])
      .filter(([id]) => id);
  }
  return Object.entries(models);
}

function envKeys(provider) {
  const raw = provider?.env ?? provider?.options?.env;
  const list = Array.isArray(raw) ? raw : typeof raw === "string" ? [raw] : [];
  return [...new Set(list.map(key => String(key || "").trim()).filter(Boolean))];
}

function indexModelOverrides(models) {
  const list = Array.isArray(models) ? models : Array.isArray(models?.data) ? models.data : [];
  const overrides = new Map();
  for (const model of list) {
    const providerID = String(model?.providerID ?? model?.provider?.id ?? model?.provider?.providerID ?? "");
    const modelID = String(model?.id ?? model?.modelID ?? "");
    if (!providerID || !modelID) continue;
    const patch = {};
    if (model && Object.prototype.hasOwnProperty.call(model, "status")) patch.status = model.status ?? null;
    if (model && Object.prototype.hasOwnProperty.call(model, "enabled")) patch.enabled = model.enabled !== false;
    overrides.set(`${providerID}\0${modelID}`, patch);
  }
  return overrides;
}

export function buildOpenCodeProviderCatalog({ v1, modelOverrides = [], directory = null, modelSource = null } = {}) {
  const providers = v1?.all;
  if (!Array.isArray(providers)) throw new Error("OpenCode /provider catalog is missing");
  const connected = (Array.isArray(v1?.connected) ? v1.connected : []).map(id => String(id));
  const connectedSet = new Set(connected);
  const defaults = v1?.default && typeof v1.default === "object" && !Array.isArray(v1.default) ? v1.default : {};
  const overrides = indexModelOverrides(modelOverrides);

  const all = [];
  for (const provider of providers) {
    const id = String(provider?.id ?? "").trim();
    if (!id) continue;
    const keys = envKeys(provider);
    const available = connectedSet.has(id);
    const models = {};
    for (const [key, model] of modelEntries(provider?.models)) {
      const modelID = String(model?.id ?? model?.modelID ?? key);
      if (!modelID) continue;
      const patch = overrides.get(`${id}\0${modelID}`) ?? {};
      const status = Object.prototype.hasOwnProperty.call(patch, "status") ? patch.status : (model?.status ?? null);
      const enabled = Object.prototype.hasOwnProperty.call(patch, "enabled") ? patch.enabled : model?.enabled !== false;
      const cost = normalizeModelPricing(model?.cost);
      models[modelID] = {
        id: modelID,
        modelID: String(model?.modelID ?? modelID),
        providerID: id,
        name: model?.name ?? modelID,
        family: model?.family ?? null,
        status,
        enabled,
        capabilities: model?.capabilities ?? null,
        cost,
        variants: Array.isArray(model?.variants)
          ? model.variants.map(variant => ({ id: String(variant?.id ?? "") })).filter(variant => variant.id)
          : [],
        limit: model?.limit ?? null,
        free: cost?.input === 0 && cost?.output === 0,
        available,
        requiresKey: keys,
        deprecated: status === "deprecated"
      };
    }
    all.push({
      id,
      name: typeof provider?.name === "string" && provider.name ? provider.name : id,
      env: keys,
      models
    });
  }

  return {
    apiVersion: "v1",
    source: "/provider",
    modelSource,
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

export function openCodePickerWindow(scrollTop, height, count, rowPx = 56) {
  if (count <= 0 || height <= 0) return { start: 0, end: 0 };
  const start = Math.max(0, Math.floor(scrollTop / rowPx) - 2);
  const end = Math.min(count, Math.ceil((scrollTop + height) / rowPx) + 3);
  return { start, end };
}

export { PROVIDER_CATALOG_TTL_MS };
