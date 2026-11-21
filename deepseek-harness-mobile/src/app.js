import {
  clearSavedHost,
  readSavedHost,
  saveHostUrl,
  validateHostUrl,
} from "./connection.js";
import {
  DeepSeekError,
  cacheModels,
  clearApiKey,
  createChatCompletion,
  fetchBalance,
  fetchModels,
  formatMoney,
  formatTokens,
  maskApiKey,
  readApiKey,
  readCachedModels,
  readLedger,
  readSelectedModel,
  recordUsage,
  resetLedger,
  saveApiKey,
  saveSelectedModel,
} from "./deepseek.js";

const $ = (selector) => document.querySelector(selector);
const views = ["home", "api", "connect", "settings"];

let hostUrl = readSavedHost();
let hostReachable = false;
let apiKey = readApiKey();
let models = [];
let modelsLoaded = false;
let balanceBusy = false;
let modelsBusy = false;
let chatBusy = false;

function withTimeout(ms) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), ms);
  return { signal: controller.signal, done: () => window.clearTimeout(timer) };
}

function errorMessage(error, fallback) {
  if (error?.name === "AbortError") return "応答がタイムアウトしました。通信環境を確認して再試行してください。";
  if (error instanceof DeepSeekError) return error.message;
  return fallback;
}

function showFieldError(selector, message) {
  const error = $(selector);
  error.textContent = message;
  error.hidden = !message;
}

// --- Views -------------------------------------------------------------------

function showView(name) {
  for (const view of views) {
    const section = document.getElementById(`view-${view}`);
    const button = document.querySelector(`.nav-item[data-view="${view}"]`);
    const active = view === name;
    section.hidden = !active;
    section.classList.toggle("is-active", active);
    button.classList.toggle("is-active", active);
    if (active) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  }
  window.scrollTo({ top: 0 });
  if (name === "api" && apiKey && !modelsLoaded && !modelsBusy) {
    void loadModels();
  }
}

document.querySelectorAll("[data-view]").forEach((button) => {
  button.addEventListener("click", () => showView(button.dataset.view));
});

// --- DSH connection (existing shell behavior) ---------------------------------

function renderConnection() {
  const configured = Boolean(hostUrl);
  $("#workspace-label").textContent = configured ? new URL(hostUrl).host : "未設定";
  $("#connection-label").textContent = configured
    ? hostReachable
      ? "応答を確認済み"
      : "接続先を保存済み"
    : "接続先を設定してください";
  $("#status-dot").className = `status-dot${hostReachable ? " ready" : ""}`;
  $("#open-dsh").disabled = !configured;
  $("#check-host").disabled = !configured;
  $("#settings-host").textContent = configured ? hostUrl : "未設定";
  if ($("#host-url").value === "" && configured) $("#host-url").value = hostUrl;
}

function openDsh() {
  if (!hostUrl) return;
  window.open(hostUrl, "_blank", "noopener,noreferrer");
}

$("#open-dsh").addEventListener("click", openDsh);

$("#save-host").addEventListener("click", () => {
  const result = saveHostUrl($("#host-url").value);
  if (!result.ok) {
    showFieldError("#url-error", result.error);
    return;
  }
  showFieldError("#url-error", "");
  hostUrl = result.value;
  hostReachable = false;
  $("#check-result").textContent = "接続先をこの端末に保存しました。";
  renderConnection();
  showView("home");
});

$("#host-url").addEventListener("input", () => {
  showFieldError("#url-error", "");
  $("#check-result").textContent = "";
  $("#check-host").disabled = !validateHostUrl($("#host-url").value).ok;
});

$("#check-host").addEventListener("click", async () => {
  const checked = validateHostUrl($("#host-url").value || hostUrl);
  if (!checked.ok) {
    showFieldError("#url-error", checked.error);
    return;
  }
  const target = checked.value;
  const button = $("#check-host");
  const output = $("#check-result");
  button.disabled = true;
  output.textContent = "確認中…";
  const timeout = withTimeout(5000);
  try {
    const response = await fetch(target, {
      method: "HEAD",
      mode: "cors",
      credentials: "omit",
      cache: "no-store",
      redirect: "manual",
      signal: timeout.signal,
    });
    hostReachable = target === hostUrl && response.ok;
    output.textContent = response.ok
      ? "ホストから応答がありました。"
      : response.status === 0
        ? "応答を確認できませんでした。リダイレクトまたは CORS 制限の可能性があります。"
        : `ホストから HTTP ${response.status} が返りました。`;
  } catch {
    hostReachable = false;
    output.textContent = "ブラウザから応答を確認できませんでした。CORS 制限の場合もあるため、DSH を開いて確認してください。";
  } finally {
    timeout.done();
    button.disabled = !validateHostUrl($("#host-url").value || hostUrl).ok;
    renderConnection();
  }
});

