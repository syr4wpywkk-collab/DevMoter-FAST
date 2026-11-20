import "./qwen-chat.css";
import { formatDateTime, formatNumber, getLanguage, t, translateServerMessage } from "./i18n";
import { apiErrorMessage } from "./api-error.mjs";
import { SYSTEM_ICONS } from "./app-registry";
import { renderChatMarkdown } from "./chat-markdown.mjs";
import { createChatDraftBinding } from "./chat-draft.mjs";
import { createSheetHeader } from "./sheet-header.mjs";
import {
  createNdjsonReader,
  createQwenChat,
  loadQwenChats,
  mergeStoredQwenChats,
  QWEN_CHATS_KEY,
  qwenChatTime,
  qwenChatTitle,
  readQwenHistory,
  saveQwenChats,
  sortQwenChats,
  type QwenChat,
  type QwenChatMessage
} from "./qwen-chat-history.mjs";
import { mountQwenModelPicker } from "./qwen-model-picker";
import { qwenModelChipLabel, qwenModelKey } from "./qwen-model-store.mjs";

type Project = { id: string; name: string; path: string; available?: boolean };
type QwenEvent =
  | { type: "start"; runId: string }
  | { type: "session"; sessionId: string }
  | { type: "delta"; text: string }
  | { type: "tool"; name: string }
  | { type: "ping" }
  | { type: "done"; text: string; sessionId: string | null }
  | { type: "error"; error: string; code?: string };
type LiveRun = {
  chatId: string;
  runId: string;
  controller: AbortController;
  text: string;
  tool: string;
  startedAt: number;
  stopped: boolean;
};

export type QwenChatOptions = {
  onIntegrations?: () => void;
};

export type QwenChatController = {
  refresh(): Promise<void>;
};

const PROJECT_KEY = "opencode-pocket-project";
const DEVICE_TOKEN_KEY = "devmoter-device-token";
// Codes for which the fix lives on the Integrations screen.
const SETUP_CODES = new Set(["not_installed", "auth"]);

function escapeHtml(value: string) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function newId() {
  return globalThis.crypto?.randomUUID?.() ?? "00000000-0000-4000-8000-" + Date.now().toString(16).padStart(12, "0").slice(-12);
}

function requestHeaders() {
  const headers = new Headers({ "content-type": "application/json", "x-pocket-operation-id": newId() });
  const deviceToken = localStorage.getItem(DEVICE_TOKEN_KEY);
  if (deviceToken) headers.set("x-devmoter-device-token", deviceToken);
  return headers;
}

