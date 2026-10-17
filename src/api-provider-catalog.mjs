export function normalizeApiProviderCatalog(payload) {
  const providers = payload?.providers;
  if (!Array.isArray(providers) || providers.some(provider =>
    !provider ||
    typeof provider.id !== "string" || !provider.id ||
    typeof provider.name !== "string" || !provider.name ||
    typeof provider.protocol !== "string" ||
    typeof provider.baseUrl !== "string" ||
    typeof provider.ready !== "boolean" ||
    !Array.isArray(provider.models) ||
    provider.models.some(model => typeof model !== "string")
  )) {
    throw new Error("API Chat received an invalid provider catalog");
  }
  return providers;
}
