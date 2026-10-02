// Model catalogue metadata is not an invoice or proof of a free account.
export function normalizeModelPricing(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const cost = {};
  for (const key of ["input", "output", "cache_read", "cache_write"]) {
    if (typeof value[key] === "number" && Number.isFinite(value[key]) && value[key] >= 0) cost[key] = value[key];
  }
  const cache = value.cache;
  if (cache && typeof cache === "object" && !Array.isArray(cache)) {
    if (cost.cache_read === undefined && typeof cache.read === "number" && Number.isFinite(cache.read) && cache.read >= 0) cost.cache_read = cache.read;
    if (cost.cache_write === undefined && typeof cache.write === "number" && Number.isFinite(cache.write) && cache.write >= 0) cost.cache_write = cache.write;
  }
  return Object.keys(cost).length ? cost : null;
}

export function describeModelPricing(value) {
  const cost = normalizeModelPricing(value);
  const hasPaidRate = cost && Object.values(cost).some(rate => rate > 0);
  const zeroBase = cost?.input === 0 && cost?.output === 0;
  const label = hasPaidRate ? "有料単価あり" : zeroBase ? "基本単価0・無料保証なし" : "料金不明・無料とは未確認";
  const rates = cost ? Object.entries(cost).map(([key, rate]) => `${key}: ${rate}`).join(" / ") : "上流から料金情報を取得できていません";
  return { label, detail: `${label} · ${rates}。単価の単位・認証方式・契約・請求はproviderで確認してください。` };
}
