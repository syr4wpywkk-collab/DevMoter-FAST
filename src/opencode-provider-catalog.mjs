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
