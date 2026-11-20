import { formatNumber, t, translateServerMessage } from "./i18n";
import { renderChatMarkdown } from "./chat-markdown.mjs";
import { fetchWithTimeout } from "./fetch-with-timeout.mjs";
import { normalizeApiProviderCatalog } from "./api-provider-catalog.mjs";
import { normalizeApiAttachment } from "./api-attachment.mjs";
import { apiModelLabel } from "./api-model-label.mjs";
import { createChatDraftBinding } from "./chat-draft.mjs";
import { latestAssistantText } from "./chat-transcript-actions.mjs";
import { chatHistoryTriggerMarkup } from "./chat-history-trigger.mjs";
import "./api-chat-surface.css";

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

type ChatConversation = {
  id: string;
  title: string;
  messages: ChatMessage[];
  providerId: string;
  model: string;
  reasoning: string;
};

const API_CHAT_HISTORY_LIMIT = 100;
const API_CHAT_SESSION_LIMIT = 20;
const API_CHAT_REQUEST_TIMEOUT_MS = 120_000;
const DEVICE_TOKEN_KEY = "devmoter-device-token";
const PROJECT_KEY = "opencode-pocket-project";

type ApiChatOptions = {
  onCodex?: () => void;
  onOpenCode?: () => void;
};

export type ApiChatController = {
  refresh(): Promise<void>;
};

function escapeHtml(value: string) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
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
  if (!res.ok) throw new Error(translateServerMessage(payload?.error || t("common.httpError", { status: res.status })));
  return payload as T;
}

