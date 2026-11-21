// DeepSeek API (OpenAI-compatible) client for the mobile companion.
//
// Verified against the official API reference (https://api-docs.deepseek.com):
//   GET  /models            -> { object: "list", data: [{ id, object, owned_by, name?, ... }] }
//   GET  /user/balance      -> { is_available, balance_infos: [{ currency, total_balance, granted_balance, topped_up_balance }] }
//   POST /chat/completions  -> { choices: [{ message: { content, reasoning_content? } }], usage: {...} }
// CORS was verified empirically: api.deepseek.com reflects the request Origin
// in Access-Control-Allow-Origin and allows the authorization header, so the
// browser can call it directly. The API key is held in volatile module memory
// (never in localStorage) and is sent only to api.deepseek.com.

export const API_BASE = "https://api.deepseek.com";
export const API_KEY_STORAGE_KEY = "dsh-mobile.deepseek-api-key";
export const MODEL_STORAGE_KEY = "dsh-mobile.deepseek-model";
export const MODELS_CACHE_KEY = "dsh-mobile.deepseek-models-cache";
export const LEDGER_STORAGE_KEY = "dsh-mobile.deepseek-usage-ledger";

const defaultFetch = (...args) => globalThis.fetch(...args);

export class DeepSeekError extends Error {
  constructor(kind, message, status = 0) {
    super(message);
    this.name = "DeepSeekError";
    this.kind = kind;
    this.status = status;
  }
}

function storageOrDefault(storage) {
  return storage ?? globalThis.localStorage;
}