export function mountQwenChat(root: HTMLElement, options: QwenChatOptions = {}): QwenChatController {
  root.innerHTML = `
    <div class="qx-app" data-qwen-app>
      <header class="qx-topbar">
        <button type="button" class="qx-icon-button" data-qwen-history aria-haspopup="dialog" aria-expanded="false" aria-controls="qwenHistorySheet" aria-label="${escapeHtml(t("qwen.chat.historyAria"))}">${SYSTEM_ICONS.history}</button>
        <div class="qx-brand">
          <strong>Qwen Code</strong>
          <small data-qwen-project></small>
        </div>
        <button type="button" class="qx-model-chip" data-qwen-model-button aria-haspopup="dialog" aria-expanded="false" aria-controls="qwenModelSheet"><span data-qwen-model-label></span>${SYSTEM_ICONS["chevron-down"]}</button>
        <button type="button" class="qx-icon-button" data-qwen-new aria-label="${escapeHtml(t("qwen.chat.newChatAria"))}">${SYSTEM_ICONS.plus}</button>
      </header>
      <main class="qx-main">
        <div class="qx-transcript" data-qwen-log data-i18n-skip>
          <section class="qx-welcome" data-qwen-welcome>
            <h1>Qwen Code</h1>
            <p data-qwen-welcome-text></p>
          </section>
          <div class="qx-messages" data-qwen-messages aria-live="polite"></div>
        </div>
      </main>
      <section class="qx-composer-wrap">
        <form class="qx-composer" data-qwen-form>
          <textarea data-qwen-input rows="1" enterkeyhint="send" placeholder="${escapeHtml(t("qwen.chat.inputPlaceholder"))}" aria-label="${escapeHtml(t("qwen.chat.inputAria"))}"></textarea>
          <div class="qx-composer-foot">
            <small class="qx-status" data-qwen-status role="status" aria-live="polite"></small>
            <button type="submit" class="qx-send" data-qwen-send aria-label="${escapeHtml(t("qwen.chat.sendAria"))}">${SYSTEM_ICONS.send}</button>
          </div>
        </form>
      </section>
      <div class="qx-scrim" data-qwen-scrim hidden></div>
      <section class="qx-sheet" id="qwenHistorySheet" data-qwen-sheet role="dialog" aria-modal="true" aria-labelledby="qwenHistoryTitle" hidden>
        <input class="qx-history-search" type="search" data-qwen-history-search placeholder="${escapeHtml(t("qwen.chat.searchHistory"))}" aria-label="${escapeHtml(t("qwen.chat.searchHistory"))}" />
        <div class="qx-history" data-qwen-history-list></div>
      </section>
    </div>`;

  const app = root.querySelector<HTMLElement>("[data-qwen-app]")!;
  const historyButton = root.querySelector<HTMLButtonElement>("[data-qwen-history]")!;
  const newButton = root.querySelector<HTMLButtonElement>("[data-qwen-new]")!;
  const projectLabel = root.querySelector<HTMLElement>("[data-qwen-project]")!;
  const transcript = root.querySelector<HTMLElement>("[data-qwen-log]")!;
  const welcome = root.querySelector<HTMLElement>("[data-qwen-welcome]")!;
  const welcomeText = root.querySelector<HTMLElement>("[data-qwen-welcome-text]")!;
  const list = root.querySelector<HTMLElement>("[data-qwen-messages]")!;
  const form = root.querySelector<HTMLFormElement>("[data-qwen-form]")!;
  const input = root.querySelector<HTMLTextAreaElement>("[data-qwen-input]")!;
  const status = root.querySelector<HTMLElement>("[data-qwen-status]")!;
  const send = root.querySelector<HTMLButtonElement>("[data-qwen-send]")!;
  const scrim = root.querySelector<HTMLElement>("[data-qwen-scrim]")!;
  const sheet = root.querySelector<HTMLElement>("[data-qwen-sheet]")!;
  const historyList = root.querySelector<HTMLElement>("[data-qwen-history-list]")!;
  const historySearch = root.querySelector<HTMLInputElement>("[data-qwen-history-search]")!;
  historySearch.addEventListener("input", () => renderHistory());
  const modelButton = root.querySelector<HTMLButtonElement>("[data-qwen-model-button]")!;
  const modelLabel = root.querySelector<HTMLElement>("[data-qwen-model-label]")!;
  const background = [".qx-topbar", ".qx-main", ".qx-composer-wrap"].map(selector => root.querySelector<HTMLElement>(selector)!);
  const composerWrap = background[2];

  const head = createSheetHeader(document, {
    title: t("qwen.chat.historyTitle"),
    titleId: "qwenHistoryTitle",
    closeLabel: t("common.close"),
    onClose: () => closeSheet(),
    primary: { label: t("qwen.chat.historyNew"), onClick: () => { closeSheet(); startNewChat(); } }
  });
  sheet.prepend(head.element);

  const picker = mountQwenModelPicker({
    host: app,
    headers: requestHeaders,
    projectId: () => projectFor(activeChat())?.id ?? null,
    onChange: () => renderModel(),
    onOpenChange: open => {
      scrim.hidden = !open;
      for (const region of background) region.inert = open;
      modelButton.setAttribute("aria-expanded", String(open));
    }
  });

  const savedHistory = readQwenHistory(localStorage);
  let chats: QwenChat[] = savedHistory.chats;
  let activeId: string | null = chats[0]?.id ?? null;
  let projects: Project[] = [];
  let projectsLoaded = false;
  let live: LiveRun | null = null;
  let tick = 0;
  let paintQueued = false;
  let sheetReturnFocus: HTMLElement | null = null;
  // One quiet line for problems that are not part of a chat (no project, storage full).
  let notice = savedHistory.damaged ? t("qwen.chat.historyDamaged") : "";
  // The last deleted chat can be restored until another chat is deleted (#344).
  let lastDeleted: QwenChat | null = null;

  if (typeof ResizeObserver !== "undefined") {
    new ResizeObserver(() => {
      app.style.setProperty("--qx-composer-height", `${composerWrap.getBoundingClientRect().height}px`);
    }).observe(composerWrap);
  }

  const activeChat = () => chats.find(chat => chat.id === activeId) ?? null;
  // Unsent text belongs to the chat it was typed in (a new chat has no id yet),
  // so switching chats or leaving the screen never carries or drops it.
  const drafts = createChatDraftBinding({
    provider: "qwen",
    input,
    storage: window.sessionStorage,
    getProjectId: () => activeId,
    onRestore: () => { resizeInput(); renderStatus(); }
  });
  const persist = () => {
    if (!saveQwenChats(localStorage, chats)) notice = t("qwen.chat.saveHistoryFailed");
  };
  const currentProject = () => {
    const usable = projects.filter(project => project.available !== false);
    const saved = localStorage.getItem(PROJECT_KEY) || "";
    return usable.find(project => project.id === saved || project.path === saved) ?? usable[0] ?? null;
  };
  // A chat with a qwen session keeps running in its own project, because qwen
  // stores sessions per working directory and --resume only works there.
  const projectFor = (chat: QwenChat | null) =>
    chat?.projectId ? projects.find(project => project.id === chat.projectId) ?? null : currentProject();

  function renderProject() {
    const chat = activeChat();
    const project = projectFor(chat);
    const name = project?.name
      || (chat?.projectId && projectsLoaded ? t("qwen.chat.projectNotFound") : "")
      || (projectsLoaded ? t("qwen.chat.noProject") : t("qwen.chat.loadingProject"));
    projectLabel.textContent = name;
    projectLabel.title = project?.path || name;
    welcomeText.textContent = project
      ? t("qwen.chat.welcomeProject", { project: project.name })
      : t("qwen.chat.welcomeDefault");
  }

  function renderModel() {
    const current = picker.current();
    modelLabel.textContent = qwenModelChipLabel(current, getLanguage());
    const name = current ? current.name : t("qwen.picker.defaultTitle");
    modelButton.setAttribute("aria-label", t("qwen.chat.modelButtonAria", { name }));
    modelButton.title = name;
  }

  async function copyText(text: string) {
    await navigator.clipboard.writeText(text);
  }

  function messageRow(message: QwenChatMessage, streaming = false) {
    const row = document.createElement("article");
    row.className = `qx-message ${message.role}${streaming ? " streaming" : ""}`;
    if (message.code) row.dataset.code = message.code;
    const body = document.createElement("div");
    body.className = "qx-message-body";
    if (message.role === "assistant") renderChatMarkdown(body, message.text, text => void copyText(text));
    else if (message.role === "note") {
      row.dataset.qwenNote = "";
      body.textContent = message.text;
    }
    else body.textContent = message.text;
    row.append(body);
    if (message.role === "assistant" && !streaming && message.text) {
      const copy = document.createElement("button");
      copy.type = "button";
      copy.className = "qx-message-action";
      copy.textContent = t("common.copy");
      copy.addEventListener("click", () => {
        copyText(message.text)
          .then(() => { copy.textContent = t("common.copied"); })
          .catch(() => { copy.textContent = t("common.copyFailed"); });
      });
      row.append(copy);
    }
    if (message.role === "error" && (message.code === "model_auth" || message.code === "unknown_model")) {
      const open = document.createElement("button");
      open.type = "button";
      open.className = "qx-message-action qx-setup";
      open.dataset.qwenOpenModels = "";
      open.textContent = t("qwen.chat.openModelPicker");
      open.addEventListener("click", () => picker.open(modelButton));
      row.append(open);
    }
    if (message.role === "error" && message.code && SETUP_CODES.has(message.code) && options.onIntegrations) {
      const setup = document.createElement("button");
      setup.type = "button";
      setup.className = "qx-message-action qx-setup";
      setup.dataset.qwenSetup = "";
      setup.textContent = t("qwen.chat.openIntegrations");
      setup.addEventListener("click", () => options.onIntegrations?.());
      row.append(setup);
    }
    return row;
  }

  const nearBottom = () => transcript.scrollHeight - transcript.scrollTop - transcript.clientHeight < 80;

  function renderMessages(stick = true) {
    const chat = activeChat();
    const messages = chat?.messages ?? [];
    const running = live && live.chatId === chat?.id;
    welcome.hidden = messages.length > 0 || Boolean(running);
    list.replaceChildren(...messages.map(message => messageRow(message)));
    if (running) {
      const row = live!.text
        ? messageRow({ role: "assistant", text: live!.text }, true)
        : Object.assign(document.createElement("article"), { className: "qx-message assistant streaming" });
      row.dataset.qwenLive = "";
      if (!live!.text) {
        const wait = document.createElement("div");
        wait.className = "qx-thinking";
        wait.textContent = t("qwen.chat.thinking");
        row.append(wait);
      }
      list.append(row);
    }
    if (stick) transcript.scrollTop = transcript.scrollHeight;
  }

  function schedulePaint() {
    if (paintQueued) return;
    paintQueued = true;
    window.setTimeout(() => {
      paintQueued = false;
      if (!live || live.chatId !== activeId) return;
      const stick = nearBottom();
      renderMessages(stick);
      renderStatus();
    }, 80);
  }

  function renderStatus() {
    const runningHere = live && live.chatId === activeId;
    if (live) {
      const seconds = Math.max(0, Math.floor((Date.now() - live.startedAt) / 1000));
      const what = !runningHere
        ? t("qwen.chat.otherChatReplying")
        : live.tool
          ? t("qwen.chat.runningTool", { tool: live.tool })
          : t("qwen.chat.replying");
      status.textContent = t("qwen.chat.statusWithSeconds", { what, seconds: formatNumber(seconds) });
    } else {
      status.textContent = notice;
    }
    const isRunning = Boolean(live);
    send.classList.toggle("stop", Boolean(runningHere));
    send.innerHTML = runningHere ? SYSTEM_ICONS.stop : SYSTEM_ICONS.send;
    send.type = runningHere ? "button" : "submit";
    send.setAttribute("aria-label", runningHere ? t("qwen.chat.stopAria") : t("qwen.chat.sendAria"));
    send.disabled = runningHere ? false : isRunning || !input.value.trim();
    form.setAttribute("aria-busy", String(Boolean(runningHere)));
  }

  function renderHistory() {
    const query = historySearch.value.trim().toLowerCase();
    const sorted = sortQwenChats(chats).filter(chat => !query
      || chat.title.toLowerCase().includes(query)
      || chat.messages.some(message => message.text.toLowerCase().includes(query)));
    historyList.replaceChildren();
    if (lastDeleted) {
      const restore = document.createElement("button");
      restore.type = "button";
      restore.className = "qx-history-restore";
      restore.dataset.restoreChat = lastDeleted.id;
      restore.textContent = t("qwen.chat.restoreChat", { title: lastDeleted.title });
      restore.addEventListener("click", restoreDeletedChat);
      historyList.append(restore);
    }
    if (!sorted.length) {
      const empty = document.createElement("p");
      empty.className = "qx-history-empty";
      empty.textContent = query && chats.length
        ? t("qwen.chat.noHistoryMatches", { query: historySearch.value.trim() })
        : t("qwen.chat.emptyHistory");
      historyList.append(empty);
      return;
    }
    const language = getLanguage();
    for (const chat of sorted) {
      const row = document.createElement("div");
      row.className = "qx-history-row";
      const open = document.createElement("button");
      open.type = "button";
      open.className = "qx-history-open";
      open.dataset.chatId = chat.id;
      if (chat.id === activeId) open.setAttribute("aria-current", "true");
      const title = document.createElement("strong");
      title.textContent = chat.title;
      const meta = document.createElement("small");
      const project = projects.find(item => item.id === chat.projectId);
      const running = live?.chatId === chat.id ? ` · ${t("qwen.chat.replying")}` : "";
      meta.textContent = `${project?.name ? `${project.name} · ` : ""}${qwenChatTime(chat.updatedAt, Date.now(), language)}${running}`;
      open.title = chat.title;
      meta.title = formatDateTime(chat.updatedAt);
      open.append(title, meta);
      open.addEventListener("click", () => selectChat(chat.id));
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "qx-icon-button qx-history-delete";
      remove.dataset.deleteChat = chat.id;
      remove.setAttribute("aria-label", t("qwen.chat.deleteChatAria", { title: chat.title }));
      remove.innerHTML = SYSTEM_ICONS.trash;
      remove.addEventListener("click", () => deleteChat(chat.id));
      row.append(open, remove);
      historyList.append(row);
    }
  }

  function render() {
    renderProject();
    renderModel();
    renderMessages();
    renderStatus();
    if (!sheet.hidden) renderHistory();
  }

  function setOverlay(open: boolean) {
    sheet.hidden = !open;
    scrim.hidden = !open;
    for (const region of background) region.inert = open;
    historyButton.setAttribute("aria-expanded", String(open));
  }

  function openSheet() {
    if (!sheet.hidden) return;
    picker.close();
    sheetReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : historyButton;
    window.dispatchEvent(new CustomEvent("devmoter:close-global-nav"));
    renderHistory();
    setOverlay(true);
    (historyList.querySelector<HTMLElement>('[aria-current="true"]') ?? head.closeButton).focus({ preventScroll: true });
  }

  function closeSheet() {
    if (sheet.hidden) return;
    const restore = sheet.contains(document.activeElement);
    setOverlay(false);
    if (restore && sheetReturnFocus?.isConnected) sheetReturnFocus.focus({ preventScroll: true });
    sheetReturnFocus = null;
  }

  function selectChat(id: string) {
    activeId = id;
    drafts.sync();
    closeSheet();
    render();
    input.focus({ preventScroll: true });
  }

  function startNewChat() {
    activeId = null;
    drafts.sync();
    render();
    input.focus({ preventScroll: true });
  }

  function deleteChat(id: string) {
    const chat = chats.find(item => item.id === id);
    if (!chat) return;
    if (!window.confirm(t("qwen.chat.deleteChatConfirm", { title: chat.title }))) return;
    if (live?.chatId === id) stopRun();
    lastDeleted = chat;
    chats = chats.filter(item => item.id !== id);
    if (activeId === id) activeId = null;
    drafts.sync();
    persist();
    render();
    renderHistory();
    (historyList.querySelector<HTMLElement>("button") ?? head.closeButton).focus({ preventScroll: true });
  }

  function restoreDeletedChat() {
    const chat = lastDeleted;
    lastDeleted = null;
    if (!chat) return;
    if (!chats.some(item => item.id === chat.id)) chats = sortQwenChats([chat, ...chats]);
    persist();
    render();
    renderHistory();
    [...historyList.querySelectorAll<HTMLElement>("[data-chat-id]")]
      .find(item => item.dataset.chatId === chat.id)?.focus({ preventScroll: true });
  }

  function resizeInput() {
    input.style.height = "auto";
    input.style.height = `${Math.min(input.scrollHeight, 180)}px`;
  }

  function finishRun(run: LiveRun, messages: QwenChatMessage[]) {
    const chat = chats.find(item => item.id === run.chatId);
    if (chat) {
      chat.messages.push(...messages);
      chat.updatedAt = Date.now();
      persist();
    }
    if (live === run) live = null;
    window.clearInterval(tick);
    render();
  }

  function stopRun() {
    const run = live;
    if (!run || run.stopped) return;
    run.stopped = true;
    run.controller.abort();
    // Closing the stream already stops qwen; the explicit cancel also covers
    // proxies that keep the upstream request open.
    void fetch("/api/qwen/chat/cancel", { method: "POST", headers: requestHeaders(), body: JSON.stringify({ runId: run.runId }) }).catch(() => {});
    const partial: QwenChatMessage[] = run.text ? [{ role: "assistant", text: run.text }] : [];
    finishRun(run, [...partial, { role: "error", text: t("qwen.chat.stoppedMessage"), code: "cancelled" }]);
  }

  async function submit() {
    const prompt = input.value.trim();
    if (!prompt || live) return;
    let chat = activeChat();
    const project = projectFor(chat);
    if (!project) {
      notice = chat?.projectId
        ? t("qwen.chat.chatProjectNotFound")
        : t("qwen.chat.chooseProjectFirst");
      renderStatus();
      return;
    }
    notice = "";
    if (!chat) {
      chat = createQwenChat(project.id);
      chats.unshift(chat);
      activeId = chat.id;
    }
    if (!chat.projectId) chat.projectId = project.id;
    if (!chat.messages.some(message => message.role === "user")) chat.title = qwenChatTitle(prompt);
    const model = picker.current();
    const modelKey = qwenModelKey(model);
    // A resumed qwen session can switch models (qwen's /model does the same);
    // say so in the transcript so the change is visible later.
    if (chat.messages.length && (chat.model ?? "") !== modelKey) {
      const name = model ? model.name.replace(/^\[[^\]]+\]\s*/, "") || model.id : t("qwen.picker.defaultTitle");
      chat.messages.push({ role: "note", text: t("qwen.chat.modelSwitchNote", { name }) });
    }
    chat.model = modelKey;
    chat.messages.push({ role: "user", text: prompt });
    chat.updatedAt = Date.now();
    persist();
    input.value = "";
    drafts.capture();
    drafts.sync();
    resizeInput();

    const run: LiveRun = { chatId: chat.id, runId: newId(), controller: new AbortController(), text: "", tool: "", startedAt: Date.now(), stopped: false };
    live = run;
    tick = window.setInterval(renderStatus, 1000);
    render();

    const target = chat;
    const fail = (text: string, code = "failed"): QwenChatMessage[] =>
      [...(run.text ? [{ role: "assistant" as const, text: run.text }] : []), { role: "error", text, code }];
    try {
      const res = await fetch("/api/qwen/chat", {
        method: "POST",
        headers: requestHeaders(),
        body: JSON.stringify({ projectId: project.id, prompt, sessionId: target.sessionId, runId: run.runId, model: model ? { authType: model.authType, id: model.id } : null }),
        signal: run.controller.signal
      });
      if (!res.ok || !res.body) {
        const payload = await res.json().catch(() => ({}));
        if (!run.stopped) {
          finishRun(run, fail(apiErrorMessage(payload, res.status), String(payload?.code || "failed")));
        }
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      const lines = createNdjsonReader();
      let outcome: QwenChatMessage[] | null = null;
      const handle = (event: QwenEvent) => {
        if (run.stopped) return;
        if (event.type === "session") {
          target.sessionId = event.sessionId;
          persist();
        } else if (event.type === "delta") {
          run.text += event.text;
          run.tool = "";
          schedulePaint();
        } else if (event.type === "tool") {
          run.tool = event.name;
          schedulePaint();
        } else if (event.type === "done") {
          if (event.sessionId) target.sessionId = event.sessionId;
          const text = run.text || event.text;
          outcome = [{ role: "assistant", text: text || t("qwen.chat.emptyReply") }];
        } else if (event.type === "error") {
          outcome = fail(translateServerMessage(event.error), event.code);
        }
      };
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        for (const event of lines.push(decoder.decode(value, { stream: true }))) handle(event as QwenEvent);
      }
      for (const event of lines.flush()) handle(event as QwenEvent);
      if (!run.stopped) finishRun(run, outcome ?? fail(t("qwen.chat.connectionClosed")));
    } catch (error) {
      if (run.stopped) return;
      finishRun(run, fail(translateServerMessage(error instanceof Error ? error.message : String(error))));
    }
  }

  async function refresh() {
    try {
      const res = await fetch("/api/projects", { cache: "no-store", headers: requestHeaders() });
      const payload = await res.json().catch(() => ({}));
      if (res.ok && Array.isArray(payload?.projects)) projects = payload.projects;
    } catch {
      // Keep the last known list; the label says so when it is empty.
    }
    projectsLoaded = true;
    render();
  }

  historyButton.addEventListener("click", () => (sheet.hidden ? openSheet() : closeSheet()));
  modelButton.addEventListener("click", () => {
    if (picker.isOpen()) return picker.close();
    closeSheet();
    window.dispatchEvent(new CustomEvent("devmoter:close-global-nav"));
    picker.open(modelButton);
  });
  newButton.addEventListener("click", startNewChat);
  scrim.addEventListener("click", () => {
    closeSheet();
    picker.close();
  });
  send.addEventListener("click", event => {
    if (live && live.chatId === activeId) {
      event.preventDefault();
      stopRun();
    }
  });
  form.addEventListener("submit", event => {
    event.preventDefault();
    void submit();
  });
  input.addEventListener("input", () => {
    resizeInput();
    renderStatus();
  });
  input.addEventListener("keydown", event => {
    if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;
    event.preventDefault();
    void submit();
  });
  sheet.addEventListener("keydown", event => {
    if (event.key === "Escape") {
      event.preventDefault();
      closeSheet();
      return;
    }
    if (event.key !== "Tab") return;
    const controls = Array.from(sheet.querySelectorAll<HTMLElement>(":is(button, input):not([disabled]):not([hidden])"));
    const first = controls[0];
    const last = controls.at(-1);
    if (!first || !last) return;
    if (event.shiftKey ? document.activeElement === first : document.activeElement === last) {
      event.preventDefault();
      (event.shiftKey ? last : first).focus({ preventScroll: true });
    }
  });
  window.addEventListener("devmoter:global-nav-opened", () => { closeSheet(); picker.close(); });
  window.addEventListener("devmoter:surface-changed", () => { closeSheet(); picker.close(); });
  window.addEventListener("devmoter:backend-changed", event => {
    if ((event as CustomEvent<{ backend?: string }>).detail?.backend === "qwen") void refresh();
  });
  window.addEventListener("storage", event => {
    if (event.key === PROJECT_KEY) render();
    if (event.key === QWEN_CHATS_KEY) {
      chats = mergeStoredQwenChats(loadQwenChats(localStorage), chats, live?.chatId ?? null);
      if (activeId && !chats.some(chat => chat.id === activeId)) activeId = null;
      render();
    }
  });

  render();
  resizeInput();
  return { refresh };
}