export function mountApiChat(
  root: HTMLElement,
  options: ApiChatOptions = {}
): ApiChatController {
  root.innerHTML = `
    <div class="api-app">
      <div id="apiScrim" class="api-scrim hidden"></div>
      <aside id="apiSidebar" class="api-sidebar" aria-hidden="true" aria-label="${escapeHtml(t("apiChat.sidebarAria"))}" tabindex="-1" inert>
        <div class="api-sidebar-head dm-agent-head">
          <div class="dm-unified-agent-identity" data-unified-agent-label hidden aria-label="${escapeHtml(t("apiChat.unifiedIdentityAria"))}">
            <span class="dm-unified-agent-icon" aria-hidden="true">✦</span>
            <span class="dm-unified-agent-copy"><strong>API Chat</strong><small>${escapeHtml(t("apiChat.chatHistory"))}</small></span>
          </div>
          <div class="dm-agent-switch-shell">
            <button id="apiAgentSwitchButton" class="dm-agent-switch-trigger" type="button" aria-haspopup="listbox" aria-expanded="false">
              <span class="dm-agent-switch-icon">✦</span>
              <span class="dm-agent-switch-copy"><strong>API Chat</strong><small>${escapeHtml(t("apiChat.currentAgent"))}</small></span>
              <span class="dm-agent-switch-chevron">⌄</span>
            </button>
            <div id="apiAgentSwitchMenu" class="dm-agent-switch-menu hidden" role="listbox" aria-label="${escapeHtml(t("apiChat.selectAgentAria"))}">
              <button id="apiGoCodex" type="button" data-agent="codex"><span>⌘</span><span><strong>Codex</strong><small>${escapeHtml(t("apiChat.agentCodexSummary"))}</small></span><span></span></button>
              <button id="apiGoOpenCode" type="button" data-agent="opencode"><span>◈</span><span><strong>OpenCode</strong><small>${escapeHtml(t("apiChat.agentOpenCodeSummary"))}</small></span><span></span></button>
              <button id="apiAgentCurrent" class="active" type="button" data-agent="api"><span>✦</span><span><strong>API Chat</strong><small>${escapeHtml(t("apiChat.agentApiSummary"))}</small></span><span>✓</span></button>
            </div>
          </div>
          <button id="apiSidebarClose" type="button" aria-label="${escapeHtml(t("common.close"))}">×</button>
        </div>
        <button id="apiNewChat" class="api-new-chat" type="button">${escapeHtml(t("apiChat.newChatButton"))}</button>
        <div class="api-sidebar-scroll">
        <section class="api-history" aria-label="${escapeHtml(t("apiChat.chatsAria"))}">
          <div id="apiHistory"></div>
        </section>
        </div>
      </aside>

      <header class="api-topbar">
        ${chatHistoryTriggerMarkup({ id: "apiMenu", className: "api-icon-button", ariaLabel: t("nav.openChatHistoryAria"), title: t("nav.chatHistoryTitle") })}
        <div class="api-brand">
          <strong>API Chat</strong>
          <small id="apiModelTopLabel">${escapeHtml(t("apiChat.topModelUnset"))}</small>
        </div>
        <div class="api-header-actions">
          <button id="apiSettingsTop" class="api-icon-button api-settings-button" type="button" aria-label="${escapeHtml(t("apiChat.providersTitle"))}" title="${escapeHtml(t("apiChat.providersTitle"))}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/></svg></button>
          <button id="apiNewChatTop" class="api-icon-button" type="button" aria-label="${escapeHtml(t("apiChat.newChatAria"))}" title="${escapeHtml(t("apiChat.newChatAria"))}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg></button>
        </div>
      </header>

      <main class="api-main">
        <div id="apiTranscript" class="api-transcript">
          <section id="apiWelcome" class="api-welcome">
            <h1>API Chat</h1>
            <p>${escapeHtml(t("apiChat.welcomePrompt"))}</p>
          </section>
        </div>
      </main>

      <section class="api-composer-wrap">
        <form id="apiForm" class="api-composer">
          <div id="apiAttachments" class="api-attachment-tray hidden"></div>
          <textarea id="apiPrompt" rows="1" enterkeyhint="send" placeholder="${escapeHtml(t("apiChat.promptPlaceholder"))}" aria-label="${escapeHtml(t("apiChat.promptAria"))}"></textarea>
          <input id="apiImageInput" class="hidden" type="file" accept="image/jpeg,image/png,image/webp,image/gif" multiple />
          <small id="apiStatus" class="api-status" role="status" aria-live="polite">${escapeHtml(t("apiChat.loadingProviders"))}</small>
          <button id="apiCopyLatest" class="api-copy-latest" type="button">${escapeHtml(t("chat.copyLatest.button"))}</button>
          <div class="api-composer-foot">
            <button id="apiAttachImage" class="api-attach-button" type="button" aria-label="${escapeHtml(t("apiChat.attachImageAria"))}">＋</button>
            <div class="api-picker-row">
              <select id="apiProvider" aria-label="${escapeHtml(t("apiChat.providerSelectAria"))}"></select>
              <select id="apiModel" aria-label="${escapeHtml(t("apiChat.modelSelectAria"))}"></select>
              <select id="apiReasoning" aria-label="${escapeHtml(t("apiChat.reasoningAria"))}"></select>
            </div>
            <button id="apiSend" type="submit" aria-label="${escapeHtml(t("common.send"))}">↑</button>
          </div>
        </form>
      </section>

      <div id="apiSettingsModal" class="api-settings-modal hidden" role="dialog" aria-modal="true" aria-labelledby="apiSettingsTitle">
        <div class="api-settings-card">
          <header class="api-settings-head">
            <div>
              <strong id="apiSettingsTitle">${escapeHtml(t("apiChat.providersTitle"))}</strong>
            </div>
            <button id="apiSettingsClose" type="button" aria-label="${escapeHtml(t("common.close"))}">×</button>
          </header>
          <div id="apiSettingsBody" class="api-settings-body"></div>
        </div>
      </div>
    </div>
  `;

  const sidebar = root.querySelector<HTMLElement>("#apiSidebar")!;
  const scrim = root.querySelector<HTMLElement>("#apiScrim")!;
  const menu = root.querySelector<HTMLButtonElement>("#apiMenu")!;
  const sidebarClose = root.querySelector<HTMLButtonElement>("#apiSidebarClose")!;
  const agentSwitchButton = root.querySelector<HTMLButtonElement>("#apiAgentSwitchButton")!;
  const agentSwitchMenu = root.querySelector<HTMLDivElement>("#apiAgentSwitchMenu")!;
  const agentCurrent = root.querySelector<HTMLButtonElement>("#apiAgentCurrent")!;
  const goCodex = root.querySelector<HTMLButtonElement>("#apiGoCodex")!;
  const goOpenCode = root.querySelector<HTMLButtonElement>("#apiGoOpenCode")!;
  const settingsTop = root.querySelector<HTMLButtonElement>("#apiSettingsTop")!;
  const newChat = root.querySelector<HTMLButtonElement>("#apiNewChat")!;
  const newChatTop = root.querySelector<HTMLButtonElement>("#apiNewChatTop")!;
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
  const backgroundRegions = [".api-topbar", ".api-main", ".api-composer-wrap"]
    .map(selector => root.querySelector<HTMLElement>(selector)!);
  let sidebarReturnFocus: HTMLElement | null = null;
  let settingsReturnFocus: HTMLElement | null = null;
  let settingsOpenSerial = 0;

  function syncOverlayState() {
    const sidebarOpen = sidebar.classList.contains("open");
    const settingsOpen = !settingsModal.classList.contains("hidden");
    sidebar.inert = !sidebarOpen;
    settingsModal.inert = !settingsOpen;
    for (const region of backgroundRegions) region.inert = sidebarOpen || settingsOpen;
    menu.setAttribute("aria-expanded", String(sidebarOpen));
  }
  syncOverlayState();

  function isVisibleFocusTarget(target: HTMLElement | null): target is HTMLElement {
    return Boolean(target?.isConnected && !target.closest('[inert], [aria-hidden="true"]') && target.getClientRects().length);
  }

  function restoreOverlayFocus(target: HTMLElement | null) {
    if (isVisibleFocusTarget(target)) target.focus({ preventScroll: true });
    else if (isVisibleFocusTarget(menu)) menu.focus({ preventScroll: true });
  }

  function closeAgentSwitch() {
    agentSwitchMenu.classList.add("hidden");
    agentSwitchButton.setAttribute("aria-expanded", "false");
  }
  const history = root.querySelector<HTMLElement>("#apiHistory")!;
  const app = root.querySelector<HTMLElement>(".api-app")!;
  const composerWrap = root.querySelector<HTMLElement>(".api-composer-wrap")!;
  if (typeof ResizeObserver !== "undefined") {
    new ResizeObserver(() => {
      app.style.setProperty("--api-composer-height", `${composerWrap.getBoundingClientRect().height}px`);
    }).observe(composerWrap);
  }

  let providers: ApiProvider[] = [];
  let providerCatalogAvailable = false;
  let providerCatalogRequestGeneration = 0;
  let presets: ApiPreset[] = [];
  let messages: ChatMessage[] = [];
  let pendingAttachments: ApiAttachment[] = [];
  let uploadingCount = 0;
  let sending = false;
  let conversationGeneration = 0;
  let activeChatController: AbortController | null = null;
  let activeConversationId: string = operationId();
  let conversations: ChatConversation[] = [];

  function trimHistory() {
    if (messages.length > API_CHAT_HISTORY_LIMIT) {
      messages = messages.slice(-API_CHAT_HISTORY_LIMIT);
    }
  }

  function cloneMessages(value: ChatMessage[]) {
    return value.map(message => ({
      ...message,
      attachments: message.attachments?.map(attachment => ({ ...attachment }))
    }));
  }

  function renderHistory() {
    const focusedId = document.activeElement instanceof HTMLElement
      ? document.activeElement.closest<HTMLElement>(".api-history-row")?.dataset.conversationId : undefined;
    history.replaceChildren();
    for (const conversation of conversations) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `api-history-row${conversation.id === activeConversationId ? " active" : ""}`;
      button.dataset.conversationId = conversation.id;
      button.disabled = uploadingCount > 0;
      if (conversation.id === activeConversationId) button.setAttribute("aria-current", "true");
      const title = document.createElement("strong");
      title.textContent = conversation.title;
      const detail = document.createElement("small");
      const provider = providers.find(item => item.id === conversation.providerId);
      detail.textContent = `${provider?.name || conversation.providerId} · ${apiModelLabel(conversation.model)}`;
      button.title = `${conversation.title}\n${detail.textContent}`;
      button.append(title, detail);
      button.addEventListener("click", () => selectConversation(conversation.id));
      history.appendChild(button);
      if (focusedId === conversation.id && !sidebar.inert) button.focus({ preventScroll: true });
    }
  }

  function archiveConversation() {
    if (messages.length) {
      const title = (messages.find(message => message.role === "user")?.content || t("apiChat.defaultTitle")).replace(/\s+/g, " ");
      const conversation: ChatConversation = {
        id: activeConversationId,
        title: Array.from(title).slice(0, 60).join(""),
        messages: cloneMessages(messages),
        providerId: providerSelect.value,
        model: modelSelect.value,
        reasoning: reasoningSelect.value || "auto"
      };
      conversations = [conversation, ...conversations.filter(item => item.id !== activeConversationId)].slice(0, API_CHAT_SESSION_LIMIT);
    }
    renderHistory();
  }

  function cancelActiveRequest() {
    conversationGeneration += 1;
    activeChatController?.abort();
    activeChatController = null;
    sending = false;
  }

  function discardPendingAttachments() {
    for (const attachment of pendingAttachments) {
      if (attachment.previewUrl) URL.revokeObjectURL(attachment.previewUrl);
      void apiJson(`/api/llm/attachments/${encodeURIComponent(attachment.id)}`, {
        method: "DELETE"
      }).catch(() => {});
    }
    pendingAttachments = [];
    renderPendingAttachments();
  }

  const drafts = createChatDraftBinding<ApiAttachment[]>({
    provider: "api-chat",
    input: prompt,
    storage: window.sessionStorage,
    getProjectId: () => localStorage.getItem(PROJECT_KEY),
    takeExtras: () => pendingAttachments,
    restoreExtras: extras => {
      pendingAttachments = extras ?? [];
      renderPendingAttachments();
    },
    onRestore: () => resizePrompt()
  });

  function selectConversation(id: string) {
    if (uploadingCount > 0) return;
    if (id === activeConversationId) {
      closeSidebar();
      prompt.focus();
      return;
    }
    const conversation = conversations.find(item => item.id === id);
    if (!conversation) return;
    archiveConversation();
    cancelActiveRequest();
    discardPendingAttachments();
    activeConversationId = conversation.id;
    messages = cloneMessages(conversation.messages);
    providerSelect.value = conversation.providerId;
    updateModels();
    if (currentProvider()) {
      localStorage.setItem("devmoter-api-provider", providerSelect.value);
      modelSelect.value = conversation.model;
      if (modelSelect.value) localStorage.setItem(`devmoter-api-model:${providerSelect.value}`, modelSelect.value);
      updateReasoning();
      if (Array.from(reasoningSelect.options).some(option => option.value === conversation.reasoning)) {
        reasoningSelect.value = conversation.reasoning;
        localStorage.setItem(`devmoter-api-reasoning:${providerSelect.value}:${modelSelect.value}`, conversation.reasoning);
      }
    }
    updateAvailability();
    renderMessages();
    closeSidebar();
    prompt.focus();
  }

  function updateAvailability() {
    const provider = currentProvider();
    const busy = sending || uploadingCount > 0;
    providerSelect.disabled = busy;
    modelSelect.disabled = busy || !provider?.models.length;
    reasoningSelect.disabled = busy || reasoningSelect.options.length <= 1;
    // While a reply is pending the send button is Stop, like Codex, OpenCode and Qwen.
    send.disabled = sending ? false : !providerCatalogAvailable || !provider?.ready || !modelSelect.value || busy;
    attachImage.disabled = busy;
    newChat.disabled = uploadingCount > 0;
    history.querySelectorAll<HTMLButtonElement>("button").forEach(button => { button.disabled = uploadingCount > 0; });
    for (const select of [providerSelect, modelSelect, reasoningSelect]) {
      select.title = select.selectedOptions[0]?.textContent || select.getAttribute("aria-label") || "";
    }
    send.textContent = sending ? "■" : "↑";
    send.setAttribute("aria-label", sending ? t("common.stop") : t("common.send"));
    form.setAttribute("aria-busy", String(sending));
    status.title = status.textContent || "";
  }

  async function copyMessage(text: string) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const helper = document.createElement("textarea");
      helper.value = text;
      helper.style.position = "fixed";
      helper.style.opacity = "0";
      document.body.appendChild(helper);
      try {
        helper.select();
        if (!document.execCommand("copy")) throw new Error(t("common.copyFailed"));
      } finally {
        helper.remove();
      }
    }
  }

  function openSidebar() {
    if (!settingsModal.classList.contains("hidden") || sidebar.classList.contains("open")) return;
    sidebarReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : menu;
    closeAgentSwitch();
    window.dispatchEvent(new CustomEvent("devmoter:close-global-nav"));
    sidebar.classList.add("open");
    sidebar.setAttribute("aria-hidden", "false");
    sidebar.setAttribute("role", "dialog");
    sidebar.setAttribute("aria-modal", "true");
    scrim.classList.remove("hidden");
    syncOverlayState();
    sidebarClose.focus({ preventScroll: true });
  }

  function closeSidebar() {
    const restoreFocus = sidebar.contains(document.activeElement);
    closeAgentSwitch();
    sidebar.classList.remove("open");
    sidebar.setAttribute("aria-hidden", "true");
    sidebar.removeAttribute("role");
    sidebar.removeAttribute("aria-modal");
    scrim.classList.add("hidden");
    syncOverlayState();
    if (restoreFocus) restoreOverlayFocus(sidebarReturnFocus);
    sidebarReturnFocus = null;
  }

  function closeSettings() {
    const restoreFocus = settingsModal.contains(document.activeElement);
    settingsOpenSerial += 1;
    settingsModal.classList.add("hidden");
    syncOverlayState();
    if (restoreFocus) restoreOverlayFocus(settingsReturnFocus);
    settingsReturnFocus = null;
  }

  function currentProvider() {
    return providers.find(provider => provider.id === providerSelect.value) ?? null;
  }

  function reasoningLabel(mode: string) {
    const label = ({
      auto: t("apiChat.reasoning.auto"),
      none: t("apiChat.reasoning.off"),
      low: t("apiChat.reasoning.low"),
      medium: t("apiChat.reasoning.medium"),
      high: t("apiChat.reasoning.high")
    } as Record<string, string>)[mode] || mode;
    return t("apiChat.reasoningPrefix", { label });
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
      option.textContent = apiModelLabel(model);
      modelSelect.appendChild(option);
    }

    if (savedModel && provider?.models.includes(savedModel)) {
      modelSelect.value = savedModel;
    }
    updateReasoning();
    updateHeader();
    // Ready needs no line: the selectors in the composer foot already show the choice.
    status.textContent = !provider
      ? t("apiChat.addApiHint")
      : provider.ready
        ? ""
        : `${provider.name} · ${t("apiChat.keyMissing")}`;
    updateAvailability();
  }

  function updateHeader() {
    const label = root.querySelector<HTMLElement>("#apiModelTopLabel")!;
    const provider = currentProvider();
    label.textContent = provider
      ? `${provider.name} · ${modelSelect.value ? apiModelLabel(modelSelect.value) : t("apiChat.modelUnset")}`
      : t("apiChat.topModelUnset");
    label.title = label.textContent;
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
      row.setAttribute("aria-label", message.role === "user" ? t("apiChat.roleYou") : t("apiChat.roleAssistant"));
      const bubble = document.createElement("div");
      bubble.className = "api-message-bubble";
      if (message.role === "assistant") {
        renderChatMarkdown(bubble, message.content, copyMessage);
      } else {
        bubble.textContent = message.content;
      }

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
      if (message.role === "assistant") {
        const copy = document.createElement("button");
        copy.type = "button";
        copy.className = "api-message-copy";
        copy.textContent = t("common.copy");
        copy.setAttribute("aria-label", t("apiChat.copyAnswerAria"));
        copy.addEventListener("click", () => {
          void copyMessage(message.content).then(() => {
            copy.textContent = t("common.copied");
          }).catch(() => { copy.textContent = t("common.copyFailed"); });
        });
        row.appendChild(copy);
      }
      transcript.appendChild(row);
    }

    transcript.scrollTop = transcript.scrollHeight;
    archiveConversation();
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
      remove.setAttribute("aria-label", t("apiChat.removeAttachmentAria", { name: attachment.name }));
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
      throw new Error(t("apiChat.unsupportedImageType"));
    }
    if (file.size <= 0 || file.size > 15 * 1024 * 1024) {
      throw new Error(t("apiChat.imageTooLarge"));
    }

    const res = await fetchWithTimeout(
      (input, init) => fetch(input, init),
      "/api/llm/attachments",
      {
        method: "POST",
        headers: {
          "content-type": file.type,
          "x-devmoter-file-name": encodeURIComponent(file.name),
          "x-pocket-operation-id": operationId()
        },
        body: file
      },
      API_CHAT_REQUEST_TIMEOUT_MS,
      () => new Error(t("apiChat.imageUploadTimeout"))
    );
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(translateServerMessage(payload?.error || t("common.httpError", { status: res.status })));

    return {
      ...normalizeApiAttachment(payload, file),
      previewUrl: URL.createObjectURL(file)
    } as ApiAttachment;
  }

  async function handleImageFiles(files: FileList | File[]) {
    const list = Array.from(files).slice(0, Math.max(0, 8 - pendingAttachments.length));
    if (!list.length) return;

    uploadingCount += list.length;
    updateModels();
    status.textContent = t("apiChat.uploadingImagesProgress", {
      done: formatNumber(0),
      total: formatNumber(list.length)
    });

    let completed = 0;
    let uploadError: string | null = null;
    try {
      for (const file of list) {
        const attachment = await uploadImage(file);
        pendingAttachments.push(attachment);
        completed += 1;
        status.textContent = t("apiChat.uploadingImagesProgress", {
          done: formatNumber(completed),
          total: formatNumber(list.length)
        });
        renderPendingAttachments();
      }
      status.textContent = `${currentProvider()?.name || "API"} · ${t("apiChat.imageReady")}`;
    } catch (error) {
      uploadError = translateServerMessage(error instanceof Error ? error.message : String(error));
    } finally {
      uploadingCount -= list.length;
      imageInput.value = "";
      updateModels();
      if (uploadError) {
        status.textContent = uploadError;
        status.title = uploadError;
      }
    }
  }

  async function refresh() {
    const requestGeneration = ++providerCatalogRequestGeneration;
    status.textContent = t("apiChat.loadingProviders");
    try {
      const payload = await apiJson<unknown>("/api/llm/providers");
      if (requestGeneration !== providerCatalogRequestGeneration) return;
      providers = normalizeApiProviderCatalog(payload) as ApiProvider[];
      providerCatalogAvailable = true;

      const saved = localStorage.getItem("devmoter-api-provider");
      providerSelect.replaceChildren();

      if (providers.length === 0) {
        const option = document.createElement("option");
        option.value = "";
        option.textContent = t("apiChat.addApiOption");
        providerSelect.appendChild(option);
      }

      for (const provider of providers) {
        const option = document.createElement("option");
        option.value = provider.id;
        option.textContent = provider.ready ? provider.name : `${provider.name} (${t("apiChat.keyRequiredSuffix")})`;
        providerSelect.appendChild(option);
      }

      if (saved && providers.some(provider => provider.id === saved)) {
        providerSelect.value = saved;
      }
      updateModels();
    } catch (error) {
      if (requestGeneration !== providerCatalogRequestGeneration) return;
      providerCatalogAvailable = false;
      status.textContent = translateServerMessage(error instanceof Error ? error.message : String(error));
      updateAvailability();
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
    const source = provider.source === "env" ? t("apiChat.sourceEnvReadonly") : t("apiChat.sourceFileConfig");
    const modelCount = formatNumber(provider.models.length);
    meta.textContent = t("apiChat.providerMeta", {
      source,
      count: modelCount,
      state: provider.ready ? t("apiChat.keySaved") : t("apiChat.noKey")
    });
    if (provider.secretRef) {
      meta.textContent = t("apiChat.providerMetaVault", { source, count: modelCount });
    }
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
    text.innerHTML = `<strong>${escapeHtml(t("apiChat.providersListTitle"))}</strong>`;
    const add = document.createElement("button");
    add.type = "button";
    add.className = "primary";
    add.textContent = t("apiChat.addApiButton");
    add.addEventListener("click", () => void showProviderForm());
    toolbar.append(text, add);
    settingsBody.appendChild(toolbar);

    if (!providers.length) {
      const empty = document.createElement("div");
      empty.className = "api-settings-empty";
      empty.innerHTML = `<strong>${escapeHtml(t("apiChat.noProvidersEmpty"))}</strong>`;
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
        migrate.textContent = migrationEligible ? t("apiChat.migrateToVault") : t("apiChat.notMigrationEligible");
        migrate.disabled = !migrationEligible || !localStorage.getItem(DEVICE_TOKEN_KEY) || !localStorage.getItem(PROJECT_KEY);
        migrate.title = !migrationEligible
          ? t("apiChat.migrationRequiresPreset")
          : migrate.disabled ? t("apiChat.migrationRequiresDeviceProject") : t("apiChat.migrationTitleReady");
        migrate.addEventListener("click", async () => {
          const projectId = localStorage.getItem(PROJECT_KEY) || "";
          if (!projectId || !localStorage.getItem(DEVICE_TOKEN_KEY)) return;
          if (!confirm(t("apiChat.migrationConfirm", { name: provider.name }))) return;
          migrate.disabled = true;
          migrate.textContent = t("apiChat.movingToVault");
          try {
            await apiJson(`/api/llm/providers/${encodeURIComponent(provider.id)}/migrate-to-vault`, {
              method: "POST",
              body: JSON.stringify({ projectId, confirm: true })
            });
            await refresh();
            await renderSettingsList();
          } catch (error) {
            migrate.disabled = false;
            migrate.textContent = t("apiChat.migrateToVault");
            const message = document.createElement("small");
            message.className = "api-provider-migrate-error";
            message.textContent = translateServerMessage(error instanceof Error ? error.message : String(error));
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
    if (!settingsModal.classList.contains("hidden")) {
      settingsClose.focus({ preventScroll: true });
      return;
    }
    settingsReturnFocus = sidebar.contains(document.activeElement) ? menu
      : document.activeElement instanceof HTMLElement ? document.activeElement : menu;
    closeSidebar();
    closeAgentSwitch();
    window.dispatchEvent(new CustomEvent("devmoter:close-global-nav"));
    settingsModal.classList.remove("hidden");
    syncOverlayState();
    settingsClose.focus({ preventScroll: true });
    settingsBody.innerHTML = `<div class="api-settings-loading">${escapeHtml(t("common.loading"))}</div>`;
    const serial = ++settingsOpenSerial;
    try {
      await Promise.all([refresh(), loadPresets()]);
      if (serial !== settingsOpenSerial || settingsModal.classList.contains("hidden")) return;
      await renderSettingsList();
    } catch (error) {
      if (serial !== settingsOpenSerial || settingsModal.classList.contains("hidden")) return;
      settingsBody.textContent = translateServerMessage(error instanceof Error ? error.message : String(error));
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
    back.textContent = t("apiChat.backToProviders");
    back.addEventListener("click", () => void renderSettingsList());

    const heading = document.createElement("div");
    heading.className = "api-settings-form-title";
    const headingTitle = document.createElement("strong");
    headingTitle.textContent = provider ? provider.name : t("apiChat.addApiTitle");
    heading.append(headingTitle);

    const providerForm = document.createElement("form");
    providerForm.className = "api-provider-form api-provider-form-simple";
    providerForm.innerHTML = `
      <label>
        <span>${escapeHtml(t("apiChat.fieldCompanyProvider"))}</span>
        <div class="api-preset-grid" data-field="preset-grid"></div>
        <select data-field="preset" class="api-preset-select-hidden" aria-label="${escapeHtml(t("apiChat.presetAria"))}"></select>
      </label>

      <label>
        <span>${escapeHtml(t("apiChat.credentialStore"))}</span>
        <select data-field="credentialMode">
          <option value="api-key">${escapeHtml(t("apiChat.credentialApiKeyOption"))}</option>
          <option value="vault" ${provider?.secretRef ? "selected" : ""} ${bindingProjectId && (vaultSecrets.length || provider?.secretRef) ? "" : "disabled"}>${escapeHtml(t("apiChat.credentialVaultOption"))}</option>
        </select>
        <small data-credential-hint></small>
      </label>

      <label data-vault-reference-row hidden>
        <span>${escapeHtml(t("apiChat.vaultSecretLabel"))}</span>
        <select data-field="secretRef"></select>
        <small data-vault-status></small>
      </label>

      <label data-api-key-row>
        <span>${escapeHtml(t("apiChat.apiKeyLabel"))}</span>
        <input data-field="apiKey" type="password" autocomplete="new-password" />
      </label>

      <details class="api-advanced-settings" data-advanced>
        <summary>${escapeHtml(t("apiChat.advancedSummary"))}</summary>
        <div class="api-advanced-settings-body">
          <label>
            <span>${escapeHtml(t("apiChat.displayNameLabel"))}</span>
            <input data-field="name" type="text" maxlength="100" />
          </label>
          <label>
            <span>${escapeHtml(t("apiChat.apiFormatLabel"))}</span>
            <select data-field="protocol">
              <option value="openai-compatible">${escapeHtml(t("apiChat.protocolOpenAiCompatible"))}</option>
              <option value="anthropic">${escapeHtml(t("apiChat.protocolAnthropicMessages"))}</option>
            </select>
          </label>
          <label>
            <span>${escapeHtml(t("apiChat.baseUrlLabel"))}</span>
            <input data-field="baseUrl" type="url" inputmode="url" autocomplete="off" />
          </label>
          <label>
            <span>${escapeHtml(t("apiChat.modelsLabel"))}</span>
            <textarea data-field="models" rows="5" placeholder="${escapeHtml(t("apiChat.modelsPlaceholder"))}"></textarea>
          </label>
        </div>
      </details>

      <div data-form-message class="api-form-message"></div>
      <button data-action="save" type="submit" class="api-auto-connect-button">
        ${escapeHtml(provider ? t("apiChat.updateProvider") : t("apiChat.connectAndAdd"))}
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
      credentialHint.textContent = bindingProjectId ? "" : t("apiChat.selectProjectForVault");
      vaultStatus.textContent = vaultSecrets.length
        ? t("apiChat.usableSecretsCount", { count: formatNumber(matching.length) })
        : t("apiChat.noUsableSecretsHint");
    }

    if (provider) {
      presetSelect.value = provider.presetId || "custom";
      presetSelect.disabled = true;
      nameInput.value = provider.name;
      protocolSelect.value = provider.protocol;
      baseUrlInput.value = provider.baseUrl;
      modelsInput.value = provider.models.join("\n");
      apiKeyInput.placeholder = provider.ready
        ? provider.secretRef ? t("apiChat.managedInVault") : t("apiChat.keySavedPlaceholder")
        : t("apiChat.pasteApiKeyPlaceholder");
      credentialModeSelect.value = provider.secretRef ? "vault" : "api-key";
      advanced.open = provider.presetId === "custom";
      syncPresetButtons();
    } else {
      const initial = presets[0];
      if (initial) presetSelect.value = initial.id;
      apiKeyInput.placeholder = t("apiChat.pasteApiKeyPlaceholder");
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
        formMessage.textContent = t("apiChat.pasteApiKeyError");
        formMessage.dataset.state = "error";
        apiKeyInput.focus();
        return;
      }

      saveButton.disabled = true;
      formMessage.dataset.state = "loading";

      try {
        if (usesVault && !selectedSecretRef) {
          formMessage.textContent = t("apiChat.selectVaultSecretError");
          formMessage.dataset.state = "error";
          return;
        }
        let models = modelsInput.value
          .split(/\n|,/)
          .map(item => item.trim())
          .filter(Boolean);

        if (enteredKey || usesVault) {
          formMessage.textContent = t("apiChat.testingConnection");
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
            formMessage.textContent = t("apiChat.modelsDiscoveryEmpty");
            formMessage.dataset.state = "error";
            return;
          }
        }

        if (!models.length) {
          advanced.open = true;
          formMessage.textContent = t("apiChat.noModelsError");
          formMessage.dataset.state = "error";
          return;
        }

        formMessage.textContent = t("apiChat.savingSafely");
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
        status.textContent = "";
        prompt.focus();
      } catch (error) {
        advanced.open = true;
        formMessage.textContent = t("apiChat.connectFailed", {
          error: translateServerMessage(error instanceof Error ? error.message : String(error))
        });
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
      remove.textContent = t("apiChat.deleteProviderButton");
      remove.addEventListener("click", async () => {
        if (!confirm(t("apiChat.deleteProviderConfirm", { name: provider.name }))) return;
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
          formMessage.textContent = translateServerMessage(error instanceof Error ? error.message : String(error));
          formMessage.dataset.state = "error";
          remove.disabled = false;
        }
      });
      danger.appendChild(remove);
      settingsBody.appendChild(danger);
    }
  }

  async function submit() {
    if (sending) {
      activeChatController?.abort();
      return;
    }
    if (uploadingCount > 0) return;
    if (drafts.sync()) {
      status.textContent = t("chat.draft.projectSwitched");
      return;
    }
    const rawText = prompt.value.trim();
    const provider = currentProvider();
    const model = modelSelect.value;
    if ((!rawText && pendingAttachments.length === 0) || !provider?.ready || !model || sending) return;
    if (provider.secretRef && (localStorage.getItem(PROJECT_KEY) || "") !== provider.projectId) {
      status.textContent = t("apiChat.vaultProjectMismatch");
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

    const text = rawText || t("apiChat.imagePromptFallback");
    messages.push({ role: "user", content: text, attachments });
    trimHistory();
    const generation = conversationGeneration;
    const controller = new AbortController();
    activeChatController?.abort();
    activeChatController = controller;
    let requestTimedOut = false;
    let stoppedByUser = false;
    const requestTimeout = window.setTimeout(() => {
      requestTimedOut = true;
      controller.abort();
    }, API_CHAT_REQUEST_TIMEOUT_MS);
    prompt.value = "";
    drafts.capture();
    resizePrompt();
    renderMessages();
    sending = true;
    updateAvailability();
    status.textContent = t("apiChat.thinkingStatus", { provider: provider.name });
    status.title = status.textContent;
    let responseFailed = false;

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
      const content = String(payload?.message?.content || "");
      if (!content.trim()) throw new Error(t("apiChat.emptyResponseError"));
      messages.push({ role: "assistant", content });
      trimHistory();
      renderMessages();
      status.textContent = "";
    } catch (error) {
      if (generation !== conversationGeneration) return;
      if (controller.signal.aborted && !requestTimedOut) {
        stoppedByUser = true;
        return;
      }
      responseFailed = true;
      messages.push({
        role: "assistant",
        content: requestTimedOut
          ? t("apiChat.requestTimeoutError")
          : t("apiChat.errorPrefix", {
              error: translateServerMessage(error instanceof Error ? error.message : String(error))
            })
      });
      trimHistory();
      renderMessages();
      status.textContent = t("apiChat.errorStatus", { provider: provider.name });
    } finally {
      window.clearTimeout(requestTimeout);
      if (activeChatController === controller) activeChatController = null;
      if (generation === conversationGeneration) {
        sending = false;
        updateModels();
        if (responseFailed) {
          status.textContent = t("apiChat.errorStatus", { provider: provider.name });
          status.title = status.textContent;
        } else if (stoppedByUser) {
          status.textContent = t("apiChat.stopped");
          status.title = status.textContent;
        }
        prompt.focus();
      }
    }
  }

  menu.addEventListener("click", openSidebar);
  window.addEventListener("devmoter:close-chat-history", closeSidebar);
  const closeLocalOverlays = () => {
    closeSidebar();
    closeSettings();
  };
  window.addEventListener("devmoter:global-nav-opened", closeLocalOverlays);
  window.addEventListener("devmoter:surface-changed", closeLocalOverlays);
  window.addEventListener("devmoter:surface-changed", () => {
    if (uploadingCount === 0) drafts.sync();
  });
  root.querySelector<HTMLButtonElement>("#apiCopyLatest")!.addEventListener("click", () => {
    const text = latestAssistantText(messages.map(message => (message.role === "assistant" ? message.content : "")));
    if (!text) {
      status.textContent = t("chat.copyLatest.none");
      return;
    }
    void copyMessage(text)
      .then(() => { status.textContent = t("common.copied"); })
      .catch(() => { status.textContent = t("common.copyFailed"); });
  });
  agentSwitchButton.addEventListener("click", () => {
    const open = agentSwitchMenu.classList.toggle("hidden") === false;
    agentSwitchButton.setAttribute("aria-expanded", String(open));
  });
  agentCurrent.addEventListener("click", () => {
    closeAgentSwitch();
    agentSwitchButton.focus({ preventScroll: true });
  });
  sidebarClose.addEventListener("click", closeSidebar);
  scrim.addEventListener("click", closeSidebar);
  goCodex.addEventListener("click", () => {
    closeSidebar();
    options.onCodex?.();
  });
  goOpenCode.addEventListener("click", () => {
    closeSidebar();
    options.onOpenCode?.();
  });
  settingsTop.addEventListener("click", () => void openSettings());
  settingsClose.addEventListener("click", closeSettings);
  settingsModal.addEventListener("click", event => {
    if (event.target === settingsModal) closeSettings();
  });
  document.addEventListener("keydown", event => {
    if (!document.body.classList.contains("api-mode")) return;
    const overlay = !settingsModal.classList.contains("hidden") ? settingsModal
      : sidebar.classList.contains("open") ? sidebar : null;
    if (!overlay) return;
    if (event.key === "Escape") {
      event.preventDefault();
      if (overlay === sidebar && !agentSwitchMenu.classList.contains("hidden")) {
        closeAgentSwitch();
        agentSwitchButton.focus({ preventScroll: true });
      } else if (overlay === settingsModal) closeSettings();
      else closeSidebar();
      return;
    }
    if (event.key !== "Tab") return;
    const controls = Array.from(overlay.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex="0"]'
    )).filter(isVisibleFocusTarget);
    const first = controls[0];
    const last = controls.at(-1);
    if (!first || !last) return;
    const active = document.activeElement;
    if (!overlay.contains(active) || (event.shiftKey ? active === first : active === last)) {
      event.preventDefault();
      (event.shiftKey ? last : first).focus({ preventScroll: true });
    }
  });
  newChatTop.addEventListener("click", () => newChat.click());
  newChat.addEventListener("click", () => {
    if (uploadingCount > 0) return;
    archiveConversation();
    cancelActiveRequest();
    discardPendingAttachments();
    messages = [];
    activeConversationId = operationId();
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
    archiveConversation();
  });
  modelSelect.addEventListener("change", () => {
    const provider = currentProvider();
    if (provider) localStorage.setItem(`devmoter-api-model:${provider.id}`, modelSelect.value);
    updateReasoning();
    updateHeader();
    updateAvailability();
    archiveConversation();
  });
  reasoningSelect.addEventListener("change", () => {
    const provider = currentProvider();
    if (!provider) return;
    localStorage.setItem(
      `devmoter-api-reasoning:${provider.id}:${modelSelect.value}`,
      reasoningSelect.value
    );
    updateAvailability();
    archiveConversation();
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
  renderHistory();

  return { refresh };
}
