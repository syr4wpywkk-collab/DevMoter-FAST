import { getLanguage } from "./i18n";

type ApiProvider = {
  id: string;
  name: string;
  presetId?: string;
  protocol: "openai-compatible" | "anthropic";
  baseUrl: string;
  ready: boolean;
  secretRef?: string;
  projectId?: string;
  credentialSource?: "api-key" | "vault";
  models: string[];
  reasoningModes?: string[];
  source?: "file" | "env";
  editable?: boolean;
};

type ApiPreset = {
  id: string;
  name: string;
  protocol: "openai-compatible" | "anthropic";
  baseUrl: string;
};

type ApiAttachment = {
  id: string;
  name: string;
  mime: string;
  size: number;
  previewUrl?: string;
};

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  attachments?: ApiAttachment[];
};

const API_CHAT_HISTORY_LIMIT = 100;
const DEVICE_TOKEN_KEY = "devmoter-device-token";
const PROJECT_KEY = "opencode-pocket-project";

type ApiChatOptions = {
  onCodex?: () => void;
  onOpenCode?: () => void;
};

export type ApiChatController = {
  refresh(): Promise<void>;
};

function apiLocale(en: string, ja: string, zhCN: string) {
  const language = getLanguage();
  if (language === "ja") return ja;
  if (language === "zh-CN") return zhCN;
  return en;
}

