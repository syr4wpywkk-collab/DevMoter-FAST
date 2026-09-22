type ApiProvider = {
  id: string;
  name: string;
  presetId?: string;
  protocol: "openai-compatible" | "anthropic";
  baseUrl: string;
  ready: boolean;
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

type ApiChatOptions = {
  onCodex?: () => void;
  onOpenCode?: () => void;
};

export type ApiChatController = {
  refresh(): Promise<void>;
};

function operationId() {
  return globalThis.crypto?.randomUUID?.() ??
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

async function apiJson<T = any>(path: string, init: RequestInit = {}): Promise<T> {
  const method = String(init.method || "GET").toUpperCase();
  const mutating = method !== "GET" && method !== "HEAD";
  const res = await fetch(path, {
    ...init,
    cache: method === "GET" ? "no-store" : undefined,
    headers: {
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...(mutating ? { "x-pocket-operation-id": operationId() } : {}),
      ...(init.headers || {})
    }
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
        <div class="api-sidebar-head">
          <strong>DevMoter</strong>
          <button id="apiSidebarClose" type="button" aria-label="閉じる">×</button>
        </div>
        <button id="apiNewChat" class="api-new-chat" type="button">＋ 新しいチャット</button>
        <div class="api-nav-label">AGENTS</div>
        <nav class="api-agent-nav">
          <button id="apiGoCodex" type="button"><span>⌘</span><span>Codex</span></button>
          <button id="apiGoOpenCode" type="button"><span>◈</span><span>OpenCode</span></button>
          <button class="active" type="button"><span>✦</span><span>API Chat</span></button>
        </nav>
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

  function openSidebar() {
    sidebar.classList.add("open");
  }

  function closeSidebar() {
    sidebar.classList.remove("open");
  }

  function closeSettings() {
    settingsModal.classList.add("hidden");
  }

  function currentProvider() {
    return providers.find(provider => provider.id === providerSelect.value) ?? null;
  }

  function reasoningLabel(mode: string) {
    return ({
      auto: "推論: Auto",
      none: "推論: Off",
      low: "推論: Low",
      medium: "推論: Medium",
      high: "推論: High"
    } as Record<string, string>)[mode] || `推論: ${mode}`;
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
      ? "⚙ API Providerを追加してね"
      : provider.ready
        ? `${provider.name} · Ready`
        : `${provider.name} · APIキー未設定`;
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
      throw new Error("JPEG / PNG / WebP / GIF のみ対応しています");
    }
    if (file.size <= 0 || file.size > 15 * 1024 * 1024) {
      throw new Error("画像は15MB以下にしてください");
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
    status.textContent = `画像をLinuxへ保存中… 0/${list.length}`;

    let completed = 0;
    try {
      for (const file of list) {
        const attachment = await uploadImage(file);
        pendingAttachments.push(attachment);
        completed += 1;
        status.textContent = `画像をLinuxへ保存中… ${completed}/${list.length}`;
        renderPendingAttachments();
      }
      status.textContent = `${currentProvider()?.name || "API"} · 画像準備OK`;
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : String(error);
    } finally {
      uploadingCount -= list.length;
      imageInput.value = "";
      updateModels();
    }
  }

  async function refresh() {
    status.textContent = "接続先を読み込み中…";
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
    for (const provider of providers) list.appendChild(providerSummary(provider));
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
    }

    if (provider) {
      presetSelect.value = provider.presetId || "custom";
      presetSelect.disabled = true;
      nameInput.value = provider.name;
      protocolSelect.value = provider.protocol;
      baseUrlInput.value = provider.baseUrl;
      modelsInput.value = provider.models.join("\n");
      apiKeyInput.placeholder = provider.ready
        ? "保存済み（変更するときだけ入力）"
        : "APIキーを貼り付け";
      keyHint.textContent = provider.ready
        ? "🔒 保存済みキーは表示しません。変更するときだけ新しいキーを入力。"
        : "🔒 キーはDevMoterサーバー側だけに保存します。";
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
    syncPresetButtons();

    function formPayload(modelsOverride?: string[]) {
      return {
        ...(provider ? { id: provider.id } : {}),
        presetId: presetSelect.value,
        name: nameInput.value.trim(),
        protocol: protocolSelect.value,
        baseUrl: baseUrlInput.value.trim(),
        apiKey: apiKeyInput.value.trim(),
        models: modelsOverride ?? modelsInput.value
          .split(/\n|,/)
          .map(item => item.trim())
          .filter(Boolean)
      };
    }

    providerForm.addEventListener("submit", async event => {
      event.preventDefault();
      const enteredKey = apiKeyInput.value.trim();

      if (!provider && !enteredKey) {
        formMessage.textContent = "APIキーを貼ってね";
        formMessage.dataset.state = "error";
        apiKeyInput.focus();
        return;
      }

      saveButton.disabled = true;
      formMessage.dataset.state = "loading";

      try {
        let models = modelsInput.value
          .split(/\n|,/)
          .map(item => item.trim())
          .filter(Boolean);

        if (enteredKey) {
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
          model,
          reasoning: reasoningSelect.value || "auto",
          messages: messages.map(message => ({
            role: message.role,
            content: message.content,
            attachments: message.attachments?.map(({ id, name, mime }) => ({ id, name, mime })) || []
          }))
        })
      });
      const content = String(payload?.message?.content || "").trim();
      if (!content) throw new Error("空の応答が返されました");
      messages.push({ role: "assistant", content });
      renderMessages();
      status.textContent = `${provider.name} · Ready`;
    } catch (error) {
      messages.push({
        role: "assistant",
        content: `エラー: ${error instanceof Error ? error.message : String(error)}`
      });
      renderMessages();
      status.textContent = `${provider.name} · Error`;
    } finally {
      sending = false;
      updateModels();
      prompt.focus();
    }
  }

  menu.addEventListener("click", openSidebar);
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
