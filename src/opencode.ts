import { isExecutionActive, openCodeIdleOutcomeToExecutionState, type ExecutionState } from "./execution-state.mjs";
import { speechRecognitionLanguage } from "./i18n";
import { mergeOpenCodeStreamText, normalizeOpenCodeEvent } from "./opencode-event-compat.mjs";
import { reconnectDelay, shouldOpenEventSource, shouldScheduleReconnect } from "./reconnect-policy.mjs";

const FOLLOW_BOTTOM_THRESHOLD = 48;

type Json = Record<string, any>;

type OpenCodeModel = {
  id: string;
  name?: string;
};

type OpenCodeProvider = {
  id: string;
  name?: string;
  models?: Record<string, Json> | Json[];
};

type OpenCodeAgent = {
  id: string;
  description?: string;
  mode?: "primary" | "subagent" | "all";
  hidden?: boolean;
  model?: {
    providerID?: string;
    modelID?: string;
  };
};

type OpenCodeCommand = {
  name: string;
  template: string;
  description?: string;
  agent?: string;
  model?: {
    providerID?: string;
    modelID?: string;
  };
};

type PendingAttachment = {
  id: string;
  name: string;
  type: string;
  kind: "image" | "file";
  dataUrl?: string;
  path: string;
  size: number;
};

type OpenCodeSkill = {
  name: string;
  description?: string;
  slash?: boolean;
  location?: string;
};

type OpenCodeSession = {
  id: string;
  title?: string;
  agent?: string;
  model?: {
    providerID?: string;
    modelID?: string;
    id?: string;
  };
  location?: {
    directory?: string;
  } | string;
  time?: {
    created?: number;
    updated?: number;
  };
  tokens?: {
    input?: number;
    output?: number;
    reasoning?: number;
    cache?: {
      read?: number;
      write?: number;
    };
  };
  cost?: number;
};

type PendingPermission = {
  id: string;
  sessionID: string;
  action?: string;
  resources?: string[];
  save?: string[];
  metadata?: Json;
};

type QuestionInfo = {
  header?: string;
  question: string;
  options?: Array<{
    label: string;
    description?: string;
  }>;
  multiple?: boolean;
  custom?: boolean;
};

type PendingQuestion = {
  id: string;
  sessionID: string;
  questions: QuestionInfo[];
};

type OpenCodeRemoteOptions = {
  onCodex?: () => void;
  onIntegrations?: () => void;
};

export type OpenCodeController = {
  setOnline(online: boolean): void;
  refresh(): Promise<void>;
};

