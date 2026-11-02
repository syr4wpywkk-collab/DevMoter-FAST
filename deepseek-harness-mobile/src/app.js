import {
  clearSavedHost,
  readSavedHost,
  saveHostUrl,
  validateHostUrl,
} from "./connection.js";

const $ = (selector) => document.querySelector(selector);
const views = ["home", "connect", "settings"];
let hostUrl = readSavedHost();
let hostReachable = false;

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
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function renderConnection() {
  const configured = Boolean(hostUrl);
  $("#workspace-label").textContent = configured ? new URL(hostUrl).host : "未設定のワークスペース";
  $("#connection-label").textContent = configured ? "接続先を保存済み" : "接続先を設定してください";
  $("#status-dot").classList.toggle("ready", hostReachable);
  $("#open-dsh").disabled = !configured;
  document.querySelector('.quick-card[data-action="open"]').disabled = !configured;
  $("#check-host").disabled = !configured;
  $("#settings-host").textContent = configured ? hostUrl : "未設定";
  if ($("#host-url").value === "" && configured) $("#host-url").value = hostUrl;
}

function openDsh() {
  if (!hostUrl) return;
  window.open(hostUrl, "_blank", "noopener,noreferrer");
}

function showError(message) {
  const error = $("#url-error");
  error.textContent = message;
  error.hidden = !message;
}

document.querySelectorAll("[data-view]").forEach((button) => {
  button.addEventListener("click", () => showView(button.dataset.view));
});
$("#open-dsh").addEventListener("click", openDsh);
document.querySelector('.quick-card[data-action="open"]').addEventListener("click", openDsh);

$("#save-host").addEventListener("click", () => {
  const result = saveHostUrl($("#host-url").value);
  if (!result.ok) {
    showError(result.error);
    return;
  }
  showError("");
  hostUrl = result.value;
  hostReachable = false;
  $("#check-result").textContent = "接続先をこの端末に保存しました。";
  renderConnection();
  showView("home");
});

$("#host-url").addEventListener("input", () => {
  showError("");
  $("#check-result").textContent = "";
  $("#check-host").disabled = !validateHostUrl($("#host-url").value).ok;
});

$("#check-host").addEventListener("click", async () => {
  const checked = validateHostUrl($("#host-url").value || hostUrl);
  if (!checked.ok) {
    showError(checked.error);
    return;
  }
  const target = checked.value;
  const button = $("#check-host");
  const output = $("#check-result");
  button.disabled = true;
  output.textContent = "確認中…";
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(target, {
      method: "HEAD",
      mode: "cors",
      credentials: "omit",
      cache: "no-store",
      redirect: "manual",
      signal: controller.signal,
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
    window.clearTimeout(timeout);
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

renderConnection();

if ("serviceWorker" in navigator && window.isSecureContext) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  }, { once: true });
}
