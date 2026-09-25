import { codexThreadStatusToExecutionState, codexTurnStatusToExecutionState, isExecutionActive, type ExecutionState } from "./execution-state.mjs";
import { speechRecognitionLanguage } from "./i18n";
import { createDevWorkflowPanel } from "./dev-workflows-ui";
import { isMcpToolItem, mcpToolSummary, normalizeStructuredMcpResult } from "./mcp-result";
import { setWakeLockExecutionActive } from "./wake-lock";
import { enrichInstalledPluginEntries, pluginEntries } from "./codex-plugin-metadata.mjs";
import { applyReasoningToTurnStart, normalizeCodexModels, reasoningChoices, reconcileReasoningMode } from "./codex-reasoning.mjs";
import { reconnectDelay, shouldOpenEventSource, shouldScheduleReconnect } from "./reconnect-policy.mjs";
import { enforceTranscriptLimit } from "./bounded-transcript";
import {
  continueAgentRun,
  guardMessage,
  loopMessage,
  matchRememberedPermission,
  recordAgentAction,
  rememberPermission,
  runPreExecutionGuard,
  scanCommand,
  type CommandScan,
  type LoopResult,
  type PermissionScope
} from "./safety-client";

const FOLLOW_BOTTOM_THRESHOLD = 48;

type Json = Record<string, any>;

type ThreadSummary = {
  id: string;
  name?: string | null;
  preview?: string | null;
  updatedAt?: number | null;
  cwd?: string | null;
};

type ProjectSummary = {
  id: string;
  name: string;
  path: string;
  available?: boolean;
  addedAt?: number;
  github?: string;
};

type GithubRepo = {
  owner: string;
  name: string;
  fullName: string;
  private: boolean;
  visibility: string;
  defaultBranch: string;
  description: string;
  cloned: boolean;
  currentBranch?: string | null;
  dirty?: boolean;
};

type MarkdownDoc = {
  path: string;
  name: string;
  size?: number | null;
  updatedAt?: number | null;
  kind: "agents" | "handoff" | "readme" | "markdown";
};

type CodexModel = {
  id: string;
  model: string;
  displayName?: string;
  description?: string;
  isDefault?: boolean;
  hidden?: boolean;
  defaultReasoningEffort?: string;
  supportedReasoningEfforts?: Array<{ reasoningEffort: string; description?: string }>;
};

type PendingAttachment = {
  id: string;
  name: string;
  type: string;
  kind: "image" | "file";
  dataUrl?: string;
  uploadId?: string;
  size: number;
};

type CodexRemoteOptions = {
  onOpenCode?: () => void;
  onApi?: () => void;
  onIntegrations?: () => void;
};

export type CodexRemoteController = {
  setOnline(online: boolean): void;
  refresh(): Promise<void>;
};