function operationId() {
  return globalThis.crypto?.randomUUID?.() ??
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

async function apiJson<T = any>(path: string, init: RequestInit = {}): Promise<T> {
  const method = String(init.method || "GET").toUpperCase();
  const mutating = method !== "GET" && method !== "HEAD";
  const headers = new Headers(init.headers || {});
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  if (mutating && !headers.has("x-pocket-operation-id")) headers.set("x-pocket-operation-id", operationId());
  const deviceToken = localStorage.getItem(DEVICE_TOKEN_KEY);
  if (deviceToken) headers.set("x-devmoter-device-token", deviceToken);
  const res = await fetch(path, {
    ...init,
    cache: method === "GET" ? "no-store" : undefined,
    headers
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(payload?.error || `HTTP ${res.status}`);
  return payload as T;
}

export function mountApiChat(
  root: HTMLElement,
  options: ApiChatOptions = {}
): ApiChatController {
  root.innerHTML = `
    <div class="api-app">
      <aside id="apiSidebar" class="api-sidebar">
        <div class="api-sidebar-head dm-agent-head">
          <div class="dm-agent-switch-shell">
            <button id="apiAgentSwitchButton" class="dm-agent-switch-trigger" type="button" aria-haspopup="listbox" aria-expanded="false">
              <span class="dm-agent-switch-icon">✦</span>
              <span class="dm-agent-switch-copy"><strong>API Chat</strong><small>現在のエージェント</small></span>
              <span class="dm-agent-switch-chevron">⌄</span>
            </button>
            <div id="apiAgentSwitchMenu" class="dm-agent-switch-menu hidden" role="listbox" aria-label="エージェントを選択">
              <button id="apiGoCodex" type="button" data-agent="codex"><span>⌘</span><span><strong>Codex</strong><small>実装・修正</small></span><span></span></button>
              <button id="apiGoOpenCode" type="button" data-agent="opencode"><span>◈</span><span><strong>OpenCode</strong><small>エージェント実行</small></span><span></span></button>
              <button id="apiAgentCurrent" class="active" type="button" data-agent="api"><span>✦</span><span><strong>API Chat</strong><small>マルチプロバイダー</small></span><span>✓</span></button>
            </div>
          </div>
          <button id="apiSidebarClose" type="button" aria-label="閉じる">×</button>
        </div>
        <button id="apiNewChat" class="api-new-chat" type="button">＋ 新しいチャット</button>
        <div class="api-nav-label">SETTINGS</div>
        <nav class="api-agent-nav">
          <button id="apiSettingsSide" type="button"><span>⚙</span><span>API Providers</span></button>
        </nav>
        <div class="api-sidebar-note">
          APIキーはDevMoterサーバー側だけに保存され、保存後ブラウザへ返されません。
        </div>
      </aside>

      <header class="api-topbar">
        <button id="apiMenu" class="api-icon-button" type="button" aria-label="メニュー">☰</button>
        <div class="api-brand">
          <strong>API Chat</strong>
          <small>Multi-provider</small>
        </div>
        <div class="api-picker-row">
          <select id="apiProvider" aria-label="API provider"></select>
          <select id="apiModel" aria-label="Model"></select>
          <select id="apiReasoning" aria-label="推論モード"></select>
          <button id="apiSettingsTop" class="api-icon-button api-settings-button" type="button" aria-label="API設定">⚙</button>
        </div>
      </header>

      <main class="api-main">
        <div id="apiTranscript" class="api-transcript">
          <section id="apiWelcome" class="api-welcome">
            <div class="api-spark">✦</div>
            <h1>こんにちは</h1>
            <p>どのAPIで考える？</p>
          </section>
        </div>
      </main>

      <section class="api-composer-wrap">
        <form id="apiForm" class="api-composer">
          <div id="apiAttachments" class="api-attachment-tray hidden"></div>
          <textarea id="apiPrompt" rows="1" placeholder="メッセージを入力" aria-label="メッセージ"></textarea>
          <input id="apiImageInput" class="hidden" type="file" accept="image/jpeg,image/png,image/webp,image/gif" multiple />
          <div class="api-composer-foot">
            <button id="apiAttachImage" class="api-attach-button" type="button" aria-label="画像を添付">＋</button>
            <span id="apiStatus">接続先を読み込み中…</span>
            <button id="apiSend" type="submit" aria-label="送信">↑</button>
          </div>
        </form>
      </section>

      <div id="apiSettingsModal" class="api-settings-modal hidden" role="dialog" aria-modal="true" aria-labelledby="apiSettingsTitle">
        <div class="api-settings-card">
          <header class="api-settings-head">
            <div>
              <strong id="apiSettingsTitle">API Providers</strong>
              <small>キーはこの端末のDevMoterにだけ保存</small>
            </div>
            <button id="apiSettingsClose" type="button" aria-label="閉じる">×</button>
          </header>
          <div id="apiSettingsBody" class="api-settings-body"></div>
        </div>
      </div>
    </div>
  `;

  const sidebar = root.querySelector<HTMLElement>("#apiSidebar")!;
  const menu = root.querySelector<HTMLButtonElement>("#apiMenu")!;
  const sidebarClose = root.querySelector<HTMLButtonElement>("#apiSidebarClose")!;
  const agentSwitchButton = root.querySelector<HTMLButtonElement>("#apiAgentSwitchButton")!;
  const agentSwitchMenu = root.querySelector<HTMLDivElement>("#apiAgentSwitchMenu")!;
  const agentCurrent = root.querySelector<HTMLButtonElement>("#apiAgentCurrent")!;
  const goCodex = root.querySelector<HTMLButtonElement>("#apiGoCodex")!;
  const goOpenCode = root.querySelector<HTMLButtonElement>("#apiGoOpenCode")!;
  const settingsSide = root.querySelector<HTMLButtonElement>("#apiSettingsSide")!;
  const settingsTop = root.querySelector<HTMLButtonElement>("#apiSettingsTop")!;
  const newChat = root.querySelector<HTMLButtonElement>("#apiNewChat")!;
  const providerSelect = root.querySelector<HTMLSelectElement>("#apiProvider")!;
  const modelSelect = root.querySelector<HTMLSelectElement>("#apiModel")!;
  const reasoningSelect = root.querySelector<HTMLSelectElement>("#apiReasoning")!;
  const transcript = root.querySelector<HTMLDivElement>("#apiTranscript")!;
  const welcome = root.querySelector<HTMLElement>("#apiWelcome")!;
  const form = root.querySelector<HTMLFormElement>("#apiForm")!;
  const prompt = root.querySelector<HTMLTextAreaElement>("#apiPrompt")!;
  const attachmentTray = root.querySelector<HTMLDivElement>("#apiAttachments")!;
  const imageInput = root.querySelector<HTMLInputElement>("#apiImageInput")!;
  const attachImage = root.querySelector<HTMLButtonElement>("#apiAttachImage")!;
  const send = root.querySelector<HTMLButtonElement>("#apiSend")!;
  const status = root.querySelector<HTMLElement>("#apiStatus")!;
  const settingsModal = root.querySelector<HTMLDivElement>("#apiSettingsModal")!;
  const settingsClose = root.querySelector<HTMLButtonElement>("#apiSettingsClose")!;
  const settingsBody = root.querySelector<HTMLDivElement>("#apiSettingsBody")!;

  let providers: ApiProvider[] = [];
  let presets: ApiPreset[] = [];
  let messages: ChatMessage[] = [];
  let pendingAttachments: ApiAttachment[] = [];
  let uploadingCount = 0;
  let sending = false;
  let conversationGeneration = 0;
  let activeChatController: AbortController | null = null;

  function trimHistory() {
    if (messages.length > API_CHAT_HISTORY_LIMIT) {
      messages = messages.slice(-API_CHAT_HISTORY_LIMIT);
    }
  }

  function openSidebar() {
    sidebar.classList.add("open");
  }

  function closeSidebar() {
    agentSwitchMenu.classList.add("hidden");
    agentSwitchButton.setAttribute("aria-expanded", "false");
    sidebar.classList.remove("open");
  }

  function closeSettings() {
    settingsModal.classList.add("hidden");
  }

  function currentProvider() {
    return providers.find(provider => provider.id === providerSelect.value) ?? null;
  }

  function reasoningLabel(mode: string) {
    const label = ({
      auto: "Auto",
      none: "Off",
      low: "Low",
      medium: "Medium",
      high: "High"
    } as Record<string, string>)[mode] || mode;
    return apiLocale("Reasoning: " + label, "推論: " + label, "推理: " + label);
  }

  function updateReasoning() {
    const provider = currentProvider();
    const modes = provider?.reasoningModes?.length ? provider.reasoningModes : ["auto"];
    const storageKey = `devmoter-api-reasoning:${provider?.id || ""}:${modelSelect.value || ""}`;
    const saved = localStorage.getItem(storageKey);

    reasoningSelect.replaceChildren();
    for (const mode of modes) {
      const option = document.createElement("option");
      option.value = mode;
      option.textContent = reasoningLabel(mode);
      reasoningSelect.appendChild(option);
    }
    reasoningSelect.value = saved && modes.includes(saved) ? saved : "auto";
    reasoningSelect.disabled = modes.length <= 1;
  }

  function updateModels() {
    const provider = currentProvider();
    const savedModel = localStorage.getItem(`devmoter-api-model:${provider?.id || ""}`);
    modelSelect.replaceChildren();

    for (const model of provider?.models ?? []) {
      const option = document.createElement("option");
      option.value = model;
      option.textContent = model;
      modelSelect.appendChild(option);
    }

    if (savedModel && provider?.models.includes(savedModel)) {
      modelSelect.value = savedModel;
    }
    updateReasoning();

    status.textContent = !provider
      ? apiLocale("⚙ Add an API provider", "⚙ API Providerを追加してね", "⚙ 添加 API Provider")
      : provider.ready
        ? `${provider.name} · Ready`
        : `${provider.name} · ${apiLocale("API key missing", "APIキー未設定", "未设置 API 密钥")}`;
    send.disabled = !provider?.ready || !modelSelect.value || sending || uploadingCount > 0;
    attachImage.disabled = sending || uploadingCount > 0;
  }

  function resizePrompt() {
    prompt.style.height = "auto";
    prompt.style.height = `${Math.min(prompt.scrollHeight, 180)}px`;
  }

  function renderMessages() {
    transcript.querySelectorAll(".api-message").forEach(node => node.remove());
    welcome.classList.toggle("hidden", messages.length > 0);

    for (const message of messages) {
      const row = document.createElement("article");
      row.className = `api-message ${message.role}`;
      const bubble = document.createElement("div");
      bubble.className = "api-message-bubble";
      bubble.textContent = message.content;

      if (message.attachments?.length) {
        const attachments = document.createElement("div");
        attachments.className = "api-message-attachments";
        for (const attachment of message.attachments) {
          const chip = document.createElement("span");
          chip.textContent = `🖼 ${attachment.name}`;
          attachments.appendChild(chip);
        }
        bubble.appendChild(attachments);
      }

      row.appendChild(bubble);
      transcript.appendChild(row);
    }

    transcript.scrollTop = transcript.scrollHeight;
  }

  function renderPendingAttachments() {
    attachmentTray.replaceChildren();
    attachmentTray.classList.toggle("hidden", pendingAttachments.length === 0);

    for (const attachment of pendingAttachments) {
      const item = document.createElement("div");
      item.className = "api-attachment-chip";

      if (attachment.previewUrl) {
        const image = document.createElement("img");
        image.src = attachment.previewUrl;
        image.alt = "";
        item.appendChild(image);
      }

      const name = document.createElement("span");
      name.textContent = attachment.name;
      item.appendChild(name);

      const remove = document.createElement("button");
      remove.type = "button";
      remove.setAttribute("aria-label", `${attachment.name} を削除`);
      remove.textContent = "×";
      remove.addEventListener("click", async () => {
        pendingAttachments = pendingAttachments.filter(item => item.id !== attachment.id);
        if (attachment.previewUrl) URL.revokeObjectURL(attachment.previewUrl);
        renderPendingAttachments();
        try {
          await apiJson(`/api/llm/attachments/${encodeURIComponent(attachment.id)}`, {
            method: "DELETE"
          });
        } catch {
          // Server cleanup will remove stale temporary attachments later.
        }
      });
      item.appendChild(remove);
      attachmentTray.appendChild(item);
    }
  }

  async function uploadImage(file: File) {
    if (!["image/jpeg", "image/png", "image/webp", "image/gif"].includes(file.type)) {
      throw new Error(apiLocale("Only JPEG / PNG / WebP / GIF are supported", "JPEG / PNG / WebP / GIF のみ対応しています", "仅支持 JPEG / PNG / WebP / GIF"));
    }
    if (file.size <= 0 || file.size > 15 * 1024 * 1024) {
      throw new Error(apiLocale("Images must be 15 MB or smaller", "画像は15MB以下にしてください", "图片必须不超过 15MB"));
    }

    const res = await fetch("/api/llm/attachments", {
      method: "POST",
      headers: {
        "content-type": file.type,
        "x-devmoter-file-name": encodeURIComponent(file.name),
        "x-pocket-operation-id": operationId()
      },
      body: file
    });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(payload?.error || `HTTP ${res.status}`);

    return {
      ...payload.attachment,
      previewUrl: URL.createObjectURL(file)
    } as ApiAttachment;
  }

  async function handleImageFiles(files: FileList | File[]) {
    const list = Array.from(files).slice(0, Math.max(0, 8 - pendingAttachments.length));
    if (!list.length) return;

    uploadingCount += list.length;
    updateModels();
    status.textContent = apiLocale(
      `Saving images to Linux… 0/${list.length}`,
      `画像をLinuxへ保存中… 0/${list.length}`,
      `正在将图片保存到 Linux… 0/${list.length}`
    );

    let completed = 0;
    try {
      for (const file of list) {
        const attachment = await uploadImage(file);
        pendingAttachments.push(attachment);
        completed += 1;
        status.textContent = apiLocale(
          `Saving images to Linux… ${completed}/${list.length}`,
          `画像をLinuxへ保存中… ${completed}/${list.length}`,
          `正在将图片保存到 Linux… ${completed}/${list.length}`
        );
        renderPendingAttachments();
      }
      status.textContent = `${currentProvider()?.name || "API"} · ${apiLocale("image ready", "画像準備OK", "图片已准备")}`;
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : String(error);
    } finally {
      uploadingCount -= list.length;
      imageInput.value = "";
      updateModels();
    }
  }

  async function refresh() {
    status.textContent = apiLocale("Loading providers…", "接続先を読み込み中…", "正在加载 Provider…");
    try {
      const payload = await apiJson<{ providers?: ApiProvider[] }>("/api/llm/providers");
      providers = Array.isArray(payload?.providers) ? payload.providers : [];

      const saved = localStorage.getItem("devmoter-api-provider");
      providerSelect.replaceChildren();

      if (providers.length === 0) {
        const option = document.createElement("option");
        option.value = "";
        option.textContent = "APIを追加";
        providerSelect.appendChild(option);
      }

      for (const provider of providers) {
        const option = document.createElement("option");
        option.value = provider.id;
        option.textContent = provider.ready ? provider.name : `${provider.name} (key required)`;
        providerSelect.appendChild(option);
      }

      if (saved && providers.some(provider => provider.id === saved)) {
        providerSelect.value = saved;
      }
      updateModels();
    } catch (error) {
      providers = [];
      providerSelect.replaceChildren();
      modelSelect.replaceChildren();
      status.textContent = error instanceof Error ? error.message : String(error);
      send.disabled = true;
    }
  }

  async function loadPresets() {
    if (presets.length) return presets;
    const payload = await apiJson<{ presets?: ApiPreset[] }>("/api/llm/presets");
    presets = Array.isArray(payload?.presets) ? payload.presets : [];
    return presets;
  }

  function providerSummary(provider: ApiProvider) {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "api-provider-row";
    row.disabled = provider.editable === false;

    const copy = document.createElement("span");
    copy.className = "api-provider-row-copy";
    const title = document.createElement("strong");
    title.textContent = provider.name;
    const meta = document.createElement("small");
    const source = provider.source === "env" ? "環境変数 · 読み取り専用" : "DevMoter設定";
    meta.textContent = `${source} · ${provider.models.length} models · ${provider.ready ? "Key saved" : "No key"}`;
    if (provider.secretRef) meta.textContent = `${source} · Host Vault · ${provider.models.length} models`;
    copy.append(title, meta);

    const protocol = document.createElement("span");
    protocol.className = "api-provider-protocol";
    protocol.textContent = provider.protocol === "anthropic" ? "Anthropic" : "OpenAI";

    row.append(copy, protocol);
    if (provider.editable !== false) {
      row.addEventListener("click", () => void showProviderForm(provider));
    }
    return row;
  }

  async function renderSettingsList() {
    settingsBody.replaceChildren();

    const toolbar = document.createElement("div");
    toolbar.className = "api-settings-toolbar";
    const text = document.createElement("div");
    text.innerHTML = "<strong>接続先</strong><small>APIキーは保存後に画面へ戻しません</small>";
    const add = document.createElement("button");
    add.type = "button";
    add.className = "primary";
    add.textContent = "＋ APIを追加";
    add.addEventListener("click", () => void showProviderForm());
    toolbar.append(text, add);
    settingsBody.appendChild(toolbar);

    if (!providers.length) {
      const empty = document.createElement("div");
      empty.className = "api-settings-empty";
      empty.innerHTML = "<strong>まだAPIがありません</strong><p>企業を選んでAPIキーを追加すると、上のモデル切替からすぐ使えます。</p>";
      settingsBody.appendChild(empty);
      return;
    }

    const list = document.createElement("div");
    list.className = "api-provider-list";
    for (const provider of providers) {
      const item = document.createElement("div");
      item.className = "api-provider-settings-item";
      item.appendChild(providerSummary(provider));
      if (provider.editable !== false && provider.source === "file" && provider.ready && !provider.secretRef) {
        const preset = presets.find(item => item.id === (provider.presetId || "custom"));
        const migrationEligible = Boolean(preset && preset.id !== "custom" && preset.baseUrl === provider.baseUrl && preset.protocol === provider.protocol);
        const migrate = document.createElement("button");
        migrate.type = "button";
        migrate.className = "api-provider-migrate";
        migrate.textContent = migrationEligible ? "暗号化Vaultへ移行" : "このProviderは移行対象外";
        migrate.disabled = !migrationEligible || !localStorage.getItem(DEVICE_TOKEN_KEY) || !localStorage.getItem(PROJECT_KEY);
        migrate.title = !migrationEligible
          ? "Vault移行には対応Provider presetと正規Endpointが必要"
          : migrate.disabled ? "端末を登録し、Projectを選択してね" : "保存済みAPIキーをVaultへ移動";
        migrate.addEventListener("click", async () => {
          const projectId = localStorage.getItem(PROJECT_KEY) || "";
          if (!projectId || !localStorage.getItem(DEVICE_TOKEN_KEY)) return;
          if (!confirm(`${provider.name} のAPIキーを選択中のProjectに紐付けた暗号化Vaultへ移動し、旧Provider設定から削除するよ。続ける？`)) return;
          migrate.disabled = true;
          migrate.textContent = "Vaultへ移動中…";
          try {
            await apiJson(`/api/llm/providers/${encodeURIComponent(provider.id)}/migrate-to-vault`, {
              method: "POST",
              body: JSON.stringify({ projectId, confirm: true })
            });
            await refresh();
            await renderSettingsList();
          } catch (error) {
            migrate.disabled = false;
            migrate.textContent = "暗号化Vaultへ移行";
            const message = document.createElement("small");
            message.className = "api-provider-migrate-error";
            message.textContent = error instanceof Error ? error.message : String(error);
            item.appendChild(message);
          }
        });
        item.appendChild(migrate);
      }
      list.appendChild(item);
    }
    settingsBody.appendChild(list);
  }

  async function openSettings() {
    closeSidebar();
    settingsModal.classList.remove("hidden");
    settingsBody.innerHTML = '<div class="api-settings-loading">読み込み中…</div>';
    try {
      await Promise.all([refresh(), loadPresets()]);
      await renderSettingsList();
    } catch (error) {
      settingsBody.textContent = error instanceof Error ? error.message : String(error);
    }
  }

  async function showProviderForm(provider?: ApiProvider) {
    await loadPresets();
    settingsBody.replaceChildren();
    const activeProjectId = localStorage.getItem(PROJECT_KEY) || "";
    const bindingProjectId = provider?.projectId || activeProjectId;
    let vaultSecrets: Array<{ reference: string; provider: string; name: string; purpose?: string; projectIds: string[] }> = [];
    if (localStorage.getItem(DEVICE_TOKEN_KEY) && bindingProjectId) {
      try {
        const vaultStatus = await apiJson<{ unlocked?: boolean }>("/api/secrets/status");
        if (vaultStatus.unlocked) {
          const vaultPayload = await apiJson<{ secrets?: typeof vaultSecrets }>("/api/secrets");
          vaultSecrets = (vaultPayload.secrets || []).filter(secret => secret.projectIds?.includes(bindingProjectId));
        }
      } catch {
        // The form remains usable with a manually entered API key when Vault is locked or unavailable.
      }
    }

    const back = document.createElement("button");
    back.type = "button";
    back.className = "api-settings-back";
    back.textContent = "‹ Providers";
    back.addEventListener("click", () => void renderSettingsList());

    const heading = document.createElement("div");
    heading.className = "api-settings-form-title";
    const headingTitle = document.createElement("strong");
    headingTitle.textContent = provider ? provider.name : "APIを追加";
    const headingText = document.createElement("small");
    headingText.textContent = provider
      ? "キーを変更しないなら空欄のままでOK"
      : "会社を選んでAPIキーを貼るだけ。残りはDevMoterが自動設定します。";
    heading.append(headingTitle, headingText);

    const providerForm = document.createElement("form");
    providerForm.className = "api-provider-form api-provider-form-simple";
    providerForm.innerHTML = `
      <label>
        <span>企業 / Provider</span>
        <div class="api-preset-grid" data-field="preset-grid"></div>
        <select data-field="preset" class="api-preset-select-hidden" aria-label="Provider preset"></select>
      </label>

      <label>
        <span>認証情報の保存先</span>
        <select data-field="credentialMode">
          <option value="api-key">API Key（既存方式）</option>
          <option value="vault" ${provider?.secretRef ? "selected" : ""} ${bindingProjectId && (vaultSecrets.length || provider?.secretRef) ? "" : "disabled"}>Host API Vault</option>
        </select>
        <small data-credential-hint></small>
      </label>

      <label data-vault-reference-row hidden>
        <span>Vault Secret（選択Projectに紐付いたもの）</span>
        <select data-field="secretRef"></select>
        <small data-vault-status></small>
      </label>

      <label data-api-key-row>
        <span>API Key</span>
        <input data-field="apiKey" type="password" autocomplete="new-password" />
        <small data-key-hint></small>
      </label>

      <details class="api-advanced-settings" data-advanced>
        <summary>詳細設定</summary>
        <div class="api-advanced-settings-body">
          <label>
            <span>表示名</span>
            <input data-field="name" type="text" maxlength="100" />
          </label>
          <label>
            <span>API形式</span>
            <select data-field="protocol">
              <option value="openai-compatible">OpenAI compatible</option>
              <option value="anthropic">Anthropic Messages</option>
            </select>
          </label>
          <label>
            <span>Base URL</span>
            <input data-field="baseUrl" type="url" inputmode="url" autocomplete="off" />
          </label>
          <label>
            <span>Models</span>
            <textarea data-field="models" rows="5" placeholder="自動取得できない場合だけ入力"></textarea>
          </label>
        </div>
      </details>

      <div data-form-message class="api-form-message"></div>
      <button data-action="save" type="submit" class="api-auto-connect-button">
        ${provider ? "更新" : "接続して追加"}
      </button>
    `;

    const presetSelect = providerForm.querySelector<HTMLSelectElement>('[data-field="preset"]')!;
    const presetGrid = providerForm.querySelector<HTMLDivElement>('[data-field="preset-grid"]')!;
    const nameInput = providerForm.querySelector<HTMLInputElement>('[data-field="name"]')!;
    const protocolSelect = providerForm.querySelector<HTMLSelectElement>('[data-field="protocol"]')!;
    const baseUrlInput = providerForm.querySelector<HTMLInputElement>('[data-field="baseUrl"]')!;
    const credentialModeSelect = providerForm.querySelector<HTMLSelectElement>('[data-field="credentialMode"]')!;
    const secretRefSelect = providerForm.querySelector<HTMLSelectElement>('[data-field="secretRef"]')!;
    const vaultReferenceRow = providerForm.querySelector<HTMLElement>("[data-vault-reference-row]")!;
    const apiKeyRow = providerForm.querySelector<HTMLElement>("[data-api-key-row]")!;
    const credentialHint = providerForm.querySelector<HTMLElement>("[data-credential-hint]")!;
    const vaultStatus = providerForm.querySelector<HTMLElement>("[data-vault-status]")!;
    const apiKeyInput = providerForm.querySelector<HTMLInputElement>('[data-field="apiKey"]')!;
    const modelsInput = providerForm.querySelector<HTMLTextAreaElement>('[data-field="models"]')!;
    const advanced = providerForm.querySelector<HTMLDetailsElement>("[data-advanced]")!;
    const keyHint = providerForm.querySelector<HTMLElement>("[data-key-hint]")!;
    const formMessage = providerForm.querySelector<HTMLElement>("[data-form-message]")!;
    const saveButton = providerForm.querySelector<HTMLButtonElement>('[data-action="save"]')!;

    for (const preset of presets) {
      const option = document.createElement("option");
      option.value = preset.id;
      option.textContent = preset.name;
      presetSelect.appendChild(option);

      const button = document.createElement("button");
      button.type = "button";
      button.className = "api-preset-button";
      button.dataset.presetId = preset.id;
      button.textContent = preset.name;
      button.addEventListener("click", () => {
        if (presetSelect.disabled) return;
        presetSelect.value = preset.id;
        applyPreset();
      });
      presetGrid.appendChild(button);
    }

    function syncPresetButtons() {
      for (const button of presetGrid.querySelectorAll<HTMLButtonElement>(".api-preset-button")) {
        const selected = button.dataset.presetId === presetSelect.value;
        button.classList.toggle("selected", selected);
        button.setAttribute("aria-pressed", selected ? "true" : "false");
        button.disabled = presetSelect.disabled && !selected;
      }
    }

    function applyPreset() {
      const preset = presets.find(item => item.id === presetSelect.value);
      if (!preset) return;
      if (!provider || presetSelect.value !== (provider.presetId || "custom")) {
        nameInput.value = preset.name;
        protocolSelect.value = preset.protocol;
        baseUrlInput.value = preset.baseUrl;
      }
      advanced.open = preset.id === "custom";
      syncPresetButtons();
      refreshVaultChoices();
    }

    function refreshVaultChoices() {
      const selectedReference = secretRefSelect.value || provider?.secretRef || "";
      secretRefSelect.replaceChildren();
      const matching = vaultSecrets.filter(secret =>
        secret.provider === presetSelect.value && presetSelect.value !== "custom"
      );
      for (const secret of matching) {
        const option = document.createElement("option");
        option.value = secret.reference;
        option.textContent = `${secret.provider}/${secret.name}${secret.purpose ? ` · ${secret.purpose}` : ""}`;
        secretRefSelect.appendChild(option);
      }
      if (provider?.secretRef && !matching.some(secret => secret.reference === provider.secretRef)) {
        const option = document.createElement("option");
        option.value = provider.secretRef;
        option.textContent = provider.secretRef;
        secretRefSelect.appendChild(option);
      }
      if (Array.from(secretRefSelect.options).some(option => option.value === selectedReference)) {
        secretRefSelect.value = selectedReference;
      }
      const canUseVault = Boolean(bindingProjectId && (secretRefSelect.options.length || provider?.secretRef));
      for (const option of credentialModeSelect.options) {
        if (option.value === "vault") option.disabled = !canUseVault;
      }
      if (credentialModeSelect.value === "vault" && !canUseVault) credentialModeSelect.value = "api-key";
      vaultReferenceRow.hidden = credentialModeSelect.value !== "vault";
      apiKeyRow.hidden = credentialModeSelect.value === "vault";
      apiKeyInput.required = credentialModeSelect.value === "api-key" && (!provider?.ready || provider.credentialSource === "vault");
      credentialHint.textContent = bindingProjectId
        ? `Project binding: ${bindingProjectId}`
        : "Vaultを使うにはProjectを選択してね。";
      vaultStatus.textContent = vaultSecrets.length
        ? `${matching.length}件のSecretがこのProviderで使えるよ。Vault設定はHost側で検証される。`
        : "Vaultがロック中、端末が未登録、またはこのProjectに紐付くSecretがありません。Settings → API Vaultを確認してね。";
    }

    if (provider) {
      presetSelect.value = provider.presetId || "custom";
      presetSelect.disabled = true;
      nameInput.value = provider.name;
      protocolSelect.value = provider.protocol;
      baseUrlInput.value = provider.baseUrl;
      modelsInput.value = provider.models.join("\n");
      apiKeyInput.placeholder = provider.ready
        ? provider.secretRef ? "Vaultで管理中" : "保存済み（変更するときだけ入力）"
        : "APIキーを貼り付け";
      keyHint.textContent = provider.ready
        ? provider.secretRef ? "🔒 Secret値はVaultから読まず、API Chat送信時だけHostで解決します。" : "🔒 保存済みキーは表示しません。変更するときだけ新しいキーを入力。"
        : "🔒 キーはDevMoterサーバー側だけに保存します。";
      credentialModeSelect.value = provider.secretRef ? "vault" : "api-key";
      advanced.open = provider.presetId === "custom";
      syncPresetButtons();
    } else {
      const initial = presets[0];
      if (initial) presetSelect.value = initial.id;
      apiKeyInput.placeholder = "APIキーを貼り付け";
      keyHint.textContent = "🔒 貼ったキーはこの端末のDevMoterにだけ保存します。";
      applyPreset();
    }

    presetSelect.addEventListener("change", applyPreset);
    credentialModeSelect.addEventListener("change", refreshVaultChoices);
    refreshVaultChoices();
    syncPresetButtons();

    function formPayload(modelsOverride?: string[]) {
      return {
        ...(provider ? { id: provider.id } : {}),
        presetId: presetSelect.value,
        name: nameInput.value.trim(),
        protocol: protocolSelect.value,
        baseUrl: baseUrlInput.value.trim(),
        credentialMode: credentialModeSelect.value,
        apiKey: credentialModeSelect.value === "api-key" ? apiKeyInput.value.trim() : "",
        secretRef: credentialModeSelect.value === "vault" ? secretRefSelect.value : "",
        projectId: credentialModeSelect.value === "vault" ? bindingProjectId : "",
        models: modelsOverride ?? modelsInput.value
          .split(/\n|,/)
          .map(item => item.trim())
          .filter(Boolean)
      };
    }

    providerForm.addEventListener("submit", async event => {
      event.preventDefault();
      const enteredKey = apiKeyInput.value.trim();
      const usesVault = credentialModeSelect.value === "vault";
      const selectedSecretRef = secretRefSelect.value;

      if (!usesVault && !provider && !enteredKey) {
        formMessage.textContent = "APIキーを貼ってね";
        formMessage.dataset.state = "error";
        apiKeyInput.focus();
        return;
      }

      saveButton.disabled = true;
      formMessage.dataset.state = "loading";

      try {
        if (usesVault && !selectedSecretRef) {
          formMessage.textContent = "このProjectで使えるVault Secretを選んでね。";
          formMessage.dataset.state = "error";
          return;
        }
        let models = modelsInput.value
          .split(/\n|,/)
          .map(item => item.trim())
          .filter(Boolean);

        if (enteredKey || usesVault) {
          formMessage.textContent = "接続確認 → モデルを自動取得中…";
          const tested = await apiJson<{ ok?: boolean; models?: string[] }>("/api/llm/test", {
            method: "POST",
            body: JSON.stringify(formPayload([]))
          });
          const discovered = Array.isArray(tested.models) ? tested.models : [];
          if (discovered.length) {
            models = discovered;
            modelsInput.value = discovered.join("\n");
          } else if (!models.length) {
            advanced.open = true;
            formMessage.textContent = "接続は成功したけどモデル一覧を取得できませんでした。詳細設定でモデル名を1つ入力してね。";
            formMessage.dataset.state = "error";
            return;
          }
        }

        if (!models.length) {
          advanced.open = true;
          formMessage.textContent = "モデル情報がありません。詳細設定でモデル名を入力してね。";
          formMessage.dataset.state = "error";
          return;
        }

        formMessage.textContent = "安全に保存中…";
        const saved = await apiJson<{ provider?: ApiProvider }>("/api/llm/providers", {
          method: "POST",
          body: JSON.stringify(formPayload(models))
        });

        apiKeyInput.value = "";
        await refresh();

        const savedId = saved.provider?.id;
        if (savedId && providers.some(item => item.id === savedId)) {
          providerSelect.value = savedId;
          localStorage.setItem("devmoter-api-provider", savedId);
          updateModels();
        }

        closeSettings();
        status.textContent = `${saved.provider?.name || provider?.name || "API"} · Ready`;
        prompt.focus();
      } catch (error) {
        advanced.open = true;
        formMessage.textContent = `接続できませんでした: ${error instanceof Error ? error.message : String(error)}`;
        formMessage.dataset.state = "error";
      } finally {
        saveButton.disabled = false;
      }
    });

    settingsBody.append(back, heading, providerForm);

    if (provider && provider.editable !== false) {
      const danger = document.createElement("section");
      danger.className = "api-provider-danger";
      const remove = document.createElement("button");
      remove.type = "button";
      remove.textContent = "このAPI設定を削除";
      remove.addEventListener("click", async () => {
        if (!confirm(`${provider.name} のAPI設定を削除しますか？`)) return;
        remove.disabled = true;
        try {
          await apiJson(`/api/llm/providers/${encodeURIComponent(provider.id)}`, {
            method: "DELETE"
          });
          if (localStorage.getItem("devmoter-api-provider") === provider.id) {
            localStorage.removeItem("devmoter-api-provider");
          }
          await refresh();
          await renderSettingsList();
        } catch (error) {
          formMessage.textContent = error instanceof Error ? error.message : String(error);
          formMessage.dataset.state = "error";
          remove.disabled = false;
        }
      });
      danger.appendChild(remove);
      settingsBody.appendChild(danger);
    }
  }

  async function submit() {
    const rawText = prompt.value.trim();
    const provider = currentProvider();
    const model = modelSelect.value;
    if ((!rawText && pendingAttachments.length === 0) || !provider?.ready || !model || sending || uploadingCount > 0) return;
    if (provider.secretRef && (localStorage.getItem(PROJECT_KEY) || "") !== provider.projectId) {
      status.textContent = apiLocale(
        "Select the project bound to this Vault provider",
        "このVault Providerに紐付いたProjectを選択してね",
        "请选择绑定到此 Vault Provider 的项目"
      );
      return;
    }

    const attachments = pendingAttachments.map(({ id, name, mime, size }) => ({
      id, name, mime, size
    }));
    for (const attachment of pendingAttachments) {
      if (attachment.previewUrl) URL.revokeObjectURL(attachment.previewUrl);
    }
    pendingAttachments = [];
    renderPendingAttachments();

    const text = rawText || "この画像を確認してください。";
    messages.push({ role: "user", content: text, attachments });
    trimHistory();
    const generation = conversationGeneration;
    const controller = new AbortController();
    activeChatController?.abort();
    activeChatController = controller;
    prompt.value = "";
    resizePrompt();
    renderMessages();
    sending = true;
    send.disabled = true;
    attachImage.disabled = true;
    status.textContent = `${provider.name} · 考え中…`;

    try {
      const payload = await apiJson<{ message?: { content?: string } }>("/api/llm/chat", {
        method: "POST",
        body: JSON.stringify({
          providerId: provider.id,
          projectId: localStorage.getItem(PROJECT_KEY) || "",
          model,
          reasoning: reasoningSelect.value || "auto",
          messages: messages.slice(-API_CHAT_HISTORY_LIMIT).map(message => ({
            role: message.role,
            content: message.content,
            attachments: message.attachments?.map(({ id, name, mime }) => ({ id, name, mime })) || []
          }))
        }),
        signal: controller.signal
      });
      if (generation !== conversationGeneration) return;
      const content = String(payload?.message?.content || "").trim();
      if (!content) throw new Error(apiLocale("The provider returned an empty response", "空の応答が返されました", "Provider 返回了空响应"));
      messages.push({ role: "assistant", content });
      trimHistory();
      renderMessages();
      status.textContent = `${provider.name} · Ready`;
    } catch (error) {
      if (generation !== conversationGeneration || controller.signal.aborted) return;
      messages.push({
        role: "assistant",
        content: `${apiLocale("Error", "エラー", "错误")}: ${error instanceof Error ? error.message : String(error)}`
      });
      trimHistory();
      renderMessages();
      status.textContent = `${provider.name} · Error`;
    } finally {
      if (activeChatController === controller) activeChatController = null;
      if (generation === conversationGeneration) {
        sending = false;
        updateModels();
        prompt.focus();
      }
    }
  }

  menu.addEventListener("click", openSidebar);
  agentSwitchButton.addEventListener("click", () => {
    const open = agentSwitchMenu.classList.toggle("hidden") === false;
    agentSwitchButton.setAttribute("aria-expanded", String(open));
  });
  agentCurrent.addEventListener("click", () => {
    agentSwitchMenu.classList.add("hidden");
    agentSwitchButton.setAttribute("aria-expanded", "false");
  });
  sidebarClose.addEventListener("click", closeSidebar);
  goCodex.addEventListener("click", () => {
    closeSidebar();
    options.onCodex?.();
  });
  goOpenCode.addEventListener("click", () => {
    closeSidebar();
    options.onOpenCode?.();
  });
  settingsSide.addEventListener("click", () => void openSettings());
  settingsTop.addEventListener("click", () => void openSettings());
  settingsClose.addEventListener("click", closeSettings);
  settingsModal.addEventListener("click", event => {
    if (event.target === settingsModal) closeSettings();
  });
  newChat.addEventListener("click", () => {
    conversationGeneration += 1;
    activeChatController?.abort();
    activeChatController = null;
    sending = false;
    for (const attachment of pendingAttachments) {
      if (attachment.previewUrl) URL.revokeObjectURL(attachment.previewUrl);
      void apiJson(`/api/llm/attachments/${encodeURIComponent(attachment.id)}`, {
        method: "DELETE"
      }).catch(() => {});
    }
    pendingAttachments = [];
    messages = [];
    renderPendingAttachments();
    renderMessages();
    updateModels();
    closeSidebar();
    prompt.focus();
  });
  providerSelect.addEventListener("change", () => {
    if (!providerSelect.value) {
      void openSettings();
      return;
    }
    localStorage.setItem("devmoter-api-provider", providerSelect.value);
    updateModels();
  });
  modelSelect.addEventListener("change", () => {
    const provider = currentProvider();
    if (provider) localStorage.setItem(`devmoter-api-model:${provider.id}`, modelSelect.value);
    updateReasoning();
  });
  reasoningSelect.addEventListener("change", () => {
    const provider = currentProvider();
    if (!provider) return;
    localStorage.setItem(
      `devmoter-api-reasoning:${provider.id}:${modelSelect.value}`,
      reasoningSelect.value
    );
  });
  attachImage.addEventListener("click", () => imageInput.click());
  imageInput.addEventListener("change", () => {
    if (imageInput.files) void handleImageFiles(imageInput.files);
  });
  prompt.addEventListener("input", resizePrompt);
  prompt.addEventListener("keydown", event => {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      void submit();
    }
  });
  form.addEventListener("submit", event => {
    event.preventDefault();
    void submit();
  });

  void refresh();
  resizePrompt();

  return { refresh };
}
