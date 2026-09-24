export function normalizeCodexModels(payload) {
  const raw = payload?.data ?? payload?.models ?? [];
  if (!Array.isArray(raw)) return [];
  return raw
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
