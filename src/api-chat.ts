type ApiProvider = {
  id: string;
  name: string;
  kind: string;
  ready: boolean;
  models: string[];
};

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
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
        <div class="api-sidebar-note">
          APIキーはサーバー側だけに保存され、ブラウザには送信されません。
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
        </div>
      </header>

      <main class="api-main">
        <div id="apiTranscript" class="api-transcript">
          <section id="apiWelcome" class="api-welcome">
            <div class="api-spark">✦</div>
            <h1>こんにちは、まり</h1>
            <p>どのAPIで考える？</p>
          </section>
        </div>
      </main>

      <section class="api-composer-wrap">
        <form id="apiForm" class="api-composer">
          <textarea id="apiPrompt" rows="1" placeholder="メッセージを入力" aria-label="メッセージ"></textarea>
          <div class="api-composer-foot">
            <span id="apiStatus">接続先を読み込み中…</span>
            <button id="apiSend" type="submit" aria-label="送信">↑</button>
          </div>
        </form>
      </section>
    </div>
  `;

  const sidebar = root.querySelector<HTMLElement>("#apiSidebar")!;
  const menu = root.querySelector<HTMLButtonElement>("#apiMenu")!;
  const sidebarClose = root.querySelector<HTMLButtonElement>("#apiSidebarClose")!;
  const goCodex = root.querySelector<HTMLButtonElement>("#apiGoCodex")!;
  const goOpenCode = root.querySelector<HTMLButtonElement>("#apiGoOpenCode")!;
  const newChat = root.querySelector<HTMLButtonElement>("#apiNewChat")!;
  const providerSelect = root.querySelector<HTMLSelectElement>("#apiProvider")!;
  const modelSelect = root.querySelector<HTMLSelectElement>("#apiModel")!;
  const transcript = root.querySelector<HTMLDivElement>("#apiTranscript")!;
  const welcome = root.querySelector<HTMLElement>("#apiWelcome")!;
  const form = root.querySelector<HTMLFormElement>("#apiForm")!;
  const prompt = root.querySelector<HTMLTextAreaElement>("#apiPrompt")!;
  const send = root.querySelector<HTMLButtonElement>("#apiSend")!;
  const status = root.querySelector<HTMLElement>("#apiStatus")!;

  let providers: ApiProvider[] = [];
  let messages: ChatMessage[] = [];
  let sending = false;

  function openSidebar() {
    sidebar.classList.add("open");
  }

  function closeSidebar() {
    sidebar.classList.remove("open");
  }

  function currentProvider() {
    return providers.find(provider => provider.id === providerSelect.value) ?? null;
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
    status.textContent = !provider
      ? "API providerが未設定です"
      : provider.ready
        ? `${provider.name} · Ready`
        : `${provider.name} · APIキー未設定`;
    send.disabled = !provider?.ready || !modelSelect.value || sending;
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
      row.appendChild(bubble);
      transcript.appendChild(row);
    }

    transcript.scrollTop = transcript.scrollHeight;
  }

  async function refresh() {
    status.textContent = "接続先を読み込み中…";
    try {
      const res = await fetch("/api/llm/providers", { cache: "no-store" });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload?.error || `HTTP ${res.status}`);
      providers = Array.isArray(payload?.providers) ? payload.providers : [];

      const saved = localStorage.getItem("devmoter-api-provider");
      providerSelect.replaceChildren();
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

  async function submit() {
    const text = prompt.value.trim();
    const provider = currentProvider();
    const model = modelSelect.value;
    if (!text || !provider?.ready || !model || sending) return;

    messages.push({ role: "user", content: text });
    prompt.value = "";
    resizePrompt();
    renderMessages();
    sending = true;
    send.disabled = true;
    status.textContent = `${provider.name} · 考え中…`;

    try {
      const res = await fetch("/api/llm/chat", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-pocket-operation-id": operationId()
        },
        body: JSON.stringify({
          providerId: provider.id,
          model,
          messages
        })
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload?.error || `HTTP ${res.status}`);
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
      send.disabled = !currentProvider()?.ready || !modelSelect.value;
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
  newChat.addEventListener("click", () => {
    messages = [];
    renderMessages();
    closeSidebar();
    prompt.focus();
  });
  providerSelect.addEventListener("change", () => {
    localStorage.setItem("devmoter-api-provider", providerSelect.value);
    updateModels();
  });
  modelSelect.addEventListener("change", () => {
    const provider = currentProvider();
    if (provider) localStorage.setItem(`devmoter-api-model:${provider.id}`, modelSelect.value);
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
