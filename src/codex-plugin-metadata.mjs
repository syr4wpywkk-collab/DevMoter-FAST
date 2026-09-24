function rawPluginName(plugin) {
  return String(
    plugin?.interface?.displayName ||
    plugin?.release?.interface?.displayName ||
    plugin?.release?.displayName ||
    plugin?.release?.display_name ||
    plugin?.displayName ||
    plugin?.name ||
    ""
  ).trim();
}

export function pluginEntries(payload) {
  const entries = [];
  for (const marketplace of payload?.marketplaces ?? []) {
    for (const plugin of Array.isArray(marketplace?.plugins) ? marketplace.plugins : []) {
      const id = String(plugin?.id || plugin?.name || "").trim();
      if (!id) continue;
      entries.push({
        id,
        name: rawPluginName(plugin) || id.split("@")[0],
        marketplace: String(marketplace?.interface?.displayName || marketplace?.name || ""),
        installed: plugin?.installed !== false,
        enabled: plugin?.enabled !== false
      });
    }
  }
  return entries;
}

export function pluginNameLooksOpaque(entry) {
  const id = String(entry?.id || "");
  const name = String(entry?.name || "");
  return !name || name === id || /^app[-_~]/i.test(name) || /^plugins?~Plugin_/i.test(name);
}

export function enrichInstalledPluginEntries(installedEntries, catalogEntries) {
  const catalogById = new Map(catalogEntries.map(entry => [String(entry.id), entry]));
  return installedEntries.map(entry => {
    if (!pluginNameLooksOpaque(entry)) return entry;
    const catalog = catalogById.get(String(entry.id));
    if (!catalog || pluginNameLooksOpaque(catalog)) return entry;
    return {
      ...entry,
      name: catalog.name,
      marketplace: entry.marketplace || catalog.marketplace
    };
  });
}
