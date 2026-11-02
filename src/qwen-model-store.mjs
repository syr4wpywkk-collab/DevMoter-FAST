// Qwen Code model choice kept on this device, plus the pure list logic the
// picker renders (search, provider filter, recent first). Loaded standalone
// by tests.

export const QWEN_MODEL_KEY = "devmoter-qwen-model";
export const QWEN_RECENT_KEY = "devmoter-qwen-model-recent";
const RECENT_LIMIT = 5;
const AUTH_TYPES = new Set(["openai", "openai-responses", "anthropic", "gemini", "vertex-ai"]);

export function qwenModelKey(model) {
  return model ? `${model.authType}/${model.id}` : "";
}

function cleanChoice(value) {
  if (!value || typeof value !== "object") return null;
  const id = typeof value.id === "string" ? value.id.slice(0, 200) : "";
  const authType = typeof value.authType === "string" ? value.authType : "";
  if (!id || !AUTH_TYPES.has(authType)) return null;
  const name = typeof value.name === "string" && value.name ? value.name.slice(0, 200) : id;
  return { id, authType, name };
}

function read(storage, key) {
  try {
    return JSON.parse(storage.getItem(key) || "null");
  } catch {
    return null;
  }
}

/** null = Qwen Code default (no --model). */
export function loadQwenModel(storage) {
  return cleanChoice(read(storage, QWEN_MODEL_KEY));
}

export function loadRecentQwenModels(storage) {
  const list = read(storage, QWEN_RECENT_KEY);
  return Array.isArray(list) ? list.map(cleanChoice).filter(Boolean).slice(0, RECENT_LIMIT) : [];
}

export function saveQwenModel(storage, choice) {
  const clean = cleanChoice(choice);
  try {
    if (!clean) {
      storage.removeItem(QWEN_MODEL_KEY);
      return null;
    }
    storage.setItem(QWEN_MODEL_KEY, JSON.stringify(clean));
    const recent = [clean, ...loadRecentQwenModels(storage).filter(item => qwenModelKey(item) !== qwenModelKey(clean))].slice(0, RECENT_LIMIT);
    storage.setItem(QWEN_RECENT_KEY, JSON.stringify(recent));
  } catch {
    // Private mode: the choice still applies to this page.
  }
  return clean;
}

/** Short label for the header chip: the id, without the "[Provider] " prefix. */
export function qwenModelChipLabel(choice) {
  return choice ? choice.id.split("/").at(-1) : "既定";
}

/**
 * Sections for the list: recent (still listed, not filtered out) first, then
 * each provider group in its listed order. Disabled models stay visible.
 */
export function qwenModelSections({ groups = [], models = [] }, { query = "", group = "all", recent = [] } = {}) {
  const needle = String(query || "").trim().toLowerCase();
  const match = model => !needle || `${model.id} ${model.name} ${model.host || ""}`.toLowerCase().includes(needle);
  const visible = models.filter(model => (group === "all" || model.group === group) && match(model));
  const sections = [];
  const recentKeys = new Set();
  if (!needle && group === "all") {
    const items = recent
      .map(choice => visible.find(model => !model.disabled && qwenModelKey(model) === qwenModelKey(choice)))
      .filter(Boolean);
    if (items.length) {
      sections.push({ id: "recent", label: "最近使ったモデル", items });
      for (const item of items) recentKeys.add(`${item.group}\0${qwenModelKey(item)}`);
    }
  }
  for (const entry of groups) {
    const items = visible.filter(model => model.group === entry.id && !recentKeys.has(`${model.group}\0${qwenModelKey(model)}`));
    if (items.length) sections.push({ id: entry.id, label: entry.label, items });
  }
  return sections;
}