$("#clear-host").addEventListener("click", () => {
  clearSavedHost();
  hostUrl = "";
  hostReachable = false;
  $("#host-url").value = "";
  $("#check-result").textContent = "";
  renderConnection();
  showView("connect");
});

// --- DeepSeek API key ------------------------------------------------------------

function renderApiKeyState() {
  const registered = Boolean(apiKey);
  $("#apikey-state").textContent = registered ? `使用中（${maskApiKey(apiKey)}）` : "未登録";
  $("#settings-apikey").textContent = registered ? `使用中（${maskApiKey(apiKey)}）` : "未登録";
  $("#clear-apikey").disabled = !registered;
  $("#refresh-balance").disabled = !registered || balanceBusy;
  $("#refresh-models").disabled = !registered || modelsBusy;
  $("#balance-empty").hidden = registered;
  if (!registered) {
    $("#balance-content").hidden = true;
    showFieldError("#balance-error", "");
  }
  updateSendButton();
}

$("#save-apikey").addEventListener("click", () => {
  const result = saveApiKey($("#api-key").value);
  if (!result.ok) {
    showFieldError("#apikey-error", result.error);
    return;
  }
  showFieldError("#apikey-error", "");
  apiKey = result.value;
  $("#api-key").value = "";
  modelsLoaded = false;
  renderApiKeyState();
  void loadBalance();
  void loadModels();
});

$("#clear-apikey").addEventListener("click", () => {
  clearApiKey();
  apiKey = "";
  models = [];
  modelsLoaded = false;
  renderApiKeyState();
  renderModels();
  renderHomeModel();
  showFieldError("#balance-error", "");
  showFieldError("#models-error", "");
  $("#models-status").textContent = "";
});

// --- Balance -----------------------------------------------------------------------

function renderBalance(balance, fetchedAt) {
  const [primary, ...rest] = balance.balances;
  $("#balance-content").hidden = false;
  if (!primary) {
    $("#balance-total").textContent = "–";
    $("#balance-status").textContent = "残高情報を取得できませんでした";
    return;
  }
  $("#balance-total").textContent = formatMoney(primary.total, primary.currency);
  $("#balance-topped-up").textContent = formatMoney(primary.toppedUp, primary.currency);
  $("#balance-granted").textContent = formatMoney(primary.granted, primary.currency);
  $("#balance-status").textContent = balance.isAvailable ? "利用できます" : "残高が不足しています";
  $("#balance-dot").className = `status-dot${balance.isAvailable ? " ready" : " error"}`;
  const others = $("#balance-others");
  others.replaceChildren();
  for (const extra of rest) {
    const row = document.createElement("div");
    row.className = "row";
    const dt = document.createElement("dt");
    dt.textContent = `${extra.currency} の残高`;
    const dd = document.createElement("dd");
    dd.textContent = formatMoney(extra.total, extra.currency);
    row.append(dt, dd);
    others.append(row);
  }
  if (fetchedAt) {
    const time = new Intl.DateTimeFormat("ja-JP", { hour: "2-digit", minute: "2-digit" }).format(fetchedAt);
    $("#balance-updated").textContent = `最終更新 ${time}`;
  }
}

async function loadBalance() {
  if (!apiKey || balanceBusy) return;
  balanceBusy = true;
  renderApiKeyState();
  showFieldError("#balance-error", "");
  const timeout = withTimeout(15000);
  try {
    const balance = await fetchBalance(apiKey, { signal: timeout.signal });
    renderBalance(balance, new Date());
  } catch (error) {
    showFieldError("#balance-error", errorMessage(error, "残高を取得できませんでした。"));
  } finally {
    timeout.done();
    balanceBusy = false;
    renderApiKeyState();
  }
}

$("#refresh-balance").addEventListener("click", () => void loadBalance());

// --- Models ---------------------------------------------------------------------------

function renderModels() {
  const select = $("#model-select");
  const selected = readSelectedModel();
  select.replaceChildren();
  if (models.length === 0) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = apiKey ? "モデル一覧が未取得です" : "API キーが未設定です";
    select.append(option);
    select.disabled = true;
  } else {
    for (const model of models) {
      const option = document.createElement("option");
      option.value = model.id;
      option.textContent = model.name !== model.id ? `${model.name}（${model.id}）` : model.id;
      select.append(option);
    }
    select.disabled = false;
    if (selected && models.some((model) => model.id === selected)) {
      select.value = selected;
    } else {
      select.value = models[0].id;
      saveSelectedModel(models[0].id);
    }
  }
  renderModelMeta();
  renderHomeModel();
  updateSendButton();
}

function renderModelMeta() {
  const model = models.find((entry) => entry.id === $("#model-select").value);
  const parts = [];
  if (model?.contextWindow) parts.push(`コンテキスト ${formatTokens(model.contextWindow)} トークン`);
  if (model?.maxOutputTokens) parts.push(`最大出力 ${formatTokens(model.maxOutputTokens)} トークン`);
  $("#model-meta").textContent = parts.join("、");
}

