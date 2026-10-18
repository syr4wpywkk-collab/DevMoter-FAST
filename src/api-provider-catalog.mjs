export function normalizeApiProviderCatalog(payload) {
  const providers = payload?.providers;
  const providerIds = new Set();
  if (!Array.isArray(providers) || providers.some(provider => {
    if (
      !provider ||
      typeof provider.id !== "string" || !provider.id ||
      typeof provider.name !== "string" || !provider.name ||
      !["openai-compatible", "anthropic"].includes(provider.protocol) ||
      typeof provider.baseUrl !== "string" ||
      typeof provider.ready !== "boolean" ||
      !Array.isArray(provider.models) ||
      provider.models.some(model => typeof model !== "string") ||
      providerIds.has(provider.id)
    ) return true;
    providerIds.add(provider.id);
    return false;
  })) {
    throw new Error("API Chat received an invalid provider catalog");
  }
  return providers;
}