function readJson(storage, key) {
  try {
    const raw = storage?.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeJson(storage, key, value) {
  try {
    storage?.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

// --- API key ---------------------------------------------------------------

export function validateApiKey(input) {
  const value = String(input ?? "").trim();
  if (!value) return { ok: false, error: "API キーを入力してください。" };
  if (/\s/.test(value)) return { ok: false, error: "API キーに空白は含められません。" };
  return { ok: true, value };
}

// This static PWA cannot safely persist a reusable API secret in the browser.
// Keep the key only for the lifetime of this JS module / loaded page.
let activeApiKey = "";

// v0.2.0 stored the key in plaintext. Remove that old value on every startup,
// save and clear; critically, do not import it into memory first.
function purgeLegacyApiKey(storage) {
  try {
    const target = storage === undefined ? globalThis.localStorage : storage;
    target?.removeItem(API_KEY_STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
}

export function readApiKey(storage) {
  purgeLegacyApiKey(storage);
  return activeApiKey;
}

export function saveApiKey(value, storage) {
  const checked = validateApiKey(value);
  if (!checked.ok) return checked;
  purgeLegacyApiKey(storage);
  activeApiKey = checked.value;
  return { ok: true, value: activeApiKey };
}

export function clearApiKey(storage) {
  activeApiKey = "";
  return purgeLegacyApiKey(storage);
}

// Only the last four characters are ever surfaced, so the key can be
// identified on screen without being exposed.
export function maskApiKey(key) {
  const value = String(key ?? "");
  if (value.length < 4) return value ? "登録済み" : "";
  return `末尾 ${value.slice(-4)}`;
}

// --- Model selection ---------------------------------------------------------

export function readSelectedModel(storage = globalThis.localStorage) {
  try {
    return storage?.getItem(MODEL_STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
}

export function saveSelectedModel(modelId, storage = globalThis.localStorage) {
  const value = String(modelId ?? "").trim();
  try {
    if (value) storage?.setItem(MODEL_STORAGE_KEY, value);
    else storage?.removeItem(MODEL_STORAGE_KEY);
    return value;
  } catch {
    return value;
  }
}

export function readCachedModels(storage = globalThis.localStorage) {
  const cached = readJson(storageOrDefault(storage), MODELS_CACHE_KEY);
  if (!cached || !Array.isArray(cached.models)) return null;
  return cached;
}

export function cacheModels(models, storage = globalThis.localStorage, now = Date.now()) {
  return writeJson(storageOrDefault(storage), MODELS_CACHE_KEY, {
    fetchedAt: now,
    models,
  });
}

// --- Response parsing (pure, exported for tests) ------------------------------

export function parseModels(payload) {
  const list = Array.isArray(payload?.data) ? payload.data : [];
  const models = [];
  for (const entry of list) {
    const id = typeof entry?.id === "string" ? entry.id.trim() : "";
    if (!id) continue;
    models.push({
      id,
      name: typeof entry.name === "string" && entry.name.trim() ? entry.name.trim() : id,
      ownedBy: typeof entry.owned_by === "string" ? entry.owned_by : "",
      contextWindow: Number.isFinite(entry.context_window) ? entry.context_window : null,
      maxOutputTokens: Number.isFinite(entry.max_output_tokens) ? entry.max_output_tokens : null,
    });
  }
  return models;
}

function toAmount(value) {
  const amount = Number.parseFloat(String(value ?? ""));
  return Number.isFinite(amount) ? amount : 0;
}

export function parseBalance(payload) {
  const infos = Array.isArray(payload?.balance_infos) ? payload.balance_infos : [];
  return {
    isAvailable: payload?.is_available === true,
    balances: infos
      .filter((info) => typeof info?.currency === "string" && info.currency)
      .map((info) => ({
        currency: info.currency,
        total: toAmount(info.total_balance),
        granted: toAmount(info.granted_balance),
        toppedUp: toAmount(info.topped_up_balance),
      })),
  };
}

export function parseUsage(raw) {
  if (!raw || typeof raw !== "object") return null;
  const num = (value) => (Number.isFinite(value) ? value : 0);
  return {
    promptTokens: num(raw.prompt_tokens),
    completionTokens: num(raw.completion_tokens),
    totalTokens: num(raw.total_tokens),
    cacheHitTokens: num(raw.prompt_cache_hit_tokens),
    cacheMissTokens: num(raw.prompt_cache_miss_tokens),
    reasoningTokens: num(raw.completion_tokens_details?.reasoning_tokens),
  };
}

export function parseChatCompletion(payload) {
  const message = payload?.choices?.[0]?.message ?? {};
  return {
    id: typeof payload?.id === "string" ? payload.id : "",
    model: typeof payload?.model === "string" ? payload.model : "",
    content: typeof message.content === "string" ? message.content : "",
    reasoningContent:
      typeof message.reasoning_content === "string" ? message.reasoning_content : "",
    finishReason: payload?.choices?.[0]?.finish_reason ?? "",
    usage: parseUsage(payload?.usage),
  };
}

// --- HTTP layer ----------------------------------------------------------------

function errorForStatus(status, detail) {
  if (status === 401) {
    return new DeepSeekError("auth", "API キーが無効です。設定画面でキーを確認してください。", status);
  }
  if (status === 402) {
    return new DeepSeekError("balance", "残高が不足しています。DeepSeek の管理画面でチャージしてください。", status);
  }
  if (status === 429) {
    return new DeepSeekError("rate", "リクエストが集中しています。少し待ってから再試行してください。", status);
  }
  const suffix = detail ? `（${detail}）` : "";
  return new DeepSeekError("http", `DeepSeek API から HTTP ${status} が返りました${suffix}。`, status);
}

async function request(path, { apiKey, fetchImpl = defaultFetch, method = "GET", body, signal } = {}) {
  const key = String(apiKey ?? "").trim();
  if (!key) {
    throw new DeepSeekError("no-key", "API キーが未設定です。設定画面で登録してください。");
  }
  let response;
  try {
    response = await fetchImpl(`${API_BASE}${path}`, {
      method,
      mode: "cors",
      credentials: "omit",
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${key}`,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      ...(signal ? { signal } : {}),
    });
  } catch (error) {
    if (error?.name === "AbortError") throw error;
    throw new DeepSeekError(
      "network",
      "api.deepseek.com に接続できませんでした。通信環境を確認して再試行してください。"
    );
  }
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  if (!response.ok) {
    throw errorForStatus(response.status, payload?.error?.message ?? "");
  }
  if (!payload || typeof payload !== "object") {
    throw new DeepSeekError("parse", "DeepSeek API から予期しない応答が返りました。");
  }
  return payload;
}

export async function fetchModels(apiKey, options = {}) {
  const payload = await request("/models", { apiKey, ...options });
  return parseModels(payload);
}

export async function fetchBalance(apiKey, options = {}) {
  const payload = await request("/user/balance", { apiKey, ...options });
  return parseBalance(payload);
}

export async function createChatCompletion(apiKey, { model, prompt } = {}, options = {}) {
  const modelId = String(model ?? "").trim();
  if (!modelId) {
    throw new DeepSeekError("no-model", "モデルが選択されていません。モデル一覧を取得して選択してください。");
  }
  const text = String(prompt ?? "").trim();
  if (!text) {
    throw new DeepSeekError("empty-prompt", "プロンプトを入力してください。");
  }
  const payload = await request("/chat/completions", {
    apiKey,
    method: "POST",
    body: {
      model: modelId,
      messages: [{ role: "user", content: text }],
      stream: false,
    },
    ...options,
  });
  return parseChatCompletion(payload);
}

// --- Local usage ledger ----------------------------------------------------------
// The DeepSeek API exposes the account balance but no per-request history, so
// requests made from this device are totalled locally. This is a device-local
// tally, not an account-wide figure.

const EMPTY_LEDGER = Object.freeze({
  requests: 0,
  promptTokens: 0,
  completionTokens: 0,
  totalTokens: 0,
});

export function readLedger(storage = globalThis.localStorage) {
  const saved = readJson(storageOrDefault(storage), LEDGER_STORAGE_KEY);
  if (!saved) return { ...EMPTY_LEDGER };
  const num = (value) => (Number.isFinite(value) && value > 0 ? Math.floor(value) : 0);
  return {
    requests: num(saved.requests),
    promptTokens: num(saved.promptTokens),
    completionTokens: num(saved.completionTokens),
    totalTokens: num(saved.totalTokens),
  };
}

export function recordUsage(usage, storage = globalThis.localStorage) {
  const ledger = readLedger(storage);
  if (!usage) return ledger;
  ledger.requests += 1;
  ledger.promptTokens += usage.promptTokens ?? 0;
  ledger.completionTokens += usage.completionTokens ?? 0;
  ledger.totalTokens += usage.totalTokens ?? 0;
  writeJson(storageOrDefault(storage), LEDGER_STORAGE_KEY, ledger);
  return ledger;
}

export function resetLedger(storage = globalThis.localStorage) {
  try {
    storage?.removeItem(LEDGER_STORAGE_KEY);
  } catch {
    // A ledger that cannot be cleared is not fatal; the next read re-validates.
  }
  return { ...EMPTY_LEDGER };
}

// --- Formatting -------------------------------------------------------------------

export function formatTokens(value) {
  const num = Number.isFinite(value) ? value : 0;
  return new Intl.NumberFormat("ja-JP").format(num);
}

export function formatMoney(amount, currency) {
  const value = Number.isFinite(amount) ? amount : 0;
  try {
    return new Intl.NumberFormat("ja-JP", {
      style: "currency",
      currency: currency || "USD",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return `${value.toFixed(2)} ${currency ?? ""}`.trim();
  }
}