function renderHomeModel() {
  const selectedId = readSelectedModel();
  const model = models.find((entry) => entry.id === selectedId);
  const label = model ? (model.name !== model.id ? model.name : model.id) : selectedId || "未選択";
  $("#home-model").textContent = label;
  $("#settings-model").textContent = label;
}

async function loadModels() {
  if (!apiKey || modelsBusy) return;
  modelsBusy = true;
  renderApiKeyState();
  showFieldError("#models-error", "");
  $("#models-status").textContent = "モデル一覧を取得中…";
  const timeout = withTimeout(15000);
  try {
    models = await fetchModels(apiKey, { signal: timeout.signal });
    modelsLoaded = true;
    cacheModels(models);
    $("#models-status").textContent = `${models.length} 件のモデルを取得しました。`;
    renderModels();
  } catch (error) {
    $("#models-status").textContent = "";
    showFieldError("#models-error", errorMessage(error, "モデル一覧を取得できませんでした。"));
  } finally {
    timeout.done();
    modelsBusy = false;
    renderApiKeyState();
  }
}

$("#refresh-models").addEventListener("click", () => void loadModels());
$("#model-select").addEventListener("change", () => {
  saveSelectedModel($("#model-select").value);
  renderModelMeta();
  renderHomeModel();
  updateSendButton();
});

// --- Chat test ---------------------------------------------------------------------------

function updateSendButton() {
  $("#send-chat").disabled =
    chatBusy || !apiKey || !$("#model-select").value || !$("#prompt").value.trim();
}

$("#prompt").addEventListener("input", updateSendButton);

$("#send-chat").addEventListener("click", async () => {
  if (chatBusy) return;
  chatBusy = true;
  const button = $("#send-chat");
  button.textContent = "送信中…";
  updateSendButton();
  showFieldError("#chat-error", "");
  const timeout = withTimeout(60000);
  try {
    const result = await createChatCompletion(
      apiKey,
      { model: $("#model-select").value, prompt: $("#prompt").value },
      { signal: timeout.signal }
    );
    $("#chat-result").hidden = false;
    $("#chat-content").textContent = result.content || "（応答本文が空でした）";
    const hasReasoning = Boolean(result.reasoningContent);
    $("#chat-reasoning").hidden = !hasReasoning;
    if (hasReasoning) $("#chat-reasoning-text").textContent = result.reasoningContent;
    if (result.usage) {
      const usage = result.usage;
      const parts = [
        `入力 ${formatTokens(usage.promptTokens)}`,
        `出力 ${formatTokens(usage.completionTokens)}`,
        `合計 ${formatTokens(usage.totalTokens)} トークン`,
      ];
      if (usage.cacheHitTokens || usage.cacheMissTokens) {
        parts.push(`キャッシュ命中 ${formatTokens(usage.cacheHitTokens)}`);
      }
      if (usage.reasoningTokens) parts.push(`思考 ${formatTokens(usage.reasoningTokens)}`);
      $("#chat-usage").textContent = parts.join("、");
      recordUsage(usage);
      renderLedger();
    } else {
      $("#chat-usage").textContent = "使用量は応答に含まれていませんでした。";
    }
    void loadBalance();
  } catch (error) {
    showFieldError("#chat-error", errorMessage(error, "送信できませんでした。"));
  } finally {
    timeout.done();
    chatBusy = false;
    button.textContent = "送信";
    updateSendButton();
  }
});

// --- Local usage ledger ---------------------------------------------------------------------

function ledgerSummary(ledger) {
  return `リクエスト ${formatTokens(ledger.requests)} 回、合計 ${formatTokens(ledger.totalTokens)} トークン`;
}

function renderLedger() {
  const ledger = readLedger();
  $("#ledger-requests").textContent = `${formatTokens(ledger.requests)} 回`;
  $("#ledger-prompt").textContent = formatTokens(ledger.promptTokens);
  $("#ledger-completion").textContent = formatTokens(ledger.completionTokens);
  $("#ledger-total").textContent = formatTokens(ledger.totalTokens);
  $("#home-usage").textContent = ledgerSummary(ledger);
  $("#settings-usage").textContent = ledgerSummary(ledger);
}

$("#reset-ledger").addEventListener("click", () => {
  resetLedger();
  renderLedger();
});

// --- Initial render ----------------------------------------------------------------------------

const cached = readCachedModels();
if (cached) {
  models = cached.models;
  modelsLoaded = true;
}
renderConnection();
renderApiKeyState();
renderModels();
renderLedger();
if (apiKey) void loadBalance();

if ("serviceWorker" in navigator && window.isSecureContext) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  }, { once: true });
}
