export function normalizeCodexModels(payload) {
  const raw = payload?.data ?? payload?.models;
  if (!Array.isArray(raw)) throw new Error("Codex returned an invalid model catalog");
  const models = raw
    .map(model => ({
      id: String(model?.id || ""),
      model: String(model?.model || model?.id || ""),
      displayName: String(model?.displayName || model?.name || model?.model || model?.id || ""),
      description: String(model?.description || ""),
      isDefault: Boolean(model?.isDefault),
      hidden: Boolean(model?.hidden),
      defaultReasoningEffort: String(model?.defaultReasoningEffort || ""),
      supportedReasoningEfforts: Array.isArray(model?.supportedReasoningEfforts)
        ? model.supportedReasoningEfforts
            .map(item => ({
              reasoningEffort: String(item?.reasoningEffort || ""),
              description: String(item?.description || "")
            }))
            .filter(item => item.reasoningEffort)
        : []
    }))
    .filter(model => model.model);
  if (raw.length > 0 && models.length === 0) {
    throw new Error("Codex returned an invalid model catalog");
  }
  return models;
}

const MAX_MODEL_PAGES = 20;

/**
 * Codex app-server `model/list` (codex-rs app-server-protocol v2 ModelListParams:
 * cursor, limit, includeHidden) is cursor-paginated and omits models flagged
 * `hidden` unless `includeHidden` is sent. Reading only the first page (and then
 * dropping `hidden` rows in the picker) made available models unselectable.
 * Follow `nextCursor` until it is null and keep every model.
 */
export async function fetchAllCodexModels(request, pageSize = 100) {
  const pages = [];
  let cursor = null;
  const seen = new Set();
  for (let page = 0; page < MAX_MODEL_PAGES; page += 1) {
    const result = await request({ limit: pageSize, includeHidden: true, ...(cursor ? { cursor } : {}) });
    pages.push(...normalizeCodexModels(result));
    const next = typeof result?.nextCursor === "string" && result.nextCursor ? result.nextCursor : null;
    if (!next || seen.has(next)) break;
    seen.add(next);
    cursor = next;
  }
  const byValue = new Map();
  for (const model of pages) if (!byValue.has(model.model)) byValue.set(model.model, model);
  return [...byValue.values()];
}

export function reconcileReasoningMode(savedMode, model) {
  const mode = String(savedMode || "auto");
  const supported = Array.isArray(model?.supportedReasoningEfforts)
    ? model.supportedReasoningEfforts.map(item => String(item?.reasoningEffort || "")).filter(Boolean)
    : [];
  if (mode !== "auto" && supported.length && !supported.includes(mode)) return "auto";
  return mode;
}

export function reasoningChoices(model) {
  const advertised = Array.isArray(model?.supportedReasoningEfforts)
    ? model.supportedReasoningEfforts
    : [];
  return [
    { value: "auto", description: model?.defaultReasoningEffort ? `default:${model.defaultReasoningEffort}` : "auto" },
    ...advertised.map(item => ({
      value: String(item?.reasoningEffort || ""),
      description: String(item?.description || "")
    })).filter(item => item.value)
  ];
}

export function applyReasoningToTurnStart(params, mode) {
  const next = { ...params };
  if (mode && mode !== "auto") next.effort = mode;
  else delete next.effort;
  return next;
}
