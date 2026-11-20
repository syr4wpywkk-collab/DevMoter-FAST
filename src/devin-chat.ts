import "./devin-chat.css";
import { formatDateTime, formatNumber, t, translateServerMessage } from "./i18n";
import { SYSTEM_ICONS } from "./app-registry";
import { renderChatMarkdown } from "./chat-markdown.mjs";
import { createSheetHeader } from "./sheet-header.mjs";
import { reconnectDelay, shouldOpenEventSource, shouldScheduleReconnect } from "./reconnect-policy.mjs";

type Project = { id: string; name: string; path: string; available?: boolean };
type DevinHealth = {
  online?: boolean;
  ready?: boolean;
  loggedIn?: boolean | null;
  bin?: string;
  cwd?: string;
  error?: string;
  code?: string;
};
type ConfigOptionValue = { value: string; name?: string };
type ConfigOption = {
  id: string;
  name?: string;
  type?: string;
  currentValue?: string;
  options?: ConfigOptionValue[];
};
type DevinSession = { sessionId: string; cwd?: string; title?: string; updatedAt?: string };
type Message = { role: "user" | "assistant" | "error" | "note" | "tool" | "thought"; text: string; code?: string };

export type DevinChatOptions = {
  onIntegrations?: () => void;
};

export type DevinChatController = {
  refresh(): Promise<void>;
  setOnline(online: boolean, notice?: string, code?: string): void;
};

const PROJECT_KEY = "opencode-pocket-project";
const DEVICE_TOKEN_KEY = "devmoter-device-token";

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