export function mountOpenCodeRemote(
  root: HTMLElement,
  options: OpenCodeRemoteOptions = {}
): OpenCodeController {
  root.innerHTML = `
    <div class="ocx-app">
      <div id="ocxScrim" class="ocx-scrim hidden"></div>

      <aside id="ocxSidebar" class="ocx-sidebar" aria-hidden="true">
        <div class="ocx-sidebar-head">
          <div>
            <strong>OpenCode</strong>
            <small id="ocxSidebarDirectory">workspace</small>
          </div>
          <button id="ocxSidebarClose" class="ocx-icon" type="button" aria-label="閉じる">×</button>
        </div>

        <button id="ocxNewSessionSide" class="ocx-new-session" type="button">
          <span>＋</span>
          <span>New session</span>
        </button>

        <label class="ocx-search">
          <span>⌕</span>
          <input id="ocxSessionSearch" type="search" placeholder="Search sessions" />
        </label>

        <nav class="ocx-side-nav">
          <button id="ocxAgentsNav" type="button"><span>◈</span><span>Agents</span></button>
          <button id="ocxCommandsNav" type="button"><span>／</span><span>Commands</span></button>
          <button id="ocxSkillsNav" type="button"><span>✦</span><span>Skills</span></button>
          <button id="ocxModelsNav" type="button"><span>◇</span><span>Models</span></button>
          <button id="ocxCodexNav" type="button"><span>⌘</span><span>Codex UI</span></button>
          <button id="ocxIntegrationsNav" type="button"><span>⌁</span><span>Integrations</span></button>
        </nav>

        <div class="ocx-side-section">
          <div class="ocx-side-label">SESSIONS</div>
          <div id="ocxSessions" class="ocx-sessions">
            <div class="ocx-empty">Connecting…</div>
          </div>
        </div>

        <div class="ocx-sidebar-foot">
          <label class="pocket-language-setting ocx-language-setting" title="Language">
            <span aria-hidden="true">◎</span>
            <select data-language-select aria-label="Language">
              <option value="en">English</option>
              <option value="ja">日本語</option>
              <option value="zh-CN">简体中文</option>
            </select>
          </label>
          <button id="ocxRefresh" type="button" class="ocx-refresh">↻ Refresh</button>
          <span id="ocxSideStatus" class="ocx-side-status offline"><i></i> Offline</span>
        </div>
      </aside>

      <header class="ocx-topbar">
        <button id="ocxMenu" class="ocx-icon" type="button" aria-label="メニュー">☰</button>

        <button id="ocxSessionTitleButton" class="ocx-session-title" type="button">
          <strong id="ocxSessionTitle">OpenCode</strong>
          <small id="ocxSessionMeta">No session</small>
        </button>

        <button id="ocxNewSessionTop" class="ocx-icon" type="button" aria-label="新規セッション">＋</button>
      </header>

      <main class="ocx-main">
        <div id="ocxTranscript" class="ocx-transcript">
          <div class="ocx-welcome">
            <div class="ocx-mark">></div>
            <h2>What do you want to build?</h2>
            <p>OpenCode is running on your Chromebook.</p>
            <div class="ocx-welcome-hints">
              <button type="button" data-hint="plan">Plan first</button>
              <button type="button" data-hint="build">Start building</button>
              <button type="button" data-hint="command">/ commands</button>
            </div>
          </div>
        </div>
      </main>

      <section id="ocxPermission" class="ocx-dock ocx-permission hidden">
        <div class="ocx-dock-copy">
          <span class="ocx-eyebrow">PERMISSION REQUIRED</span>
          <strong id="ocxPermissionTitle">OpenCode wants permission</strong>
          <pre id="ocxPermissionDetail"></pre>
        </div>
        <div class="ocx-dock-actions three">
          <button id="ocxPermissionReject" type="button">Reject</button>
          <button id="ocxPermissionOnce" type="button">Allow once</button>
          <button id="ocxPermissionAlways" class="primary" type="button">Always allow</button>
        </div>
      </section>

      <section id="ocxQuestion" class="ocx-dock ocx-question hidden">
        <div class="ocx-dock-copy">
          <span class="ocx-eyebrow">OPENCode QUESTION</span>
          <strong id="ocxQuestionHeader">Question</strong>
          <p id="ocxQuestionText"></p>
          <div id="ocxQuestionOptions" class="ocx-question-options"></div>
          <input id="ocxQuestionCustom" class="ocx-question-custom hidden" type="text" placeholder="Type another answer…" />
        </div>
        <div class="ocx-dock-actions">
          <button id="ocxQuestionReject" type="button">Skip</button>
          <button id="ocxQuestionSubmit" class="primary" type="button">Submit</button>
        </div>
      </section>

      <section class="ocx-composer-wrap">
        <div id="ocxSlashPalette" class="ocx-slash-palette hidden"></div>

        <div class="ocx-context-row">
          <div class="ocx-mode-switch" role="group" aria-label="agent mode">
            <button id="ocxPlanMode" type="button">Plan</button>
            <button id="ocxAskMode" type="button">Ask</button>
            <button id="ocxBuildMode" type="button" class="active">Build</button>
          </div>

          <div class="ocx-context-buttons">
            <button id="ocxAgentButton" type="button" class="ocx-context-button">agent</button>
            <button id="ocxModelButton" type="button" class="ocx-context-button">model</button>
          </div>
        </div>

        <form id="ocxPromptForm" class="ocx-composer">
          <div id="ocxAttachmentStrip" class="ocx-attachment-strip hidden"></div>
          <textarea
            id="ocxPromptInput"
            rows="1"
            placeholder="Message OpenCode…"
            aria-label="OpenCodeへの指示"
            disabled
          ></textarea>

          <div class="ocx-composer-foot">
            <div class="ocx-composer-left">
              <button id="ocxPlus" type="button" class="ocx-mini-button" aria-label="添付">＋</button>
              <button id="ocxSlashButton" type="button" class="ocx-mini-button">/</button>
              <span id="ocxActivity" class="ocx-activity">offline</span>
            </div>
            <div class="ocx-composer-actions">
              <button id="ocxVoice" type="button" class="ocx-mini-button" aria-label="音声入力">♩</button>
              <button id="ocxSend" class="ocx-send" type="submit" disabled>↵</button>
            </div>
          </div>
        </form>
        <div id="ocxAttachmentMenu" class="ocx-attachment-menu hidden">
          <button id="ocxImageButton" type="button">▧ 画像</button>
          <button id="ocxFileButton" type="button">⌑ ファイル</button>
        </div>
        <input id="ocxImageInput" type="file" accept="image/*" multiple hidden />
        <input id="ocxFileInput" type="file" multiple hidden />
      </section>

      <div id="ocxToast" class="ocx-toast hidden" role="status" aria-live="polite"></div>

      <div id="ocxModal" class="ocx-modal hidden" role="dialog" aria-modal="true">
        <div class="ocx-modal-card">
          <div class="ocx-modal-head">
            <div>
              <strong id="ocxModalTitle">OpenCode</strong>
              <p id="ocxModalSubtitle"></p>
            </div>
            <button id="ocxModalClose" class="ocx-icon" type="button">×</button>
          </div>
          <div id="ocxModalBody" class="ocx-modal-body"></div>
        </div>
      </div>
    </div>
  `;

  const sidebar = root.querySelector<HTMLElement>("#ocxSidebar")!;
  const scrim = root.querySelector<HTMLElement>("#ocxScrim")!;
  const sidebarDirectory = root.querySelector<HTMLElement>("#ocxSidebarDirectory")!;
  const sidebarClose = root.querySelector<HTMLButtonElement>("#ocxSidebarClose")!;
  const menu = root.querySelector<HTMLButtonElement>("#ocxMenu")!;
  const newSessionSide = root.querySelector<HTMLButtonElement>("#ocxNewSessionSide")!;
  const newSessionTop = root.querySelector<HTMLButtonElement>("#ocxNewSessionTop")!;
  const sessionSearch = root.querySelector<HTMLInputElement>("#ocxSessionSearch")!;
  const sessionsEl = root.querySelector<HTMLDivElement>("#ocxSessions")!;
  const agentsNav = root.querySelector<HTMLButtonElement>("#ocxAgentsNav")!;
  const commandsNav = root.querySelector<HTMLButtonElement>("#ocxCommandsNav")!;
  const skillsNav = root.querySelector<HTMLButtonElement>("#ocxSkillsNav")!;
  const modelsNav = root.querySelector<HTMLButtonElement>("#ocxModelsNav")!;
  const codexNav = root.querySelector<HTMLButtonElement>("#ocxCodexNav")!;
  const integrationsNav = root.querySelector<HTMLButtonElement>("#ocxIntegrationsNav")!;
  const refreshButton = root.querySelector<HTMLButtonElement>("#ocxRefresh")!;
  const sideStatus = root.querySelector<HTMLElement>("#ocxSideStatus")!;
  const sessionTitleButton = root.querySelector<HTMLButtonElement>("#ocxSessionTitleButton")!;
  const sessionTitle = root.querySelector<HTMLElement>("#ocxSessionTitle")!;
  const sessionMeta = root.querySelector<HTMLElement>("#ocxSessionMeta")!;
  const transcript = root.querySelector<HTMLDivElement>("#ocxTranscript")!;
  let followsBottom = true;
  const followLatest = () => {
    if (followsBottom) transcript.scrollTop = transcript.scrollHeight;
  };
  transcript.addEventListener("scroll", () => {
    followsBottom = transcript.scrollHeight - transcript.scrollTop - transcript.clientHeight <= FOLLOW_BOTTOM_THRESHOLD;
  }, { passive: true });

  const TRANSCRIPT_NODE_LIMIT = 400;
  function trimTranscript() {
    if (transcript.childElementCount <= TRANSCRIPT_NODE_LIMIT) return;

    const liveRows = new Set(
      [...liveText.values(), ...liveReasoning.values()]
        .map(node => node.closest(".ocx-message-row, .ocx-reasoning"))
        .filter((node): node is Element => Boolean(node))
    );

    let candidate = transcript.firstElementChild;
    while (transcript.childElementCount > TRANSCRIPT_NODE_LIMIT && candidate) {
      const next = candidate.nextElementSibling;
      if (!liveRows.has(candidate)) candidate.remove();
      candidate = next;
    }
  }
  const permission = root.querySelector<HTMLElement>("#ocxPermission")!;
  const permissionTitle = root.querySelector<HTMLElement>("#ocxPermissionTitle")!;
  const permissionDetail = root.querySelector<HTMLElement>("#ocxPermissionDetail")!;
  const permissionReject = root.querySelector<HTMLButtonElement>("#ocxPermissionReject")!;
  const permissionOnce = root.querySelector<HTMLButtonElement>("#ocxPermissionOnce")!;
  const permissionAlways = root.querySelector<HTMLButtonElement>("#ocxPermissionAlways")!;
  const questionDock = root.querySelector<HTMLElement>("#ocxQuestion")!;
  const questionHeader = root.querySelector<HTMLElement>("#ocxQuestionHeader")!;
  const questionText = root.querySelector<HTMLElement>("#ocxQuestionText")!;
  const questionOptions = root.querySelector<HTMLDivElement>("#ocxQuestionOptions")!;
  const questionCustom = root.querySelector<HTMLInputElement>("#ocxQuestionCustom")!;
  const questionReject = root.querySelector<HTMLButtonElement>("#ocxQuestionReject")!;
  const questionSubmit = root.querySelector<HTMLButtonElement>("#ocxQuestionSubmit")!;
  const planMode = root.querySelector<HTMLButtonElement>("#ocxPlanMode")!;
  const askMode = root.querySelector<HTMLButtonElement>("#ocxAskMode")!;
  const buildMode = root.querySelector<HTMLButtonElement>("#ocxBuildMode")!;
  const agentButton = root.querySelector<HTMLButtonElement>("#ocxAgentButton")!;
  const modelButton = root.querySelector<HTMLButtonElement>("#ocxModelButton")!;
  const slashPalette = root.querySelector<HTMLDivElement>("#ocxSlashPalette")!;
  const promptForm = root.querySelector<HTMLFormElement>("#ocxPromptForm")!;
  const promptInput = root.querySelector<HTMLTextAreaElement>("#ocxPromptInput")!;
  const plus = root.querySelector<HTMLButtonElement>("#ocxPlus")!;
  const voice = root.querySelector<HTMLButtonElement>("#ocxVoice")!;
  const attachmentStrip = root.querySelector<HTMLDivElement>("#ocxAttachmentStrip")!;
  const attachmentMenu = root.querySelector<HTMLDivElement>("#ocxAttachmentMenu")!;
  const imageButton = root.querySelector<HTMLButtonElement>("#ocxImageButton")!;
  const fileButton = root.querySelector<HTMLButtonElement>("#ocxFileButton")!;
  const imageInput = root.querySelector<HTMLInputElement>("#ocxImageInput")!;
  const fileInput = root.querySelector<HTMLInputElement>("#ocxFileInput")!;
  const slashButton = root.querySelector<HTMLButtonElement>("#ocxSlashButton")!;
  const activity = root.querySelector<HTMLElement>("#ocxActivity")!;
  const send = root.querySelector<HTMLButtonElement>("#ocxSend")!;
  const toast = root.querySelector<HTMLDivElement>("#ocxToast")!;
  const modal = root.querySelector<HTMLDivElement>("#ocxModal")!;
  const modalTitle = root.querySelector<HTMLElement>("#ocxModalTitle")!;
  const modalSubtitle = root.querySelector<HTMLElement>("#ocxModalSubtitle")!;
  const modalBody = root.querySelector<HTMLDivElement>("#ocxModalBody")!;
  const modalClose = root.querySelector<HTMLButtonElement>("#ocxModalClose")!;

  let online = false;
  let executionState: ExecutionState = "offline";
  let providers: OpenCodeProvider[] = [];
  let providerDefaults: Record<string, string> = {};
  let connectedProviders = new Set<string>();
  let agents: OpenCodeAgent[] = [];
  let commands: OpenCodeCommand[] = [];
  let skills: OpenCodeSkill[] = [];
  let sessions: OpenCodeSession[] = [];
  let activeSession: OpenCodeSession | null = null;
  let eventSource: EventSource | null = null;
  let reconnectTimer: number | null = null;
  let reconnectAttempts = 0;
  let refreshTimer: number | null = null;
  let liveFallbackTimer: number | null = null;
  let lastLiveEventAt = 0;
  let toastTimer: number | null = null;
  let pendingPermission: PendingPermission | null = null;
  let pendingQuestion: PendingQuestion | null = null;
  let questionAnswers: Array<Set<string>> = [];
  let contextExecutionState: ExecutionState | null = null;
  const liveText = new Map<string, HTMLElement>();
  const liveReasoning = new Map<string, HTMLElement>();
  const livePartKinds = new Map<string, "text" | "reasoning">();
  let directory = "";
  type AgentMode = "plan" | "ask" | "build";
  let selectedAgent =
    localStorage.getItem("opencode-pocket-opencode-agent") || "build";
  let selectedMode: AgentMode =
    localStorage.getItem("opencode-pocket-opencode-mode") === "plan"
      ? "plan"
      : localStorage.getItem("opencode-pocket-opencode-mode") === "ask"
        ? "ask"
        : "build";
  let selectedModel: { providerID: string; modelID: string } | null = null;
  let pendingAttachments: PendingAttachment[] = [];

  try {
    const saved = JSON.parse(localStorage.getItem("opencode-pocket-model") || "null");
    if (saved?.providerID && saved?.modelID) {
      selectedModel = {
        providerID: String(saved.providerID),
        modelID: String(saved.modelID)
      };
    }
  } catch {
    selectedModel = null;
  }

  function openSidebar() {
    sidebar.classList.add("open");
    sidebar.setAttribute("aria-hidden", "false");
    scrim.classList.remove("hidden");
  }

  function closeSidebar() {
    sidebar.classList.remove("open");
    sidebar.setAttribute("aria-hidden", "true");
    scrim.classList.add("hidden");
  }

  function openModal(title: string, subtitle = "") {
    modalTitle.textContent = title;
    modalSubtitle.textContent = subtitle;
    modal.classList.remove("hidden");
  }

  function closeModal() {
    modal.classList.add("hidden");
  }

  function showToast(message: string) {
    if (toastTimer !== null) window.clearTimeout(toastTimer);
    toast.textContent = message;
    toast.classList.remove("hidden");
    requestAnimationFrame(() => toast.classList.add("show"));
    toastTimer = window.setTimeout(() => {
      toast.classList.remove("show");
      window.setTimeout(() => toast.classList.add("hidden"), 180);
      toastTimer = null;
    }, 1600);
  }

  function setActivity(value: string, state = value) {
    activity.textContent = value;
    activity.dataset.state = state;
  }

  function executionLabel(state: ExecutionState) {
    switch (state) {
      case "offline": return "offline";
      case "reconnecting": return "reconnecting";
      case "idle": return "ready";
      case "running": return "working";
      case "waiting_for_approval": return "permission";
      case "waiting_for_input": return "input";
      case "completed": return "completed";
      case "failed": return "failed";
      case "interrupted": return "interrupted";
    }
  }

  function setExecutionState(next: ExecutionState) {
    executionState = next;
    const active = isExecutionActive(next);

    send.textContent = active ? "■" : "↵";
    send.classList.toggle("stop", active);
    send.setAttribute("aria-label", active ? "Stop" : "Send");
    send.disabled = !online || next === "reconnecting";
    setActivity(executionLabel(next), next);

    if (active) startLiveFallback();
    else stopLiveFallback();
  }

  function setControlsEnabled(value: boolean) {
    promptInput.disabled = !value;
    send.disabled = !value;
    newSessionSide.disabled = !value;
    newSessionTop.disabled = !value;
    planMode.disabled = !value;
    askMode.disabled = !value;
    buildMode.disabled = !value;
    agentButton.disabled = !value;
    modelButton.disabled = !value;
    slashButton.disabled = !value;
  }

  function operationId() {
    return globalThis.crypto?.randomUUID?.() ??
      `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  }

  async function api<T = Json>(
    path: string,
    init: RequestInit = {},
    options: { operationId?: string } = {}
  ): Promise<T> {
    const method = String(init.method || "GET").toUpperCase();
    const mutating = method !== "GET" && method !== "HEAD";
    const opId = mutating ? (options.operationId || operationId()) : "";
    let res: Response;

    try {
      res = await fetch(`/api/opencode${path}`, {
        ...init,
        headers: {
          ...(init.body ? { "content-type": "application/json" } : {}),
          ...(init.headers || {}),
          ...(opId ? { "x-pocket-operation-id": opId } : {}),
          ...(localStorage.getItem("opencode-pocket-project") ? { "x-pocket-project-id": localStorage.getItem("opencode-pocket-project")! } : {})
        },
        cache: method === "GET" ? "no-store" : undefined
      });
    } catch (error) {
      if (mutating) {
        throw new Error(
          `Mutation outcome is unknown (operation ${opId}). DevMoter did not retry it automatically.`,
          { cause: error }
        );
      }
      throw error;
    }

    if (res.status === 204) return undefined as T;

    const text = await res.text();
    const contentType = res.headers.get("content-type") || "";
    let payload: any;

    if (text) {
      try {
        payload = JSON.parse(text);
      } catch {
        const preview = text.slice(0, 180).replace(/\s+/g, " ");
        throw new Error(
          `OpenCode API returned non-JSON (HTTP ${res.status}, ${contentType || "unknown"}): ${preview}`
        );
      }
    }

    if (!res.ok) {
      if (payload?.duplicate) {
        throw new Error(
          `Operation ${payload?.operationId || opId} was already seen; the duplicate send was suppressed and the earlier outcome is unknown.`
        );
      }
      const message =
        payload?.error?.data?.message ||
        payload?.error?.message ||
        (typeof payload?.error === "string" ? payload.error : "") ||
        payload?.message ||
        `OpenCode HTTP ${res.status}`;
      throw new Error(message);
    }

    if (
      payload &&
      typeof payload === "object" &&
      !Array.isArray(payload) &&
      Object.prototype.hasOwnProperty.call(payload, "data")
    ) {
      return payload.data as T;
    }

    return payload as T;
  }

  function normalizeModels(provider: OpenCodeProvider): OpenCodeModel[] {
    const raw = provider.models;
    if (!raw) return [];

    if (Array.isArray(raw)) {
      return raw
        .map((model: Json) => ({
          id: String(model.id ?? model.modelID ?? ""),
          name: String(model.name ?? model.id ?? model.modelID ?? "")
        }))
        .filter(model => model.id);
    }

    return Object.entries(raw)
      .map(([id, model]) => ({
        id,
        name: String((model as Json)?.name ?? id)
      }))
      .sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id));
  }

  function currentModelName() {
    if (!selectedModel) return "default";
    const provider = providers.find(item => item.id === selectedModel?.providerID);
    const model = provider
      ? normalizeModels(provider).find(item => item.id === selectedModel?.modelID)
      : null;
    return model?.name || selectedModel.modelID;
  }

  function currentAgentName() {
    return selectedAgent || "build";
  }

  function sessionModes() {
    try {
      const parsed = JSON.parse(localStorage.getItem("opencode-pocket-opencode-session-modes") || "{}");
      return parsed && typeof parsed === "object" ? parsed as Record<string, AgentMode> : {};
    } catch {
      return {} as Record<string, AgentMode>;
    }
  }

  function persistMode(mode: AgentMode) {
    selectedMode = mode;
    localStorage.setItem("opencode-pocket-opencode-mode", mode);
    if (!activeSession?.id) return;
    const modes = sessionModes();
    modes[activeSession.id] = mode;
    localStorage.setItem("opencode-pocket-opencode-session-modes", JSON.stringify(modes));
  }

  function modeForSession(session: OpenCodeSession): AgentMode {
    const saved = sessionModes()[session.id];
    if (saved === "plan" || saved === "ask" || saved === "build") return saved;
    return session.agent === "plan" ? "plan" : "build";
  }

  function updateContextUI() {
    agentButton.textContent = currentAgentName();
    modelButton.textContent = currentModelName();

    planMode.classList.toggle("active", selectedMode === "plan");
    askMode.classList.toggle("active", selectedMode === "ask");
    buildMode.classList.toggle("active", selectedMode === "build");

    const meta = [
      activeSession?.agent || selectedAgent || "build",
      activeSession?.model?.modelID || activeSession?.model?.id || selectedModel?.modelID || "default"
    ].filter(Boolean);
    sessionMeta.textContent = activeSession ? meta.join(" · ") : "No session";
  }

  function resizeComposer() {
    promptInput.style.height = "auto";
    promptInput.style.height = `${Math.min(promptInput.scrollHeight, 180)}px`;
  }

  function sessionDirectory(session: OpenCodeSession | null) {
    if (!session) return directory;
    if (typeof session.location === "string") return session.location;
    return session.location?.directory || directory;
  }

  function renderSessions() {
    const q = sessionSearch.value.trim().toLowerCase();
    const sorted = [...sessions]
      .sort((a, b) => (b.time?.updated ?? 0) - (a.time?.updated ?? 0))
      .filter(session =>
        !q ||
        (session.title || "").toLowerCase().includes(q) ||
        session.id.toLowerCase().includes(q)
      )
      .slice(0, 80);

    sessionsEl.replaceChildren();

    if (!sorted.length) {
      const empty = document.createElement("div");
      empty.className = "ocx-empty";
      empty.textContent = q ? "No matching sessions" : "No sessions yet";
      sessionsEl.appendChild(empty);
      return;
    }

    for (const session of sorted) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "ocx-session-row";
      if (session.id === activeSession?.id) button.classList.add("active");

      const copy = document.createElement("span");
      copy.className = "ocx-session-copy";

      const title = document.createElement("strong");
      title.textContent = session.title || "Untitled session";

      const meta = document.createElement("small");
      meta.textContent = session.agent || "session";

      copy.append(title, meta);

      const dot = document.createElement("span");
      dot.className = "ocx-session-dot";
      dot.textContent = session.id === activeSession?.id ? "●" : "";

      button.append(copy, dot);
      button.addEventListener("click", () => void selectSession(session));
      sessionsEl.appendChild(button);
    }
  }

  function addMetaLine(text: string) {
    const row = document.createElement("div");
    row.className = "ocx-meta-line";
    row.textContent = text;
    transcript.appendChild(row);
    trimTranscript();
    return row;
  }

  function addUserMessage(text: string) {
    transcript.querySelector(".ocx-welcome")?.remove();
    const row = document.createElement("div");
    row.className = "ocx-message-row user";

    const prompt = document.createElement("div");
    prompt.className = "ocx-user-prompt";

    const glyph = document.createElement("span");
    glyph.textContent = "›";

    const body = document.createElement("div");
    body.textContent = text;

    prompt.append(glyph, body);
    row.appendChild(prompt);
    transcript.appendChild(row);
    trimTranscript();
  }

  function addAssistantText(text: string) {
    if (!text.trim()) return;
    transcript.querySelector(".ocx-welcome")?.remove();

    const row = document.createElement("div");
    row.className = "ocx-message-row assistant";

    const body = document.createElement("div");
    body.className = "ocx-assistant-text";
    body.textContent = text;

    row.appendChild(body);
    transcript.appendChild(row);
    trimTranscript();
  }

  function toolStateSummary(part: Json) {
    const state = part?.state ?? {};
    const status = String(state?.status || "tool");
    const name = String(part?.name || "tool");
    return `${status === "completed" ? "✓" : status === "error" ? "!" : status === "running" ? "●" : "·"} ${name}`;
  }

  function addToolPart(part: Json) {
    transcript.querySelector(".ocx-welcome")?.remove();

    const details = document.createElement("details");
    details.className = `ocx-tool-card ${String(part?.state?.status || "pending")}`;

    const summary = document.createElement("summary");
    summary.textContent = toolStateSummary(part);

    const content = document.createElement("div");
    content.className = "ocx-tool-content";

    const state = part?.state ?? {};
    const input = state?.input;
    const result =
      state?.result ??
      state?.structured ??
      state?.error ??
      state?.content ??
      null;

    function appendPayload(label: string, value: Json) {
      const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
      const block = document.createElement("section");
      block.className = "ocx-tool-block";

      const toolbar = document.createElement("div");
      toolbar.className = "ocx-tool-toolbar";

      const payloadLabel = document.createElement("span");
      payloadLabel.className = "ocx-tool-label";
      payloadLabel.textContent = label;

      const actions = document.createElement("span");
      actions.className = "ocx-tool-actions";

      const wrap = document.createElement("button");
      wrap.type = "button";
      wrap.textContent = "No wrap";
      wrap.setAttribute("aria-pressed", "false");

      const copy = document.createElement("button");
      copy.type = "button";
      copy.textContent = "Copy";

      const pre = document.createElement("pre");
      pre.textContent = text;

      wrap.addEventListener("click", () => {
        const nowrap = pre.classList.toggle("nowrap");
        wrap.textContent = nowrap ? "Wrap" : "No wrap";
        wrap.setAttribute("aria-pressed", String(nowrap));
      });

      copy.addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(text);
          copy.textContent = "Copied";
        } catch {
          const helper = document.createElement("textarea");
          helper.value = text;
          helper.style.position = "fixed";
          helper.style.opacity = "0";
          document.body.appendChild(helper);
          helper.select();
          document.execCommand("copy");
          helper.remove();
          copy.textContent = "Copied";
        }
        window.setTimeout(() => {
          copy.textContent = "Copy";
        }, 1200);
      });

      actions.append(wrap, copy);
      toolbar.append(payloadLabel, actions);
      block.append(toolbar, pre);
      content.appendChild(block);
    }

    if (input !== undefined) appendPayload("input", input);
    if (result !== null && result !== undefined) appendPayload("output", result);

    details.append(summary, content);
    transcript.appendChild(details);
    trimTranscript();
  }

  function addReasoning(text: string) {
    if (!text.trim()) return;
    const details = document.createElement("details");
    details.className = "ocx-reasoning";

    const summary = document.createElement("summary");
    summary.textContent = "Thinking";

    const body = document.createElement("div");
    body.textContent = text;

    details.append(summary, body);
    transcript.appendChild(details);
    trimTranscript();
  }

  function streamKey(data: Json) {
    const part = data?.part ?? data;
    const messageID =
      part?.assistantMessageID ??
      part?.messageID ??
      data?.assistantMessageID ??
      data?.messageID ??
      "assistant";
    const partID =
      part?.id ??
      part?.partID ??
      data?.partID ??
      data?.ordinal ??
      0;
    return `${String(messageID)}:${String(partID)}`;
  }

  const LIVE_STREAM_PROTECTION_LIMIT = 16;

  function retireLiveStream(key: string) {
    liveText.delete(key);
    liveReasoning.delete(key);
    livePartKinds.delete(key);
  }

  function boundLiveStreams() {
    const keys = [...new Set([...liveText.keys(), ...liveReasoning.keys()])];
    const excess = Math.max(0, keys.length - LIVE_STREAM_PROTECTION_LIMIT);
    for (const key of keys.slice(0, excess)) retireLiveStream(key);
    trimTranscript();
  }

  function ensureLiveText(data: Json) {
    const key = streamKey(data);
    const existing = liveText.get(key);
    if (existing) {
      liveText.delete(key);
      liveText.set(key, existing);
      return existing;
    }

    transcript.querySelector(".ocx-welcome")?.remove();

    const row = document.createElement("div");
    row.className = "ocx-message-row assistant live";

    const body = document.createElement("div");
    body.className = "ocx-assistant-text";
    body.textContent = "";

    row.appendChild(body);
    transcript.appendChild(row);
    liveText.set(key, body);
    boundLiveStreams();
    followLatest();
    return body;
  }

  function ensureLiveReasoning(data: Json) {
    const key = streamKey(data);
    const existing = liveReasoning.get(key);
    if (existing) {
      liveReasoning.delete(key);
      liveReasoning.set(key, existing);
      return existing;
    }

    const details = document.createElement("details");
    details.className = "ocx-reasoning";
    details.open = true;

    const summary = document.createElement("summary");
    summary.textContent = "Thinking";

    const body = document.createElement("div");
    body.textContent = "";

    details.append(summary, body);
    transcript.appendChild(details);
    liveReasoning.set(key, body);
    boundLiveStreams();
    followLatest();
    return body;
  }

  function clearLiveStreams() {
    liveText.clear();
    liveReasoning.clear();
    livePartKinds.clear();
  }

  function renderMessage(message: Json) {
    if (!message) return;

    if (message.type === "user") {
      addUserMessage(String(message.text || ""));
      return;
    }

    if (message.type === "assistant") {
      for (const part of Array.isArray(message.content) ? message.content : []) {
        if (part?.type === "text") addAssistantText(String(part.text || ""));
        else if (part?.type === "reasoning") addReasoning(String(part.text || ""));
        else if (part?.type === "tool") addToolPart(part);
      }

      if (message.error?.message) {
        addMetaLine(`error: ${message.error.message}`);
      }

      const footerBits: string[] = [];
      if (message.agent) footerBits.push(String(message.agent));
      if (message.model?.modelID) footerBits.push(String(message.model.modelID));
      if (Number.isFinite(message.cost) && message.cost > 0) {
        footerBits.push(`$${Number(message.cost).toFixed(4)}`);
      }
      if (footerBits.length) addMetaLine(footerBits.join(" · "));
      return;
    }

    if (message.type === "shell") {
      addToolPart({
        name: "shell",
        state: {
          status: message.time?.completed ? "completed" : "running",
          input: { command: message.command },
          result: message.output
        }
      });
      return;
    }

    if (message.type === "agent-switched") {
      addMetaLine(`agent → ${message.agent}`);
      return;
    }

    if (message.type === "model-switched") {
      addMetaLine(
        `model → ${message.model?.modelID || message.model?.id || "unknown"}`
      );
      return;
    }

    if (message.type === "compaction") {
      addMetaLine("context compacted");
      return;
    }

    // Transitional support for older projected message shape.
    const role = message?.info?.role;
    if (role === "user" || role === "assistant") {
      const parts = Array.isArray(message.parts) ? message.parts : [];
      if (role === "user") {
        const text = parts
          .filter((part: Json) => part?.type === "text")
          .map((part: Json) => String(part.text || ""))
          .join("");
        addUserMessage(text);
      } else {
        for (const part of parts) {
          if (part?.type === "text") addAssistantText(String(part.text || ""));
          else if (part?.type === "reasoning") addReasoning(String(part.text || ""));
          else if (part?.type === "tool") addToolPart(part);
        }
      }
    }
  }

  async function loadContext() {
    if (!activeSession) return;

    const messages = await api<Json[]>(
      `/session/${encodeURIComponent(activeSession.id)}/context`
    );
    const list = Array.isArray(messages) ? messages : [];

    contextExecutionState = null;
    for (let index = list.length - 1; index >= 0; index--) {
      const message = list[index];
      if (message?.type === "idle") {
        contextExecutionState = openCodeIdleOutcomeToExecutionState(message?.outcome);
        break;
      }
    }

    transcript.replaceChildren();
    clearLiveStreams();

    for (const message of list) {
      renderMessage(message);
    }

    if (!transcript.childElementCount) {
      transcript.innerHTML = `
        <div class="ocx-welcome compact">
          <div class="ocx-mark">></div>
          <h2>${activeSession.title || "New session"}</h2>
          <p>Send a prompt to start working.</p>
        </div>
      `;
    }

    followLatest();
  }

  async function loadLocation() {
    try {
      const value = await api<Json>("/location");
      directory = String(value?.directory || value?.location?.directory || "");
      sidebarDirectory.textContent = directory || "workspace";
    } catch {
      // The UI remains usable even if location metadata is unavailable.
    }
  }

  async function loadProviders() {
    const payload = await api<{
      all?: OpenCodeProvider[];
      default?: Record<string, string>;
      connected?: string[];
    }>("/pocket/providers");

    providers = Array.isArray(payload?.all) ? payload.all : [];
    providerDefaults = payload?.default ?? {};
    connectedProviders = new Set(payload?.connected ?? []);

    if (!selectedModel) {
      const provider =
        providers.find(item => connectedProviders.has(item.id)) ??
        providers[0];
      if (provider) {
        const models = normalizeModels(provider);
        const modelID =
          providerDefaults[provider.id] ||
          models[0]?.id;
        if (modelID) {
          selectedModel = { providerID: provider.id, modelID };
        }
      }
    }

    updateContextUI();
  }

  async function loadAgents() {
    const data = await api<OpenCodeAgent[]>("/agent");
    agents = (Array.isArray(data) ? data : []).filter(agent => !agent.hidden);

    if (!agents.some(agent => agent.id === selectedAgent)) {
      selectedAgent =
        agents.find(agent => agent.id === "build")?.id ||
        agents.find(agent => agent.mode === "primary" || agent.mode === "all")?.id ||
        agents[0]?.id ||
        "build";
    }

    localStorage.setItem("opencode-pocket-opencode-agent", selectedAgent);
    updateContextUI();
  }

  async function loadCommands() {
    try {
      const data = await api<OpenCodeCommand[]>("/command");
      commands = Array.isArray(data) ? data : [];
    } catch {
      commands = [];
    }
  }

  async function loadSkills() {
    try {
      const data = await api<OpenCodeSkill[]>("/skill");
      skills = Array.isArray(data) ? data : [];
    } catch {
      skills = [];
    }
  }

  async function loadSessions() {
    const data = await api<OpenCodeSession[]>("/session?limit=80&order=desc");
    sessions = Array.isArray(data) ? data : [];

    if (activeSession) {
      const fresh = sessions.find(session => session.id === activeSession?.id);
      if (fresh) {
        activeSession = fresh;

        if (fresh.agent) {
          selectedAgent = fresh.agent;
          localStorage.setItem("opencode-pocket-opencode-agent", selectedAgent);
        }

        if (fresh.model?.providerID && (fresh.model?.modelID || fresh.model?.id)) {
          selectedModel = {
            providerID: String(fresh.model.providerID),
            modelID: String(fresh.model.modelID || fresh.model.id)
          };
          localStorage.setItem("opencode-pocket-model", JSON.stringify(selectedModel));
        }

        sessionTitle.textContent = fresh.title || "Untitled session";
        updateContextUI();
      } else {
        activeSession = null;
        pendingPermission = null;
        pendingQuestion = null;
        localStorage.removeItem("opencode-pocket-opencode-session");
      }
    }

    renderSessions();

    if (!activeSession) {
      const saved = localStorage.getItem("opencode-pocket-opencode-session");
      const target = sessions.find(session => session.id === saved);
      if (target) await selectSession(target);
      else if (saved) localStorage.removeItem("opencode-pocket-opencode-session");
    }
  }

  async function syncPendingPermission() {
    if (!activeSession) {
      pendingPermission = null;
      renderPermission();
      return;
    }

    try {
      const data = await api<PendingPermission[]>(
        `/session/${encodeURIComponent(activeSession.id)}/permission`
      );
      pendingPermission = (Array.isArray(data) ? data : [])[0] ?? null;
      renderPermission();
    } catch {
      // Event stream remains the primary live source.
    }
  }

  async function syncPendingQuestion() {
    if (!activeSession) {
      pendingQuestion = null;
      renderQuestion();
      return;
    }

    try {
      const data = await api<PendingQuestion[]>(
        `/session/${encodeURIComponent(activeSession.id)}/question`
      );
      pendingQuestion = (Array.isArray(data) ? data : [])[0] ?? null;
      renderQuestion();
    } catch {
      // Ignore temporary question lookup failure.
    }
  }

  async function recoverExecutionState() {
    if (!activeSession) {
      setExecutionState(online ? "idle" : "offline");
      return;
    }

    if (pendingPermission) {
      setExecutionState("waiting_for_approval");
      return;
    }

    if (pendingQuestion) {
      setExecutionState("waiting_for_input");
      return;
    }

    try {
      const payload = await api<Json>("/session/active");
      const active =
        payload?.data && typeof payload.data === "object"
          ? payload.data
          : payload;

      if (active && typeof active === "object" && active[activeSession.id]) {
        setExecutionState("running");
        return;
      }

      setExecutionState(contextExecutionState ?? "idle");
    } catch {
      // Preserve the current state if the recovery probe itself fails.
    }
  }

  async function selectSession(session: OpenCodeSession) {
    activeSession = session;
    localStorage.setItem("opencode-pocket-opencode-session", session.id);

    if (session.agent) {
      selectedAgent = session.agent;
      localStorage.setItem("opencode-pocket-opencode-agent", selectedAgent);
    }
    selectedMode = modeForSession(session);
    localStorage.setItem("opencode-pocket-opencode-mode", selectedMode);

    if (session.model?.providerID && (session.model?.modelID || session.model?.id)) {
      selectedModel = {
        providerID: String(session.model.providerID),
        modelID: String(session.model.modelID || session.model.id)
      };
      localStorage.setItem("opencode-pocket-model", JSON.stringify(selectedModel));
    }

    sessionTitle.textContent = session.title || "Untitled session";
    sidebarDirectory.textContent = sessionDirectory(session) || directory || "workspace";
    updateContextUI();
    renderSessions();
    closeSidebar();
    setActivity("loading");

    try {
      followsBottom = true;
      await Promise.all([
        loadContext(),
        syncPendingPermission(),
        syncPendingQuestion()
      ]);
      await recoverExecutionState();
    } catch (error) {
      setActivity("error", "failed");
      showToast(error instanceof Error ? error.message : String(error));
    }
  }

  async function createSession() {
    setActivity("creating");

    try {
      const body: Json = {};

      if (selectedAgent) body.agent = selectedAgent;
      if (selectedModel) {
        body.model = {
          id: selectedModel.modelID,
          providerID: selectedModel.providerID
        };
      }

      const session = await api<OpenCodeSession>("/session", {
        method: "POST",
        headers: {
          "x-pocket-agent-mode": selectedMode
        },
        body: JSON.stringify(body)
      });

      if (!session?.id) throw new Error("OpenCode did not return a session id");

      sessions.unshift(session);
      activeSession = session;
      localStorage.setItem("opencode-pocket-opencode-session", session.id);
      persistMode(selectedMode);

      sessionTitle.textContent = session.title || "New session";
      updateContextUI();
      renderSessions();

      transcript.innerHTML = `
        <div class="ocx-welcome compact">
          <div class="ocx-mark">></div>
          <h2>New session</h2>
          <p>${
            selectedMode === "ask"
              ? "Ask mode is active · read-only Q&A."
              : selectedMode === "plan"
                ? "Plan mode is active · read-only tools only."
                : "Build mode is active."
          }</p>
        </div>
      `;

      setExecutionState("idle");
      closeSidebar();
      return session.id;
    } catch (error) {
      setActivity("error");
      showToast(error instanceof Error ? error.message : "Could not create session");
      return null;
    }
  }

  async function switchAgent(agentID: string, mode: AgentMode = agentID === "plan" ? "plan" : "build") {
    if (isExecutionActive(executionState)) {
      showToast("Wait for the current run to finish");
      return;
    }

    const previous = selectedAgent;
    const previousMode = selectedMode;
    selectedAgent = agentID;
    persistMode(mode);
    localStorage.setItem("opencode-pocket-opencode-agent", agentID);
    updateContextUI();

    try {
      if (activeSession) {
        await api(
          `/session/${encodeURIComponent(activeSession.id)}/agent`,
          {
            method: "POST",
            headers: {
              "x-pocket-agent-mode": mode
            },
            body: JSON.stringify({ agent: agentID })
          }
        );
        activeSession.agent = agentID;
      }
      showToast(`Agent: ${agentID}`);
    } catch (error) {
      selectedAgent = previous;
      persistMode(previousMode);
      updateContextUI();
      showToast(error instanceof Error ? error.message : "Agent switch failed");
      throw error;
    }
  }

  async function switchModel(model: { providerID: string; modelID: string }) {
    if (isExecutionActive(executionState)) {
      showToast("Wait for the current run to finish");
      return;
    }

    const previous = selectedModel;
    selectedModel = model;
    localStorage.setItem("opencode-pocket-model", JSON.stringify(model));
    updateContextUI();

    try {
      if (activeSession) {
        await api(
          `/session/${encodeURIComponent(activeSession.id)}/model`,
          {
            method: "POST",
            body: JSON.stringify({
              model: {
                id: model.modelID,
                providerID: model.providerID
              }
            })
          }
        );
        activeSession.model = {
          providerID: model.providerID,
          modelID: model.modelID
        };
      }
      showToast(`Model: ${currentModelName()}`);
    } catch (error) {
      selectedModel = previous;
      updateContextUI();
      showToast(error instanceof Error ? error.message : "Model switch failed");
      throw error;
    }
  }

  async function setMode(mode: AgentMode) {
    const target =
      mode === "ask"
        ? agents.find(agent => agent.id === "plan")?.id ||
          agents.find(agent => agent.mode === "primary" || agent.mode === "all")?.id
        : agents.find(agent => agent.id === mode)?.id ||
          (mode === "build"
            ? agents.find(agent => agent.mode === "primary" || agent.mode === "all")?.id
            : undefined);

    if (!target) {
      showToast(`${mode} mode is not available`);
      return;
    }

    await switchAgent(target, mode);
  }

  function renderSlashPalette(query = "") {
    const normalized = query.replace(/^\//, "").trim().toLowerCase();
    const items = commands
      .filter(command =>
        !normalized ||
        command.name.toLowerCase().includes(normalized) ||
        (command.description || "").toLowerCase().includes(normalized)
      )
      .slice(0, 8);

    slashPalette.replaceChildren();

    if (!items.length) {
      slashPalette.classList.add("hidden");
      return;
    }

    for (const command of items) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "ocx-command-row";

      const name = document.createElement("strong");
      name.textContent = `/${command.name}`;

      const description = document.createElement("span");
      description.textContent = command.description || "OpenCode command";

      button.append(name, description);
      button.addEventListener("click", () => void applyCommand(command));
      slashPalette.appendChild(button);
    }

    slashPalette.classList.remove("hidden");
  }

  async function applyCommand(command: OpenCodeCommand) {
    try {
      if (command.agent) {
        await switchAgent(command.agent);
      }

      if (command.model?.providerID && command.model?.modelID) {
        await switchModel({
          providerID: command.model.providerID,
          modelID: command.model.modelID
        });
      }
    } catch {
      return;
    }

    promptInput.value = command.template || `/${command.name}`;
    updateContextUI();
    resizeComposer();
    slashPalette.classList.add("hidden");
    promptInput.focus();
  }

  async function sendMessage() {
    const text = promptInput.value.trim();
    if (!text && !pendingAttachments.length) return;

    let sessionID: string | null | undefined = activeSession?.id;
    if (!sessionID) sessionID = await createSession();
    if (!sessionID) return;

    const attachmentText = pendingAttachments.length
      ? `\n\n添付ファイル:\n${pendingAttachments.map(item => `- ${item.name} (${item.kind}): ${item.path}`).join("\n")}`
      : "";
    const promptText = `${text}${attachmentText}`.trim();
    followsBottom = true;
    addUserMessage(promptText);
    followLatest();

    promptInput.value = "";
    pendingAttachments = [];
    renderAttachments();
    resizeComposer();
    slashPalette.classList.add("hidden");
    setExecutionState("running");

    try {
      await api(
        `/session/${encodeURIComponent(sessionID)}/prompt`,
        {
          method: "POST",
          headers: {
            "x-pocket-agent-mode": selectedMode
          },
          body: JSON.stringify({
            text: promptText,
            agent: selectedAgent
          })
        }
      );
    } catch (error) {
      setExecutionState("failed");
      showToast(error instanceof Error ? error.message : "Send failed");
    }
  }

  function fileToDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(reader.error || new Error("ファイルを読み込めませんでした"));
      reader.readAsDataURL(file);
    });
  }

  async function uploadAttachment(file: File, kind: "image" | "file") {
    const limit = kind === "image" ? 10 * 1024 * 1024 : 15 * 1024 * 1024;
    if (file.size > limit) throw new Error(`${file.name} は${kind === "image" ? "10" : "15"}MBを超えています`);
    const data = await fileToDataUrl(file);
    const response = await fetch("/api/codex/upload", {
      method: "POST",
      headers: { "content-type": "application/json", "x-pocket-operation-id": operationId() },
      body: JSON.stringify({ name: file.name, type: file.type || "application/octet-stream", data })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload?.error || `Upload failed (${response.status})`);
    return { id: operationId(), name: file.name, type: file.type, kind, dataUrl: kind === "image" ? data : undefined, path: String(payload.path || ""), size: file.size } satisfies PendingAttachment;
  }

  function renderAttachments() {
    attachmentStrip.replaceChildren();
    attachmentStrip.classList.toggle("hidden", pendingAttachments.length === 0);
    for (const attachment of pendingAttachments) {
      const chip = document.createElement("div");
      chip.className = "ocx-attachment-chip";
      if (attachment.kind === "image" && attachment.dataUrl) {
        const image = document.createElement("img");
        image.src = attachment.dataUrl;
        image.alt = "";
        chip.appendChild(image);
      } else {
        const icon = document.createElement("span");
        icon.textContent = "⌑";
        chip.appendChild(icon);
      }
      const name = document.createElement("span");
      name.textContent = attachment.name;
      const remove = document.createElement("button");
      remove.type = "button";
      remove.textContent = "×";
      remove.addEventListener("click", () => {
        pendingAttachments = pendingAttachments.filter(item => item.id !== attachment.id);
        renderAttachments();
      });
      chip.append(name, remove);
      attachmentStrip.appendChild(chip);
    }
  }

  async function addAttachments(files: FileList | File[], forceImages = false) {
    try {
      for (const file of Array.from(files)) {
        const kind = forceImages || file.type.startsWith("image/") ? "image" : "file";
        pendingAttachments.push(await uploadAttachment(file, kind));
      }
      renderAttachments();
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Upload failed");
    }
  }

  async function interrupt() {
    if (!activeSession) return;

    try {
      await api(
        `/session/${encodeURIComponent(activeSession.id)}/interrupt`,
        {
          method: "POST",
          headers: {
            "x-pocket-operation-id": `opencode-interrupt-${operationId()}`
          }
        }
      );
      setExecutionState("interrupted");
      showToast("Interrupted");
      scheduleRefresh();
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Interrupt failed");
    }
  }

  function renderPermission() {
    permission.classList.toggle("hidden", !pendingPermission);
    if (!pendingPermission) return;

    permissionTitle.textContent =
      pendingPermission.action || "OpenCode wants permission";

    const projectContext =
      activeSession ? sessionDirectory(activeSession) : directory || "workspace";
    permissionDetail.textContent = [
      "Backend: OpenCode",
      `Session: ${pendingPermission.sessionID || activeSession?.id || "unknown"}`,
      `Workspace: ${projectContext}`,
      `Action: ${pendingPermission.action || "permission"}`,
      pendingPermission.resources?.length
        ? `Resources:\n${pendingPermission.resources.map(value => `- ${String(value)}`).join("\n")}`
        : "",
      pendingPermission.save?.length
        ? `Persistent rules:\n${pendingPermission.save.map(value => `- ${String(value)}`).join("\n")}`
        : "",
      pendingPermission.metadata
        ? `Metadata:\n${JSON.stringify(pendingPermission.metadata, null, 2)}`
        : ""
    ].filter(Boolean).join("\n\n");
  }

  async function answerPermission(reply: "once" | "always" | "reject") {
    if (!pendingPermission) return;

    const request = pendingPermission;

    permissionReject.disabled = true;
    permissionOnce.disabled = true;
    permissionAlways.disabled = true;

    try {
      await api(
        `/session/${encodeURIComponent(request.sessionID)}/permission/${encodeURIComponent(request.id)}/reply`,
        {
          method: "POST",
          headers: {
            "x-pocket-operation-id":
              `opencode-permission-${request.id}-${reply}`
          },
          body: JSON.stringify({ reply })
        }
      );
      pendingPermission = null;
      renderPermission();
      setExecutionState("running");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Permission reply failed");
    } finally {
      permissionReject.disabled = false;
      permissionOnce.disabled = false;
      permissionAlways.disabled = false;
    }
  }

  function renderQuestion() {
    questionDock.classList.toggle("hidden", !pendingQuestion);
    questionOptions.replaceChildren();
    questionCustom.classList.add("hidden");
    questionCustom.value = "";
    questionAnswers = [];

    if (!pendingQuestion) return;

    const questions = pendingQuestion.questions ?? [];
    if (!questions.length) return;

    questionHeader.textContent =
      questions.length === 1
        ? questions[0].header || "OpenCode needs input"
        : `OpenCode has ${questions.length} questions`;

    questionText.textContent =
      questions.length === 1
        ? questions[0].question
        : "Answer each question below.";

    questions.forEach((question, index) => {
      const selected = new Set<string>();
      questionAnswers.push(selected);

      const card = document.createElement("div");
      card.className = "ocx-question-card";

      if (questions.length > 1) {
        const head = document.createElement("div");
        head.className = "ocx-question-card-head";
        const label = document.createElement("strong");
        label.textContent = question.header || `Question ${index + 1}`;
        const text = document.createElement("span");
        text.textContent = question.question;
        head.append(label, text);
        card.appendChild(head);
      }

      const optionsWrap = document.createElement("div");
      optionsWrap.className = "ocx-question-options-inner";

      for (const option of question.options ?? []) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "ocx-question-option";

        const label = document.createElement("strong");
        label.textContent = option.label;

        const description = document.createElement("span");
        description.textContent = option.description || "";

        button.append(label, description);
        button.addEventListener("click", () => {
          const multiple = Boolean(question.multiple);

          if (!multiple) {
            selected.clear();
            optionsWrap
              .querySelectorAll(".ocx-question-option")
              .forEach(item => item.classList.remove("selected"));
          }

          if (selected.has(option.label)) {
            selected.delete(option.label);
            button.classList.remove("selected");
          } else {
            selected.add(option.label);
            button.classList.add("selected");
          }
        });

        optionsWrap.appendChild(button);
      }

      if (question.custom !== false) {
        const customButton = document.createElement("button");
        customButton.type = "button";
        customButton.className = "ocx-question-option custom";
        customButton.innerHTML = "<strong>Other</strong><span>Type a custom answer</span>";

        const customInput = document.createElement("input");
        customInput.type = "text";
        customInput.className = "ocx-question-custom hidden";
        customInput.placeholder = "Type another answer…";

        customButton.addEventListener("click", () => {
          customInput.classList.toggle("hidden");
          if (!customInput.classList.contains("hidden")) customInput.focus();
        });

        customInput.addEventListener("input", () => {
          const previous = [...selected].find(value => value.startsWith("__custom__:"));
          if (previous) selected.delete(previous);
          const value = customInput.value.trim();
          if (value) selected.add(`__custom__:${value}`);
        });

        optionsWrap.append(customButton, customInput);
      }

      card.appendChild(optionsWrap);
      questionOptions.appendChild(card);
    });
  }

  async function submitQuestion() {
    if (!pendingQuestion) return;

    const questions = pendingQuestion.questions ?? [];
    const answers = questionAnswers.map(set =>
      [...set].map(value =>
        value.startsWith("__custom__:") ? value.slice("__custom__:".length) : value
      )
    );

    if (
      answers.length !== questions.length ||
      answers.some(answer => answer.length === 0)
    ) {
      showToast("Answer every question");
      return;
    }

    const request = pendingQuestion;
    questionSubmit.disabled = true;
    questionReject.disabled = true;

    try {
      await api(
        `/session/${encodeURIComponent(request.sessionID)}/question/${encodeURIComponent(request.id)}/reply`,
        {
          method: "POST",
          headers: {
            "x-pocket-operation-id":
              `opencode-question-${request.id}-reply-${crypto.randomUUID()}`
          },
          body: JSON.stringify({ answers })
        }
      );
      pendingQuestion = null;
      renderQuestion();
      setExecutionState("running");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Question reply failed");
    } finally {
      questionSubmit.disabled = false;
      questionReject.disabled = false;
    }
  }

  async function rejectQuestion() {
    if (!pendingQuestion) return;

    const request = pendingQuestion;
    questionSubmit.disabled = true;
    questionReject.disabled = true;

    try {
      await api(
        `/session/${encodeURIComponent(request.sessionID)}/question/${encodeURIComponent(request.id)}/reject`,
        {
          method: "POST",
          headers: {
            "x-pocket-operation-id": `opencode-question-${request.id}-reject-${crypto.randomUUID()}`
          }
        }
      );
      pendingQuestion = null;
      renderQuestion();
      setExecutionState("running");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Could not dismiss question");
    } finally {
      questionSubmit.disabled = false;
      questionReject.disabled = false;
    }
  }

  function scheduleRefresh(delay = 140) {
    if (refreshTimer !== null) window.clearTimeout(refreshTimer);

    refreshTimer = window.setTimeout(() => {
      refreshTimer = null;
      if (!activeSession) return;

      void Promise.all([
        loadContext(),
        loadSessions(),
        syncPendingPermission(),
        syncPendingQuestion()
      ]);
    }, delay);
  }

  function stopLiveFallback() {
    if (liveFallbackTimer !== null) {
      window.clearTimeout(liveFallbackTimer);
      liveFallbackTimer = null;
    }
  }

  function startLiveFallback() {
    if (liveFallbackTimer !== null) return;

    const tick = async () => {
      liveFallbackTimer = null;
      if (!online || !activeSession || !isExecutionActive(executionState)) return;

      // OpenCode has had SSE regressions where the model keeps running but
      // message events do not reach remote clients. Reconcile from persisted
      // context only when the live stream has been quiet long enough.
      if (Date.now() - lastLiveEventAt > 650) {
        try {
          await loadContext();
          await recoverExecutionState();
        } catch {
          // Keep the live request running; the next tick can retry.
        }
      }

      if (online && activeSession && isExecutionActive(executionState)) {
        liveFallbackTimer = window.setTimeout(() => void tick(), 700);
      }
    };

    liveFallbackTimer = window.setTimeout(() => void tick(), 700);
  }

  function handleEvent(payload: Json) {
    const normalized = normalizeOpenCodeEvent(payload);
    const { type, props, sessionID } = normalized;

    if (
      sessionID &&
      activeSession &&
      sessionID !== activeSession.id
    ) {
      if (type.startsWith("session.")) void loadSessions();
      return;
    }

    // Current OpenCode v1 SSE schema. Keep the older projected
    // session.* event handlers below for compatibility with newer/v2 builds.
    if (type === "message.part.updated") {
      const part = props?.part;
      if (!part) return;

      const key = streamKey({
        messageID: part.messageID,
        partID: part.id
      });

      if (part.type === "text") {
        livePartKinds.set(key, "text");
        const staleReasoning = liveReasoning.get(key);
        if (staleReasoning) {
          staleReasoning.closest("details")?.remove();
          liveReasoning.delete(key);
        }
        const body = ensureLiveText({
          messageID: part.messageID,
          partID: part.id
        });
        body.textContent = mergeOpenCodeStreamText(body.textContent, {
          text: part.text,
          delta: props?.delta
        });
        followLatest();
        lastLiveEventAt = Date.now();
        setExecutionState("running");
        return;
      }

      if (part.type === "reasoning") {
        livePartKinds.set(key, "reasoning");
        const staleText = liveText.get(key);
        if (staleText) {
          staleText.closest(".ocx-message-row")?.remove();
          liveText.delete(key);
        }
        const body = ensureLiveReasoning({
          messageID: part.messageID,
          partID: part.id
        });
        body.textContent = mergeOpenCodeStreamText(body.textContent, {
          text: part.text,
          delta: props?.delta
        });
        followLatest();
        lastLiveEventAt = Date.now();
        setExecutionState("running");
        return;
      }

      if (part.type === "tool") {
        lastLiveEventAt = Date.now();
        scheduleRefresh(180);
        return;
      }
    }

    if (type === "message.part.delta") {
      const key = streamKey({
        messageID: props?.messageID,
        partID: props?.partID
      });
      const kind = livePartKinds.get(key);
      const data = {
        messageID: props?.messageID,
        partID: props?.partID
      };
      const body =
        kind === "reasoning"
          ? ensureLiveReasoning(data)
          : ensureLiveText(data);
      body.textContent = mergeOpenCodeStreamText(body.textContent, normalized);
      followLatest();
      lastLiveEventAt = Date.now();
      setExecutionState("running");
      return;
    }

    if (type === "session.status") {
      lastLiveEventAt = Date.now();
      if (normalized.executionState) {
        setExecutionState(normalized.executionState);
        if (normalized.executionState === "completed") scheduleRefresh(60);
      }
      return;
    }

    if (type === "session.idle" || type === "session.error") {
      lastLiveEventAt = Date.now();
      clearLiveStreams();
      trimTranscript();
      if (normalized.executionState) setExecutionState(normalized.executionState);
      scheduleRefresh(60);
      return;
    }

    if (type === "session.updated") {
      lastLiveEventAt = Date.now();
      void loadSessions();
      return;
    }

    if (type === "session.text.started") {
      ensureLiveText(props);
      setExecutionState("running");
      return;
    }

    if (type === "session.text.delta") {
      const body = ensureLiveText(props);
      body.textContent = mergeOpenCodeStreamText(body.textContent, normalized);
      followLatest();
      setExecutionState("running");
      return;
    }

    if (type === "session.text.ended") {
      const key = streamKey(props);
      const body = ensureLiveText(props);
      body.textContent = mergeOpenCodeStreamText(body.textContent, normalized);
      retireLiveStream(key);
      trimTranscript();
      followLatest();
      return;
    }

    if (type === "session.reasoning.started") {
      ensureLiveReasoning(props);
      setExecutionState("running");
      return;
    }

    if (type === "session.reasoning.delta") {
      const body = ensureLiveReasoning(props);
      body.textContent = mergeOpenCodeStreamText(body.textContent, normalized);
      followLatest();
      setExecutionState("running");
      return;
    }

    if (type === "session.reasoning.ended") {
      const key = streamKey(props);
      const body = ensureLiveReasoning(props);
      body.textContent = mergeOpenCodeStreamText(body.textContent, normalized);
      retireLiveStream(key);
      trimTranscript();
      return;
    }

    if (type === "session.execution.started") {
      setExecutionState("running");
      return;
    }

    if (type === "session.execution.succeeded") {
      setExecutionState("completed");
      scheduleRefresh(60);
      return;
    }

    if (type === "session.execution.failed") {
      setExecutionState("failed");
      scheduleRefresh(60);
      return;
    }

    if (type === "session.execution.interrupted") {
      setExecutionState("interrupted");
      scheduleRefresh(60);
      return;
    }

    if (type === "permission.v2.asked") {
      if (!activeSession || props?.sessionID === activeSession.id) {
        pendingPermission = props as PendingPermission;
        renderPermission();
        setExecutionState("waiting_for_approval");
      }
      return;
    }

    if (type === "permission.v2.replied") {
      if (pendingPermission?.id === props?.requestID) {
        pendingPermission = null;
        renderPermission();
        if (executionState === "waiting_for_approval") {
          setExecutionState("running");
        }
      }
      return;
    }

    if (type === "question.v2.asked") {
      if (!activeSession || props?.sessionID === activeSession.id) {
        pendingQuestion = props as PendingQuestion;
        renderQuestion();
        setExecutionState("waiting_for_input");
      }
      return;
    }

    if (type === "question.v2.replied" || type === "question.v2.rejected") {
      if (pendingQuestion?.id === props?.requestID) {
        pendingQuestion = null;
        renderQuestion();
        if (executionState === "waiting_for_input") {
          setExecutionState("running");
        }
      }
      return;
    }

    if (
      (type === "session.agent.selected" || type === "session.next.agent.switched") &&
      activeSession &&
      sessionID === activeSession.id
    ) {
      const agent = props?.agent;
      if (typeof agent === "string") {
        selectedAgent = agent;
        activeSession.agent = agent;
        localStorage.setItem("opencode-pocket-opencode-agent", agent);
        updateContextUI();
      }
      return;
    }

    if (
      (type === "session.model.selected" || type === "session.next.model.switched") &&
      activeSession &&
      sessionID === activeSession.id
    ) {
      const model = props?.model;
      if (model?.providerID && (model?.modelID || model?.id)) {
        selectedModel = {
          providerID: String(model.providerID),
          modelID: String(model.modelID || model.id)
        };
        activeSession.model = model;
        localStorage.setItem("opencode-pocket-model", JSON.stringify(selectedModel));
        updateContextUI();
      }
      return;
    }

    if (
      type === "session.tool.called" ||
      type === "session.tool.success" ||
      type === "session.tool.failed" ||
      type === "session.shell.started" ||
      type === "session.shell.ended"
    ) {
      // Tool events are less latency-sensitive; reconcile after a short debounce.
      scheduleRefresh(220);
      return;
    }

    if (
      type === "session.renamed" ||
      type === "session.created" ||
      type === "session.deleted"
    ) {
      void loadSessions();
    }
  }

  function scheduleEventReconnect() {
    if (!shouldScheduleReconnect(online, reconnectTimer !== null)) return;

    const delay = reconnectDelay(reconnectAttempts);
    reconnectAttempts += 1;
    setExecutionState("reconnecting");

    reconnectTimer = window.setTimeout(() => {
      reconnectTimer = null;
      connectEvents();
    }, delay);
  }

  function connectEvents() {
    if (!shouldOpenEventSource(online, Boolean(eventSource))) return;

    eventSource = new EventSource("/api/opencode/event");

    eventSource.onopen = () => {
      reconnectAttempts = 0;
      lastLiveEventAt = Date.now();
      if (reconnectTimer !== null) {
        window.clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }

      if (executionState === "reconnecting") {
        void refresh().finally(() => {
          if (executionState === "reconnecting") {
            setExecutionState("idle");
            showToast("Connection recovered");
          }
        });
      }
    };

    eventSource.onmessage = event => {
      try {
        lastLiveEventAt = Date.now();
        handleEvent(JSON.parse(event.data));
      } catch {
        // Ignore malformed event frames.
      }
    };

    eventSource.onerror = () => {
      eventSource?.close();
      eventSource = null;
      scheduleEventReconnect();
    };
  }

  function disconnectEvents() {
    stopLiveFallback();
    if (reconnectTimer !== null) {
      window.clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    reconnectAttempts = 0;
    eventSource?.close();
    eventSource = null;
  }

  async function showAgents() {
    openModal("Agents", "Choose how OpenCode should work");
    modalBody.replaceChildren();

    const list = document.createElement("div");
    list.className = "ocx-picker-list";

    for (const agent of agents) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `ocx-picker-row ${selectedAgent === agent.id ? "selected" : ""}`;

      const copy = document.createElement("span");
      copy.innerHTML = "<strong></strong><small></small>";
      copy.querySelector("strong")!.textContent = agent.id;
      copy.querySelector("small")!.textContent =
        agent.description || agent.mode || "OpenCode agent";

      const mark = document.createElement("span");
      mark.textContent = selectedAgent === agent.id ? "✓" : "›";

      button.append(copy, mark);
      button.addEventListener("click", () => {
        void switchAgent(agent.id)
          .then(closeModal)
          .catch(() => {});
      });
      list.appendChild(button);
    }

    modalBody.appendChild(list);
  }

  async function showModels() {
    openModal("Models", "Choose the model for subsequent work");
    modalBody.replaceChildren();

    const list = document.createElement("div");
    list.className = "ocx-picker-list";

    const sortedProviders = [...providers].sort((a, b) => {
      const aConnected = connectedProviders.has(a.id) ? 0 : 1;
      const bConnected = connectedProviders.has(b.id) ? 0 : 1;
      return aConnected - bConnected || (a.name || a.id).localeCompare(b.name || b.id);
    });

    for (const provider of sortedProviders) {
      const heading = document.createElement("div");
      heading.className = "ocx-picker-heading";
      heading.textContent = provider.name || provider.id;
      list.appendChild(heading);

      for (const model of normalizeModels(provider)) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = `ocx-picker-row ${
          selectedModel?.providerID === provider.id &&
          selectedModel?.modelID === model.id
            ? "selected"
            : ""
        }`;

        const copy = document.createElement("span");
        copy.innerHTML = "<strong></strong><small></small>";
        copy.querySelector("strong")!.textContent = model.name || model.id;
        copy.querySelector("small")!.textContent =
          `${provider.id}/${model.id}`;

        const mark = document.createElement("span");
        mark.textContent =
          selectedModel?.providerID === provider.id &&
          selectedModel?.modelID === model.id
            ? "✓"
            : "›";

        button.append(copy, mark);
        button.addEventListener("click", () => {
          void switchModel({
            providerID: provider.id,
            modelID: model.id
          })
            .then(closeModal)
            .catch(() => {});
        });
        list.appendChild(button);
      }
    }

    modalBody.appendChild(list);
  }

  function showCommands() {
    openModal("Commands", "Reusable OpenCode prompts");
    modalBody.replaceChildren();

    const list = document.createElement("div");
    list.className = "ocx-picker-list";

    if (!commands.length) {
      const empty = document.createElement("p");
      empty.className = "ocx-modal-empty";
      empty.textContent = "No commands are registered.";
      list.appendChild(empty);
    }

    for (const command of commands) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "ocx-picker-row";

      const copy = document.createElement("span");
      copy.innerHTML = "<strong></strong><small></small>";
      copy.querySelector("strong")!.textContent = `/${command.name}`;
      copy.querySelector("small")!.textContent =
        command.description || command.template.slice(0, 120);

      const mark = document.createElement("span");
      mark.textContent = "›";

      button.append(copy, mark);
      button.addEventListener("click", () => {
        void applyCommand(command).then(() => closeModal());
      });
      list.appendChild(button);
    }

    modalBody.appendChild(list);
  }

  function showSkills() {
    openModal("Skills", "Workspace and installed skills");
    modalBody.replaceChildren();

    const list = document.createElement("div");
    list.className = "ocx-picker-list";

    if (!skills.length) {
      const empty = document.createElement("p");
      empty.className = "ocx-modal-empty";
      empty.textContent = "No skills are available.";
      list.appendChild(empty);
    }

    for (const skill of skills) {
      const row = document.createElement("div");
      row.className = "ocx-skill-row";

      const copy = document.createElement("span");
      copy.innerHTML = "<strong></strong><small></small>";
      copy.querySelector("strong")!.textContent =
        skill.slash ? `/${skill.name}` : skill.name;
      copy.querySelector("small")!.textContent =
        skill.description || skill.location || "OpenCode skill";

      row.appendChild(copy);
      list.appendChild(row);
    }

    modalBody.appendChild(list);
  }

  function showSessionDetails() {
    if (!activeSession) {
      void createSession();
      return;
    }

    openModal(activeSession.title || "Session", activeSession.id);
    modalBody.innerHTML = `
      <div class="ocx-detail-grid">
        <div><span>Agent</span><strong>${activeSession.agent || selectedAgent}</strong></div>
        <div><span>Model</span><strong>${activeSession.model?.modelID || activeSession.model?.id || selectedModel?.modelID || "default"}</strong></div>
        <div><span>Directory</span><strong>${sessionDirectory(activeSession) || "workspace"}</strong></div>
        <div><span>Input tokens</span><strong>${activeSession.tokens?.input ?? 0}</strong></div>
        <div><span>Output tokens</span><strong>${activeSession.tokens?.output ?? 0}</strong></div>
        <div><span>Cost</span><strong>${Number(activeSession.cost || 0).toFixed(4)}</strong></div>
      </div>
    `;
  }

  async function refresh() {
    if (!online) return;

    try {
      setActivity("syncing");
      await Promise.all([
        loadLocation(),
        loadProviders(),
        loadAgents(),
        loadCommands(),
        loadSkills()
      ]);
      await loadSessions();

      if (activeSession) {
        await Promise.all([
          loadContext(),
          syncPendingPermission(),
          syncPendingQuestion()
        ]);
        await recoverExecutionState();
      } else if (executionState === "reconnecting" || executionState === "offline") {
        setExecutionState("idle");
      }
    } catch (error) {
      setActivity("error");
      showToast(error instanceof Error ? error.message : String(error));
    }
  }

  function setOnline(value: boolean) {
    const changed = online !== value;
    online = value;
    sideStatus.classList.toggle("online", value);
    sideStatus.classList.toggle("offline", !value);
    sideStatus.innerHTML = `<i></i> ${value ? "Connected" : "Offline"}`;
    setControlsEnabled(value);

    if (value) {
      connectEvents();
      if (changed || executionState === "offline") {
        setExecutionState("reconnecting");
        void refresh();
      }
    } else {
      setExecutionState("offline");
      disconnectEvents();
    }
  }

  menu.addEventListener("click", openSidebar);
  sidebarClose.addEventListener("click", closeSidebar);
  scrim.addEventListener("click", closeSidebar);
  sessionSearch.addEventListener("input", renderSessions);

  newSessionSide.addEventListener("click", () => void createSession());
  newSessionTop.addEventListener("click", () => void createSession());

  agentsNav.addEventListener("click", () => {
    closeSidebar();
    void showAgents();
  });
  commandsNav.addEventListener("click", () => {
    closeSidebar();
    showCommands();
  });
  skillsNav.addEventListener("click", () => {
    closeSidebar();
    showSkills();
  });
  modelsNav.addEventListener("click", () => {
    closeSidebar();
    void showModels();
  });
  codexNav.addEventListener("click", () => {
    closeSidebar();
    options.onCodex?.();
  });
  integrationsNav.addEventListener("click", () => {
    closeSidebar();
    options.onIntegrations?.();
  });
  refreshButton.addEventListener("click", () => void refresh());

  sessionTitleButton.addEventListener("click", showSessionDetails);
  agentButton.addEventListener("click", () => void showAgents());
  modelButton.addEventListener("click", () => void showModels());

  planMode.addEventListener("click", () => void setMode("plan"));
  askMode.addEventListener("click", () => void setMode("ask"));
  buildMode.addEventListener("click", () => void setMode("build"));

  plus.addEventListener("click", () => attachmentMenu.classList.toggle("hidden"));
  imageButton.addEventListener("click", () => imageInput.click());
  fileButton.addEventListener("click", () => fileInput.click());
  imageInput.addEventListener("change", () => {
    if (imageInput.files) void addAttachments(imageInput.files, true);
    imageInput.value = "";
    attachmentMenu.classList.add("hidden");
  });
  fileInput.addEventListener("change", () => {
    if (fileInput.files) void addAttachments(fileInput.files);
    fileInput.value = "";
    attachmentMenu.classList.add("hidden");
  });
  voice.addEventListener("click", () => {
    const Recognition = (window as Window & { SpeechRecognition?: new () => any; webkitSpeechRecognition?: new () => any }).SpeechRecognition ||
      (window as Window & { webkitSpeechRecognition?: new () => any }).webkitSpeechRecognition;
    if (!Recognition) {
      showToast("このブラウザは音声入力に未対応です");
      return;
    }
    const recognition = new Recognition();
    recognition.lang = speechRecognitionLanguage();
    recognition.interimResults = true;
    voice.classList.add("listening");
    recognition.onresult = (event: any) => {
      promptInput.value = Array.from(event.results as ArrayLike<{ 0: { transcript: string } }>)
        .map(result => result[0]?.transcript || "").join("");
      resizeComposer();
    };
    recognition.onerror = () => showToast("音声入力に失敗しました");
    recognition.onend = () => voice.classList.remove("listening");
    recognition.start();
  });

  slashButton.addEventListener("click", () => {
    if (!promptInput.value.startsWith("/")) {
      promptInput.value = "/";
      resizeComposer();
    }
    renderSlashPalette(promptInput.value);
    promptInput.focus();
  });

  promptInput.addEventListener("input", () => {
    resizeComposer();
    if (promptInput.value.startsWith("/")) {
      renderSlashPalette(promptInput.value);
    } else {
      slashPalette.classList.add("hidden");
    }
  });

  promptInput.addEventListener("keydown", event => {
    if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;

    if (!slashPalette.classList.contains("hidden")) {
      const first = slashPalette.querySelector<HTMLButtonElement>(".ocx-command-row");
      if (first) {
        event.preventDefault();
        first.click();
      }
      return;
    }

    event.preventDefault();
    if (isExecutionActive(executionState)) void interrupt();
    else void sendMessage();
  });

  promptForm.addEventListener("submit", event => {
    event.preventDefault();
    if (isExecutionActive(executionState)) void interrupt();
    else void sendMessage();
  });

  permissionReject.addEventListener("click", () => void answerPermission("reject"));
  permissionOnce.addEventListener("click", () => void answerPermission("once"));
  permissionAlways.addEventListener("click", () => void answerPermission("always"));

  questionSubmit.addEventListener("click", () => void submitQuestion());
  questionReject.addEventListener("click", () => void rejectQuestion());

  modalClose.addEventListener("click", closeModal);
  modal.addEventListener("click", event => {
    if (event.target === modal) closeModal();
  });

  root.querySelectorAll<HTMLButtonElement>("[data-hint]").forEach(button => {
    button.addEventListener("click", () => {
      const hint = button.dataset.hint;
      if (hint === "plan") void setMode("plan");
      if (hint === "build") void setMode("build");
      if (hint === "command") {
        promptInput.value = "/";
        resizeComposer();
        renderSlashPalette("/");
        promptInput.focus();
      }
    });
  });

  updateContextUI();
  resizeComposer();
  setOnline(false);

  return {
    setOnline,
    refresh
  };
}