export function mountCodexRemote(
  root: HTMLElement,
  options: CodexRemoteOptions = {}
): CodexRemoteController {
  root.innerHTML = `
    <div class="cx-app">
      <div id="cxScrim" class="cx-scrim hidden"></div>

      <aside id="cxSidebar" class="cx-sidebar" aria-hidden="true">
        <div class="cx-sidebar-head dm-agent-head">
          <div class="dm-agent-switch-shell">
            <button id="cxAgentSwitchButton" class="dm-agent-switch-trigger" type="button" aria-haspopup="listbox" aria-expanded="false">
              <span class="dm-agent-switch-icon">⌘</span>
              <span class="dm-agent-switch-copy"><strong>Codex</strong><small>現在のエージェント</small></span>
              <span class="dm-agent-switch-chevron">⌄</span>
            </button>
            <div id="cxAgentSwitchMenu" class="dm-agent-switch-menu hidden" role="listbox" aria-label="エージェントを選択">
              <button class="cx-agent-option active" type="button" data-agent="codex"><span>⌘</span><span><strong>Codex</strong><small>実装・修正</small></span><span>✓</span></button>
              <button class="cx-agent-option" type="button" data-agent="opencode"><span>◈</span><span><strong>OpenCode</strong><small>エージェント実行</small></span><span></span></button>
              <button class="cx-agent-option" type="button" data-agent="api"><span>✦</span><span><strong>API Chat</strong><small>マルチプロバイダー</small></span><span></span></button>
            </div>
          </div>
          <button id="cxSidebarClose" class="cx-icon-button" type="button" aria-label="閉じる">×</button>
        </div>

        <div class="cx-sidebar-scroll">
        <button id="cxNewChatSide" class="cx-side-action primary" type="button">
          <span>✎</span><span>新しいチャット</span>
        </button>

        <label class="cx-search">
          <span>⌕</span>
          <input id="cxThreadSearch" type="search" placeholder="チャットを検索" />
        </label>

        <nav class="cx-side-nav">
          <button id="cxLibraryNav" class="cx-nav-item" type="button"><span>▦</span><span>ライブラリ · 準備中</span></button>
          <button id="cxProjectsNav" class="cx-nav-item" type="button"><span>▱</span><span>Projects</span></button>
          <button id="cxIntegrationsNav" class="cx-nav-item" type="button"><span>⌁</span><span>Integrations</span></button>
          <button id="cxDevWorkflowsNav" class="cx-nav-item" type="button"><span>◇</span><span>Developer workflows</span></button>
          <button id="cxSettingsNav" class="cx-nav-item" type="button"><span>⚙</span><span>Settings</span></button>
        </nav>

        <div class="cx-side-section">
          <div class="cx-side-label">最近</div>
          <div id="cxSidebarThreads" class="cx-sidebar-threads">
            <div class="cx-side-empty">読み込み中…</div>
          </div>
        </div>

        </div>

        <div class="cx-sidebar-foot">
          <label class="pocket-language-setting" title="Language">
            <span aria-hidden="true">◎</span>
            <select data-language-select aria-label="Language">
              <option value="en">English</option>
              <option value="ja">日本語</option>
              <option value="zh-CN">简体中文</option>
            </select>
          </label>
          <span id="cxSideStatus" class="cx-online-pill offline"><i></i> Offline</span>
        </div>
      </aside>

      <header class="cx-topbar">
        <button id="cxMenu" class="cx-icon-button" type="button" aria-label="会話履歴を開く" title="会話履歴">☰</button>
        <button id="cxTitleButton" class="cx-title-button" type="button">
          <span id="cxTitle">Codex</span>
          <small id="cxModelLabel">DevMoter agent</small>
        </button>
        <div class="cx-topbar-controls">
          <button id="cxModelTop" class="cx-topbar-pill" type="button" aria-label="モデルを選択"><span>◉</span><small id="cxModelTopLabel">default</small></button>
          <button id="cxReasoningTop" class="cx-topbar-pill" type="button" aria-label="推論性能を選択"><span>◌</span><small>Auto</small></button>
          <button id="cxUsageTop" class="cx-topbar-pill cx-usage-pill" type="button" aria-label="使用量"><span>◒</span><small id="cxUsageLabel">Usage</small></button>
          <button id="cxNewChatTop" class="cx-icon-button" type="button" aria-label="新しいチャット">✎</button>
        </div>
      </header>

      <main class="cx-main">
        <div id="cxTranscript" class="cx-transcript">
          <div class="cx-welcome">
            <div class="cx-welcome-mark">✦</div>
            <h2>何を作ろうか？</h2>
            <p>CodexをChromebookで動かしたまま、ここから操作できます。</p>
          </div>
        </div>
      </main>

      <div id="cxApproval" class="cx-approval hidden">
        <div class="cx-approval-copy">
          <span class="cx-approval-eyebrow">CODEX APPROVAL</span>
          <strong id="cxApprovalTitle">許可が必要です</strong>
          <div id="cxApprovalMeta" class="cx-approval-meta"></div>
          <pre id="cxApprovalDetail"></pre>
        </div>
        <div class="cx-approval-actions three">
          <button id="cxDenyApproval" type="button">拒否</button>
          <button id="cxAcceptApproval" type="button">今回だけ</button>
          <button id="cxAcceptSessionApproval" class="primary" type="button">セッション中は許可</button>
        </div>
      </div>

      <section class="cx-composer-wrap">
        <div id="cxExecutionStatus" class="cx-execution-status" data-state="offline" role="status" aria-live="polite">
          <i></i><span>オフライン</span>
        </div>
        <div id="cxAttachmentStrip" class="cx-attachment-strip hidden"></div>
        <div id="cxContextPalette" class="cx-context-palette hidden" role="listbox" aria-label="Project context suggestions"></div>

        <form id="cxPromptForm" class="cx-composer">
          <textarea
            id="cxPromptInput"
            rows="1"
            placeholder="Codexにメッセージ"
            aria-label="Codexへのメッセージ"
          ></textarea>

          <div class="cx-composer-row">
            <div class="cx-composer-left">
              <button id="cxPlus" class="cx-round-button" type="button" aria-label="追加">＋</button>
              <button id="cxThink" class="cx-think-button" type="button" aria-label="推論量を選択">
                <span>◌</span><span id="cxThinkLabel">推論量</span>
              </button>
            </div>
            <div class="cx-composer-right">
              <button id="cxVoice" class="cx-round-button cx-voice-button" type="button" aria-label="音声入力">♩</button>
              <button id="cxSend" class="cx-send-button" type="submit" aria-label="送信">↑</button>
            </div>
          </div>
        </form>

        <div id="cxPlusMenu" class="cx-plus-menu hidden">
          <button id="cxPhoto" type="button"><span>▧</span><span>画像送信</span></button>
          <button id="cxFile" type="button"><span>⌑</span><span>ファイル</span></button>
          <button id="cxPluginsQuick" type="button"><span>◉</span><span>プラグイン</span></button>
        </div>

        <input id="cxPhotoInput" type="file" accept="image/*" multiple hidden />
        <input id="cxFileInput" type="file" multiple hidden />
      </section>

      <div id="cxToast" class="cx-toast hidden" role="status" aria-live="polite"></div>

      <div id="cxModal" class="cx-modal hidden" role="dialog" aria-modal="true">
        <div class="cx-modal-card">
          <div class="cx-modal-head">
            <div>
              <strong id="cxModalTitle">設定</strong>
              <p id="cxModalSubtitle"></p>
            </div>
            <button id="cxModalClose" class="cx-icon-button" type="button">×</button>
          </div>
          <div id="cxModalBody" class="cx-modal-body"></div>
        </div>
      </div>
    </div>
  `;

  const sidebar = root.querySelector<HTMLElement>("#cxSidebar")!;
  const scrim = root.querySelector<HTMLElement>("#cxScrim")!;
  const sidebarClose = root.querySelector<HTMLButtonElement>("#cxSidebarClose")!;
  const agentSwitchButton = root.querySelector<HTMLButtonElement>("#cxAgentSwitchButton")!;
  const agentSwitchMenu = root.querySelector<HTMLDivElement>("#cxAgentSwitchMenu")!;
  const settingsNav = root.querySelector<HTMLButtonElement>("#cxSettingsNav")!;
  const menu = root.querySelector<HTMLButtonElement>("#cxMenu")!;
  const newChatSide = root.querySelector<HTMLButtonElement>("#cxNewChatSide")!;
  const newChatTop = root.querySelector<HTMLButtonElement>("#cxNewChatTop")!;
  const threadSearch = root.querySelector<HTMLInputElement>("#cxThreadSearch")!;
  const sidebarThreads = root.querySelector<HTMLDivElement>("#cxSidebarThreads")!;
  const projectsNav = root.querySelector<HTMLButtonElement>("#cxProjectsNav")!;
  const libraryNav = root.querySelector<HTMLButtonElement>("#cxLibraryNav")!;
  const devWorkflowsNav = root.querySelector<HTMLButtonElement>("#cxDevWorkflowsNav")!;
  const integrationsNav = root.querySelector<HTMLButtonElement>("#cxIntegrationsNav")!;
  const voice = root.querySelector<HTMLButtonElement>("#cxVoice")!;
  const reasoningTop = root.querySelector<HTMLButtonElement>("#cxReasoningTop")!;
  const usageTop = root.querySelector<HTMLButtonElement>("#cxUsageTop")!;
  const modelTop = root.querySelector<HTMLButtonElement>("#cxModelTop")!;
  const modelTopLabel = root.querySelector<HTMLElement>("#cxModelTopLabel")!;
  const usageLabel = root.querySelector<HTMLElement>("#cxUsageLabel")!;
  const sideStatus = root.querySelector<HTMLElement>("#cxSideStatus")!;
  const title = root.querySelector<HTMLElement>("#cxTitle")!;
  const titleButton = root.querySelector<HTMLButtonElement>("#cxTitleButton")!;
  const modelLabel = root.querySelector<HTMLElement>("#cxModelLabel")!;
  const transcript = root.querySelector<HTMLDivElement>("#cxTranscript")!;
  let followsBottom = true;
  const followLatest = () => {
    enforceTranscriptLimit(transcript);
    if (followsBottom) transcript.scrollTop = transcript.scrollHeight;
  };
  transcript.addEventListener("scroll", () => {
    followsBottom = transcript.scrollHeight - transcript.scrollTop - transcript.clientHeight <= FOLLOW_BOTTOM_THRESHOLD;
  }, { passive: true });

  const TRANSCRIPT_NODE_LIMIT = 400;
  function trimTranscript() {
    if (transcript.childElementCount <= TRANSCRIPT_NODE_LIMIT) return;

    const activeRow = activeAssistantBubble?.closest(".cx-message-row") ?? null;
    let candidate = transcript.firstElementChild;
    while (transcript.childElementCount > TRANSCRIPT_NODE_LIMIT && candidate) {
      const next = candidate.nextElementSibling;
      if (candidate !== activeRow) candidate.remove();
      candidate = next;
    }
  }
  const approval = root.querySelector<HTMLDivElement>("#cxApproval")!;
  const approvalTitle = root.querySelector<HTMLElement>("#cxApprovalTitle")!;
  const approvalMeta = root.querySelector<HTMLElement>("#cxApprovalMeta")!;
  const approvalDetail = root.querySelector<HTMLElement>("#cxApprovalDetail")!;
  const denyApproval = root.querySelector<HTMLButtonElement>("#cxDenyApproval")!;
  const acceptApproval = root.querySelector<HTMLButtonElement>("#cxAcceptApproval")!;
  const acceptSessionApproval = root.querySelector<HTMLButtonElement>("#cxAcceptSessionApproval")!;
  const promptForm = root.querySelector<HTMLFormElement>("#cxPromptForm")!;
  const promptInput = root.querySelector<HTMLTextAreaElement>("#cxPromptInput")!;
  const send = root.querySelector<HTMLButtonElement>("#cxSend")!;
  const plus = root.querySelector<HTMLButtonElement>("#cxPlus")!;
  const think = root.querySelector<HTMLButtonElement>("#cxThink")!;
  const thinkLabel = root.querySelector<HTMLElement>("#cxThinkLabel")!;
  const plusMenu = root.querySelector<HTMLDivElement>("#cxPlusMenu")!;
  const executionStatus = root.querySelector<HTMLDivElement>("#cxExecutionStatus")!;
  const attachmentStrip = root.querySelector<HTMLDivElement>("#cxAttachmentStrip")!;
  const contextPalette = root.querySelector<HTMLDivElement>("#cxContextPalette")!;
  const photo = root.querySelector<HTMLButtonElement>("#cxPhoto")!;
  const file = root.querySelector<HTMLButtonElement>("#cxFile")!;
  const pluginsQuick = root.querySelector<HTMLButtonElement>("#cxPluginsQuick")!;
  const photoInput = root.querySelector<HTMLInputElement>("#cxPhotoInput")!;
  const fileInput = root.querySelector<HTMLInputElement>("#cxFileInput")!;
  const toast = root.querySelector<HTMLDivElement>("#cxToast")!;
  const modal = root.querySelector<HTMLDivElement>("#cxModal")!;
  const modalTitle = root.querySelector<HTMLElement>("#cxModalTitle")!;
  const modalSubtitle = root.querySelector<HTMLElement>("#cxModalSubtitle")!;
  const modalBody = root.querySelector<HTMLDivElement>("#cxModalBody")!;
  const modalClose = root.querySelector<HTMLButtonElement>("#cxModalClose")!;

  let online = false;
  let activeThreadId: string | null = null;
  let activeTurnId: string | null = null;
  let activeAssistantBubble: HTMLDivElement | null = null;
  let pendingApproval: { id: string | number; method: string; params: Json } | null = null;
  let pendingApprovalSafety = "";
  let events: EventSource | null = null;
  let reconnectTimer: number | null = null;
  let reconnectAttempts = 0;
  let allThreads: ThreadSummary[] = [];
  let projects: ProjectSummary[] = [];
  let activeProject: ProjectSummary | null = null;
  let pendingAttachments: PendingAttachment[] = [];
  let selectedContextRefs: Array<{ path: string; kind: "file" | "folder" }> = [];
  let contextRequestSerial = 0;
  let executionState: ExecutionState = "offline";
  let selectedModel = localStorage.getItem("opencode-pocket-codex-model") || "";
  let modelCatalog: CodexModel[] = [];
  let modalCloseGuard: (() => boolean) | null = null;
  let toastTimer: number | null = null;
  let reasoningMode = localStorage.getItem("opencode-pocket-reasoning") || "auto";
  let usageTokens = 0;
  let submitInFlight = false;
  let resumeSyncInFlight = false;

  function uid() {
    return globalThis.crypto?.randomUUID?.() ??
      `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  }

  function eventThreadId(params: Json) {
    const value =
      params?.threadId ??
      params?.turn?.threadId ??
      params?.item?.threadId ??
      params?.thread?.id;
    return typeof value === "string" ? value : "";
  }

  function eventBelongsToActiveThread(params: Json) {
    const threadId = eventThreadId(params);
    return !threadId || threadId === activeThreadId;
  }

  function modelDisplayName(value: string) {
    const match = modelCatalog.find(model =>
      model.model === value || model.id === value
    );
    return match?.displayName || match?.model || value;
  }

  function updateContextLabel() {
    const project = activeProject?.name || "No project";
    const model = selectedModel ? modelDisplayName(selectedModel) : "default";
    modelLabel.textContent = `${project} · ${model}`;
    modelTopLabel.textContent = model;
  }

  function updateUsage(tokens = 0) {
    usageTokens = Math.max(0, usageTokens + tokens);
    usageLabel.textContent = usageTokens > 0
      ? (usageTokens >= 1000 ? `${(usageTokens / 1000).toFixed(1)}k tok` : `${usageTokens} tok`)
      : "Usage";
  }

  function formatResetTime(value: unknown) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0) return "";
    const date = new Date(numeric < 1e12 ? numeric * 1000 : numeric);
    return new Intl.DateTimeFormat(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    }).format(date);
  }

  async function showUsage() {
    openModal("Usage", "Codexアカウントの利用枠");
    modalBody.innerHTML = '<div class="cx-modal-loading">読み込み中…</div>';

    try {
      const payload = await rpc<Json>("account/rateLimits/read", {});
      const snapshots = [
        payload?.rateLimits,
        ...Object.values(payload?.rateLimitsByLimitId ?? {})
      ].filter((value, index, all) =>
        value && typeof value === "object" && all.indexOf(value) === index
      ) as Json[];

      modalBody.replaceChildren();
      if (!snapshots.length) {
        const empty = document.createElement("section");
        empty.className = "cx-library-empty";
        const title = document.createElement("strong");
        title.textContent = "利用枠の情報がありません";
        const note = document.createElement("p");
        note.textContent = "Codexがこのアカウントについて返した利用枠だけを表示します。";
        empty.append(title, note);
        modalBody.appendChild(empty);
        usageLabel.textContent = "Usage";
        return;
      }

      const seen = new Set<string>();
      for (const snapshot of snapshots) {
        const key = String(snapshot.limitId ?? snapshot.limitName ?? JSON.stringify(snapshot));
        if (seen.has(key)) continue;
        seen.add(key);

        const section = document.createElement("section");
        section.className = "cx-usage-card";
        const heading = document.createElement("strong");
        heading.textContent = String(snapshot.limitName || snapshot.limitId || "Codex");
        section.appendChild(heading);

        const windows = [
          ["Primary", snapshot.primary],
          ["Secondary", snapshot.secondary]
        ] as const;
        for (const [label, windowData] of windows) {
          if (!windowData || typeof windowData !== "object") continue;
          const used = Number(windowData.usedPercent);
          const row = document.createElement("div");
          row.className = "cx-usage-row";
          const copy = document.createElement("span");
          const reset = formatResetTime(windowData.resetsAt);
          copy.textContent = Number.isFinite(used)
            ? `${label}: ${Math.max(0, 100 - used).toFixed(0)}% left${reset ? ` · reset ${reset}` : ""}`
            : `${label}${reset ? ` · reset ${reset}` : ""}`;
          row.appendChild(copy);
          section.appendChild(row);
        }

        if (snapshot.credits && typeof snapshot.credits === "object") {
          const credits = document.createElement("div");
          credits.className = "cx-usage-row";
          const balance = snapshot.credits.balance;
          credits.textContent = balance == null ? "Credits available" : `Credits: ${String(balance)}`;
          section.appendChild(credits);
        }
        modalBody.appendChild(section);
      }

      const primary = payload?.rateLimits?.primary;
      const used = Number(primary?.usedPercent);
      usageLabel.textContent = Number.isFinite(used)
        ? `${Math.max(0, 100 - used).toFixed(0)}% left`
        : "Usage";
    } catch (error) {
      modalBody.replaceChildren();
      const empty = document.createElement("section");
      empty.className = "cx-library-empty";
      const title = document.createElement("strong");
      title.textContent = "Usageを取得できませんでした";
      const note = document.createElement("p");
      note.textContent = error instanceof Error ? error.message : "Codex app-serverから利用枠を取得できませんでした";
      empty.append(title, note);
      modalBody.appendChild(empty);
    }
  }

  function selectedModelMetadata() {
    return modelCatalog.find(model => model.model === selectedModel || model.id === selectedModel)
      ?? modelCatalog.find(model => model.isDefault)
      ?? null;
  }

  function reasoningLabel(value: string) {
    return ({
      none: "None",
      minimal: "Minimal",
      low: "Low",
      medium: "Medium",
      high: "High",
      xhigh: "Extra High"
    } as Record<string, string>)[value] || value;
  }

  function syncReasoningLabels() {
    const model = selectedModelMetadata();
    const reconciledMode = reconcileReasoningMode(reasoningMode, model);
    if (reconciledMode !== reasoningMode) {
      reasoningMode = reconciledMode;
      localStorage.setItem("opencode-pocket-reasoning", reasoningMode);
    }
    const defaultEffort = model?.defaultReasoningEffort;
    const label = reasoningMode === "auto"
      ? `Auto${defaultEffort ? ` · ${reasoningLabel(defaultEffort)}` : ""}`
      : reasoningLabel(reasoningMode);
    reasoningTop.querySelector("small")!.textContent = label;
    thinkLabel.textContent = label;
  }

  function showReasoningPicker() {
    const model = selectedModelMetadata();
    const values = reasoningChoices(model).map(item => ({
      value: item.value,
      label: item.value === "auto" ? "Auto" : reasoningLabel(item.value),
      description: item.value === "auto"
        ? (model?.defaultReasoningEffort ? `モデル既定: ${reasoningLabel(model.defaultReasoningEffort)}` : "Codexに自動選択させる")
        : (item.description || `${reasoningLabel(item.value)} reasoning`)
    }));
    openModal("推論量", model ? `${model.displayName || model.model} が対応している推論量` : "このモデルの思考量を選択");
    modalBody.innerHTML = `<div class="cx-choice-list"></div>`;
    const list = modalBody.querySelector<HTMLDivElement>(".cx-choice-list")!;
    for (const item of values) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `cx-choice-row ${reasoningMode === item.value ? "selected" : ""}`;
      const strong = document.createElement("strong");
      strong.textContent = item.label;
      const small = document.createElement("small");
      small.textContent = item.description;
      button.append(strong, small);
      button.addEventListener("click", () => {
        reasoningMode = item.value;
        localStorage.setItem("opencode-pocket-reasoning", item.value);
        syncReasoningLabels();
        closeModal();
      });
      list.appendChild(button);
    }
  }

  function showLibrary() {
    closeSidebar();
    openModal("ライブラリ", "DevMoterに保存された素材と添付ファイル");
    modalBody.innerHTML = `
      <section class="cx-library-empty">
        <div>▦</div>
        <strong>ライブラリは準備中</strong>
        <p>会話で使った画像・ファイル・生成物を、ここから探せるようにする予定。</p>
      </section>
    `;
  }

  function persistSelectedModel(value: string) {
    selectedModel = value;
    if (value) localStorage.setItem("opencode-pocket-codex-model", value);
    else localStorage.removeItem("opencode-pocket-codex-model");
    updateContextLabel();
  }

  async function loadModelCatalog() {
    const result = await rpc<Json>("model/list", { limit: 100 });
    modelCatalog = normalizeCodexModels(result) as CodexModel[];

    const migrated = modelCatalog.find(model => model.id === selectedModel && model.model !== selectedModel);
    if (migrated) persistSelectedModel(migrated.model);

    syncReasoningLabels();
    return modelCatalog;
  }

  async function applyModelSelection(modelValue: string, displayName: string) {
    if (isExecutionActive(executionState)) {
      showToast("回答中はモデルを変更できません");
      return;
    }

    try {
      if (activeThreadId) {
        await rpc("thread/settings/update", {
          threadId: activeThreadId,
          model: modelValue
        });
      }

      persistSelectedModel(modelValue);
      showToast(
        activeThreadId
          ? `${displayName} に切り替えました`
          : `次のチャット: ${displayName}`
      );
      closeModal();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      showToast("モデル変更に失敗しました");
      throw new Error(message);
    }
  }

  async function projectApi<T = Json>(path: string, init: RequestInit = {}): Promise<T> {
    const method = String(init.method || "GET").toUpperCase();
    const mutating = method !== "GET" && method !== "HEAD";
    const res = await fetch(`/api/projects${path}`, {
      ...init,
      headers: {
        ...(init.body ? { "content-type": "application/json" } : {}),
        ...(mutating ? { "x-pocket-operation-id": uid() } : {}),
        ...(init.headers || {})
      },
      cache: method === "GET" ? "no-store" : undefined
    });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(payload?.error || `HTTP ${res.status}`);
    return payload as T;
  }

  async function loadProjects() {
    const result = await projectApi<{ projects?: ProjectSummary[] }>("");
    projects = (result.projects ?? []).filter(project => project.available !== false);

    const saved = localStorage.getItem("opencode-pocket-project");
    activeProject =
      projects.find(project => project.id === saved) ??
      activeProject ??
      projects[0] ??
      null;

    if (activeProject) {
      localStorage.setItem("opencode-pocket-project", activeProject.id);
    }
    updateContextLabel();
  }

  function setActiveProject(project: ProjectSummary | null) {
    activeProject = project;
    if (project) localStorage.setItem("opencode-pocket-project", project.id);
    else localStorage.removeItem("opencode-pocket-project");
    updateContextLabel();
  }

  function openSidebar() {
    window.dispatchEvent(new CustomEvent("devmoter:close-global-nav"));
    sidebar.classList.add("open");
    sidebar.setAttribute("aria-hidden", "false");
    scrim.classList.remove("hidden");
  }

  function closeSidebar() {
    agentSwitchMenu.classList.add("hidden");
    agentSwitchButton.setAttribute("aria-expanded", "false");
    sidebar.classList.remove("open");
    sidebar.setAttribute("aria-hidden", "true");
    scrim.classList.add("hidden");
  }

  function openModal(titleText: string, subtitleText = "") {
    modalCloseGuard = null;
    modalTitle.textContent = titleText;
    modalSubtitle.textContent = subtitleText;
    modal.classList.remove("hidden");
  }

  function closeModal() {
    if (modalCloseGuard && !modalCloseGuard()) return;
    modalCloseGuard = null;
    modal.classList.add("hidden");
  }

  async function rpc<T = Json>(
    method: string,
    params: Json = {},
    options: { operationId?: string } = {}
  ): Promise<T> {
    const mutatingMethods = new Set([
      "thread/start",
      "thread/resume",
      "thread/fork",
      "thread/settings/update",
      "turn/start",
      "turn/steer",
      "turn/interrupt"
    ]);
    const opId =
      options.operationId ??
      (mutatingMethods.has(method) ? uid() : "");

    let res: Response;
    try {
      res = await fetch("/api/codex/rpc", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(opId ? { "x-pocket-operation-id": opId } : {})
        },
        body: JSON.stringify({ method, params })
      });
    } catch (error) {
      if (opId) {
        throw new Error(
          `Mutation outcome is unknown (operation ${opId}). DevMoter did not retry it automatically.`,
          { cause: error }
        );
      }
      throw error;
    }
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (payload?.duplicate) {
        throw new Error(
          `Operation ${payload?.operationId || opId} was already seen; the duplicate send was suppressed and the earlier outcome is unknown.`
        );
      }
      throw new Error(payload?.error || `HTTP ${res.status}`);
    }
    return payload.result as T;
  }

  function executionLabel(state: ExecutionState) {
    switch (state) {
      case "offline": return "オフライン";
      case "reconnecting": return "再接続中…";
      case "idle": return "待機中";
      case "running": return "実行中…";
      case "waiting_for_approval": return "確認待ち";
      case "waiting_for_input": return "入力待ち";
      case "completed": return "完了";
      case "failed": return "失敗";
      case "interrupted": return "中断";
    }
  }

  function setExecutionState(next: ExecutionState) {
    const previous = executionState;
    executionState = next;
    const active = isExecutionActive(next);
    setWakeLockExecutionActive("codex", active);

    executionStatus.dataset.state = next;
    executionStatus.querySelector("span")!.textContent = executionLabel(next);

    send.classList.toggle("stop", active);
    send.textContent = active ? "■" : "↑";
    send.setAttribute("aria-label", active ? "停止" : "送信");
    send.disabled = !online || next === "reconnecting";

    if (previous !== next) {
      window.dispatchEvent(new CustomEvent("devmoter-agent-state", {
        detail: { backend: "codex", sessionId: activeThreadId, state: next }
      }));
    }
  }

  function setOnline(next: boolean) {
    const changed = online !== next;
    online = next;
    sideStatus.classList.toggle("offline", !next);
    sideStatus.classList.toggle("online", next);
    sideStatus.innerHTML = `<i></i> ${next ? "Online" : "Offline"}`;
    promptInput.disabled = !next;

    if (!next) {
      if (reconnectTimer !== null) {
        window.clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      reconnectAttempts = 0;
      events?.close();
      events = null;
      setExecutionState("offline");
      return;
    }

    if (changed || executionState === "offline") {
      setExecutionState("reconnecting");
    }

    connectEvents();
    void refresh();
  }

  function showToast(message: string) {
    if (toastTimer !== null) window.clearTimeout(toastTimer);
    toast.textContent = message;
    toast.classList.remove("hidden");
    toast.classList.add("show");
    toastTimer = window.setTimeout(() => {
      toast.classList.remove("show");
      window.setTimeout(() => toast.classList.add("hidden"), 160);
      toastTimer = null;
    }, 1500);
  }

  async function copyText(text: string) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const helper = document.createElement("textarea");
      helper.value = text;
      helper.style.position = "fixed";
      helper.style.opacity = "0";
      document.body.appendChild(helper);
      helper.select();
      document.execCommand("copy");
      helper.remove();
    }
    showToast("コピーしました");
  }

  function feedbackKey(text: string) {
    let hash = 2166136261;
    for (let index = 0; index < text.length; index++) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return `opencode-pocket-feedback-${(hash >>> 0).toString(36)}`;
  }

  function addAssistantActions(bubble: HTMLDivElement) {
    if (bubble.querySelector(".cx-message-actions")) return;

    const text = bubble.querySelector<HTMLElement>(".cx-message-text")?.textContent?.trim() || "";
    if (!text) return;

    const actions = document.createElement("div");
    actions.className = "cx-message-actions";

    const copy = document.createElement("button");
    copy.type = "button";
    copy.className = "cx-message-action";
    copy.setAttribute("aria-label", "回答をコピー");
    copy.title = "コピー";
    copy.innerHTML = `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <rect x="8" y="8" width="11" height="11" rx="2"></rect>
        <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"></path>
      </svg>
    `;
    copy.addEventListener("click", () => void copyText(text));

    const feedbackWrap = document.createElement("div");
    feedbackWrap.className = "cx-feedback-wrap";

    const feedback = document.createElement("button");
    feedback.type = "button";
    feedback.className = "cx-message-action";
    feedback.setAttribute("aria-label", "回答を評価");
    feedback.title = "評価";
    feedback.innerHTML = `
      <svg viewBox="0 0 28 24" aria-hidden="true">
        <path d="M8.5 11.5V5.8c0-.9-.7-1.6-1.6-1.6h-.7L3.5 9v5.8h3.4c.9 0 1.6-.7 1.6-1.6v-1.7Z"></path>
        <path d="M10.5 5.5h4.2c1.1 0 1.8 1 1.5 2l-1.3 4.7c-.2.7-.8 1.2-1.5 1.2h-2.9"></path>
        <path d="M19.5 12.5v5.7c0 .9.7 1.6 1.6 1.6h.7l2.7-4.8V9.2h-3.4c-.9 0-1.6.7-1.6 1.6v1.7Z"></path>
        <path d="M17.5 18.5h-4.2c-1.1 0-1.8-1-1.5-2l1.3-4.7c.2-.7.8-1.2 1.5-1.2h2.9"></path>
      </svg>
    `;

    const feedbackMenu = document.createElement("div");
    feedbackMenu.className = "cx-feedback-menu hidden";

    const saved = localStorage.getItem(feedbackKey(text));

    for (const value of ["up", "down"] as const) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "cx-feedback-choice";
      if (saved === value) button.classList.add("selected");
      button.textContent = value === "up" ? "👍" : "👎";
      button.setAttribute("aria-label", value === "up" ? "良い回答" : "良くない回答");
      button.addEventListener("click", event => {
        event.stopPropagation();
        localStorage.setItem(feedbackKey(text), value);
        feedbackMenu.querySelectorAll(".cx-feedback-choice").forEach(item =>
          item.classList.remove("selected")
        );
        button.classList.add("selected");
        feedbackMenu.classList.add("hidden");
        feedback.classList.add("rated");
        showToast(value === "up" ? "👍 を記録しました" : "👎 を記録しました");
      });
      feedbackMenu.appendChild(button);
    }

    if (saved) feedback.classList.add("rated");

    feedback.addEventListener("click", event => {
      event.stopPropagation();
      root.querySelectorAll(".cx-feedback-menu").forEach(menu => {
        if (menu !== feedbackMenu) menu.classList.add("hidden");
      });
      feedbackMenu.classList.toggle("hidden");
    });

    feedbackWrap.append(feedback, feedbackMenu);

    const share = document.createElement("button");
    share.type = "button";
    share.className = "cx-message-action";
    share.setAttribute("aria-label", "回答を共有");
    share.title = "共有";
    share.innerHTML = `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 15V3"></path>
        <path d="m7.5 7.5 4.5-4.5 4.5 4.5"></path>
        <path d="M5 11v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"></path>
      </svg>
    `;
    share.addEventListener("click", async () => {
      if (navigator.share) {
        try {
          await navigator.share({ text });
          return;
        } catch (error) {
          if (error instanceof DOMException && error.name === "AbortError") return;
        }
      }
      await copyText(text);
      showToast("共有できないためコピーしました");
    });

    actions.append(copy, feedbackWrap, share);
    bubble.appendChild(actions);
  }

  document.addEventListener("click", () => {
    root.querySelectorAll(".cx-feedback-menu").forEach(menu => menu.classList.add("hidden"));
  });

  function addMessage(
    role: "user" | "assistant" | "system",
    text = "",
    attachments: Array<{ name: string; kind?: string }> = [],
    finalized = role !== "assistant"
  ) {
    transcript.querySelector(".cx-welcome")?.remove();

    const row = document.createElement("div");
    row.className = `cx-message-row ${role}`;

    const bubble = document.createElement("div");
    bubble.className = `cx-message ${role}`;

    if (text) {
      const body = document.createElement("div");
      body.className = "cx-message-text";
      body.textContent = text;
      bubble.appendChild(body);
    }

    if (attachments.length) {
      const files = document.createElement("div");
      files.className = "cx-message-files";
      for (const item of attachments) {
        const chip = document.createElement("span");
        chip.textContent = `${item.kind === "image" ? "▧" : "⌑"} ${item.name}`;
        files.appendChild(chip);
      }
      bubble.appendChild(files);
    }

    if (role === "assistant" && finalized) {
      addAssistantActions(bubble);
    }

    row.appendChild(bubble);
    transcript.appendChild(row);
    trimTranscript();
    followLatest();
    return bubble;
  }

  function addMcpToolResult(item: Json) {
    const summary = mcpToolSummary(item);
    const normalized = normalizeStructuredMcpResult(summary.result);
    const row = document.createElement("div");
    row.className = "cx-message-row assistant";
    const bubble = document.createElement("div");
    bubble.className = "cx-message assistant cx-mcp-result";
    const detailsEl = document.createElement("details");
    detailsEl.className = "cx-mcp-result-details";
    const head = document.createElement("summary");
    const label = document.createElement("span");
    label.textContent = `MCP · ${summary.server} · ${summary.tool}`;
    const state = document.createElement("small");
    state.textContent = summary.status + (normalized.truncated ? " · truncated" : "");
    head.append(label, state);
    const structured = document.createElement("pre");
    structured.className = "cx-mcp-structured";
    try { structured.textContent = JSON.stringify(normalized.value, null, 2); }
    catch { structured.textContent = String(normalized.value ?? ""); }
    const raw = document.createElement("details");
    raw.className = "cx-mcp-raw";
    const rawSummary = document.createElement("summary");
    rawSummary.textContent = "Raw fallback";
    const rawPre = document.createElement("pre");
    rawPre.textContent = normalized.rawText;
    raw.append(rawSummary, rawPre);
    detailsEl.append(head, structured, raw);
    bubble.appendChild(detailsEl);
    row.appendChild(bubble);
    transcript.appendChild(row);
    followLatest();
  }

  function renderThreads() {
    const q = threadSearch.value.trim().toLowerCase();
    const items = q
      ? allThreads.filter(thread =>
          `${thread.name || ""} ${thread.preview || ""}`.toLowerCase().includes(q)
        )
      : allThreads;

    sidebarThreads.replaceChildren();

    if (!items.length) {
      const empty = document.createElement("div");
      empty.className = "cx-side-empty";
      empty.textContent = q ? "見つかりません" : "まだチャットがありません";
      sidebarThreads.appendChild(empty);
      return;
    }

    for (const thread of items) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "cx-thread-row";
      if (thread.id === activeThreadId) button.classList.add("active");

      const text = document.createElement("span");
      text.textContent = thread.name || thread.preview || "新しいチャット";
      button.appendChild(text);
      button.addEventListener("click", () => {
        closeSidebar();
        void selectThread(thread);
      });
      sidebarThreads.appendChild(button);
    }
  }

  async function loadThreads() {
    const result = await rpc<{ data?: ThreadSummary[] }>("thread/list", { limit: 100 });
    allThreads = result?.data ?? [];
    renderThreads();

    if (activeThreadId && !allThreads.some(thread => thread.id === activeThreadId)) {
      activeThreadId = null;
      activeTurnId = null;
      activeAssistantBubble = null;
      localStorage.removeItem("opencode-pocket-codex-thread");
    }

    if (!activeThreadId) {
      const saved = localStorage.getItem("opencode-pocket-codex-thread");
      const target = allThreads.find(thread => thread.id === saved);
      if (target) await selectThread(target);
      else if (saved) localStorage.removeItem("opencode-pocket-codex-thread");
    }
  }

  function parseUserMessage(item: Json) {
    if (item?.type !== "userMessage") return null;
    const parts = Array.isArray(item.content) ? item.content : [];
    const texts: string[] = [];
    const attachments: Array<{ name: string; kind?: string }> = [];

    for (const part of parts) {
      if (part?.type === "text" && typeof part.text === "string") texts.push(part.text);
      if (part?.type === "image" || part?.type === "localImage") {
        attachments.push({ name: "画像", kind: "image" });
      }
      if (part?.type === "mention") {
        attachments.push({ name: part.name || part.path || "ファイル", kind: "file" });
      }
    }

    return { text: texts.join(""), attachments };
  }

  async function loadThreadHistory(threadId: string) {
    const result = await rpc<{
      thread?: {
        status?: Json;
        turns?: Array<{ id?: string; status?: string; items?: Json[] }>;
      };
    }>(
      "thread/read",
      { threadId, includeTurns: true }
    );

    const turns = result?.thread?.turns ?? [];
    const threadState = codexThreadStatusToExecutionState(result?.thread?.status);
    const latestTurn = turns.at(-1);
    const latestTurnState = latestTurn
      ? codexTurnStatusToExecutionState(latestTurn.status)
      : "idle";

    if (isExecutionActive(threadState)) {
      activeTurnId =
        [...turns].reverse().find(turn =>
          codexTurnStatusToExecutionState(turn.status) === "running"
        )?.id ?? activeTurnId;
      setExecutionState(threadState);
    } else if (latestTurn) {
      activeTurnId = latestTurnState === "running" ? latestTurn.id ?? null : null;
      setExecutionState(latestTurnState);
    } else {
      activeTurnId = null;
      setExecutionState("idle");
    }

    transcript.replaceChildren();

    for (const turn of turns) {
      for (const item of turn.items ?? []) {
        const user = parseUserMessage(item);
        if (user) {
          addMessage("user", user.text, user.attachments);
          continue;
        }

        if (isMcpToolItem(item)) {
          addMcpToolResult(item);
          continue;
        }

        if (item?.type === "agentMessage" && typeof item.text === "string" && item.text) {
          addMessage("assistant", item.text, [], true);
        }
      }
    }

    if (!transcript.childElementCount) {
      transcript.innerHTML = `
        <div class="cx-welcome">
          <div class="cx-welcome-mark">✦</div>
          <h2>新しいチャット</h2>
          <p>メッセージを送るとここに会話が表示されます。</p>
        </div>
      `;
    }

    followLatest();
  }

  async function selectThread(thread: ThreadSummary) {
    try {
      const resumed = await rpc<{ model?: string; cwd?: string }>(
        "thread/resume",
        { threadId: thread.id }
      );
      activeThreadId = thread.id;
      activeTurnId = null;
      activeAssistantBubble = null;
      localStorage.setItem("opencode-pocket-codex-thread", thread.id);
      title.textContent = thread.name || thread.preview || "Codex";

      if (resumed?.model) persistSelectedModel(resumed.model);

      const resumedCwd = resumed?.cwd || thread.cwd;
      if (resumedCwd) {
        const project = projects.find(item => item.path === resumedCwd);
        if (project) setActiveProject(project);
      }

      followsBottom = true;
      await loadThreadHistory(thread.id);
      renderThreads();
    } catch (error) {
      addMessage("system", error instanceof Error ? error.message : "チャットを開けませんでした");
    }
  }

  function selectedSkills(scope: "project" | "thread", id: string) {
    try {
      const parsed = JSON.parse(localStorage.getItem("devmoter-active-skills:" + scope + ":" + id) || "[]");
      if (!Array.isArray(parsed)) return [];
      return parsed
        .filter(item => item && typeof item.path === "string" && item.path)
        .map(item => ({ id: String(item.id || item.path), name: String(item.name || "Skill"), path: String(item.path) }));
    } catch {
      return [];
    }
  }

  function activeSkillInputs(threadId: string) {
    const combined = new Map<string, { name: string; path: string }>();
    if (activeProject?.id) {
      for (const skill of selectedSkills("project", activeProject.id)) combined.set(skill.path, { name: skill.name, path: skill.path });
    }
    for (const skill of selectedSkills("thread", threadId)) combined.set(skill.path, { name: skill.name, path: skill.path });
    return [...combined.values()];
  }

  async function sessionDeveloperInstructions() {
    if (!activeProject?.id) return "";
    const response = await fetch("/api/dev/session-context?projectId=" + encodeURIComponent(activeProject.id), { cache: "no-store" });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload?.error || "Rulesを読み込めませんでした");
    return typeof payload?.developerInstructions === "string" ? payload.developerInstructions : "";
  }

  async function createThread() {
    try {
      const params: Json = {};
      if (selectedModel) params.model = selectedModel;
      if (activeProject?.id) params.projectId = activeProject.id;
      const developerInstructions = await sessionDeveloperInstructions();
      if (developerInstructions) params.developerInstructions = developerInstructions;
      const result = await rpc<{ thread?: ThreadSummary; model?: string }>("thread/start", params);
      const thread = result?.thread;
      if (!thread?.id) throw new Error("thread id が返りませんでした");

      activeThreadId = thread.id;
      activeTurnId = null;
      if (result?.model) persistSelectedModel(result.model);
      localStorage.setItem("opencode-pocket-codex-thread", thread.id);
      title.textContent = "新しいチャット";
      transcript.innerHTML = `
        <div class="cx-welcome">
          <div class="cx-welcome-mark">✦</div>
          <h2>何を作ろうか？</h2>
          <p>メッセージ、画像、ファイルを送れます。</p>
        </div>
      `;
      await loadThreads();
      closeSidebar();
      return thread.id;
    } catch (error) {
      addMessage("system", error instanceof Error ? error.message : "新しいチャットを作れませんでした");
      return null;
    }
  }

  function resizeComposer() {
    promptInput.style.height = "auto";
    promptInput.style.height = `${Math.min(promptInput.scrollHeight, 160)}px`;
  }

  function renderAttachments() {
    attachmentStrip.replaceChildren();
    attachmentStrip.classList.toggle("hidden", pendingAttachments.length === 0);

    for (const attachment of pendingAttachments) {
      const chip = document.createElement("div");
      chip.className = "cx-attachment-chip";

      if (attachment.kind === "image" && attachment.dataUrl) {
        const img = document.createElement("img");
        img.src = attachment.dataUrl;
        img.alt = "";
        chip.appendChild(img);
      } else {
        const icon = document.createElement("span");
        icon.className = "cx-file-icon";
        icon.textContent = "⌑";
        chip.appendChild(icon);
      }

      const name = document.createElement("span");
      name.textContent = attachment.name;
      chip.appendChild(name);

      const remove = document.createElement("button");
      remove.type = "button";
      remove.textContent = "×";
      remove.addEventListener("click", () => {
        pendingAttachments = pendingAttachments.filter(item => item.id !== attachment.id);
        renderAttachments();
      });
      chip.appendChild(remove);

      attachmentStrip.appendChild(chip);
    }
  }

  function fileToDataUrl(blob: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(reader.error || new Error("ファイルを読めませんでした"));
      reader.readAsDataURL(blob);
    });
  }

  async function uploadAttachment(
    blob: File,
    kind: "image" | "file"
  ): Promise<PendingAttachment> {
    const limit = kind === "image" ? 10 * 1024 * 1024 : 15 * 1024 * 1024;
    if (blob.size > limit) {
      throw new Error(
        `${blob.name} は${kind === "image" ? "10" : "15"}MBを超えています`
      );
    }

    const dataUrl = await fileToDataUrl(blob);
    const res = await fetch("/api/codex/upload", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-pocket-operation-id": uid()
      },
      body: JSON.stringify({
        name: blob.name,
        type: blob.type || "application/octet-stream",
        data: dataUrl
      })
    });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(payload?.error || "ファイルをアップロードできませんでした");
    }

    return {
      id: uid(),
      name: blob.name,
      type: blob.type,
      kind,
      dataUrl: kind === "image" ? dataUrl : undefined,
      uploadId: String(payload.uploadId || ""),
      size: blob.size
    };
  }

  async function addFiles(files: FileList | File[], forceImages = false) {
    try {
      for (const blob of Array.from(files)) {
        const kind: "image" | "file" =
          forceImages || blob.type.startsWith("image/") ? "image" : "file";
        pendingAttachments.push(await uploadAttachment(blob, kind));
      }
      renderAttachments();
    } catch (error) {
      addMessage("system", error instanceof Error ? error.message : String(error));
    }
  }

  function contextTokenAtCursor() {
    const cursor = promptInput.selectionStart ?? promptInput.value.length;
    const prefix = promptInput.value.slice(0, cursor);
    const match = prefix.match(/(?:^|\s)@([^\s@]*)$/);
    if (!match) return null;
    const raw = match[0];
    const at = raw.lastIndexOf("@");
    return {
      query: match[1] || "",
      start: cursor - raw.length + at,
      end: cursor
    };
  }

  function hideContextPalette() {
    contextPalette.classList.add("hidden");
    contextPalette.replaceChildren();
  }

  async function updateContextSuggestions() {
    const token = contextTokenAtCursor();
    if (!token || !activeProject) {
      hideContextPalette();
      return;
    }

    const serial = ++contextRequestSerial;
    try {
      const payload = await projectApi<{
        entries?: Array<{
          path: string;
          name: string;
          kind: "file" | "folder";
          size?: number | null;
        }>;
      }>(
        `/${encodeURIComponent(activeProject.id)}/context?q=${encodeURIComponent(token.query)}`
      );
      if (serial !== contextRequestSerial) return;

      const entries = (payload.entries ?? []).slice(0, 12);
      contextPalette.replaceChildren();
      if (!entries.length) {
        hideContextPalette();
        return;
      }

      for (const entry of entries) {
        const option = document.createElement("button");
        option.type = "button";
        option.className = "cx-context-option";
        option.setAttribute("role", "option");

        const icon = document.createElement("span");
        icon.textContent = entry.kind === "folder" ? "▱" : "⌑";
        const copy = document.createElement("span");
        const strong = document.createElement("strong");
        const small = document.createElement("small");
        strong.textContent = "@" + entry.path;
        small.textContent = entry.kind === "folder"
          ? "folder · bounded expansion"
          : String(entry.size ?? "?") + " bytes";
        copy.append(strong, small);
        option.append(icon, copy);

        option.addEventListener("click", () => {
          const before = promptInput.value.slice(0, token.start);
          const after = promptInput.value.slice(token.end);
          const replacement = "@" + entry.path;
          promptInput.value = before + replacement + after;
          const caret = before.length + replacement.length;
          promptInput.setSelectionRange(caret, caret);
          selectedContextRefs = [
            ...selectedContextRefs.filter(item => item.path !== entry.path),
            { path: entry.path, kind: entry.kind }
          ].slice(-16);
          hideContextPalette();
          resizeComposer();
          promptInput.focus();
        });
        contextPalette.appendChild(option);
      }
      contextPalette.classList.remove("hidden");
    } catch {
      hideContextPalette();
    }
  }

  async function resolvedContextText(text: string) {
    if (!activeProject) return "";
    const references = selectedContextRefs
      .filter(ref => text.includes("@" + ref.path))
      .slice(0, 16);
    if (!references.length) return "";

    const payload = await projectApi<{
      items?: Array<{ path: string; content: string; size: number }>;
      truncated?: boolean;
    }>(
      `/${encodeURIComponent(activeProject.id)}/context/resolve`,
      {
        method: "POST",
        body: JSON.stringify({ references })
      }
    );

    const sections = (payload.items ?? []).map(item =>
      "--- @" + item.path + " ---\n" + item.content
    );
    if (payload.truncated) {
      sections.push("[Context expansion was truncated by DevMoter safety limits.]");
    }
    return sections.join("\n\n");
  }

  async function sendMessage() {
    const text = promptInput.value.trim();
    if (!text && pendingAttachments.length === 0) return;

    if (text) {
      try {
        const guard = await runPreExecutionGuard(text);
        if (guard.decision === "block") {
          addMessage("system", `Safety guard blocked this request:\n${guardMessage(guard)}`);
          return;
        }
        if (
          guard.decision === "warn" &&
          !window.confirm(`Safety check before execution:\n\n${guardMessage(guard)}\n\nContinue?`)
        ) return;
      } catch {
        addMessage("system", "Safety guard unavailable; request was not sent.");
        return;
      }
    }

    let contextText = "";
    try {
      contextText = await resolvedContextText(text);
    } catch (error) {
      addMessage(
        "system",
        "Project context could not be resolved: " +
          (error instanceof Error ? error.message : String(error))
      );
      return;
    }

    let threadId = activeThreadId;
    if (!threadId) threadId = await createThread();
    if (!threadId) return;

    const displayAttachments = pendingAttachments.map(item => ({
      name: item.name,
      kind: item.kind
    }));

    followsBottom = true;
    addMessage("user", text, displayAttachments);
    followLatest();

    const input: Json[] = [];
    const effectiveText = contextText
      ? text + "\n\n[Project context resolved by DevMoter]\n" + contextText
      : text;
    if (effectiveText) input.push({ type: "text", text: effectiveText });

    for (const skill of activeSkillInputs(threadId)) {
      input.push({ type: "skill", name: skill.name, path: skill.path });
    }

    for (const attachment of pendingAttachments) {
      if (attachment.kind === "image" && attachment.uploadId) {
        input.push({
          type: "localImage",
          uploadId: attachment.uploadId
        });
      } else if (attachment.uploadId) {
        input.push({
          type: "mention",
          name: attachment.name,
          uploadId: attachment.uploadId
        });
      }
    }

    promptInput.value = "";
    pendingAttachments = [];
    selectedContextRefs = [];
    hideContextPalette();
    renderAttachments();
    resizeComposer();
    plusMenu.classList.add("hidden");
    activeAssistantBubble = null;
    setExecutionState("running");

    const operationId = uid();
    let params: Json = {
      threadId,
      input,
      clientUserMessageId: operationId
    };
    params = applyReasoningToTurnStart(params, reasoningMode);
    if (selectedModel) params.model = selectedModel;

    try {
      const result = await rpc<{ turn?: { id?: string } }>(
        "turn/start",
        params,
        { operationId }
      );
      activeTurnId = result?.turn?.id ?? activeTurnId;
    } catch (error) {
      setExecutionState("failed");
      addMessage("system", error instanceof Error ? error.message : "送信できませんでした");
    }
  }

  async function interrupt() {
    if (!activeThreadId || !activeTurnId) return;
    try {
      await rpc("turn/interrupt", {
        threadId: activeThreadId,
        turnId: activeTurnId
      });
    } catch (error) {
      addMessage("system", error instanceof Error ? error.message : "停止できませんでした");
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
    if (!shouldOpenEventSource(online, Boolean(events))) return;
    events = new EventSource("/api/codex/events");

    events.onopen = () => {
      reconnectAttempts = 0;
      if (reconnectTimer !== null) {
        window.clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }

      if (executionState === "reconnecting") {
        void refresh().finally(() => {
          if (executionState === "reconnecting") {
            setExecutionState("idle");
            showToast("再接続しました");
          }
        });
      }
    };

    events.addEventListener("notification", raw => {
      const event = raw as MessageEvent;
      const message = JSON.parse(event.data) as { method: string; params: Json };
      const { method, params } = message;

      if (method === "thread/settings/updated") {
        const threadId = params?.threadId;
        const model = params?.threadSettings?.model;
        if (threadId === activeThreadId && typeof model === "string" && model) {
          persistSelectedModel(model);
        }
        return;
      }

      if (method === "model/rerouted") {
        const threadId = params?.threadId;
        const toModel = params?.toModel;
        if (threadId === activeThreadId && typeof toModel === "string" && toModel) {
          persistSelectedModel(toModel);
          showToast(`Codexが ${modelDisplayName(toModel)} に切り替えました`);
        }
        return;
      }

      if (method === "turn/started") {
        activeTurnId = params?.turn?.id ?? params?.turnId ?? activeTurnId;
        setExecutionState("running");
        return;
      }

      if (method === "turn/completed") {
        const finalState = codexTurnStatusToExecutionState(params?.turn?.status);
        setExecutionState(finalState);
        activeTurnId = null;
        if (activeAssistantBubble) {
          activeAssistantBubble.closest(".cx-message-row")?.classList.remove("live");
          addAssistantActions(activeAssistantBubble);
        }
        activeAssistantBubble = null;
        if (activeThreadId) {
          const threadId = activeThreadId;
          void loadThreadHistory(threadId);
          if (finalState === "completed") {
          }
        }
        void loadThreads();
        return;
      }

      if (method === "item/completed" && params?.item && isMcpToolItem(params.item)) {
        addMcpToolResult(params.item);
        return;
      }

      if (method === "item/agentMessage/delta") {
        const delta = typeof params?.delta === "string" ? params.delta : "";
        if (!delta) return;
        if (!activeAssistantBubble) {
          activeAssistantBubble = addMessage("assistant", "", [], false);
          activeAssistantBubble.closest(".cx-message-row")?.classList.add("live");
        }
        let textNode = activeAssistantBubble.querySelector<HTMLElement>(".cx-message-text");
        if (!textNode) {
          textNode = document.createElement("div");
          textNode.className = "cx-message-text";
          activeAssistantBubble.appendChild(textNode);
        }
        textNode.textContent += delta;
        followLatest();
        return;
      }

      if (method === "serverRequest/resolved" && pendingApproval) {
        pendingApproval = null;
        pendingApprovalSafety = "";
        approval.classList.add("hidden");
        if (executionState === "waiting_for_approval") {
          setExecutionState("running");
        }
      }
    });

    events.addEventListener("server-request", async raw => {
      const event = raw as MessageEvent;
      const request = JSON.parse(event.data) as {
        id: string | number;
        method: string;
        params: Json;
      };

      if (
        request.method !== "item/commandExecution/requestApproval" &&
        request.method !== "item/fileChange/requestApproval"
      ) {
        addMessage("system", `Codexから未対応の確認要求: ${request.method}`);
        return;
      }

      const command = String(request.params?.command || "");
      const scope = codexPermissionScope(request);
      let loopState: LoopResult | null = null;
      try {
        loopState = await recordAgentAction({
          runId: codexLoopRunId(request),
          action: scope.action,
          tool: scope.tool,
          details: {
            cwd: request.params?.cwd || null,
            grantRoot: request.params?.grantRoot || null
          }
        });
      } catch {
        loopState = null;
      }

      try {
        const remembered = await matchRememberedPermission(scope, command || undefined);
        if (remembered.matched && !remembered.blockedByRisk && !loopState?.paused) {
          const autoOperationId = `codex-remembered-${String(request.id)}`;
          const auto = await fetch("/api/codex/approval", {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "x-pocket-operation-id": autoOperationId
            },
            body: JSON.stringify({ id: request.id, decision: "accept" })
          });
          if (auto.ok) {
            addMessage("system", "Applied a remembered, narrowly scoped Codex approval.");
            return;
          }
        }
      } catch {
        // Fall back to the explicit approval UI.
      }

      pendingApprovalSafety = loopState?.paused ? loopMessage(loopState) : "";
      pendingApproval = request;
      setExecutionState("waiting_for_approval");
      approval.classList.remove("hidden");
      const isFileChange = request.method === "item/fileChange/requestApproval";
      approvalTitle.textContent = isFileChange
        ? "ファイル変更を許可しますか？"
        : "コマンド実行を許可しますか？";

      const contextRows = [
        ["Backend", "Codex"],
        ["Thread", String(request.params?.threadId || activeThreadId || "unknown")],
        ["Turn", String(request.params?.turnId || activeTurnId || "unknown")],
        ["Action", isFileChange ? "File change" : "Command execution"]
      ];
      approvalMeta.replaceChildren(
        ...contextRows.map(([label, value]) => {
          const row = document.createElement("div");
          const key = document.createElement("span");
          const val = document.createElement("strong");
          key.textContent = label;
          val.textContent = value;
          row.append(key, val);
          return row;
        })
      );

      approvalDetail.textContent = [
        request.params?.reason ? `Reason: ${request.params.reason}` : "",
        request.params?.command ? `Command:\n${request.params.command}` : "",
        request.params?.cwd ? `Working directory:\n${request.params.cwd}` : "",
        request.params?.grantRoot ? `Requested write root:\n${request.params.grantRoot}` : ""
      ].filter(Boolean).join("\n\n") || "Codex is requesting permission to continue.";
      if (pendingApprovalSafety) {
        approvalDetail.textContent += `\n\nSafety pause:\n${pendingApprovalSafety}`;
      }
    });

    events.addEventListener("offline", () => {
      setOnline(false);
    });

    events.onerror = () => {
      events?.close();
      events = null;
      scheduleEventReconnect();
    };
  }

  function codexPermissionScope(request: { method: string; params: Json }): PermissionScope {
    const action = String(
      request.params?.command ||
      request.params?.grantRoot ||
      request.params?.reason ||
      request.method
    );
    return {
      backend: "codex",
      tool: request.method,
      action,
      projectId: activeProject?.id || "",
      sessionId: String(request.params?.threadId || activeThreadId || "")
    };
  }

  function codexLoopRunId(request: { params: Json }) {
    return `codex:${String(request.params?.threadId || activeThreadId || "global")}`;
  }

  async function answerApproval(
    decision: "accept" | "acceptForSession" | "decline"
  ) {
    if (!pendingApproval) return;

    const request = pendingApproval;
    denyApproval.disabled = true;
    acceptApproval.disabled = true;
    acceptSessionApproval.disabled = true;

    try {
      const command = String(request.params?.command || "");
      const scope = codexPermissionScope(request);
      let commandRisk: CommandScan | null = null;
      let effectiveDecision = decision;

      if (decision !== "decline" && command) {
        try {
          commandRisk = await scanCommand(command);
        } catch {
          throw new Error("Safety scan unavailable; approval was not sent.");
        }
        if (
          commandRisk.dangerous &&
          !window.confirm(
            `High-risk command detected:\n\n${commandRisk.command}\n\nReasons:\n${commandRisk.reasons.map(reason => `• ${reason}`).join("\n")}\n\nApprove this one execution?`
          )
        ) return;
        if (commandRisk.dangerous && decision === "acceptForSession") {
          effectiveDecision = "accept";
          addMessage("system", "High-risk commands can only be approved once; session-wide approval was downgraded.");
        }
      }

      if (decision !== "decline" && pendingApprovalSafety) {
        if (!window.confirm(`Repeated-action safety pause:\n\n${pendingApprovalSafety}\n\nContinue this run?`)) return;
        await continueAgentRun(codexLoopRunId(request)).catch(() => {});
      }

      if (effectiveDecision === "acceptForSession" && !commandRisk?.dangerous) {
        await rememberPermission(scope, {
          note: "Remembered from Codex session approval",
          ttlMs: 24 * 60 * 60 * 1000
        }).catch(() => {});
      }

      const approvalOperationId =
        `codex-approval-${String(request.id)}-${effectiveDecision}`;
      const res = await fetch("/api/codex/approval", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-pocket-operation-id": approvalOperationId
        },
        body: JSON.stringify({ id: request.id, decision: effectiveDecision })
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (payload?.duplicate) {
          void refresh();
          return;
        }
        throw new Error(payload?.error || "許可応答に失敗しました");
      }

      pendingApproval = null;
      pendingApprovalSafety = "";
      approval.classList.add("hidden");
      setExecutionState("running");
    } catch (error) {
      addMessage(
        "system",
        error instanceof Error ? error.message : "許可応答に失敗しました"
      );
    } finally {
      denyApproval.disabled = false;
      acceptApproval.disabled = false;
      acceptSessionApproval.disabled = false;
    }
  }

  function appendPluginSection(
    titleText: string,
    entries: ReturnType<typeof pluginEntries>,
    errorMessage = ""
  ) {
    const section = document.createElement("section");
    section.className = "cx-settings-section";
    section.innerHTML = `<h3>${titleText}</h3>`;

    if (errorMessage) {
      const error = document.createElement("p");
      error.className = "cx-muted";
      error.textContent = errorMessage;
      section.appendChild(error);
    }

    if (!entries.length && !errorMessage) {
      const empty = document.createElement("p");
      empty.className = "cx-muted";
      empty.textContent = "見つかりませんでした。";
      section.appendChild(empty);
    }

    for (const entry of entries) {
      const row = document.createElement("div");
      row.className = "cx-plugin-row";

      const copy = document.createElement("span");
      copy.innerHTML = "<strong></strong><small></small>";
      copy.querySelector("strong")!.textContent = entry.name;
      copy.querySelector("small")!.textContent =
        `${entry.marketplace || "plugin"} · ${entry.enabled ? "有効" : "無効"}`;

      const state = document.createElement("span");
      state.className = "cx-plugin-state";
      state.textContent = entry.enabled ? "●" : "○";
      state.title = entry.enabled ? "Enabled" : "Disabled";

      row.append(copy, state);
      section.appendChild(row);
    }

    modalBody.appendChild(section);
  }

  async function showPlugins() {
    closeSidebar();
    openModal("プラグイン", "Codex 0.149.1互換のPlugin / MCPビュー");
    modalBody.innerHTML = '<div class="cx-modal-loading">読み込み中…</div>';

    const pluginParams = {
      cwds: activeProject?.path ? [activeProject.path] : []
    };

    const [installedResult, catalogResult, mcpResult] = await Promise.allSettled([
      rpc<Json>("plugin/installed", pluginParams),
      rpc<Json>("plugin/list", {
        ...pluginParams,
        forceRefetch: false
      }),
      rpc<Json>("mcpServerStatus/list", {
        detail: "toolsAndAuthOnly",
        ...(activeThreadId ? { threadId: activeThreadId } : {})
      })
    ]);

    modalBody.replaceChildren();

    const catalogEntries = catalogResult.status === "fulfilled"
      ? pluginEntries(catalogResult.value)
      : [];

    if (installedResult.status === "fulfilled") {
      const installedEntries = pluginEntries(installedResult.value);
      appendPluginSection(
        "Installed plugins",
        enrichInstalledPluginEntries(installedEntries, catalogEntries)
      );
    } else {
      const fallbackEntries = catalogEntries.filter(entry => entry.installed);
      const fallbackError = catalogResult.status === "rejected"
        ? (catalogResult.reason instanceof Error
            ? `Plugin API: ${catalogResult.reason.message}`
            : "Plugin APIを読み込めませんでした。")
        : "";
      appendPluginSection("Installed plugins", fallbackEntries, fallbackError);
    }

    const mcpSection = document.createElement("section");
    mcpSection.className = "cx-settings-section";
    mcpSection.innerHTML = "<h3>MCP</h3>";

    if (mcpResult.status === "fulfilled") {
      const mcp = mcpResult.value;
      const servers = Array.isArray(mcp?.data) ? mcp.data : [];

      if (!servers.length) {
        const empty = document.createElement("p");
        empty.className = "cx-muted";
        empty.textContent = "MCPサーバーはありません。";
        mcpSection.appendChild(empty);
      } else {
        for (const server of servers) {
          const row = document.createElement("div");
          row.className = "cx-mcp-row";

          const name = document.createElement("strong");
          name.textContent = String(server?.name || "MCP");

          const state = document.createElement("span");
          state.textContent = String(
            server?.runtimeStatus ||
            server?.authStatus ||
            "available"
          );

          row.append(name, state);
          mcpSection.appendChild(row);
        }
      }
    } else {
      const error = document.createElement("p");
      error.className = "cx-muted";
      error.textContent =
        mcpResult.reason instanceof Error
          ? `MCP: ${mcpResult.reason.message}`
          : "MCP情報を読み込めませんでした。";
      mcpSection.appendChild(error);
    }

    modalBody.appendChild(mcpSection);
  }

  async function showProjects() {
    closeSidebar();
    openModal("プロジェクト", "Codexの作業ディレクトリとMarkdownを管理します。");
    modalBody.innerHTML = '<div class="cx-modal-loading">読み込み中…</div>';

    try {
      await loadProjects();
      renderProjectPicker();
    } catch (error) {
      modalBody.textContent = error instanceof Error ? error.message : String(error);
    }
  }

  function renderProjectPicker() {
    modalBody.replaceChildren();

    const actions = document.createElement("div");
    actions.className = "cx-project-actions";

    const addExisting = document.createElement("button");
    addExisting.type = "button";
    addExisting.className = "primary";
    addExisting.textContent = "＋ 既存フォルダ";

    const createNew = document.createElement("button");
    createNew.type = "button";
    createNew.textContent = "＋ 新規Project";

    const github = document.createElement("button");
    github.type = "button";
    github.textContent = "◉ GitHub";
    actions.append(addExisting, createNew, github);
    modalBody.appendChild(actions);

    const list = document.createElement("div");
    list.className = "cx-project-list";

    if (!projects.length) {
      const empty = document.createElement("p");
      empty.className = "cx-muted";
      empty.textContent = "まだProjectが登録されていません。";
      list.appendChild(empty);
    }

    for (const project of projects) {
      const row = document.createElement("button");
      row.type = "button";
      row.className = `cx-project-row ${activeProject?.id === project.id ? "selected" : ""}`;

      const icon = document.createElement("span");
      icon.className = "cx-project-icon";
      icon.textContent = "▱";

      const copy = document.createElement("span");
      copy.className = "cx-project-copy";

      const name = document.createElement("strong");
      name.textContent = project.name;

      const path = document.createElement("small");
      path.textContent = project.path;

      copy.append(name, path);

      const state = document.createElement("span");
      state.className = "cx-project-state";
      state.textContent = activeProject?.id === project.id ? "✓" : "›";

      row.append(icon, copy, state);
      row.addEventListener("click", () => {
        setActiveProject(project);
        void showProjectWorkspace(project);
      });
      list.appendChild(row);
    }

    modalBody.appendChild(list);

    addExisting.addEventListener("click", () => showProjectAddForm("add"));
    createNew.addEventListener("click", () => showProjectAddForm("create"));
    github.addEventListener("click", () => void showGithubProjects());
  }

  async function showGithubProjects() {
    modalBody.replaceChildren();
    const back = document.createElement("button");
    back.type = "button";
    back.className = "cx-back-button";
    back.textContent = "‹ Local Projects";
    back.addEventListener("click", renderProjectPicker);

    const heading = document.createElement("h3");
    heading.textContent = "GitHub repositories";

    const status = document.createElement("p");
    status.className = "cx-muted";

    const filters = document.createElement("div");
    filters.className = "cx-github-filters";

    let visibility: "all" | "private" | "public" = "all";
    let page = 1;

    const filterButtons = ([
      ["all", "All"],
      ["private", "Private"],
      ["public", "Public"]
    ] as const).map(([value, label]) => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = label;
      button.className = "cx-github-filter";
      button.dataset.visibility = value;
      button.classList.toggle("active", value === visibility);
      filters.appendChild(button);
      return button;
    });

    const search = document.createElement("input");
    search.type = "search";
    search.placeholder = "Search all accessible repositories";
    search.className = "cx-github-search";

    const list = document.createElement("div");
    list.className = "cx-project-list";

    const pager = document.createElement("div");
    pager.className = "cx-github-pager";

    const previous = document.createElement("button");
    previous.type = "button";
    previous.textContent = "‹ Prev";

    const pageLabel = document.createElement("span");
    pageLabel.textContent = "Page 1";

    const nextPage = document.createElement("button");
    nextPage.type = "button";
    nextPage.textContent = "Next ›";

    pager.append(previous, pageLabel, nextPage);
    modalBody.append(back, heading, status, filters, search, list, pager);

    const load = async () => {
      list.textContent = "読み込み中…";
      previous.disabled = true;
      nextPage.disabled = true;

      try {
        const authResponse = await fetch("/api/github/status", { cache: "no-store" });
        const auth = await authResponse.json().catch(() => ({}));
        if (!authResponse.ok) throw new Error(auth?.error || `HTTP ${authResponse.status}`);

        status.textContent = auth.authenticated
          ? `gh: ${auth.login || "authenticated"}`
          : "GitHub CLIが未認証。ホストで gh auth login を実行してね。";

        if (!auth.authenticated) {
          list.textContent = "GitHub integration is unavailable.";
          pager.classList.add("hidden");
          return;
        }

        const query = new URLSearchParams({
          q: search.value,
          page: String(page),
          visibility
        });
        const response = await fetch(`/api/github/repos?${query.toString()}`, { cache: "no-store" });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result?.error || `HTTP ${response.status}`);

        pageLabel.textContent = search.value.trim() ? "Search" : `Page ${result.page || page}`;
        previous.disabled = Boolean(search.value.trim()) || page <= 1;
        nextPage.disabled = Boolean(search.value.trim()) || !result.hasMore;
        pager.classList.toggle("hidden", Boolean(search.value.trim()));

        if (!result.repositories?.length) {
          list.textContent =
            visibility === "private"
              ? "Privateリポジトリが見つかりません。"
              : "リポジトリが見つかりません。";
          return;
        }

        list.replaceChildren(...result.repositories.map((repo: GithubRepo) => {
          const row = document.createElement("button");
          row.type = "button";
          row.className = "cx-project-row";
          row.innerHTML = `<span class="cx-project-icon">◉</span><span class="cx-project-copy"><strong></strong><small></small></span><span class="cx-project-state">›</span>`;
          (row.querySelector("strong") as HTMLElement).textContent = repo.fullName;
          const localGitState = repo.cloned
            ? ` · local:${repo.currentBranch || repo.defaultBranch} · ${repo.dirty ? "changes" : "clean"}`
            : "";
          (row.querySelector("small") as HTMLElement).textContent =
            `${repo.private ? "Private" : "Public"} · ${repo.defaultBranch}${localGitState}`;
          row.addEventListener("click", () => void showGithubRepo(repo));
          return row;
        }));
      } catch (error) {
        status.textContent = error instanceof Error ? error.message : String(error);
        list.textContent = "GitHub情報を読み込めませんでした。";
      }
    };

    filterButtons.forEach(button => {
      button.addEventListener("click", () => {
        visibility = button.dataset.visibility as "all" | "private" | "public";
        page = 1;
        filterButtons.forEach(item => item.classList.toggle("active", item === button));
        void load();
      });
    });

    previous.addEventListener("click", () => {
      if (page <= 1) return;
      page -= 1;
      void load();
    });

    nextPage.addEventListener("click", () => {
      page += 1;
      void load();
    });

    let timer: number | undefined;
    search.addEventListener("input", () => {
      window.clearTimeout(timer);
      page = 1;
      timer = window.setTimeout(() => void load(), 250);
    });

    await load();
  }

  async function showGithubRepo(repo: GithubRepo) {
    modalBody.textContent = "ブランチを読み込み中…";
    try {
      const branchResponse = await fetch(
        `/api/github/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}/branches`,
        { cache: "no-store" }
      );
      const result = await branchResponse.json().catch(() => ({}));
      if (!branchResponse.ok) throw new Error(result?.error || `HTTP ${branchResponse.status}`);
      const refreshedDefaultBranch = String(
        result?.defaultBranch ||
        (result?.branches || []).find((branch: { default?: boolean }) => branch?.default)?.name ||
        repo.defaultBranch ||
        ""
      );
      const form = document.createElement("form");
      form.className = "cx-project-form";
      const back = document.createElement("button"); back.type = "button"; back.className = "cx-back-button"; back.textContent = "‹ GitHub"; back.addEventListener("click", () => void showGithubProjects());
      const title = document.createElement("h3"); title.textContent = repo.fullName;
      const label = document.createElement("label"); label.innerHTML = "<span>Branch</span>";
      const select = document.createElement("select");
      for (const branch of result.branches || []) {
        const option = document.createElement("option");
        option.value = branch.name;
        option.textContent = branch.name;
        option.selected = branch.name === refreshedDefaultBranch;
        select.appendChild(option);
      }
      label.appendChild(select);
      const submit = document.createElement("button"); submit.type = "submit"; submit.className = "primary"; submit.textContent = repo.cloned ? "Fetch and open" : "Clone and open";
      const error = document.createElement("p"); error.className = "cx-form-error hidden";
      form.append(back, title, label, submit, error); modalBody.replaceChildren(form);
      form.addEventListener("submit", async event => { event.preventDefault(); submit.disabled = true; error.classList.add("hidden"); try { const response = await fetch("/api/github/open", { method: "POST", headers: { "content-type": "application/json", "x-pocket-operation-id": uid() }, body: JSON.stringify({ owner: repo.owner, repo: repo.name, branch: select.value }) }); const result = await response.json(); if (!response.ok) throw new Error(result?.error || `HTTP ${response.status}`); await loadProjects(); const project = projects.find(item => item.id === result.project.id) || result.project; setActiveProject(project); await showProjectWorkspace(project); } catch (cause) { error.textContent = cause instanceof Error ? cause.message : String(cause); error.classList.remove("hidden"); } finally { submit.disabled = false; } });
    } catch (error) { modalBody.textContent = error instanceof Error ? error.message : String(error); }
  }

  function showProjectAddForm(action: "add" | "create") {
    modalBody.replaceChildren();

    const form = document.createElement("form");
    form.className = "cx-project-form";

    const back = document.createElement("button");
    back.type = "button";
    back.className = "cx-back-button";
    back.textContent = "‹ 戻る";
    back.addEventListener("click", renderProjectPicker);

    const heading = document.createElement("h3");
    heading.textContent =
      action === "create" ? "新しいProjectを作成" : "既存フォルダを追加";

    const pathLabel = document.createElement("label");
    pathLabel.innerHTML = "<span>Path</span>";
    const pathInput = document.createElement("input");
    pathInput.type = "text";
    pathInput.placeholder =
      action === "create" ? "~/MyProject" : "~/Study-Orbit";
    pathInput.autocomplete = "off";
    pathLabel.appendChild(pathInput);

    const nameLabel = document.createElement("label");
    nameLabel.innerHTML = "<span>表示名（任意）</span>";
    const nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.placeholder = "Project name";
    nameLabel.appendChild(nameInput);

    const note = document.createElement("p");
    note.className = "cx-muted";
    note.textContent =
      action === "create"
        ? "ホームディレクトリ配下に新しいフォルダを作成します。"
        : "Chromebook側に既に存在するフォルダを登録します。";

    const submit = document.createElement("button");
    submit.type = "submit";
    submit.className = "primary";
    submit.textContent = action === "create" ? "作成" : "追加";

    const error = document.createElement("div");
    error.className = "cx-form-error hidden";

    form.append(back, heading, pathLabel, nameLabel, note, submit, error);
    modalBody.appendChild(form);

    form.addEventListener("submit", async event => {
      event.preventDefault();
      error.classList.add("hidden");
      submit.disabled = true;

      try {
        const result = await projectApi<{ project: ProjectSummary }>("", {
          method: "POST",
          body: JSON.stringify({
            action,
            path: pathInput.value.trim(),
            name: nameInput.value.trim()
          })
        });

        await loadProjects();
        const project =
          projects.find(item => item.id === result.project.id) ??
          result.project;
        setActiveProject(project);
        await showProjectWorkspace(project);
      } catch (cause) {
        error.textContent = cause instanceof Error ? cause.message : String(cause);
        error.classList.remove("hidden");
      } finally {
        submit.disabled = false;
      }
    });
  }

  async function showProjectWorkspace(project: ProjectSummary) {
    setActiveProject(project);
    openModal(project.name, project.path);
    modalBody.innerHTML = '<div class="cx-modal-loading">Markdownを読み込み中…</div>';

    try {
      const result = await projectApi<{ files?: MarkdownDoc[] }>(
        `/${encodeURIComponent(project.id)}/docs`
      );
      const docs = result.files ?? [];
      modalBody.replaceChildren();

      const toolbar = document.createElement("div");
      toolbar.className = "cx-project-toolbar";

      const back = document.createElement("button");
      back.type = "button";
      back.textContent = "‹ Projects";
      back.addEventListener("click", () => void showProjects());

      const newChat = document.createElement("button");
      newChat.type = "button";
      newChat.className = "primary";
      newChat.textContent = "✎ 新しいチャット";
      newChat.addEventListener("click", () => {
        closeModal();
        void createThread();
      });

      toolbar.append(back, newChat);
      modalBody.appendChild(toolbar);

      const quick = document.createElement("section");
      quick.className = "cx-settings-section";
      quick.innerHTML = "<h3>Project Instructions</h3>";

      for (const filename of ["AGENTS.md", "HANDOFF.md", "README.md"]) {
        const found = docs.find(doc => doc.path.toUpperCase() === filename.toUpperCase());
        const button = document.createElement("button");
        button.type = "button";
        button.className = `cx-doc-quick ${found ? "exists" : "missing"}`;

        const label = document.createElement("span");
        label.innerHTML = "<strong></strong><small></small>";
        label.querySelector("strong")!.textContent = filename;
        label.querySelector("small")!.textContent =
          found ? "編集" : "まだありません · タップして作成";

        const arrow = document.createElement("span");
        arrow.textContent = found ? "›" : "＋";
        button.append(label, arrow);
        button.addEventListener("click", () =>
          void editProjectMarkdown(project, filename, !found)
        );
        quick.appendChild(button);
      }

      modalBody.appendChild(quick);

      const filesSection = document.createElement("section");
      filesSection.className = "cx-settings-section";
      const heading = document.createElement("div");
      heading.className = "cx-section-heading";

      const titleEl = document.createElement("h3");
      titleEl.textContent = `Markdown · ${docs.length}`;

      const add = document.createElement("button");
      add.type = "button";
      add.textContent = "＋ Markdown";
      add.addEventListener("click", () => showNewMarkdownForm(project));

      heading.append(titleEl, add);
      filesSection.appendChild(heading);

      if (!docs.length) {
        const empty = document.createElement("p");
        empty.className = "cx-muted";
        empty.textContent = "Markdownファイルはまだありません。";
        filesSection.appendChild(empty);
      }

      for (const doc of docs) {
        const row = document.createElement("button");
        row.type = "button";
        row.className = "cx-doc-row";

        const badge = document.createElement("span");
        badge.className = `cx-doc-badge ${doc.kind}`;
        badge.textContent =
          doc.kind === "agents" ? "A" :
          doc.kind === "handoff" ? "H" :
          doc.kind === "readme" ? "R" :
          "MD";

        const copy = document.createElement("span");
        copy.innerHTML = "<strong></strong><small></small>";
        copy.querySelector("strong")!.textContent = doc.name;
        copy.querySelector("small")!.textContent = doc.path;

        const arrow = document.createElement("span");
        arrow.textContent = "›";

        row.append(badge, copy, arrow);
        row.addEventListener("click", () => void editProjectMarkdown(project, doc.path));
        filesSection.appendChild(row);
      }

      modalBody.appendChild(filesSection);

      const danger = document.createElement("section");
      danger.className = "cx-settings-section";
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "cx-register-remove";
      remove.textContent = "このProjectの登録を解除";
      remove.addEventListener("click", async () => {
        if (!confirm(`${project.name} をDevMoterから登録解除しますか？\n実フォルダは削除しません。`)) {
          return;
        }
        await projectApi(`/${encodeURIComponent(project.id)}`, { method: "DELETE" });
        if (activeProject?.id === project.id) setActiveProject(null);
        await loadProjects();
        await showProjects();
      });
      danger.appendChild(remove);
      modalBody.appendChild(danger);
    } catch (error) {
      modalBody.textContent = error instanceof Error ? error.message : String(error);
    }
  }

  function showNewMarkdownForm(project: ProjectSummary) {
    openModal("Markdownを追加", project.name);
    modalBody.replaceChildren();

    const form = document.createElement("form");
    form.className = "cx-project-form";

    const back = document.createElement("button");
    back.type = "button";
    back.className = "cx-back-button";
    back.textContent = "‹ Project";
    back.addEventListener("click", () => void showProjectWorkspace(project));

    const label = document.createElement("label");
    label.innerHTML = "<span>ファイル名</span>";
    const input = document.createElement("input");
    input.type = "text";
    input.placeholder = "NOTES.md";
    input.autocapitalize = "off";
    input.autocomplete = "off";
    label.appendChild(input);

    const note = document.createElement("p");
    note.className = "cx-muted";
    note.textContent = "Project配下の既存フォルダも指定できます。例: docs/PLAN.md";

    const submit = document.createElement("button");
    submit.type = "submit";
    submit.className = "primary";
    submit.textContent = "エディタを開く";

    const error = document.createElement("div");
    error.className = "cx-form-error hidden";

    form.append(back, label, note, submit, error);
    modalBody.appendChild(form);

    form.addEventListener("submit", event => {
      event.preventDefault();
      let path = input.value.trim();
      if (!path.toLowerCase().endsWith(".md")) path += ".md";
      if (!path || path === ".md") {
        error.textContent = "ファイル名を入力してね";
        error.classList.remove("hidden");
        return;
      }
      void editProjectMarkdown(project, path, true);
    });
  }

  async function editProjectMarkdown(
    project: ProjectSummary,
    path: string,
    create = false
  ) {
    openModal(path, project.name);
    modalBody.innerHTML = '<div class="cx-modal-loading">読み込み中…</div>';

    try {
      let content = "";
      if (!create) {
        const result = await projectApi<{ content?: string }>(
          `/${encodeURIComponent(project.id)}/file?path=${encodeURIComponent(path)}`
        );
        content = result.content ?? "";
      }

      modalBody.replaceChildren();

      const toolbar = document.createElement("div");
      toolbar.className = "cx-md-toolbar";

      const back = document.createElement("button");
      back.type = "button";
      back.textContent = "‹ Project";

      const status = document.createElement("span");
      status.className = "cx-md-status";
      status.textContent = create ? "新規" : "保存済み";

      const save = document.createElement("button");
      save.type = "button";
      save.className = "primary";
      save.textContent = "保存";

      toolbar.append(back, status, save);

      const editor = document.createElement("textarea");
      editor.className = "cx-md-editor";
      editor.value = content;
      editor.spellcheck = false;
      editor.setAttribute("aria-label", `${path} editor`);

      const meta = document.createElement("div");
      meta.className = "cx-md-meta";
      meta.textContent = `${project.path}/${path}`;

      modalBody.append(toolbar, editor, meta);

      let dirty = create;
      modalCloseGuard = () =>
        !dirty || confirm("未保存の変更があります。閉じますか？");

      editor.addEventListener("input", () => {
        dirty = true;
        status.textContent = "未保存";
        status.classList.add("dirty");
      });

      const doSave = async () => {
        save.disabled = true;
        status.textContent = "保存中…";

        try {
          await projectApi(
            `/${encodeURIComponent(project.id)}/file`,
            {
              method: "PUT",
              body: JSON.stringify({
                path,
                content: editor.value
              })
            }
          );
          dirty = false;
          modalCloseGuard = null;
          status.textContent = "保存済み";
          status.classList.remove("dirty");
        } catch (error) {
          status.textContent = error instanceof Error ? error.message : String(error);
          status.classList.add("dirty");
        } finally {
          save.disabled = false;
        }
      };

      save.addEventListener("click", () => void doSave());
      editor.addEventListener("keydown", event => {
        if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
          event.preventDefault();
          void doSave();
        }
      });

      back.addEventListener("click", () => {
        if (dirty && !confirm("未保存の変更があります。戻りますか？")) return;
        void showProjectWorkspace(project);
      });

      requestAnimationFrame(() => editor.focus());
    } catch (error) {
      modalBody.textContent = error instanceof Error ? error.message : String(error);
    }
  }

  async function showModels() {
    openModal(
      "Provider · Model · Agent",
      activeThreadId ? "このチャットの実行環境を変更" : "次のチャットで使う実行環境"
    );
    modalBody.innerHTML = '<div class="cx-modal-loading">読み込み中…</div>';

    try {
      const models = await loadModelCatalog();
      modalBody.replaceChildren();

      const runtime = document.createElement("section");
      runtime.className = "cx-settings-section cx-runtime-summary";
      const heading = document.createElement("h3");
      heading.textContent = "Runtime";
      runtime.appendChild(heading);

      const runtimeRows: Array<[string, string]> = [
        ["Provider", "Codex · " + (online ? "available" : "offline")],
        ["Agent", "codex · supported"],
        ["Scope", activeThreadId ? "session" : activeProject ? "project" : "default"]
      ];
      for (const [label, value] of runtimeRows) {
        const row = document.createElement("div");
        row.className = "cx-info-row";
        const key = document.createElement("span");
        const val = document.createElement("strong");
        key.textContent = label;
        val.textContent = value;
        row.append(key, val);
        runtime.appendChild(row);
      }
      modalBody.appendChild(runtime);

      const list = document.createElement("div");
      list.className = "cx-model-list";
      const defaultModel = models.find(model => model.isDefault) ?? models[0] ?? null;

      if (defaultModel) {
        const auto = document.createElement("button");
        auto.type = "button";
        auto.className = `cx-model-row ${
          !selectedModel || selectedModel === defaultModel.model ? "selected" : ""
        }`;
        const strong = document.createElement("strong");
        const small = document.createElement("small");
        strong.textContent = "Default";
        small.textContent =
          (defaultModel.displayName || defaultModel.model) + " · Codex default";
        auto.append(strong, small);
        auto.addEventListener("click", () => {
          void applyModelSelection(
            defaultModel.model,
            defaultModel.displayName || defaultModel.model
          ).catch(error => {
            modalBody.textContent = error instanceof Error ? error.message : String(error);
          });
        });
        list.appendChild(auto);
      }

      for (const model of models.filter(model => !model.hidden)) {
        const value = model.model;
        const name = model.displayName || value;
        const option = document.createElement("button");
        option.type = "button";
        option.disabled = !online;
        option.className =
          "cx-model-row " +
          (selectedModel === value ? "selected " : "") +
          (online ? "" : "unavailable");

        const strong = document.createElement("strong");
        const small = document.createElement("small");
        strong.textContent = name;
        small.textContent = online
          ? (model.description ? value + " · " + model.description : value)
          : value + " · provider unavailable";
        option.append(strong, small);

        if (online) {
          option.addEventListener("click", () => {
            void applyModelSelection(value, name).catch(error => {
              modalBody.textContent = error instanceof Error ? error.message : String(error);
            });
          });
        }
        list.appendChild(option);
      }

      modalBody.appendChild(list);
    } catch (error) {
      modalBody.textContent = error instanceof Error ? error.message : String(error);
    }
  }

  function showRemote() {
    closeSidebar();
    openModal("リモート", "DevMoter接続情報");
    modalBody.innerHTML = `
      <section class="cx-settings-section">
        <div class="cx-info-row"><span>Codex</span><strong>${online ? "Connected" : "Offline"}</strong></div>
        <div class="cx-info-row"><span>Transport</span><strong>app-server / stdio</strong></div>
        <div class="cx-info-row"><span>Access</span><strong>Tailscale / DevMoter</strong></div>
      </section>
    `;
  }

  async function refresh() {
    await loadProjects();
    if (!online) return;

    try {
      await loadModelCatalog();
    } catch {
      // Thread/chat can still work if the model catalog is temporarily unavailable.
    }

    const threadBeforeRefresh = activeThreadId;
    await loadThreads();

    if (threadBeforeRefresh && activeThreadId === threadBeforeRefresh) {
      await loadThreadHistory(threadBeforeRefresh);
    }
  }

  menu.addEventListener("click", openSidebar);
  agentSwitchButton.addEventListener("click", () => {
    const open = agentSwitchMenu.classList.toggle("hidden") === false;
    agentSwitchButton.setAttribute("aria-expanded", String(open));
  });
  sidebarClose.addEventListener("click", closeSidebar);
  scrim.addEventListener("click", closeSidebar);
  threadSearch.addEventListener("input", renderThreads);
  newChatSide.addEventListener("click", () => void createThread());
  newChatTop.addEventListener("click", () => void createThread());
  projectsNav.addEventListener("click", () => {
    closeSidebar();
    void showProjects();
  });
  const devWorkflowPanel = createDevWorkflowPanel({
    modalBody,
    openModal,
    closeSidebar,
    getActiveProject: () => activeProject,
    getActiveThreadId: () => activeThreadId,
    showToast,
    uid
  });
  devWorkflowsNav.addEventListener("click", () => void devWorkflowPanel.show());
  integrationsNav.addEventListener("click", () => {
    closeSidebar();
    options.onIntegrations?.();
  });
  settingsNav.addEventListener("click", () => {
    closeSidebar();
    window.dispatchEvent(new CustomEvent("devmoter:open-settings"));
  });

  libraryNav.addEventListener("click", showLibrary);
  root.querySelectorAll<HTMLButtonElement>(".cx-agent-option").forEach(button => {
    button.addEventListener("click", () => {
      const agent = button.dataset.agent || "codex";
      if (agent === "opencode") {
        closeSidebar();
        options.onOpenCode?.();
        return;
      }
      if (agent === "api") {
        closeSidebar();
        options.onApi?.();
        return;
      }
      agentSwitchMenu.classList.add("hidden");
      agentSwitchButton.setAttribute("aria-expanded", "false");
    });
  });
  titleButton.addEventListener("click", () => void showModels());
  modelTop.addEventListener("click", () => void showModels());
  modalClose.addEventListener("click", closeModal);
  modal.addEventListener("click", event => {
    if (event.target === modal) closeModal();
  });

  plus.addEventListener("click", () => plusMenu.classList.toggle("hidden"));
  photo.addEventListener("click", () => photoInput.click());
  file.addEventListener("click", () => fileInput.click());
  pluginsQuick.addEventListener("click", () => {
    plusMenu.classList.add("hidden");
    void showPlugins();
  });
  reasoningTop.addEventListener("click", showReasoningPicker);
  think.addEventListener("click", showReasoningPicker);
  usageTop.addEventListener("click", () => void showUsage());
  voice.addEventListener("click", () => {
    const SpeechRecognition = (window as Window & { SpeechRecognition?: new () => any; webkitSpeechRecognition?: new () => any }).SpeechRecognition ||
      (window as Window & { webkitSpeechRecognition?: new () => any }).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      showToast("このブラウザは音声入力に未対応です");
      return;
    }
    const recognition = new SpeechRecognition();
    recognition.lang = speechRecognitionLanguage();
    recognition.interimResults = true;
    voice.classList.add("listening");
    recognition.onresult = (event: any) => {
      const text = Array.from(event.results as ArrayLike<{ 0: { transcript: string } }>)
        .map(result => result[0]?.transcript || "").join("");
      promptInput.value = text;
      resizeComposer();
    };
    recognition.onerror = () => showToast("音声入力に失敗しました");
    recognition.onend = () => voice.classList.remove("listening");
    recognition.start();
  });

  photoInput.addEventListener("change", () => {
    if (photoInput.files) void addFiles(photoInput.files, true);
    photoInput.value = "";
    plusMenu.classList.add("hidden");
  });
  fileInput.addEventListener("change", () => {
    if (fileInput.files) void addFiles(fileInput.files);
    fileInput.value = "";
    plusMenu.classList.add("hidden");
  });

  let composerDragDepth = 0;
  promptForm.addEventListener("dragenter", event => {
    if (!event.dataTransfer?.types.includes("Files")) return;
    event.preventDefault();
    composerDragDepth += 1;
    promptForm.classList.add("dragging");
  });
  promptForm.addEventListener("dragover", event => {
    if (!event.dataTransfer?.types.includes("Files")) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    promptForm.classList.add("dragging");
  });
  promptForm.addEventListener("dragleave", event => {
    if (!event.dataTransfer?.types.includes("Files")) return;
    event.preventDefault();
    composerDragDepth = Math.max(0, composerDragDepth - 1);
    if (composerDragDepth === 0) promptForm.classList.remove("dragging");
  });
  promptForm.addEventListener("drop", event => {
    if (!event.dataTransfer?.files?.length) return;
    event.preventDefault();
    composerDragDepth = 0;
    promptForm.classList.remove("dragging");
    plusMenu.classList.add("hidden");
    void addFiles(event.dataTransfer.files);
  });

  localStorage.removeItem("opencode-pocket-codex-think");
  syncReasoningLabels();
  updateUsage();

  promptInput.addEventListener("input", resizeComposer);
  promptInput.addEventListener("keydown", event => {
    if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;
    if (!contextPalette.classList.contains("hidden")) {
      const first = contextPalette.querySelector<HTMLButtonElement>(".cx-context-option");
      if (first) {
        event.preventDefault();
        first.click();
        return;
      }
    }
    event.preventDefault();
    if (!isExecutionActive(executionState)) void sendMessage();
  });

  promptForm.addEventListener("submit", event => {
    event.preventDefault();
    if (isExecutionActive(executionState)) void interrupt();
    else void sendMessage();
  });

  acceptApproval.addEventListener("click", () => void answerApproval("accept"));
  acceptSessionApproval.addEventListener("click", () => void answerApproval("acceptForSession"));
  denyApproval.addEventListener("click", () => void answerApproval("decline"));

  updateContextLabel();
  setOnline(false);
  resizeComposer();

  return {
    setOnline,
    refresh
  };
}