async function rpc<T>(method: string, params: Record<string, unknown>): Promise<T> {
  const res = await fetch("/api/devin/rpc", {
    method: "POST",
    headers: requestHeaders(),
    body: JSON.stringify({ method, params })
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    const error = new Error(String(payload?.error || `Devin RPC failed (${res.status})`));
    (error as Error & { code?: string }).code = String(payload?.code || "");
    throw error;
  }
  return payload?.result as T;
}

export function mountDevinChat(root: HTMLElement, _options: DevinChatOptions = {}): DevinChatController {
  root.innerHTML = `
    <div class="dv-app" data-devin-app>
      <header class="dv-topbar">
        <button type="button" class="dv-icon-button" data-devin-history aria-haspopup="dialog" aria-expanded="false" aria-controls="devinHistorySheet" aria-label="${escapeHtml(t("devin.chat.historyAria"))}">${SYSTEM_ICONS.history}</button>
        <div class="dv-brand">
          <strong>Devin</strong>
          <small data-devin-project></small>
        </div>
        <span class="dv-state" data-devin-state role="status"></span>
        <button type="button" class="dv-icon-button" data-devin-new aria-label="${escapeHtml(t("devin.chat.newSessionAria"))}">${SYSTEM_ICONS.plus}</button>
      </header>
      <div class="dv-configbar" data-devin-configbar hidden>
        <div class="dv-configs" data-devin-configs></div>
        <small class="dv-usage" data-devin-usage></small>
      </div>
      <main class="dv-main">
        <div class="dv-transcript" data-devin-log data-i18n-skip>
          <section class="dv-welcome" data-devin-welcome>
            <h1>Devin</h1>
            <p data-devin-welcome-text></p>
          </section>
          <div class="dv-availability" data-devin-availability role="alert" hidden></div>
          <div class="dv-messages" data-devin-messages aria-live="polite"></div>
        </div>
      </main>
      <section class="dv-composer-wrap">
        <form class="dv-composer" data-devin-form>
          <textarea data-devin-input rows="1" enterkeyhint="send" placeholder="${escapeHtml(t("devin.chat.inputPlaceholder"))}" aria-label="${escapeHtml(t("devin.chat.inputAria"))}"></textarea>
          <div class="dv-composer-foot">
            <small class="dv-status" data-devin-status role="status" aria-live="polite"></small>
            <button type="submit" class="dv-send" data-devin-send aria-label="${escapeHtml(t("devin.chat.sendAria"))}">${SYSTEM_ICONS.send}</button>
          </div>
        </form>
      </section>
      <div class="dv-scrim" data-devin-scrim hidden></div>
      <section class="dv-sheet" id="devinHistorySheet" data-devin-sheet role="dialog" aria-modal="true" aria-labelledby="devinHistoryTitle" hidden>
        <div class="dv-history" data-devin-history-list></div>
      </section>
    </div>`;

  const historyButton = root.querySelector<HTMLButtonElement>("[data-devin-history]")!;
  const newButton = root.querySelector<HTMLButtonElement>("[data-devin-new]")!;
  const projectLabel = root.querySelector<HTMLElement>("[data-devin-project]")!;
  const stateLabel = root.querySelector<HTMLElement>("[data-devin-state]")!;
  const configbar = root.querySelector<HTMLElement>("[data-devin-configbar]")!;
  const configsHost = root.querySelector<HTMLElement>("[data-devin-configs]")!;
  const usageLabel = root.querySelector<HTMLElement>("[data-devin-usage]")!;
  const transcript = root.querySelector<HTMLElement>("[data-devin-log]")!;
  const welcome = root.querySelector<HTMLElement>("[data-devin-welcome]")!;
  const welcomeText = root.querySelector<HTMLElement>("[data-devin-welcome-text]")!;
  const availability = root.querySelector<HTMLElement>("[data-devin-availability]")!;
  const list = root.querySelector<HTMLElement>("[data-devin-messages]")!;
  const form = root.querySelector<HTMLFormElement>("[data-devin-form]")!;
  const input = root.querySelector<HTMLTextAreaElement>("[data-devin-input]")!;
  const status = root.querySelector<HTMLElement>("[data-devin-status]")!;
  const send = root.querySelector<HTMLButtonElement>("[data-devin-send]")!;
  const scrim = root.querySelector<HTMLElement>("[data-devin-scrim]")!;
  const sheet = root.querySelector<HTMLElement>("[data-devin-sheet]")!;
  const historyList = root.querySelector<HTMLElement>("[data-devin-history-list]")!;
  const background = [".dv-topbar", ".dv-configbar", ".dv-main", ".dv-composer-wrap"].map(selector => root.querySelector<HTMLElement>(selector)!);
  const composerWrap = background[3];

  const head = createSheetHeader(document, {
    title: t("devin.chat.historyTitle"),
    titleId: "devinHistoryTitle",
    closeLabel: t("common.close"),
    onClose: () => closeSheet(),
    primary: { label: t("devin.chat.historyNew"), onClick: () => { closeSheet(); startNewSession(); } }
  });
  sheet.prepend(head.element);

  if (typeof ResizeObserver !== "undefined") {
    new ResizeObserver(() => {
      root.querySelector<HTMLElement>("[data-devin-app]")!.style.setProperty("--dv-composer-height", `${composerWrap.getBoundingClientRect().height}px`);
    }).observe(composerWrap);
  }

  let health: DevinHealth | null = null;
  let online = false;
  let availabilityCode = "";
  let availabilityNotice = "";
  let projects: Project[] = [];
  let sessions: DevinSession[] = [];
  let sessionId: string | null = null;
  let configOptions: ConfigOption[] = [];
  let messages: Message[] = [];
  let sending = false;
  let loading = false;
  let startedAt = 0;
  let tick = 0;
  let notice = "";
  // Streaming buffers for the in-flight turn (or a session/load replay).
  let streamText = "";
  let streamThought = "";
  let streamUser = "";
  let liveTool = "";
  const toolMessages = new Map<string, Message>();
  let usage: { used?: number; size?: number } | null = null;
  let events: EventSource | null = null;
  let reconnectTimer: number | null = null;
  let reconnectAttempts = 0;
  let sheetReturnFocus: HTMLElement | null = null;

  const currentProject = () => {
    const usable = projects.filter(project => project.available !== false);
    const saved = localStorage.getItem(PROJECT_KEY) || "";
    return usable.find(project => project.id === saved || project.path === saved) ?? usable[0] ?? null;
  };

  // session/new cwd: AcpAdapter.newSession requires an absolute cwd and
  // defaults to the bridge cwd, but the /api/devin/rpc route calls
  // adapter.request directly, so the client must send a cwd explicitly.
  // Prefer the selected project's path (the existing /api/projects +
  // localStorage mechanism, same as Qwen), falling back to the bridge cwd
  // reported by /api/devin/health.
  const sessionCwd = () => currentProject()?.path || health?.cwd || "";

  function availabilityLabel(code: string) {
    if (code === "not_installed") return t("devin.availability.notInstalled");
    if (code === "not_executable") return t("devin.availability.notExecutable");
    if (code === "not_logged_in") return t("devin.availability.notLoggedIn");
    if (code === "failed") return t("devin.availability.failed");
    return t("devin.chat.offline");
  }

  function availabilityGuide(code: string) {
    if (code === "not_installed") return t("devin.availability.notInstalledGuide");
    if (code === "not_logged_in") return t("devin.availability.notLoggedInGuide");
    return "";
  }

  function renderAvailability() {
    stateLabel.textContent = online ? t("devin.chat.online") : availabilityLabel(availabilityCode);
    stateLabel.dataset.devinState = online ? "online" : availabilityCode || "offline";
    stateLabel.classList.toggle("missing", !online && availabilityCode === "not_installed");
    if (online) {
      availability.hidden = true;
      availability.textContent = "";
    } else {
      const guide = availabilityGuide(availabilityCode);
      const parts = [availabilityNotice, guide].filter(Boolean);
      availability.textContent = parts.join("\n");
      availability.hidden = parts.length === 0;
      availability.dataset.code = availabilityCode;
    }
    const project = currentProject();
    projectLabel.textContent = project?.name || (health?.cwd ? health.cwd.split("/").filter(Boolean).pop() || health.cwd : "");
    projectLabel.title = project?.path || health?.cwd || "";
    welcomeText.textContent = project
      ? t("devin.chat.welcomeProject", { project: project.name })
      : t("devin.chat.welcomeDefault");
  }

  function renderConfig() {
    configbar.hidden = configOptions.length === 0 && !usage;
    configsHost.replaceChildren();
    for (const option of configOptions) {
      if (!Array.isArray(option.options) || option.options.length === 0) continue;
      const label = document.createElement("label");
      label.className = "dv-config";
      const caption = document.createElement("span");
      caption.textContent = option.name || (option.id === "model" ? t("devin.chat.modelLabel") : option.id);
      const select = document.createElement("select");
      select.dataset.devinConfig = option.id;
      select.setAttribute("aria-label", caption.textContent);
      for (const value of option.options) {
        const item = document.createElement("option");
        item.value = String(value.value);
        item.textContent = value.name || String(value.value);
        select.append(item);
      }
      if (option.currentValue !== undefined) select.value = String(option.currentValue);
      select.disabled = !sessionId || sending;
      select.addEventListener("change", () => void changeConfig(option, select));
      label.append(caption, select);
      configsHost.append(label);
    }
    usageLabel.textContent = usage && typeof usage.used === "number"
      ? t("devin.chat.usage", {
          used: formatNumber(usage.used),
          size: typeof usage.size === "number" ? formatNumber(usage.size) : String(usage.size ?? "")
        })
      : "";
  }

  async function changeConfig(option: ConfigOption, select: HTMLSelectElement) {
    if (!sessionId) return;
    const previous = option.currentValue;
    const value = select.value;
    try {
      await rpc("session/set_config_option", { sessionId, configId: option.id, value });
      option.currentValue = value;
    } catch (error) {
      notice = translateServerMessage(error instanceof Error ? error.message : String(error));
      if (previous !== undefined) select.value = String(previous);
    }
    render();
  }

  async function copyText(text: string) {
    await navigator.clipboard.writeText(text);
  }

  function messageRow(message: Message, streaming = false) {
    const row = document.createElement("article");
    row.className = `dv-message ${message.role}${streaming ? " streaming" : ""}`;
    if (message.code) row.dataset.code = message.code;
    const body = document.createElement("div");
    body.className = "dv-message-body";
    if (message.role === "assistant") renderChatMarkdown(body, message.text, text => void copyText(text));
    else body.textContent = message.text;
    row.append(body);
    if (message.role === "assistant" && !streaming && message.text) {
      const copy = document.createElement("button");
      copy.type = "button";
      copy.className = "dv-message-action";
      copy.textContent = t("common.copy");
      copy.addEventListener("click", () => {
        copyText(message.text)
          .then(() => { copy.textContent = t("common.copied"); })
          .catch(() => { copy.textContent = t("common.copyFailed"); });
      });
      row.append(copy);
    }
    return row;
  }

  const nearBottom = () => transcript.scrollHeight - transcript.scrollTop - transcript.clientHeight < 80;

  function renderMessages(stick = true) {
    welcome.hidden = messages.length > 0 || Boolean(sending || loading);
    const rows = messages.map(message => messageRow(message));
    if (streamThought) {
      const row = messageRow({ role: "thought", text: streamThought }, true);
      row.dataset.devinThought = "";
      rows.push(row);
    }
    if (streamText) {
      const row = messageRow({ role: "assistant", text: streamText }, true);
      row.dataset.devinLive = "";
      rows.push(row);
    } else if (sending || loading) {
      const row = document.createElement("article");
      row.className = "dv-message assistant streaming";
      row.dataset.devinLive = "";
      const wait = document.createElement("div");
      wait.className = "dv-thinking";
      wait.textContent = t("devin.chat.thinking");
      row.append(wait);
      rows.push(row);
    }
    list.replaceChildren(...rows);
    if (stick) transcript.scrollTop = transcript.scrollHeight;
  }

  function renderStatus() {
    if (sending) {
      const seconds = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
      const what = liveTool ? t("devin.chat.runningTool", { tool: liveTool }) : t("devin.chat.replying");
      status.textContent = t("devin.chat.statusWithSeconds", { what, seconds: formatNumber(seconds) });
    } else if (!online) {
      status.textContent = availabilityLabel(availabilityCode);
    } else {
      status.textContent = notice;
    }
    send.classList.toggle("stop", sending);
    send.innerHTML = sending ? SYSTEM_ICONS.stop : SYSTEM_ICONS.send;
    send.type = sending ? "button" : "submit";
    send.setAttribute("aria-label", sending ? t("devin.chat.stopAria") : t("devin.chat.sendAria"));
    send.disabled = sending ? false : !online || !input.value.trim();
    input.disabled = !online;
    form.setAttribute("aria-busy", String(sending));
  }

  function renderHistory() {
    historyList.replaceChildren();
    if (!sessions.length) {
      const empty = document.createElement("p");
      empty.className = "dv-history-empty";
      empty.textContent = t("devin.chat.emptyHistory");
      historyList.append(empty);
      return;
    }
    for (const session of sessions) {
      const open = document.createElement("button");
      open.type = "button";
      open.className = "dv-history-open";
      open.dataset.sessionId = session.sessionId;
      if (session.sessionId === sessionId) open.setAttribute("aria-current", "true");
      const title = document.createElement("strong");
      title.textContent = session.title || t("devin.chat.untitledSession");
      const meta = document.createElement("small");
      meta.textContent = session.updatedAt ? formatDateTime(session.updatedAt) : session.cwd || "";
      open.title = session.title || session.sessionId;
      open.append(title, meta);
      open.addEventListener("click", () => void selectSession(session.sessionId));
      historyList.append(open);
    }
  }

  function render() {
    renderAvailability();
    renderConfig();
    renderMessages();
    renderStatus();
    if (!sheet.hidden) renderHistory();
  }

  function setOverlay(openSheetUi: boolean) {
    sheet.hidden = !openSheetUi;
    scrim.hidden = !openSheetUi;
    for (const region of background) region.inert = openSheetUi;
    historyButton.setAttribute("aria-expanded", String(openSheetUi));
  }

  function openSheet() {
    if (!sheet.hidden) return;
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

  function flushStream() {
    if (streamUser) {
      messages.push({ role: "user", text: streamUser });
      streamUser = "";
    }
    if (streamThought) {
      messages.push({ role: "thought", text: streamThought });
      streamThought = "";
    }
    if (streamText) {
      messages.push({ role: "assistant", text: streamText });
      streamText = "";
    }
  }

  function flushUser() {
    if (!streamUser) return;
    messages.push({ role: "user", text: streamUser });
    streamUser = "";
  }

  function handleUpdate(params: Record<string, unknown>) {
    const updateSessionId = typeof params?.sessionId === "string" ? params.sessionId : "";
    if (updateSessionId && sessionId && updateSessionId !== sessionId) return;
    const update = (params?.update ?? {}) as Record<string, unknown>;
    const kind = String(update.sessionUpdate || "");
    const content = (update.content ?? {}) as Record<string, unknown>;
    const stick = nearBottom();
    if (kind === "agent_message_chunk") {
      flushUser();
      if (typeof content.text === "string") streamText += content.text;
    } else if (kind === "user_message_chunk") {
      if (typeof content.text === "string") streamUser += content.text;
    } else if (kind === "agent_thought_chunk") {
      if (typeof content.text === "string") streamThought += content.text;
    } else if (kind === "tool_call") {
      const id = String(update.toolCallId || update.title || "tool");
      liveTool = String(update.title || id);
      if (!toolMessages.has(id)) {
        const message: Message = { role: "tool", text: liveTool };
        toolMessages.set(id, message);
        messages.push(message);
      }
    } else if (kind === "tool_call_update") {
      const id = String(update.toolCallId || "");
      const message = toolMessages.get(id);
      const toolStatus = String(update.status || "");
      if (message && toolStatus) message.text = `${String(update.title || message.text)} · ${toolStatus}`;
      if (toolStatus === "completed" || toolStatus === "failed") liveTool = "";
    } else if (kind === "usage_update") {
      usage = {
        used: typeof update.used === "number" ? update.used : undefined,
        size: typeof update.size === "number" ? update.size : undefined
      };
      renderConfig();
    } else if (kind === "config_option_update") {
      if (Array.isArray(update.configOptions)) {
        configOptions = update.configOptions as ConfigOption[];
        renderConfig();
      }
    } else if (kind === "current_mode_update") {
      const mode = configOptions.find(option => option.id === "mode");
      if (mode && update.currentModeId !== undefined) mode.currentValue = String(update.currentModeId);
      renderConfig();
    } else if (kind === "session_info_update") {
      const session = sessions.find(item => item.sessionId === updateSessionId);
      if (session && typeof update.title === "string") session.title = update.title;
    }
    renderMessages(stick);
    renderStatus();
  }

  function closeEvents() {
    if (reconnectTimer !== null) {
      window.clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    events?.close();
    events = null;
  }

  function scheduleReconnect() {
    if (!shouldScheduleReconnect(online, reconnectTimer !== null)) return;
    const delay = reconnectDelay(reconnectAttempts);
    reconnectAttempts += 1;
    status.textContent = t("devin.chat.reconnecting");
    reconnectTimer = window.setTimeout(() => {
      reconnectTimer = null;
      connectEvents();
    }, delay);
  }

  function connectEvents() {
    if (!shouldOpenEventSource(online, Boolean(events))) return;
    const source = new EventSource("/api/devin/events");
    events = source;
    source.addEventListener("ready", () => {
      reconnectAttempts = 0;
      renderStatus();
    });
    source.addEventListener("notification", event => {
      try {
        const payload = JSON.parse((event as MessageEvent).data);
        if (payload?.method === "session/update") handleUpdate(payload.params ?? {});
      } catch { /* ignore malformed frames */ }
    });
    source.addEventListener("offline", () => {
      setOnline(false);
    });
    source.addEventListener("error", () => {
      if (events === source) events = null;
      source.close();
      scheduleReconnect();
    });
  }

  function setOnline(next: boolean, noticeText = "", code = "") {
    online = Boolean(next);
    availabilityCode = next ? "" : code;
    availabilityNotice = next ? "" : noticeText;
    if (!online) closeEvents();
    render();
  }

  async function refreshSessions() {
    try {
      const result = await rpc<{ sessions?: DevinSession[] }>("session/list", {});
      if (Array.isArray(result?.sessions)) sessions = result.sessions;
    } catch {
      notice = t("devin.chat.sessionsLoadFailed");
    }
  }

  async function createSession(): Promise<boolean> {
    try {
      const cwd = sessionCwd();
      const result = await rpc<{ sessionId: string; configOptions?: ConfigOption[] }>(
        "session/new",
        cwd ? { cwd, mcpServers: [] } : { mcpServers: [] }
      );
      sessionId = result.sessionId;
      configOptions = Array.isArray(result.configOptions) ? result.configOptions : [];
      void refreshSessions().then(() => renderHistory());
      return true;
    } catch (error) {
      notice = translateServerMessage(error instanceof Error ? error.message : String(error)) || t("devin.chat.sessionCreateFailed");
      return false;
    }
  }

  async function selectSession(id: string) {
    closeSheet();
    if (id === sessionId || sending) return;
    sessionId = id;
    messages = [];
    streamText = "";
    streamThought = "";
    streamUser = "";
    toolMessages.clear();
    loading = true;
    render();
    try {
      // Past session/update notifications replay over SSE while this runs.
      await rpc("session/load", { sessionId: id });
      flushStream();
    } catch (error) {
      messages.push({ role: "error", text: translateServerMessage(error instanceof Error ? error.message : String(error)) || t("devin.chat.loadFailed") });
    } finally {
      loading = false;
      render();
    }
  }

  function startNewSession() {
    if (sending) void stopRun();
    sessionId = null;
    configOptions = [];
    messages = [];
    streamText = "";
    streamThought = "";
    streamUser = "";
    liveTool = "";
    toolMessages.clear();
    usage = null;
    notice = "";
    render();
    input.focus({ preventScroll: true });
  }

  async function stopRun() {
    if (!sending || !sessionId) return;
    try {
      await fetch("/api/devin/notify", {
        method: "POST",
        headers: requestHeaders(),
        body: JSON.stringify({ method: "session/cancel", params: { sessionId } })
      });
    } catch { /* the prompt request may still settle on its own */ }
  }

  function finishTurn(extra: Message[]) {
    flushStream();
    messages.push(...extra);
    sending = false;
    liveTool = "";
    window.clearInterval(tick);
    render();
  }

  async function submit() {
    const prompt = input.value.trim();
    if (!prompt || sending || !online) return;
    notice = "";
    if (!sessionId) {
      const created = await createSession();
      if (!created) { render(); return; }
    }
    messages.push({ role: "user", text: prompt });
    input.value = "";
    resizeInput();
    sending = true;
    startedAt = Date.now();
    streamText = "";
    streamThought = "";
    liveTool = "";
    tick = window.setInterval(renderStatus, 1000);
    render();
    try {
      // The response only arrives when the turn ends; chunks stream over SSE.
      await rpc("session/prompt", { sessionId, prompt: [{ type: "text", text: prompt }] });
      finishTurn(streamText || streamThought ? [] : [{ role: "assistant", text: t("devin.chat.emptyReply") }]);
    } catch (error) {
      finishTurn([{ role: "error", text: translateServerMessage(error instanceof Error ? error.message : String(error)) || t("devin.chat.connectionClosed") }]);
    }
  }

  async function refresh() {
    try {
      const res = await fetch("/api/devin/health", { cache: "no-store", headers: requestHeaders() });
      const payload = (await res.json().catch(() => ({}))) as DevinHealth;
      health = payload;
      if (payload?.online) {
        online = true;
        availabilityCode = "";
        availabilityNotice = "";
        try {
          const projectRes = await fetch("/api/projects", { cache: "no-store", headers: requestHeaders() });
          const projectPayload = await projectRes.json().catch(() => ({}));
          if (projectRes.ok && Array.isArray(projectPayload?.projects)) projects = projectPayload.projects;
        } catch { /* keep the last known list */ }
        await refreshSessions();
        render();
        connectEvents();
        return;
      }
      setOnline(false, String(payload?.error || ""), String(payload?.code || ""));
    } catch {
      health = null;
      setOnline(false);
    }
  }

  function resizeInput() {
    input.style.height = "auto";
    input.style.height = `${Math.min(input.scrollHeight, 180)}px`;
  }

  historyButton.addEventListener("click", () => (sheet.hidden ? openSheet() : closeSheet()));
  newButton.addEventListener("click", startNewSession);
  scrim.addEventListener("click", closeSheet);
  send.addEventListener("click", event => {
    if (sending) {
      event.preventDefault();
      void stopRun();
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
    }
  });
  window.addEventListener("devmoter:global-nav-opened", closeSheet);
  window.addEventListener("devmoter:surface-changed", closeSheet);
  window.addEventListener("devmoter:backend-changed", event => {
    if ((event as CustomEvent<{ backend?: string }>).detail?.backend === "devin") void refresh();
  });

  render();
  resizeInput();
  return { refresh, setOnline };
}
