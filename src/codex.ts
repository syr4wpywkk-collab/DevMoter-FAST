import { formatCodexResetTime as formatResetTime, codexFeedbackKey as feedbackKey } from "./codex/presentation";
import { getAppDefinition } from "./app-registry";
import { cxIcons } from "./codex/icons";
import { codexThreadStatusToExecutionState, codexTurnStatusToExecutionState, isExecutionActive, type ExecutionState } from "./execution-state.mjs";
import { bindLanguageSelectors, formatNumber, localeTag, speechRecognitionLanguage, t, tApp, translateServerMessage } from "./i18n";

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function codexSendErrorCategory(category: string): string {
  switch (category) {
    case "Authentication": return t("codex.sendError.category.authentication");
    case "Rate limit": return t("codex.sendError.category.rateLimit");
    case "Usage limit": return t("codex.sendError.category.usageLimit");
    case "Connection": return t("codex.sendError.category.connection");
    case "Request": return t("codex.sendError.category.request");
    case "Service": return t("codex.sendError.category.service");
    case "Model": return t("codex.sendError.category.model");
    case "Codex error": return t("codex.sendError.category.codexError");
    default: return translateServerMessage(category);
  }
}

function codexSendErrorReason(reason: string): string {
  return reason === "Codex did not provide a reason." ? t("codex.sendError.noReason") : translateServerMessage(reason);
}
import { createDevWorkflowPanel } from "./dev-workflows-ui";
import { isMcpToolItem, mcpToolSummary, normalizeStructuredMcpResult } from "./mcp-result";
import { setWakeLockExecutionActive } from "./wake-lock";
import { enrichInstalledPluginEntries, pluginEntries } from "./codex-plugin-metadata.mjs";
import { applyReasoningToTurnStart, fetchAllCodexModels, reasoningChoices, reconcileReasoningMode } from "./codex-reasoning.mjs";
import { normalizeCodexSendError } from "./codex-send-error.mjs";
import { reconnectDelay, shouldOpenEventSource, shouldScheduleReconnect } from "./reconnect-policy.mjs";
import { createLatestRequestGuard } from "./latest-request.mjs";
import { reconnectAfterSync } from "./reconnect-after-sync.mjs";
import { normalizeCodexThreadList } from "./codex-thread-list.mjs";
import { normalizeCodexThreadHistory } from "./codex-thread-history.mjs";
import { recoverAfterEventOpen } from "./event-recovery.mjs";
import { fetchWithTimeout } from "./fetch-with-timeout.mjs";
import { createSheetHeader } from "./sheet-header.mjs";
import { shortProjectPath } from "./project-labels.mjs";

// Line icons for Project rows (one set, 18px, 1.5 stroke, currentColor).
const PROJECT_ROW_ICONS = {
  folder: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" aria-hidden="true"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/></svg>',
  check: () => `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-label="${escapeHtml(t("codex.icon.selectedAria"))}"><path d="m5 12 5 5 9-10"/></svg>`,
  chevron: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>'
} as const;
import { enforceTranscriptLimit } from "./bounded-transcript";
import { renderChatMarkdown } from "./chat-markdown.mjs";
import "./codex-chat.css";
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
const REMOTE_REQUEST_TIMEOUT_MS = 120_000;

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

type FailedCodexSendDraft = {
  text: string;
  attachments: PendingAttachment[];
  contextRefs: Array<{ path: string; kind: "file" | "folder" }>;
  threadId: string;
};

type FailedCodexTurn = {
  threadId: string;
  turnId: string;
  error: unknown;
  draft: FailedCodexSendDraft | null;
};

type CodexRemoteOptions = {
  onOpenCode?: () => void;
  onApi?: () => void;
  onIntegrations?: () => void;
};

export type CodexRemoteController = {
  /** `code` is the server's CLI launch code (not_installed / not_executable / failed) when Codex cannot start. */
  setOnline(online: boolean, notice?: string, code?: string): void;
  refresh(): Promise<boolean>;
};

type CodexUnavailableCode = "not_installed" | "not_executable" | "failed";

function codexUnavailableCode(code: unknown): CodexUnavailableCode | null {
  return code === "not_installed" || code === "not_executable" || code === "failed" ? code : null;
}

export function codexAvailabilityLabel(code: CodexUnavailableCode | null): string {
  if (code === "not_installed") return t("codex.availability.notInstalled");
  if (code === "not_executable" || code === "failed") return t("codex.availability.notExecutable");
  return t("common.offline");
}

export function mountCodexRemote(
  root: HTMLElement,
  options: CodexRemoteOptions = {}
): CodexRemoteController {
  root.innerHTML = `
    <div class="cx-app">
      <div id="cxScrim" class="cx-scrim hidden"></div>

      <aside id="cxSidebar" class="cx-sidebar" aria-hidden="true" aria-label="${escapeHtml(t("codex.sidebar.aria"))}" tabindex="-1">
        <div class="cx-sidebar-head dm-agent-head">
          <div class="dm-unified-agent-identity" data-unified-agent-label hidden aria-label="${escapeHtml(t("codex.sidebar.unifiedAria"))}">
            <span class="dm-unified-agent-icon" aria-hidden="true">⌘</span>
            <span class="dm-unified-agent-copy"><strong>Codex</strong><small>${escapeHtml(t("codex.sidebar.chatHistory"))}</small></span>
          </div>
          <div class="dm-agent-switch-shell">
            <button id="cxAgentSwitchButton" class="dm-agent-switch-trigger" type="button" aria-haspopup="listbox" aria-expanded="false">
              <span class="dm-agent-switch-icon">⌘</span>
              <span class="dm-agent-switch-copy"><strong>Codex</strong><small>${escapeHtml(t("codex.sidebar.currentAgent"))}</small></span>
              <span class="dm-agent-switch-chevron">⌄</span>
            </button>
            <div id="cxAgentSwitchMenu" class="dm-agent-switch-menu hidden" role="listbox" aria-label="${escapeHtml(t("codex.sidebar.selectAgentAria"))}">
              <button class="cx-agent-option active" type="button" data-agent="codex"><span>⌘</span><span><strong>Codex</strong><small>${escapeHtml(t("codex.sidebar.agentCodexSummary"))}</small></span><span>✓</span></button>
              <button class="cx-agent-option" type="button" data-agent="opencode"><span>◈</span><span><strong>OpenCode</strong><small>${escapeHtml(t("codex.sidebar.agentOpenCodeSummary"))}</small></span><span></span></button>
              <button class="cx-agent-option" type="button" data-agent="api"><span>✦</span><span><strong>API Chat</strong><small>${escapeHtml(t("codex.sidebar.agentApiSummary"))}</small></span><span></span></button>
            </div>
          </div>
          <button id="cxSidebarClose" class="cx-icon-button" type="button" aria-label="${escapeHtml(t("common.close"))}">×</button>
        </div>

        <div class="cx-sidebar-scroll">
        <button id="cxNewChatSide" class="cx-side-action primary" type="button">
          <span aria-hidden="true">✎</span><span>${escapeHtml(t("codex.sidebar.newChat"))}</span>
        </button>

        <label class="cx-search">
          <span aria-hidden="true">⌕</span>
          <input id="cxThreadSearch" type="search" placeholder="${escapeHtml(t("codex.sidebar.searchPlaceholder"))}" />
        </label>

        <nav class="cx-side-nav">
          <button id="cxProjectsNav" class="cx-nav-item" type="button">${getAppDefinition("projects").icon}<span>${escapeHtml(tApp("projects"))}</span></button>
          <button id="cxPluginsQuick" class="cx-nav-item" type="button">${cxIcons.plugins}<span>${escapeHtml(t("codex.sidebar.plugins"))}</span></button>
          <button id="cxIntegrationsNav" class="cx-nav-item" type="button">${cxIcons.integrations}<span>${escapeHtml(t("integrations.title"))}</span></button>
          <button id="cxDevWorkflowsNav" class="cx-nav-item" type="button">${getAppDefinition("developer-workflows").icon}<span>${escapeHtml(t("devWorkflows.panelTitle"))}</span></button>
        </nav>

        <div class="cx-side-section">
          <div class="cx-side-label cx-task-heading"><span>${escapeHtml(t("codex.sidebar.tasks"))}</span><span aria-hidden="true">☷</span></div>
          <div id="cxSidebarThreads" class="cx-sidebar-threads">
            <div class="cx-side-empty">${escapeHtml(t("common.loading"))}</div>
          </div>
        </div>

        </div>

        <div class="cx-sidebar-foot">
          <label class="pocket-language-setting" title="${escapeHtml(t("nav.language"))}">
            <span aria-hidden="true">◎</span>
            <select data-language-select aria-label="${escapeHtml(t("nav.language"))}">
              <option value="en">English</option>
              <option value="ja">日本語</option>
              <option value="zh-Hans">简体中文</option>
              <option value="zh-Hant">繁體中文</option>
            </select>
          </label>
          <span id="cxSideStatus" class="cx-online-pill offline"><i></i> ${escapeHtml(t("common.offline"))}</span>
        </div>
      </aside>

      <header class="cx-topbar">
        <button id="cxMenu" class="cx-icon-button" type="button" aria-label="${escapeHtml(t("codex.topbar.openHistoryAria"))}" title="${escapeHtml(t("codex.topbar.openHistoryTitle"))}">${cxIcons.menu}</button>
        <div class="cx-brand" aria-label="DevMoter"><span class="cx-brand-mark">Z</span><strong>DevMoter</strong></div>
        <button id="cxTitleButton" class="cx-title-button" type="button">
          <span id="cxTitle">Codex</span>
          <small id="cxModelLabel">${escapeHtml(t("codex.topbar.agentSubtitle"))}</small>
        </button>
        <div class="cx-topbar-controls">
          <button id="cxUsageTop" class="cx-topbar-pill cx-usage-pill" type="button" aria-label="${escapeHtml(t("codex.topbar.usage"))}" title="${escapeHtml(t("codex.topbar.usage"))}">${cxIcons.usage}<small id="cxUsageLabel">${escapeHtml(t("codex.topbar.usage"))}</small></button>
          <button id="cxDetailsTop" class="cx-topbar-pill cx-details-toggle" type="button" aria-label="${escapeHtml(t("codex.topbar.openDetailsAria"))}" aria-expanded="false">${escapeHtml(t("codex.topbar.detailsButton"))}</button>
          <button id="cxNewChatTop" class="cx-icon-button" type="button" aria-label="${escapeHtml(t("codex.sidebar.newChat"))}"><span class="cx-new-chat-label">${escapeHtml(t("codex.sidebar.newChat"))}</span>${cxIcons.newChat}</button>
        </div>
      </header>

      <main class="cx-main">
        <div id="cxTranscript" class="cx-transcript">
          <div class="cx-welcome">
            <div class="cx-welcome-mark">✦</div>
            <h2>${escapeHtml(t("codex.welcome.title"))}</h2>
            <p>${escapeHtml(t("codex.welcome.subtitle"))}</p>
          </div>
        </div>
      </main>

      <aside id="cxDetailsPanel" class="cx-details-panel" aria-label="${escapeHtml(t("codex.details.aria"))}" aria-hidden="true" tabindex="-1" inert>
        <section class="cx-detail-section">
          <div class="cx-detail-heading"><span>${escapeHtml(t("codex.details.sessionHeading"))}</span><span id="cxDetailsState" class="cx-detail-state">●</span></div>
          <strong id="cxDetailsTitle">Codex</strong>
          <small id="cxDetailsModel">${escapeHtml(t("codex.topbar.agentSubtitle"))}</small>
          <p id="cxDetailsActivity">${escapeHtml(t("codex.details.checkingConnection"))}</p>
        </section>
        <section class="cx-detail-section cx-goal-section" id="cxGoalSection" hidden>
          <div class="cx-detail-heading"><span>${escapeHtml(t("codex.details.goalHeading"))}</span><span id="cxGoalState"></span></div>
          <strong id="cxGoalText"></strong><small id="cxGoalMeta"></small>
        </section>
        <section class="cx-detail-section cx-progress-section" id="cxProgressSection" hidden>
          <div class="cx-detail-heading"><span>${escapeHtml(t("codex.details.progressHeading"))}</span></div>
          <div id="cxProgressItems"></div>
        </section>
        <section class="cx-detail-section cx-workspace-section">
          <div class="cx-detail-heading"><span>${escapeHtml(t("codex.details.workspaceHeading"))}</span></div>
        </section>
      </aside>

      <div id="cxApproval" class="cx-approval hidden">
        <div class="cx-approval-copy">
          <span class="cx-approval-eyebrow">${escapeHtml(t("codex.approval.eyebrow"))}</span>
          <strong id="cxApprovalTitle">${escapeHtml(t("codex.approval.defaultTitle"))}</strong>
          <div id="cxApprovalMeta" class="cx-approval-meta"></div>
          <pre id="cxApprovalDetail"></pre>
        </div>
        <div class="cx-approval-actions three">
          <button id="cxDenyApproval" type="button">${escapeHtml(t("codex.approval.deny"))}</button>
          <button id="cxAcceptApproval" type="button">${escapeHtml(t("codex.approval.once"))}</button>
          <button id="cxAcceptSessionApproval" class="primary" type="button">${escapeHtml(t("codex.approval.forSession"))}</button>
        </div>
      </div>

      <section class="cx-composer-wrap">
        <div id="cxExecutionStatus" class="cx-execution-status" data-state="offline" role="status" aria-live="polite">
          <i></i><span>${escapeHtml(t("codex.state.offline"))}</span>
        </div>
        <div id="cxAttachmentStrip" class="cx-attachment-strip hidden"></div>
        <div id="cxContextPalette" class="cx-context-palette hidden" role="listbox" aria-label="${escapeHtml(t("codex.composer.contextPaletteAria"))}"></div>

        <form id="cxPromptForm" class="cx-composer">
          <textarea
            id="cxPromptInput"
            rows="1"
            placeholder="${escapeHtml(t("codex.composer.promptPlaceholder"))}"
            aria-label="${escapeHtml(t("codex.composer.promptAria"))}"
          ></textarea>

          <div class="cx-composer-row">
            <div class="cx-composer-left">
              <button id="cxPlus" class="cx-round-button" type="button" aria-label="${escapeHtml(t("codex.composer.plusAria"))}" aria-expanded="false" aria-controls="cxPlusMenu">${cxIcons.plus}</button>
              <button id="cxModelTop" class="cx-topbar-pill" type="button" aria-label="${escapeHtml(t("codex.composer.modelSelectAria"))}" aria-haspopup="dialog"><small id="cxModelTopLabel">${escapeHtml(t("codex.composer.modelDefault"))}</small>${cxIcons.chevron}</button>
              <button id="cxReasoningTop" class="cx-topbar-pill" type="button" aria-label="${escapeHtml(t("codex.composer.reasoningSelectAria"))}" aria-haspopup="dialog"><small id="cxReasoningTopLabel">${escapeHtml(t("codex.reasoning.auto"))}</small>${cxIcons.chevron}</button>
            </div>
            <div class="cx-composer-right">
              <button id="cxVoice" class="cx-round-button cx-voice-button" type="button" aria-label="${escapeHtml(t("codex.composer.voiceAria"))}">${cxIcons.voice}</button>
              <button id="cxSend" class="cx-send-button" type="submit" aria-label="${escapeHtml(t("common.send"))}">${cxIcons.send}</button>
            </div>
          </div>
        </form>

        <div id="cxPlusMenu" class="cx-plus-menu hidden">
          <button id="cxPhoto" type="button">${cxIcons.image}<span>${escapeHtml(t("codex.composer.photoButton"))}</span></button>
          <button id="cxFile" type="button">${cxIcons.file}<span>${escapeHtml(t("codex.composer.fileButton"))}</span></button>
        </div>

        <input id="cxPhotoInput" type="file" accept="image/*" multiple hidden />
        <input id="cxFileInput" type="file" multiple hidden />
      </section>

      <div id="cxToast" class="cx-toast hidden" role="status" aria-live="polite"></div>

      <div id="cxModal" class="cx-modal hidden" role="dialog" aria-modal="true" aria-labelledby="cxModalTitle" aria-describedby="cxModalSubtitle">
        <div class="cx-modal-card">
          <div id="cxModalBody" class="cx-modal-body"></div>
        </div>
      </div>
    </div>
  `;
  bindLanguageSelectors(root, { reload: true });

  const sidebar = root.querySelector<HTMLElement>("#cxSidebar")!;
  const detailsPanel = root.querySelector<HTMLElement>("#cxDetailsPanel")!;
  const detailsToggle = root.querySelector<HTMLButtonElement>("#cxDetailsTop")!;
  const scrim = root.querySelector<HTMLElement>("#cxScrim")!;
  const sidebarClose = root.querySelector<HTMLButtonElement>("#cxSidebarClose")!;
  const agentSwitchButton = root.querySelector<HTMLButtonElement>("#cxAgentSwitchButton")!;
  const agentSwitchMenu = root.querySelector<HTMLDivElement>("#cxAgentSwitchMenu")!;
  const menu = root.querySelector<HTMLButtonElement>("#cxMenu")!;
  const newChatSide = root.querySelector<HTMLButtonElement>("#cxNewChatSide")!;
  const newChatTop = root.querySelector<HTMLButtonElement>("#cxNewChatTop")!;
  const threadSearch = root.querySelector<HTMLInputElement>("#cxThreadSearch")!;
  const sidebarThreads = root.querySelector<HTMLDivElement>("#cxSidebarThreads")!;
  const projectsNav = root.querySelector<HTMLButtonElement>("#cxProjectsNav")!;
  const devWorkflowsNav = root.querySelector<HTMLButtonElement>("#cxDevWorkflowsNav")!;
  const integrationsNav = root.querySelector<HTMLButtonElement>("#cxIntegrationsNav")!;
  const voice = root.querySelector<HTMLButtonElement>("#cxVoice")!;
  const reasoningTop = root.querySelector<HTMLButtonElement>("#cxReasoningTop")!;
  const usageTop = root.querySelector<HTMLButtonElement>("#cxUsageTop")!;
  const modelTop = root.querySelector<HTMLButtonElement>("#cxModelTop")!;
  const modelTopLabel = root.querySelector<HTMLElement>("#cxModelTopLabel")!;
  const reasoningTopLabel = root.querySelector<HTMLElement>("#cxReasoningTopLabel")!;
  const usageLabel = root.querySelector<HTMLElement>("#cxUsageLabel")!;
  const sideStatus = root.querySelector<HTMLElement>("#cxSideStatus")!;
  const title = root.querySelector<HTMLElement>("#cxTitle")!;
  const titleButton = root.querySelector<HTMLButtonElement>("#cxTitleButton")!;
  const modelLabel = root.querySelector<HTMLElement>("#cxModelLabel")!;
  const detailsTitle = root.querySelector<HTMLElement>("#cxDetailsTitle")!;
  const detailsModel = root.querySelector<HTMLElement>("#cxDetailsModel")!;
  const detailsActivity = root.querySelector<HTMLElement>("#cxDetailsActivity")!;
  const detailsState = root.querySelector<HTMLElement>("#cxDetailsState")!;
  const scheduleDetailsSync = (() => {
    let queued = false;
    return () => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => { queued = false; syncDetails(); });
    };
  })();
  const syncDetails = () => {
    const nextTitle = title.textContent || "Codex";
    const nextModel = modelLabel.textContent || "";
    const nextActivity = executionStatus.querySelector("span")?.textContent || "";
    const nextState = executionStatus.dataset.state || "offline";
    if (detailsTitle.textContent !== nextTitle) detailsTitle.textContent = nextTitle;
    if (detailsModel.textContent !== nextModel) detailsModel.textContent = nextModel;
    if (detailsActivity.textContent !== nextActivity) detailsActivity.textContent = nextActivity;
    if (detailsState.dataset.state !== nextState) detailsState.dataset.state = nextState;
  };
  const detailsObserver = new MutationObserver(scheduleDetailsSync);
  detailsObserver.observe(title, { childList: true, characterData: true, subtree: true });
  detailsObserver.observe(modelLabel, { childList: true, characterData: true, subtree: true });
  const executionStatus = root.querySelector<HTMLElement>("#cxExecutionStatus")!;
  detailsObserver.observe(executionStatus, { childList: true, characterData: true, subtree: true, attributes: true, attributeFilter: ["data-state"] });
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
  const plusMenu = root.querySelector<HTMLDivElement>("#cxPlusMenu")!;
  syncDetails();
  const attachmentStrip = root.querySelector<HTMLDivElement>("#cxAttachmentStrip")!;
  const contextPalette = root.querySelector<HTMLDivElement>("#cxContextPalette")!;
  const photo = root.querySelector<HTMLButtonElement>("#cxPhoto")!;
  const file = root.querySelector<HTMLButtonElement>("#cxFile")!;
  const pluginsQuick = root.querySelector<HTMLButtonElement>("#cxPluginsQuick")!;
  const photoInput = root.querySelector<HTMLInputElement>("#cxPhotoInput")!;
  const fileInput = root.querySelector<HTMLInputElement>("#cxFileInput")!;
  const toast = root.querySelector<HTMLDivElement>("#cxToast")!;
  const modal = root.querySelector<HTMLDivElement>("#cxModal")!;
  const modalBody = root.querySelector<HTMLDivElement>("#cxModalBody")!;
  // Shared sheet header (title / close / primary) — see src/sheet-header.mjs.
  const modalHead = createSheetHeader(document, { title: t("codex.modal.settingsTitle"), titleId: "cxModalTitle", onClose: () => closeModal() });
  modalHead.subtitleEl.id = "cxModalSubtitle";
  modalBody.before(modalHead.element);
  const modalClose = modalHead.closeButton;
  modalClose.id = "cxModalClose";
  const appFrame = root.querySelector<HTMLElement>(".cx-app")!;
  const composerWrap = root.querySelector<HTMLElement>(".cx-composer-wrap")!;
  const backgroundRegions = [".cx-topbar", ".cx-main", ".cx-composer-wrap", ".cx-approval"]
    .map(selector => root.querySelector<HTMLElement>(selector)!);
  let sidebarReturnFocus: HTMLElement | null = null;
  let modalReturnFocus: HTMLElement | null = null;
  const desktopLayout = window.matchMedia("(min-width: 1100px)");

  function syncOverlayState() {
    const modalOpen = !modal.classList.contains("hidden");
    const sidebarOpen = sidebar.classList.contains("open");
    const detailsOpen = !desktopLayout.matches && detailsPanel.classList.contains("open");
    const blocking = sidebarOpen || detailsOpen || modalOpen;
    const sidebarHidden = (!desktopLayout.matches && !sidebarOpen) || modalOpen || detailsOpen;
    const detailsHidden = (!desktopLayout.matches && !detailsOpen) || modalOpen || sidebarOpen;
    sidebar.inert = sidebarHidden;
    sidebar.setAttribute("aria-hidden", String(sidebarHidden));
    detailsPanel.inert = detailsHidden;
    detailsPanel.setAttribute("aria-hidden", String(detailsHidden));
    for (const region of backgroundRegions) region.inert = blocking;
  }
  syncOverlayState();

  // Measure local chrome; attachments, multiline input and approvals change its height.
  if (typeof ResizeObserver !== "undefined") {
    const resizeObserver = new ResizeObserver(() => {
      const composerHeight = Math.ceil(composerWrap.getBoundingClientRect().height);
      if (composerHeight > 0) appFrame.style.setProperty("--cx-composer-height", `${composerHeight}px`);
      appFrame.style.setProperty("--cx-approval-height", `${Math.ceil(approval.getBoundingClientRect().height)}px`);
      followLatest();
    });
    resizeObserver.observe(composerWrap);
    resizeObserver.observe(approval);
  }

  // Raw assistant text is state. Markdown and action buttons only project that state.
  const assistantText = new WeakMap<HTMLDivElement, string>();
  const pendingMarkdown = new Set<HTMLDivElement>();
  let markdownFrame: number | null = null;

  function renderAssistantText(bubble: HTMLDivElement) {
    let body = bubble.querySelector<HTMLElement>(".cx-message-text");
    if (!body) {
      body = document.createElement("div");
      body.className = "cx-message-text";
      bubble.prepend(body);
    }
    renderChatMarkdown(body, assistantText.get(bubble) ?? "", text => void copyText(text));
  }

  function queueAssistantRender(bubble: HTMLDivElement) {
    pendingMarkdown.add(bubble);
    if (markdownFrame !== null) return;
    markdownFrame = window.requestAnimationFrame(() => {
      markdownFrame = null;
      for (const pending of pendingMarkdown) {
        if (pending.isConnected) renderAssistantText(pending);
      }
      pendingMarkdown.clear();
      followLatest();
    });
  }

  let online = false;
  let unavailableCode: CodexUnavailableCode | null = null;
  let activeThreadId: string | null = null;
  let activeTurnId: string | null = null;
  let activeSendDraft: FailedCodexSendDraft | null = null;
  const failedCodexTurns = new Map<string, FailedCodexTurn>();
  let activeAssistantBubble: HTMLDivElement | null = null;
  let pendingApproval: { id: string | number; method: string; params: Json } | null = null;
  let pendingApprovalSafety = "";
  let events: EventSource | null = null;
  let reconnectTimer: number | null = null;
  let reconnectAttempts = 0;
  let allThreads: ThreadSummary[] = [];
  const threadListRequests = createLatestRequestGuard();
  const modelCatalogRequests = createLatestRequestGuard();
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
    const project = activeProject?.name || t("codex.context.noProject");
    const model = selectedModel ? modelDisplayName(selectedModel) : t("codex.composer.modelDefault");
    modelLabel.textContent = project;
    modelTopLabel.textContent = model;
    modelTop.title = model;
    modelTop.setAttribute("aria-label", t("codex.composer.modelWithNameAria", { name: model }));
  }

  function updateUsage(tokens = 0) {
    usageTokens = Math.max(0, usageTokens + tokens);
    usageLabel.textContent = usageTokens > 0
      ? (usageTokens >= 1000
        ? t("codex.usage.kTokens", { count: formatNumber(usageTokens / 1000, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) })
        : t("codex.usage.shortTokens", { count: formatNumber(usageTokens) }))
      : t("codex.topbar.usage");
  }

  async function showUsage() {
    openModal(t("codex.topbar.usage"), t("codex.usage.modalSubtitle"));
    modalBody.innerHTML = `<div class="cx-modal-loading">${escapeHtml(t("common.loading"))}</div>`;

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
        title.textContent = t("codex.usage.emptyTitle");
        const note = document.createElement("p");
        note.textContent = t("codex.usage.emptyNote");
        empty.append(title, note);
        modalBody.appendChild(empty);
        usageLabel.textContent = t("codex.topbar.usage");
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
          [t("codex.usage.primary"), snapshot.primary],
          [t("codex.usage.secondary"), snapshot.secondary]
        ] as const;
        for (const [label, windowData] of windows) {
          if (!windowData || typeof windowData !== "object") continue;
          const used = Number(windowData.usedPercent);
          const row = document.createElement("div");
          row.className = "cx-usage-row";
          const copy = document.createElement("span");
          const reset = formatResetTime(windowData.resetsAt, localeTag());
          if (Number.isFinite(used)) {
            const percent = formatNumber(Math.max(0, 100 - used), { maximumFractionDigits: 0 });
            copy.textContent = reset
              ? t("codex.usage.windowWithRemainingReset", { label, percent, reset })
              : t("codex.usage.windowWithRemaining", { label, percent });
          } else {
            copy.textContent = reset ? t("codex.usage.windowReset", { label, reset }) : label;
          }
          row.appendChild(copy);
          section.appendChild(row);
        }

        if (snapshot.credits && typeof snapshot.credits === "object") {
          const credits = document.createElement("div");
          credits.className = "cx-usage-row";
          const balance = snapshot.credits.balance;
          credits.textContent = balance == null
            ? t("codex.usage.creditsAvailable")
            : t("codex.usage.creditsBalance", { balance: String(balance) });
          section.appendChild(credits);
        }
        modalBody.appendChild(section);
      }

      const primary = payload?.rateLimits?.primary;
      const used = Number(primary?.usedPercent);
      usageLabel.textContent = Number.isFinite(used)
        ? t("codex.usage.leftPill", { percent: formatNumber(Math.max(0, 100 - used), { maximumFractionDigits: 0 }) })
        : t("codex.topbar.usage");
    } catch (error) {
      modalBody.replaceChildren();
      const empty = document.createElement("section");
      empty.className = "cx-library-empty";
      const title = document.createElement("strong");
      title.textContent = t("codex.usage.fetchFailedTitle");
      const note = document.createElement("p");
      note.textContent = error instanceof Error ? translateServerMessage(error.message) : t("codex.usage.fetchFailedNote");
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
      none: t("codex.reasoning.none"),
      minimal: t("codex.reasoning.minimal"),
      low: t("codex.reasoning.low"),
      medium: t("codex.reasoning.medium"),
      high: t("codex.reasoning.high"),
      xhigh: t("codex.reasoning.xhigh")
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
      ? (defaultEffort ? t("codex.reasoning.autoWithDefault", { effort: reasoningLabel(defaultEffort) }) : t("codex.reasoning.auto"))
      : reasoningLabel(reasoningMode);
    reasoningTopLabel.textContent = label;
    reasoningTop.title = label;
    reasoningTop.setAttribute("aria-label", t("codex.composer.reasoningWithLabelAria", { label }));
  }

  function showReasoningPicker() {
    const model = selectedModelMetadata();
    const values = reasoningChoices(model).map(item => ({
      value: item.value,
      label: item.value === "auto" ? t("codex.reasoning.auto") : reasoningLabel(item.value),
      description: item.value === "auto"
        ? (model?.defaultReasoningEffort ? t("codex.reasoning.modelDefault", { effort: reasoningLabel(model.defaultReasoningEffort) }) : t("codex.reasoning.letCodexChoose"))
        : (item.description || t("codex.reasoning.genericDesc", { label: reasoningLabel(item.value) }))
    }));
    openModal(
      t("codex.reasoning.modalTitle"),
      model
        ? t("codex.reasoning.modalSubtitleModel", { model: model.displayName || model.model })
        : t("codex.reasoning.modalSubtitleDefault")
    );
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

  function persistSelectedModel(value: string) {
    selectedModel = value;
    if (value) localStorage.setItem("opencode-pocket-codex-model", value);
    else localStorage.removeItem("opencode-pocket-codex-model");
    updateContextLabel();
  }

  async function loadModelCatalog() {
    const requestGeneration = modelCatalogRequests.begin();
    // Every page, including models the app-server flags hidden (see fetchAllCodexModels).
    const normalizedModels = await fetchAllCodexModels(params => rpc<Json>("model/list", params)) as CodexModel[];
    if (!modelCatalogRequests.isCurrent(requestGeneration)) return modelCatalog;
    modelCatalog = normalizedModels;

    const migrated = modelCatalog.find(model => model.id === selectedModel && model.model !== selectedModel);
    if (migrated) persistSelectedModel(migrated.model);

    syncReasoningLabels();
    return modelCatalog;
  }

  async function applyModelSelection(modelValue: string, displayName: string) {
    if (isExecutionActive(executionState)) {
      showToast(t("codex.model.cannotChangeWhileActive"));
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
          ? t("codex.model.switched", { name: displayName })
          : t("codex.model.nextChat", { name: displayName })
      );
      closeModal();
    } catch (error) {
      const message = error instanceof Error ? translateServerMessage(error.message) : String(error);
      showToast(t("codex.model.changeFailed"));
      throw new Error(message);
    }
  }

  async function projectApi<T = Json>(path: string, init: RequestInit = {}): Promise<T> {
    const method = String(init.method || "GET").toUpperCase();
    const mutating = method !== "GET" && method !== "HEAD";
    const operationId = mutating ? uid() : "";
    let res: Response;
    try {
      res = await fetchWithTimeout(
        (input, request) => fetch(input, request),
        `/api/projects${path}`,
        {
          ...init,
          headers: {
            ...(init.body ? { "content-type": "application/json" } : {}),
            ...(operationId ? { "x-pocket-operation-id": operationId } : {}),
            ...(init.headers || {})
          },
          cache: method === "GET" ? "no-store" : undefined
        },
        REMOTE_REQUEST_TIMEOUT_MS,
        () => new Error(t("codex.errors.projectRequestTimeout"))
      );
    } catch (error) {
      if (mutating) {
        throw new Error(
          t("codex.errors.mutationUnknown", { operationId }),
          { cause: error }
        );
      }
      throw error;
    }
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(payload?.error ? translateServerMessage(String(payload.error)) : t("common.httpError", { status: res.status }));
    return payload as T;
  }

  // The in-flight Project load, so panels opened during startup can wait for
  // the saved selection instead of rendering an empty state first.
  let projectsLoading: Promise<void> | null = null;
  function loadProjects() {
    const run = loadProjectsNow().finally(() => {
      if (projectsLoading === run) projectsLoading = null;
    });
    projectsLoading = run;
    return run;
  }
  function whenProjectReady() {
    if (activeProject) return Promise.resolve();
    return projectsLoading ?? loadProjects();
  }

  async function loadProjectsNow() {
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

  function closePlusMenu() {
    plusMenu.classList.add("hidden");
    plus.setAttribute("aria-expanded", "false");
  }

  function openSidebar() {
    if (!modal.classList.contains("hidden")) return;
    sidebarReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : menu;
    closeDetails(false);
    closePlusMenu();
    window.dispatchEvent(new CustomEvent("devmoter:close-global-nav"));
    sidebar.classList.add("open");
    sidebar.setAttribute("aria-hidden", "false");
    scrim.classList.remove("hidden");
    sidebar.setAttribute("role", "dialog");
    sidebar.setAttribute("aria-modal", "true");
    syncOverlayState();
    sidebarClose.focus({ preventScroll: true });
  }

  function closeDetails(restoreFocus = true) {
    const hadFocus = detailsPanel.classList.contains("open") && detailsPanel.contains(document.activeElement);
    detailsPanel.classList.remove("open");
    detailsPanel.removeAttribute("role");
    detailsPanel.removeAttribute("aria-modal");
    detailsToggle.setAttribute("aria-expanded", "false");
    if (!sidebar.classList.contains("open")) scrim.classList.add("hidden");
    syncOverlayState();
    if (restoreFocus && hadFocus && !desktopLayout.matches) detailsToggle.focus({ preventScroll: true });
  }

  function closeSidebar(restoreFocus = true) {
    const restoreSidebarFocus = sidebar.classList.contains("open") && sidebar.contains(document.activeElement);
    const restoreDetailsFocus = detailsPanel.classList.contains("open") && detailsPanel.contains(document.activeElement);
    agentSwitchMenu.classList.add("hidden");
    agentSwitchButton.setAttribute("aria-expanded", "false");
    sidebar.classList.remove("open");
    closeDetails(false);
    scrim.classList.add("hidden");
    sidebar.removeAttribute("role");
    sidebar.removeAttribute("aria-modal");
    syncOverlayState();
    if (restoreFocus && !desktopLayout.matches && restoreSidebarFocus) (sidebarReturnFocus?.isConnected ? sidebarReturnFocus : menu)?.focus({ preventScroll: true });
    else if (restoreFocus && !desktopLayout.matches && restoreDetailsFocus) detailsToggle.focus({ preventScroll: true });
  }

  const syncDesktopSidebar = () => {
    if (desktopLayout.matches) {
      sidebar.classList.remove("open");
      sidebar.removeAttribute("role");
      sidebar.removeAttribute("aria-modal");
      closeDetails(false);
      scrim.classList.add("hidden");
    } else if (sidebar.contains(document.activeElement) && !sidebar.classList.contains("open")) {
      menu.focus({ preventScroll: true });
    } else if (detailsPanel.contains(document.activeElement) && !detailsPanel.classList.contains("open")) {
      detailsToggle.focus({ preventScroll: true });
    }
    syncOverlayState();
  };
  syncDesktopSidebar();
  desktopLayout.addEventListener("change", syncDesktopSidebar);

  function toggleDetails() {
    if (detailsPanel.classList.contains("open")) { closeDetails(); return; }
    if (!modal.classList.contains("hidden")) return;
    closeSidebar(false);
    closePlusMenu();
    detailsPanel.classList.add("open");
    detailsPanel.setAttribute("role", "dialog");
    detailsPanel.setAttribute("aria-modal", "true");
    detailsToggle.setAttribute("aria-expanded", "true");
    scrim.classList.remove("hidden");
    window.dispatchEvent(new CustomEvent("devmoter:close-global-nav"));
    syncOverlayState();
    detailsPanel.focus({ preventScroll: true });
  }

  function openModal(titleText: string, subtitleText = "") {
    modalReturnFocus = sidebar.contains(document.activeElement) && !desktopLayout.matches ? menu
      : detailsPanel.contains(document.activeElement) && !desktopLayout.matches ? detailsToggle
      : document.activeElement instanceof HTMLElement ? document.activeElement : menu;
    closeSidebar(false);
    closePlusMenu();
    window.dispatchEvent(new CustomEvent("devmoter:close-global-nav"));
    modalCloseGuard = null;
    modalHead.setTitle(titleText);
    modalHead.setSubtitle(subtitleText);
    modalHead.setPrimary(null);
    modal.classList.remove("hidden");
    syncOverlayState();
    modalClose.focus({ preventScroll: true });
  }

  function closeModal() {
    if (modalCloseGuard && !modalCloseGuard()) return;
    modalCloseGuard = null;
    modal.classList.add("hidden");
    syncOverlayState();
    if (modalReturnFocus?.isConnected) modalReturnFocus.focus({ preventScroll: true });
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
      res = await fetchWithTimeout(
        (input, init) => fetch(input, init),
        "/api/codex/rpc",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(opId ? { "x-pocket-operation-id": opId } : {})
          },
          body: JSON.stringify({ method, params })
        },
        REMOTE_REQUEST_TIMEOUT_MS,
        () => new Error(t("codex.errors.rpcTimeout"))
      );
    } catch (error) {
      if (opId) {
        throw new Error(
          t("codex.errors.mutationUnknown", { operationId: opId }),
          { cause: error }
        );
      }
      throw error;
    }
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (payload?.duplicate) {
        throw new Error(
          t("codex.errors.duplicateRpc", { operationId: String(payload?.operationId || opId) })
        );
      }
      const code = typeof payload?.code === "string" ? payload.code : "";
      if (code === "not_installed" || code === "not_executable" || code === "failed") {
        throw Object.assign(new Error(payload?.error ? translateServerMessage(String(payload.error)) : t("codex.errors.cannotLaunchCli")), { code });
      }
      throw new Error(payload?.error ? translateServerMessage(String(payload.error)) : t("common.httpError", { status: res.status }));
    }
    return payload.result as T;
  }

  function executionLabel(state: ExecutionState) {
    switch (state) {
      case "offline": return t("codex.state.offline");
      case "reconnecting": return t("codex.state.reconnecting");
      case "idle": return t("codex.state.idle");
      case "running": return t("codex.state.running");
      case "waiting_for_approval": return t("codex.state.waitingApproval");
      case "waiting_for_input": return t("codex.state.waitingInput");
      case "completed": return t("codex.state.completed");
      case "failed": return t("codex.state.failed");
      case "interrupted": return t("codex.state.interrupted");
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
    send.innerHTML = active ? cxIcons.stop : cxIcons.send;
    send.setAttribute("aria-label", active ? t("common.stop") : t("common.send"));
    send.disabled = !online || next === "reconnecting";

    if (previous !== next) {
      window.dispatchEvent(new CustomEvent("devmoter-agent-state", {
        detail: { backend: "codex", sessionId: activeThreadId, state: next }
      }));
    }
  }

  function setOnline(next: boolean, notice = "", code = "") {
    const changed = online !== next;
    online = next;
    unavailableCode = next ? null : codexUnavailableCode(code);
    sideStatus.classList.toggle("offline", !next);
    sideStatus.classList.toggle("online", next);
    sideStatus.classList.toggle("missing", unavailableCode === "not_installed");
    sideStatus.dataset.codexState = next ? "online" : unavailableCode || "offline";
    sideStatus.innerHTML = `<i></i> ${escapeHtml(next ? t("common.online") : codexAvailabilityLabel(unavailableCode))}`;
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
      if (!allThreads.length) {
        sidebarThreads.replaceChildren();
        const empty = document.createElement("div");
        empty.className = "cx-side-empty";
        empty.textContent = unavailableCode === "not_installed"
          ? t("codex.side.notInstalled")
          : unavailableCode
            ? t("codex.side.cannotLaunch")
            : t("codex.side.offline");
        sidebarThreads.appendChild(empty);
      }
      if (notice) {
        const translatedNotice = translateServerMessage(notice);
        const label = executionStatus.querySelector("span");
        if (label) label.textContent = translatedNotice;
        executionStatus.title = translatedNotice;
        const welcome = root.querySelector<HTMLElement>(".cx-welcome p");
        if (welcome) welcome.textContent = translatedNotice;
      }
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
    showToast(t("common.copied"));
  }

  function addAssistantActions(bubble: HTMLDivElement) {
    if (bubble.querySelector(".cx-message-actions")) return;

    const text = assistantText.get(bubble) ?? "";
    if (!text.trim()) return;

    const actions = document.createElement("div");
    actions.className = "cx-message-actions";

    const copy = document.createElement("button");
    copy.type = "button";
    copy.className = "cx-message-action";
    copy.setAttribute("aria-label", t("codex.message.copyAria"));
    copy.title = t("codex.message.copyTitle");
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
    feedback.setAttribute("aria-label", t("codex.message.rateAria"));
    feedback.title = t("codex.message.rateTitle");
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
      button.setAttribute("aria-label", value === "up" ? t("codex.message.thumbsUpAria") : t("codex.message.thumbsDownAria"));
      button.addEventListener("click", event => {
        event.stopPropagation();
        localStorage.setItem(feedbackKey(text), value);
        feedbackMenu.querySelectorAll(".cx-feedback-choice").forEach(item =>
          item.classList.remove("selected")
        );
        button.classList.add("selected");
        feedbackMenu.classList.add("hidden");
        feedback.classList.add("rated");
        showToast(value === "up" ? t("codex.message.recordedUp") : t("codex.message.recordedDown"));
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
    share.setAttribute("aria-label", t("codex.message.shareAria"));
    share.title = t("codex.message.shareTitle");
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
      showToast(t("codex.message.copiedFallback"));
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

    if (role === "assistant") {
      assistantText.set(bubble, text);
      renderAssistantText(bubble);
    } else if (text) {
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

  function addCodexSendFailure(
    error: unknown,
    diagnostics: { method: string; threadId?: string | null; turnId?: string | null },
    retryDraft: FailedCodexSendDraft | null
  ) {
    const normalized = normalizeCodexSendError(error);
    const localizedCategory = codexSendErrorCategory(normalized.category);
    const localizedReason = codexSendErrorReason(normalized.reason);
    const bubble = addMessage("system", `${localizedCategory}: ${localizedReason}`);
    const actions = document.createElement("div");
    actions.className = "cx-send-error-actions";
    if (retryDraft) {
      const restore = document.createElement("button");
      restore.type = "button";
      restore.textContent = t("codex.sendError.restoreInput");
      restore.addEventListener("click", () => {
        if (activeThreadId !== retryDraft.threadId) {
          showToast(t("codex.sendError.openOriginalChat"));
          return;
        }
        if (promptInput.value.trim() || pendingAttachments.length || selectedContextRefs.length) {
          showToast(t("codex.sendError.clearDraftFirst"));
          return;
        }
        promptInput.value = retryDraft.text;
        pendingAttachments = retryDraft.attachments.map(item => ({ ...item }));
        selectedContextRefs = retryDraft.contextRefs.map(item => ({ ...item }));
        renderAttachments();
        resizeComposer();
        promptInput.focus();
        promptInput.setSelectionRange(promptInput.value.length, promptInput.value.length);
        failedDetails.open = false;
      });
      actions.appendChild(restore);
    }
    const diagnosticsButton = document.createElement("button");
    diagnosticsButton.type = "button";
    diagnosticsButton.textContent = t("codex.sendError.diagnostics");
    diagnosticsButton.addEventListener("click", () => {
      window.dispatchEvent(new CustomEvent("devmoter:open-settings", { detail: { page: "diagnostics" } }));
    });
    actions.appendChild(diagnosticsButton);
    const failedDetails = document.createElement("details");
    failedDetails.className = "cx-send-error-diagnostics";
    const summary = document.createElement("summary");
    summary.textContent = t("codex.sendError.detailsSummary");
    const content = document.createElement("div");
    content.textContent = [
      t("codex.sendError.detailCategory", { value: localizedCategory }),
      t("codex.sendError.detailReason", { value: localizedReason }),
      normalized.code ? t("codex.sendError.detailCode", { value: normalized.code }) : "",
      t("codex.sendError.detailBackend"),
      t("codex.sendError.detailMethod", { value: diagnostics.method }),
      diagnostics.threadId ? t("codex.sendError.detailThread", { value: diagnostics.threadId }) : "",
      diagnostics.turnId ? t("codex.sendError.detailTurn", { value: diagnostics.turnId }) : ""
    ].filter(Boolean).join("\n");
    failedDetails.append(summary, content);
    actions.appendChild(failedDetails);
    bubble.appendChild(actions);
  }

  function failedCodexTurnKey(threadId: string, turnId: string) {
    return `${threadId}\u0000${turnId}`;
  }

  function rememberFailedCodexTurn(threadId: string, turnId: string, failure: Omit<FailedCodexTurn, "threadId" | "turnId">) {
    const key = failedCodexTurnKey(threadId, turnId);
    if (failure.draft) {
      for (const [previousKey, previous] of failedCodexTurns) {
        if (previousKey !== key && previous.draft) failedCodexTurns.set(previousKey, { ...previous, draft: null });
      }
    }
    failedCodexTurns.delete(key);
    failedCodexTurns.set(key, { threadId, turnId, ...failure });
    while (failedCodexTurns.size > 12) {
      const oldest = failedCodexTurns.keys().next().value;
      if (oldest === undefined) break;
      failedCodexTurns.delete(oldest);
    }
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
    const mcpState = summary.status === "available" ? t("codex.mcp.available") : translateServerMessage(summary.status);
    state.textContent = mcpState + (normalized.truncated ? t("codex.mcp.truncatedSuffix") : "");
    head.append(label, state);
    const structured = document.createElement("pre");
    structured.className = "cx-mcp-structured";
    try { structured.textContent = JSON.stringify(normalized.value, null, 2); }
    catch { structured.textContent = String(normalized.value ?? ""); }
    const raw = document.createElement("details");
    raw.className = "cx-mcp-raw";
    const rawSummary = document.createElement("summary");
    rawSummary.textContent = t("codex.mcp.rawFallback");
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
      empty.textContent = q ? t("codex.threads.noMatches") : t("codex.threads.empty");
      sidebarThreads.appendChild(empty);
      return;
    }

    let groupName = "";
    for (const thread of items) {
      const cwd = thread.cwd || "";
      const nextGroup = cwd.split(/[\\/]/).filter(Boolean).at(-1) || t("codex.threads.otherGroup");
      if (!q && nextGroup !== groupName) {
        groupName = nextGroup;
        const group = document.createElement("div");
        group.className = "cx-thread-group";
        const icon = document.createElement("span");
        icon.setAttribute("aria-hidden", "true");
        icon.textContent = "▱";
        group.appendChild(icon);
        const label = document.createElement("span");
        label.textContent = groupName;
        group.appendChild(label);
        sidebarThreads.appendChild(group);
      }
      const button = document.createElement("button");
      button.type = "button";
      button.className = "cx-thread-row";
      if (thread.id === activeThreadId) button.classList.add("active");

      const text = document.createElement("span");
      text.textContent = thread.name || thread.preview || t("codex.sidebar.newChat");
      button.appendChild(text);
      if (thread.updatedAt) {
        const age = Math.max(0, Date.now() - thread.updatedAt);
        const stamp = document.createElement("small");
        stamp.className = "cx-thread-age";
        stamp.textContent = age < 60_000
          ? t("codex.threads.ageNow")
          : age < 3_600_000
            ? t("codex.threads.ageMinutes", { count: formatNumber(Math.floor(age / 60_000)) })
            : age < 86_400_000
              ? t("codex.threads.ageHours", { count: formatNumber(Math.floor(age / 3_600_000)) })
              : t("codex.threads.ageDays", { count: formatNumber(Math.floor(age / 86_400_000)) });
        button.appendChild(stamp);
      }
      button.addEventListener("click", () => {
        closeSidebar();
        void selectThread(thread);
      });
      sidebarThreads.appendChild(button);
    }
  }

  async function restoreSavedThread(threadId: string) {
    try {
      const result = await rpc<{ thread?: ThreadSummary }>(
        "thread/read",
        { threadId, includeTurns: false }
      );
      const thread = result?.thread;
      if (!thread) throw new Error(t("codex.threads.savedUnavailable"));
      return await selectThread({
        id: threadId,
        name: thread.name,
        preview: thread.preview,
        cwd: thread.cwd
      });
    } catch (error) {
      title.textContent = t("codex.threads.restoreTitle");
      transcript.innerHTML = `
        <div class="cx-welcome">
          <div class="cx-welcome-mark">↻</div>
          <h2>${escapeHtml(t("codex.threads.restoreHeading"))}</h2>
          <p>${escapeHtml(t("codex.threads.restoreBody"))}</p>
        </div>
      `;
      showToast(error instanceof Error ? translateServerMessage(error.message) : t("codex.threads.restoreFailed"));
      return false;
    }
  }

  async function loadThreads() {
    const requestGeneration = threadListRequests.begin();
    let result: Json;
    try {
      result = await rpc<Json>("thread/list", { limit: 100 });
    } catch (error) {
      if (threadListRequests.isCurrent(requestGeneration)) {
        showToast(error instanceof Error ? translateServerMessage(error.message) : t("codex.threads.listLoadFailed"));
      }
      return false;
    }
    if (!threadListRequests.isCurrent(requestGeneration)) return false;
    try {
      allThreads = normalizeCodexThreadList(result);
    } catch {
      showToast(t("codex.threads.listInvalid"));
      return false;
    }
    renderThreads();

    // thread/list can briefly lag a just-created or just-resumed thread.
    // Preserve the current identity instead of silently falling back to a new chat.
    if (!activeThreadId) {
      const saved = localStorage.getItem("opencode-pocket-codex-thread");
      const target = allThreads.find(thread => thread.id === saved);
      if (target) await selectThread(target);
      else if (saved) await restoreSavedThread(saved);
    }
    return true;
  }

  function parseUserMessage(item: Json) {
    if (item?.type !== "userMessage") return null;
    const parts = Array.isArray(item.content) ? item.content : [];
    const texts: string[] = [];
    const attachments: Array<{ name: string; kind?: string }> = [];

    for (const part of parts) {
      if (part?.type === "text" && typeof part.text === "string") texts.push(part.text);
      if (part?.type === "image" || part?.type === "localImage") {
        attachments.push({ name: t("codex.threads.imageLabel"), kind: "image" });
      }
      if (part?.type === "mention") {
        attachments.push({ name: part.name || part.path || t("codex.threads.fileLabel"), kind: "file" });
      }
    }

    return { text: texts.join(""), attachments };
  }

  async function loadThreadHistory(threadId: string) {
    let result: unknown;
    try {
      result = await rpc("thread/read", { threadId, includeTurns: true });
    } catch (error) {
      if (activeThreadId === threadId) {
        showToast(error instanceof Error ? translateServerMessage(error.message) : t("codex.threads.historyLoadFailed"));
      }
      return false;
    }
    if (activeThreadId !== threadId) return false;

    let thread: ReturnType<typeof normalizeCodexThreadHistory>;
    try {
      thread = normalizeCodexThreadHistory(result);
    } catch {
      showToast(t("codex.threads.historyInvalid"));
      return false;
    }
    const turns = thread.turns;
    const threadState = codexThreadStatusToExecutionState(thread.status);
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

    const renderedFailedTurnIds = new Set<string>();
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
      if (codexTurnStatusToExecutionState(turn.status) === "failed" && turn.id) {
        renderedFailedTurnIds.add(turn.id);
        const previous = failedCodexTurns.get(failedCodexTurnKey(threadId, turn.id));
        const failure = {
          error: turn.error !== undefined ? normalizeCodexSendError(turn.error) : previous?.error ?? {},
          draft: previous?.draft?.threadId === threadId ? previous.draft : null
        };
        rememberFailedCodexTurn(threadId, turn.id, failure);
        addCodexSendFailure(
          failure.error,
          { method: "turn/start", threadId, turnId: turn.id },
          failure.draft
        );
      }
    }

    const retainedFailures = [...failedCodexTurns.values()]
      .filter(failure => failure.threadId === threadId && !renderedFailedTurnIds.has(failure.turnId));
    for (const failure of retainedFailures) {
      addCodexSendFailure(
        failure.error,
        { method: "turn/start", threadId, turnId: failure.turnId },
        failure.draft
      );
    }
    if (retainedFailures.some(failure => !latestTurn?.id || failure.turnId === latestTurn.id)) {
      activeTurnId = null;
      setExecutionState("failed");
    }

    if (!transcript.childElementCount) {
      transcript.innerHTML = `
        <div class="cx-welcome">
          <div class="cx-welcome-mark">✦</div>
          <h2>${escapeHtml(t("codex.sidebar.newChat"))}</h2>
          <p>${escapeHtml(t("codex.chat.newWelcomeBody"))}</p>
        </div>
      `;
    }

    followLatest();
    return true;
  }

  async function selectThread(thread: ThreadSummary): Promise<boolean> {
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
      return true;
    } catch (error) {
      addMessage("system", error instanceof Error ? translateServerMessage(error.message) : t("codex.chat.openFailed"));
      return false;
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
    if (!response.ok) throw new Error(payload?.error ? translateServerMessage(String(payload.error)) : t("codex.chat.rulesLoadFailed"));
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
      if (!thread?.id) throw new Error(t("codex.chat.missingThreadId"));

      activeThreadId = thread.id;
      activeTurnId = null;
      if (result?.model) persistSelectedModel(result.model);
      localStorage.setItem("opencode-pocket-codex-thread", thread.id);
      title.textContent = t("codex.sidebar.newChat");
      transcript.innerHTML = `
        <div class="cx-welcome">
          <div class="cx-welcome-mark">✦</div>
          <h2>${escapeHtml(t("codex.welcome.title"))}</h2>
          <p>${escapeHtml(t("codex.chat.createdWelcomeBody"))}</p>
        </div>
      `;
      await loadThreads();
      closeSidebar();
      return thread.id;
    } catch (error) {
      addCodexSendFailure(error, { method: "thread/start" }, null);
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
      reader.onerror = () => reject(reader.error || new Error(t("codex.upload.readFailed")));
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
        t("codex.upload.sizeExceeded", { name: blob.name, limit: kind === "image" ? "10" : "15" })
      );
    }

    const dataUrl = await fileToDataUrl(blob);
    const res = await fetchWithTimeout(
      (input, init) => fetch(input, init),
      "/api/codex/upload",
      {
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
      },
      120_000,
      () => new Error(t("codex.upload.timeout"))
    );
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(payload?.error ? translateServerMessage(String(payload.error)) : t("codex.upload.failed"));
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
      addMessage("system", error instanceof Error ? translateServerMessage(error.message) : String(error));
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
          ? t("codex.context.folderSummary")
          : t("codex.context.fileBytes", { bytes: formatNumber(entry.size ?? 0) });
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
    if (submitInFlight) return;
    submitInFlight = true;
    send.disabled = true;
    try {
      await sendMessageUnlocked();
    } finally {
      submitInFlight = false;
      send.disabled = !online || executionState === "reconnecting";
    }
  }

  async function sendMessageUnlocked() {
    const text = promptInput.value.trim();
    if (!text && pendingAttachments.length === 0) return;

    if (text) {
      try {
        const guard = await runPreExecutionGuard(text);
        if (guard.decision === "block") {
          addMessage("system", t("codex.send.guardBlocked", { message: guardMessage(guard) }));
          return;
        }
        if (
          guard.decision === "warn" &&
          !window.confirm(t("codex.send.guardConfirm", { message: guardMessage(guard) }))
        ) return;
      } catch {
        addMessage("system", t("codex.send.guardUnavailable"));
        return;
      }
    }

    let contextText = "";
    try {
      contextText = await resolvedContextText(text);
    } catch (error) {
      addMessage(
        "system",
        t("codex.send.contextResolveFailed", {
          error: error instanceof Error ? translateServerMessage(error.message) : String(error)
        })
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
    const sendDraft = {
      text,
      attachments: pendingAttachments.map(item => ({ ...item })),
      contextRefs: selectedContextRefs.map(item => ({ ...item })),
      threadId
    };

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
    closePlusMenu();
    activeAssistantBubble = null;
    setExecutionState("running");

    const operationId = uid();
      activeSendDraft = sendDraft;
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
      if (activeSendDraft === sendDraft) activeTurnId = result?.turn?.id ?? activeTurnId;
    } catch (error) {
      setExecutionState("failed");
      addCodexSendFailure(error, { method: "turn/start", threadId }, sendDraft);
      activeSendDraft = null;
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
      addMessage("system", error instanceof Error ? translateServerMessage(error.message) : t("codex.send.interruptFailed"));
    }
  }

  function renderApprovalRequest(
    request: { id: string | number; method: string; params: Json },
    safetyMessage = ""
  ) {
    pendingApprovalSafety = safetyMessage;
    pendingApproval = request;
    setExecutionState("waiting_for_approval");
    approval.classList.remove("hidden");
    const isFileChange = request.method === "item/fileChange/requestApproval";
    approvalTitle.textContent = isFileChange
      ? t("codex.approval.fileChangeTitle")
      : t("codex.approval.commandTitle");

    const contextRows = [
      [t("codex.approval.metaBackend"), "Codex"],
      [t("codex.approval.metaThread"), String(request.params?.threadId || activeThreadId || t("common.unknown"))],
      [t("codex.approval.metaTurn"), String(request.params?.turnId || activeTurnId || t("common.unknown"))],
      [t("codex.approval.metaAction"), isFileChange ? t("codex.approval.actionFileChange") : t("codex.approval.actionCommand")]
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
      request.params?.reason ? t("codex.approval.reasonLine", { reason: String(request.params.reason) }) : "",
      request.params?.command ? t("codex.approval.commandLine", { command: String(request.params.command) }) : "",
      request.params?.cwd ? t("codex.approval.cwdLine", { cwd: String(request.params.cwd) }) : "",
      request.params?.grantRoot ? t("codex.approval.grantRootLine", { root: String(request.params.grantRoot) }) : ""
    ].filter(Boolean).join("\n\n") || t("codex.approval.defaultDetail");
    if (pendingApprovalSafety) {
      approvalDetail.textContent += `\n\n${t("codex.approval.safetyPauseDetail", { message: pendingApprovalSafety })}`;
    }
  }

  function clearReplayedApproval() {
    pendingApproval = null;
    pendingApprovalSafety = "";
    approval.classList.add("hidden");
  }

  function applyReplayState(event: Json) {
    if (event?.backend && event.backend !== "codex") return;
    const type = String(event?.type || "");
    if (type === "approval") {
      const payload = event?.payload || {};
      const id = payload?.id;
      const method = String(payload?.method || "");
      const params = payload?.params && typeof payload.params === "object" ? payload.params : {};
      if (
        (typeof id === "string" || typeof id === "number") &&
        (method === "item/commandExecution/requestApproval" || method === "item/fileChange/requestApproval")
      ) {
        renderApprovalRequest({ id, method, params });
      } else {
        setExecutionState("waiting_for_approval");
      }
    }
    else if (type === "question") setExecutionState("waiting_for_input");
    else if (type === "failure") {
      clearReplayedApproval();
      setExecutionState("failed");
    } else if (type === "completion") {
      clearReplayedApproval();
      setExecutionState("completed");
    } else {
      const method = String(event?.payload?.method || "");
      if (method === "turn/started") setExecutionState("running");
      if (method === "serverRequest/resolved") {
        clearReplayedApproval();
        if (executionState === "waiting_for_approval") setExecutionState("running");
      }
      if (method === "turn/completed") {
        clearReplayedApproval();
        setExecutionState(codexTurnStatusToExecutionState(event?.payload?.params?.turn?.status));
      }
    }
  }

  async function replayWorkspaceState(threadId: string) {
    const storageKey = `devmoter-chat-cursor:codex:${threadId}`;
    let cursor = localStorage.getItem(storageKey) || "0";

    for (let page = 0; page < 4; page += 1) {
      const response = await fetchWithTimeout(
        (input, init) => fetch(input, init),
        "/api/workspace-control/events?sessionId=" +
          encodeURIComponent(threadId) +
          "&after=" +
          encodeURIComponent(cursor) +
          "&limit=500",
        { cache: "no-store" },
        REMOTE_REQUEST_TIMEOUT_MS,
        () => new Error(t("codex.reconnect.replayTimeout"))
      );
      if (!response.ok) throw new Error(t("codex.reconnect.replayUnavailable"));
      const payload = await response.json().catch(() => ({}));
      if (payload?.gap) {
        cursor = String(payload?.latestCursor || payload?.cursor || cursor);
        localStorage.setItem(storageKey, cursor);
        throw new Error(t("codex.reconnect.replayGap"));
      }
      const items = Array.isArray(payload?.events) ? payload.events : [];
      for (const item of items) applyReplayState(item);
      const nextCursor = String(payload?.cursor || cursor);
      if (nextCursor === cursor || items.length === 0) break;
      cursor = nextCursor;
      if (items.length < 500) break;
    }

    localStorage.setItem(storageKey, cursor);
  }

  async function resumeFromBackground() {
    if (!online || resumeSyncInFlight) return;
    resumeSyncInFlight = true;
    const threadId =
      activeThreadId || localStorage.getItem("opencode-pocket-codex-thread") || "";

    let replayFallback = false;
    try {
      if (threadId) {
        setExecutionState("reconnecting");
        try {
          await replayWorkspaceState(threadId);
        } catch {
          replayFallback = true;
        }
      }

      events?.close();
      events = null;
      const sync = await reconnectAfterSync(async () => {
        if (!(await refresh())) throw new Error(t("codex.reconnect.refreshFailed"));
      }, () => connectEvents());

      if (sync.error) {
        showToast(t("codex.reconnect.syncFailedToast"));
        return;
      }

      if (threadId && activeThreadId === threadId) {
        showToast(replayFallback ? t("codex.reconnect.resyncedFallback") : t("codex.reconnect.resyncedBackground"));
      }
    } finally {
      resumeSyncInFlight = false;
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
        void recoverAfterEventOpen(async () => {
          if (!(await refresh())) throw new Error(t("codex.reconnect.refreshFailed"));
        }, error => {
          if (executionState === "reconnecting") {
            setExecutionState("idle");
            showToast(error
              ? t("codex.reconnect.syncAfterOpenFailed")
              : t("codex.reconnect.reconnected"));
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
          showToast(t("codex.events.rerouted", { model: modelDisplayName(toModel) }));
        }
        return;
      }

      if (!eventBelongsToActiveThread(params)) {
        if (method === "turn/completed") void loadThreads();
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
        let completedFailure: unknown = null;
        let completedFailureDraft: FailedCodexSendDraft | null = null;
        let completedTurnId = "";
        if (finalState === "failed") {
          const turn = params?.turn || {};
          completedFailure = normalizeCodexSendError(turn.error ?? params?.error ?? {});
          completedTurnId = String(turn.id || params?.turnId || activeTurnId || "");
          const draftMatchesTurn = activeSendDraft?.threadId === activeThreadId &&
            (!activeTurnId || !completedTurnId || completedTurnId === activeTurnId);
          completedFailureDraft = draftMatchesTurn ? activeSendDraft : null;
          if (activeThreadId && completedTurnId) {
            rememberFailedCodexTurn(activeThreadId, completedTurnId, {
              error: completedFailure,
              draft: completedFailureDraft
            });
          }
        }
        activeSendDraft = null;
        activeTurnId = null;
        if (activeAssistantBubble) {
          activeAssistantBubble.closest(".cx-message-row")?.classList.remove("live");
          renderAssistantText(activeAssistantBubble);
          addAssistantActions(activeAssistantBubble);
        }
        activeAssistantBubble = null;
        if (activeThreadId) {
          const threadId = activeThreadId;
          void loadThreadHistory(threadId).catch(() => {
            if (finalState === "failed" && activeThreadId === threadId) {
              addCodexSendFailure(
                completedFailure,
                { method: "turn/start", threadId, turnId: completedTurnId },
                completedFailureDraft
              );
            }
          });
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
        assistantText.set(activeAssistantBubble, (assistantText.get(activeAssistantBubble) ?? "") + delta);
        queueAssistantRender(activeAssistantBubble);
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

      const requestThreadId = eventThreadId(request.params);
      if (requestThreadId && requestThreadId !== activeThreadId) return;

      if (
        request.method !== "item/commandExecution/requestApproval" &&
        request.method !== "item/fileChange/requestApproval"
      ) {
        addMessage("system", t("codex.events.unsupportedApproval", { method: request.method }));
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
            addMessage("system", t("codex.approval.rememberedApplied"));
            return;
          }
        }
      } catch {
        // Fall back to the explicit approval UI.
      }

      renderApprovalRequest(
        request,
        loopState?.paused ? loopMessage(loopState) : ""
      );
    });

    events.addEventListener("offline", event => {
      let detail: { error?: unknown; code?: unknown } = {};
      try {
        detail = JSON.parse((event as MessageEvent<string>).data || "{}") || {};
      } catch {
        detail = {};
      }
      setOnline(
        false,
        codexUnavailableCode(detail.code) ? String(detail.error || "") : "",
        typeof detail.code === "string" ? detail.code : ""
      );
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
          throw new Error(t("codex.approval.safetyScanUnavailable"));
        }
        if (
          commandRisk.dangerous &&
          !window.confirm(
            t("codex.approval.highRiskConfirm", {
              command: commandRisk.command,
              reasons: commandRisk.reasons.map(reason => `• ${translateServerMessage(reason)}`).join("\n")
            })
          )
        ) return;
        if (commandRisk.dangerous && decision === "acceptForSession") {
          effectiveDecision = "accept";
          addMessage("system", t("codex.approval.highRiskDowngraded"));
        }
      }

      if (decision !== "decline" && pendingApprovalSafety) {
        if (!window.confirm(t("codex.approval.loopConfirm", { message: pendingApprovalSafety }))) return;
        await continueAgentRun(codexLoopRunId(request)).catch(() => {});
      }

      if (effectiveDecision === "acceptForSession" && !commandRisk?.dangerous) {
        await rememberPermission(scope, {
          note: t("codex.approval.rememberedNote"),
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
        throw new Error(payload?.error ? translateServerMessage(String(payload.error)) : t("codex.approval.replyFailed"));
      }

      pendingApproval = null;
      pendingApprovalSafety = "";
      approval.classList.add("hidden");
      setExecutionState("running");
    } catch (error) {
      addMessage(
        "system",
        error instanceof Error ? translateServerMessage(error.message) : t("codex.approval.replyFailed")
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
    section.innerHTML = `<h3>${escapeHtml(titleText)}</h3>`;

    if (errorMessage) {
      const error = document.createElement("p");
      error.className = "cx-muted";
      error.textContent = errorMessage;
      section.appendChild(error);
    }

    if (!entries.length && !errorMessage) {
      const empty = document.createElement("p");
      empty.className = "cx-muted";
      empty.textContent = t("codex.plugins.noneFound");
      section.appendChild(empty);
    }

    for (const entry of entries) {
      const row = document.createElement("div");
      row.className = "cx-plugin-row";

      const copy = document.createElement("span");
      copy.innerHTML = "<strong></strong><small></small>";
      copy.querySelector("strong")!.textContent = entry.name;
      copy.querySelector("small")!.textContent = t("codex.plugins.rowMeta", {
        marketplace: entry.marketplace || "plugin",
        state: entry.enabled ? t("common.enabled") : t("common.disabled")
      });

      const state = document.createElement("span");
      state.className = "cx-plugin-state";
      state.textContent = entry.enabled ? "●" : "○";
      state.title = entry.enabled ? t("common.enabled") : t("common.disabled");

      row.append(copy, state);
      section.appendChild(row);
    }

    modalBody.appendChild(section);
  }

  async function showPlugins() {
    closeSidebar();
    openModal(t("codex.sidebar.plugins"), t("codex.plugins.subtitle"));
    modalBody.innerHTML = `<div class="cx-modal-loading">${escapeHtml(t("common.loading"))}</div>`;

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
        t("codex.plugins.installedTitle"),
        enrichInstalledPluginEntries(installedEntries, catalogEntries)
      );
    } else {
      const fallbackEntries = catalogEntries.filter(entry => entry.installed);
      const fallbackError = catalogResult.status === "rejected"
        ? (catalogResult.reason instanceof Error
            ? t("codex.plugins.apiError", { error: translateServerMessage(catalogResult.reason.message) })
            : t("codex.plugins.apiLoadFailed"))
        : "";
      appendPluginSection(t("codex.plugins.installedTitle"), fallbackEntries, fallbackError);
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
        empty.textContent = t("codex.plugins.noMcpServers");
        mcpSection.appendChild(empty);
      } else {
        for (const server of servers) {
          const row = document.createElement("div");
          row.className = "cx-mcp-row";

          const name = document.createElement("strong");
          name.textContent = String(server?.name || "MCP");

          const state = document.createElement("span");
          const rawState = server?.runtimeStatus || server?.authStatus;
          state.textContent = rawState
            ? translateServerMessage(String(rawState))
            : t("codex.mcp.available");

          row.append(name, state);
          mcpSection.appendChild(row);
        }
      }
    } else {
      const error = document.createElement("p");
      error.className = "cx-muted";
      error.textContent =
        mcpResult.reason instanceof Error
          ? t("codex.plugins.mcpError", { error: translateServerMessage(mcpResult.reason.message) })
          : t("codex.plugins.mcpLoadFailed");
      mcpSection.appendChild(error);
    }

    modalBody.appendChild(mcpSection);
  }

  async function showProjects() {
    closeSidebar();
    openModal(tApp("projects"), t("codex.projects.subtitle"));
    modalBody.innerHTML = `<div class="cx-modal-loading">${escapeHtml(t("common.loading"))}</div>`;

    try {
      await loadProjects();
      renderProjectPicker();
    } catch (error) {
      modalBody.textContent = error instanceof Error ? translateServerMessage(error.message) : String(error);
    }
  }

  function renderProjectPicker() {
    modalBody.replaceChildren();

    const actions = document.createElement("div");
    actions.className = "cx-project-actions";

    const addExisting = document.createElement("button");
    addExisting.type = "button";
    addExisting.className = "primary";
    addExisting.textContent = t("codex.projects.addExisting");

    const createNew = document.createElement("button");
    createNew.type = "button";
    createNew.textContent = t("codex.projects.createNew");

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
      empty.textContent = t("codex.projects.empty");
      list.appendChild(empty);
    }

    for (const project of projects) {
      const row = document.createElement("button");
      row.type = "button";
      row.className = `cx-project-row ${activeProject?.id === project.id ? "selected" : ""}`;

      const selected = activeProject?.id === project.id;
      if (selected) row.setAttribute("aria-current", "true");
      const icon = document.createElement("span");
      icon.className = "cx-project-icon";
      icon.innerHTML = PROJECT_ROW_ICONS.folder;

      const copy = document.createElement("span");
      copy.className = "cx-project-copy";

      const name = document.createElement("strong");
      name.textContent = project.name;

      // Short path in the row; the full path stays one long-press away.
      const path = document.createElement("small");
      path.textContent = shortProjectPath(project.path);
      row.title = project.path;

      copy.append(name, path);

      const state = document.createElement("span");
      state.className = "cx-project-state";
      state.innerHTML = selected ? PROJECT_ROW_ICONS.check() : PROJECT_ROW_ICONS.chevron;

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
    back.textContent = t("codex.github.backLocal");
    back.addEventListener("click", renderProjectPicker);

    const heading = document.createElement("h3");
    heading.textContent = t("codex.github.heading");

    const status = document.createElement("p");
    status.className = "cx-muted";

    const filters = document.createElement("div");
    filters.className = "cx-github-filters";

    let visibility: "all" | "private" | "public" = "all";
    let page = 1;

    const filterButtons = ([
      ["all", t("common.all")],
      ["private", t("codex.github.filterPrivate")],
      ["public", t("codex.github.filterPublic")]
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
    search.placeholder = t("codex.github.searchPlaceholder");
    search.className = "cx-github-search";

    const list = document.createElement("div");
    list.className = "cx-project-list";

    const pager = document.createElement("div");
    pager.className = "cx-github-pager";

    const previous = document.createElement("button");
    previous.type = "button";
    previous.textContent = t("codex.github.prevPage");

    const pageLabel = document.createElement("span");
    pageLabel.textContent = t("codex.github.pageLabel", { page: formatNumber(1) });

    const nextPage = document.createElement("button");
    nextPage.type = "button";
    nextPage.textContent = t("codex.github.nextPage");

    pager.append(previous, pageLabel, nextPage);
    modalBody.append(back, heading, status, filters, search, list, pager);

    const load = async () => {
      list.textContent = t("common.loading");
      previous.disabled = true;
      nextPage.disabled = true;

      try {
        const authResponse = await fetch("/api/github/status", { cache: "no-store" });
        const auth = await authResponse.json().catch(() => ({}));
        if (!authResponse.ok) {
          throw new Error(auth?.error ? translateServerMessage(String(auth.error)) : t("common.httpError", { status: authResponse.status }));
        }

        status.textContent = auth.authenticated
          ? t("codex.github.authStatus", { login: auth.login || t("codex.github.authenticated") })
          : t("codex.github.unauthenticated");

        if (!auth.authenticated) {
          list.textContent = t("codex.github.unavailable");
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
        if (!response.ok) {
          throw new Error(result?.error ? translateServerMessage(String(result.error)) : t("common.httpError", { status: response.status }));
        }

        pageLabel.textContent = search.value.trim()
          ? t("codex.github.searchPageLabel")
          : t("codex.github.pageLabel", { page: formatNumber(result.page || page) });
        previous.disabled = Boolean(search.value.trim()) || page <= 1;
        nextPage.disabled = Boolean(search.value.trim()) || !result.hasMore;
        pager.classList.toggle("hidden", Boolean(search.value.trim()));

        if (!result.repositories?.length) {
          list.textContent =
            visibility === "private"
              ? t("codex.github.noPrivateRepos")
              : t("codex.github.noRepos");
          return;
        }

        list.replaceChildren(...result.repositories.map((repo: GithubRepo) => {
          const row = document.createElement("button");
          row.type = "button";
          row.className = "cx-project-row";
          row.innerHTML = `<span class="cx-project-icon">◉</span><span class="cx-project-copy"><strong></strong><small></small></span><span class="cx-project-state">›</span>`;
          (row.querySelector("strong") as HTMLElement).textContent = repo.fullName;
          const localGitState = repo.cloned
            ? t("codex.github.localBranchState", {
                branch: repo.currentBranch || repo.defaultBranch,
                dirty: repo.dirty ? t("codex.github.dirtyChanges") : t("codex.github.dirtyClean")
              })
            : "";
          (row.querySelector("small") as HTMLElement).textContent =
            `${repo.private ? t("codex.github.filterPrivate") : t("codex.github.filterPublic")} · ${repo.defaultBranch}${localGitState}`;
          row.addEventListener("click", () => void showGithubRepo(repo));
          return row;
        }));
      } catch (error) {
        status.textContent = error instanceof Error ? translateServerMessage(error.message) : String(error);
        list.textContent = t("codex.github.repoLoadFailed");
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
    modalBody.textContent = t("codex.github.loadingBranches");
    try {
      const branchResponse = await fetch(
        `/api/github/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}/branches`,
        { cache: "no-store" }
      );
      const result = await branchResponse.json().catch(() => ({}));
      if (!branchResponse.ok) {
        throw new Error(result?.error ? translateServerMessage(String(result.error)) : t("common.httpError", { status: branchResponse.status }));
      }
      const refreshedDefaultBranch = String(
        result?.defaultBranch ||
        (result?.branches || []).find((branch: { default?: boolean }) => branch?.default)?.name ||
        repo.defaultBranch ||
        ""
      );
      const form = document.createElement("form");
      form.className = "cx-project-form";
      const back = document.createElement("button"); back.type = "button"; back.className = "cx-back-button"; back.textContent = t("codex.github.backGithub"); back.addEventListener("click", () => void showGithubProjects());
      const title = document.createElement("h3"); title.textContent = repo.fullName;
      const label = document.createElement("label"); label.innerHTML = `<span>${escapeHtml(t("codex.github.branchLabel"))}</span>`;
      const select = document.createElement("select");
      for (const branch of result.branches || []) {
        const option = document.createElement("option");
        option.value = branch.name;
        option.textContent = branch.name;
        option.selected = branch.name === refreshedDefaultBranch;
        select.appendChild(option);
      }
      label.appendChild(select);
      const submit = document.createElement("button"); submit.type = "submit"; submit.className = "primary"; submit.textContent = repo.cloned ? t("codex.github.fetchAndOpen") : t("codex.github.cloneAndOpen");
      const error = document.createElement("p"); error.className = "cx-form-error hidden";
      form.append(back, title, label, submit, error); modalBody.replaceChildren(form);
      form.addEventListener("submit", async event => {
        event.preventDefault();
        submit.disabled = true;
        error.classList.add("hidden");
        try {
          const response = await fetch("/api/github/open", {
            method: "POST",
            headers: { "content-type": "application/json", "x-pocket-operation-id": uid() },
            body: JSON.stringify({ owner: repo.owner, repo: repo.name, branch: select.value })
          });
          const openResult = await response.json();
          if (!response.ok) {
            throw new Error(openResult?.error ? translateServerMessage(String(openResult.error)) : t("common.httpError", { status: response.status }));
          }
          await loadProjects();
          const project = projects.find(item => item.id === openResult.project.id) || openResult.project;
          setActiveProject(project);
          await showProjectWorkspace(project);
        } catch (cause) {
          error.textContent = cause instanceof Error ? translateServerMessage(cause.message) : String(cause);
          error.classList.remove("hidden");
        } finally {
          submit.disabled = false;
        }
      });
    } catch (error) {
      modalBody.textContent = error instanceof Error ? translateServerMessage(error.message) : String(error);
    }
  }

  function showProjectAddForm(action: "add" | "create") {
    modalBody.replaceChildren();

    const form = document.createElement("form");
    form.className = "cx-project-form";

    const back = document.createElement("button");
    back.type = "button";
    back.className = "cx-back-button";
    back.textContent = `‹ ${t("common.back")}`;
    back.addEventListener("click", renderProjectPicker);

    const heading = document.createElement("h3");
    heading.textContent =
      action === "create" ? t("codex.projects.createHeading") : t("codex.projects.addHeading");

    const pathLabel = document.createElement("label");
    pathLabel.innerHTML = `<span>${escapeHtml(t("codex.projects.pathLabel"))}</span>`;
    const pathInput = document.createElement("input");
    pathInput.type = "text";
    pathInput.placeholder =
      action === "create" ? "~/MyProject" : "~/Study-Orbit";
    pathInput.autocomplete = "off";
    pathLabel.appendChild(pathInput);

    const nameLabel = document.createElement("label");
    nameLabel.innerHTML = `<span>${escapeHtml(t("codex.projects.optionalNameLabel"))}</span>`;
    const nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.placeholder = t("codex.projects.namePlaceholder");
    nameLabel.appendChild(nameInput);

    const note = document.createElement("p");
    note.className = "cx-muted";
    note.textContent =
      action === "create"
        ? t("codex.projects.createNote")
        : t("codex.projects.addNote");

    const submit = document.createElement("button");
    submit.type = "submit";
    submit.className = "primary";
    submit.textContent = action === "create" ? t("common.create") : t("common.add");

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
        error.textContent = cause instanceof Error ? translateServerMessage(cause.message) : String(cause);
        error.classList.remove("hidden");
      } finally {
        submit.disabled = false;
      }
    });
  }

  async function showProjectWorkspace(project: ProjectSummary) {
    setActiveProject(project);
    openModal(project.name, project.path);
    modalBody.innerHTML = `<div class="cx-modal-loading">${escapeHtml(t("codex.projects.loadingMarkdown"))}</div>`;

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
      back.textContent = t("codex.projects.backProjects");
      back.addEventListener("click", () => void showProjects());

      const newChat = document.createElement("button");
      newChat.type = "button";
      newChat.className = "primary";
      newChat.textContent = `✎ ${t("codex.sidebar.newChat")}`;
      newChat.addEventListener("click", () => {
        closeModal();
        void createThread();
      });

      toolbar.append(back, newChat);
      modalBody.appendChild(toolbar);

      const quick = document.createElement("section");
      quick.className = "cx-settings-section";
      quick.innerHTML = `<h3>${escapeHtml(t("codex.projects.instructionsHeading"))}</h3>`;

      for (const filename of ["AGENTS.md", "HANDOFF.md", "README.md"]) {
        const found = docs.find(doc => doc.path.toUpperCase() === filename.toUpperCase());
        const button = document.createElement("button");
        button.type = "button";
        button.className = `cx-doc-quick ${found ? "exists" : "missing"}`;

        const label = document.createElement("span");
        label.innerHTML = "<strong></strong><small></small>";
        label.querySelector("strong")!.textContent = filename;
        label.querySelector("small")!.textContent =
          found ? t("common.edit") : t("codex.projects.missingTapCreate");

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
      titleEl.textContent = t("codex.projects.markdownHeading", { count: formatNumber(docs.length) });

      const add = document.createElement("button");
      add.type = "button";
      add.textContent = t("codex.projects.addMarkdownButton");
      add.addEventListener("click", () => showNewMarkdownForm(project));

      heading.append(titleEl, add);
      filesSection.appendChild(heading);

      if (!docs.length) {
        const empty = document.createElement("p");
        empty.className = "cx-muted";
        empty.textContent = t("codex.projects.noMarkdownFiles");
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
      remove.textContent = t("codex.projects.unregisterProject");
      remove.addEventListener("click", async () => {
        if (!confirm(t("codex.projects.unregisterConfirm", { name: project.name }))) {
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
      modalBody.textContent = error instanceof Error ? translateServerMessage(error.message) : String(error);
    }
  }

  function showNewMarkdownForm(project: ProjectSummary) {
    openModal(t("codex.markdown.addTitle"), project.name);
    modalBody.replaceChildren();

    const form = document.createElement("form");
    form.className = "cx-project-form";

    const back = document.createElement("button");
    back.type = "button";
    back.className = "cx-back-button";
    back.textContent = t("codex.markdown.backProject");
    back.addEventListener("click", () => void showProjectWorkspace(project));

    const label = document.createElement("label");
    label.innerHTML = `<span>${escapeHtml(t("codex.markdown.filenameLabel"))}</span>`;
    const input = document.createElement("input");
    input.type = "text";
    input.placeholder = "NOTES.md";
    input.autocapitalize = "off";
    input.autocomplete = "off";
    label.appendChild(input);

    const note = document.createElement("p");
    note.className = "cx-muted";
    note.textContent = t("codex.markdown.subpathNote");

    const submit = document.createElement("button");
    submit.type = "submit";
    submit.className = "primary";
    submit.textContent = t("codex.markdown.openEditor");

    const error = document.createElement("div");
    error.className = "cx-form-error hidden";

    form.append(back, label, note, submit, error);
    modalBody.appendChild(form);

    form.addEventListener("submit", event => {
      event.preventDefault();
      let path = input.value.trim();
      if (!path.toLowerCase().endsWith(".md")) path += ".md";
      if (!path || path === ".md") {
        error.textContent = t("codex.markdown.enterFilename");
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
    modalBody.innerHTML = `<div class="cx-modal-loading">${escapeHtml(t("common.loading"))}</div>`;

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
      back.textContent = t("codex.markdown.backProject");

      const status = document.createElement("span");
      status.className = "cx-md-status";
      status.textContent = create ? t("codex.markdown.statusNew") : t("codex.markdown.statusSaved");

      const save = document.createElement("button");
      save.type = "button";
      save.className = "primary";
      save.textContent = t("common.save");

      toolbar.append(back, status, save);

      const editor = document.createElement("textarea");
      editor.className = "cx-md-editor";
      editor.value = content;
      editor.spellcheck = false;
      editor.setAttribute("aria-label", t("codex.markdown.editorAria", { path }));

      const meta = document.createElement("div");
      meta.className = "cx-md-meta";
      meta.textContent = `${project.path}/${path}`;

      modalBody.append(toolbar, editor, meta);

      let dirty = create;
      modalCloseGuard = () =>
        !dirty || confirm(t("codex.markdown.unsavedCloseConfirm"));

      editor.addEventListener("input", () => {
        dirty = true;
        status.textContent = t("codex.markdown.statusUnsaved");
        status.classList.add("dirty");
      });

      const doSave = async () => {
        save.disabled = true;
        status.textContent = t("common.saving");

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
          status.textContent = t("codex.markdown.statusSaved");
          status.classList.remove("dirty");
        } catch (error) {
          status.textContent = error instanceof Error ? translateServerMessage(error.message) : String(error);
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
        if (dirty && !confirm(t("codex.markdown.unsavedBackConfirm"))) return;
        void showProjectWorkspace(project);
      });

      requestAnimationFrame(() => editor.focus());
    } catch (error) {
      modalBody.textContent = error instanceof Error ? translateServerMessage(error.message) : String(error);
    }
  }

  async function showModels() {
    openModal(
      t("codex.models.modalTitle"),
      activeThreadId ? t("codex.models.thisChat") : t("codex.models.nextChat")
    );
    modalBody.innerHTML = `<div class="cx-modal-loading">${escapeHtml(t("common.loading"))}</div>`;

    try {
      const models = await loadModelCatalog();
      modalBody.replaceChildren();

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
        strong.textContent = t("codex.models.defaultTitle");
        small.textContent = t("codex.models.codexDefaultMeta", {
          model: defaultModel.displayName || defaultModel.model
        });
        auto.append(strong, small);
        auto.addEventListener("click", () => {
          void applyModelSelection(
            defaultModel.model,
            defaultModel.displayName || defaultModel.model
          ).catch(error => {
            modalBody.textContent = error instanceof Error ? translateServerMessage(error.message) : String(error);
          });
        });
        list.appendChild(auto);
      }

      // Codex's own picker lists only non-hidden models; hidden ones (already
      // filtered to this account by the app-server) stay selectable below them.
      const ordered = [...models.filter(model => !model.hidden), ...models.filter(model => model.hidden)];
      let hiddenGroupShown = false;
      for (const model of ordered) {
        if (model.hidden && !hiddenGroupShown) {
          hiddenGroupShown = true;
          const group = document.createElement("div");
          group.className = "cx-model-group";
          group.textContent = t("codex.models.otherGroup");
          list.appendChild(group);
        }
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
          : t("codex.models.disconnectedMeta", { model: value });
        option.append(strong, small);

        if (online) {
          option.addEventListener("click", () => {
            void applyModelSelection(value, name).catch(error => {
              modalBody.textContent = error instanceof Error ? translateServerMessage(error.message) : String(error);
            });
          });
        }
        list.appendChild(option);
      }

      modalBody.appendChild(list);
    } catch (error) {
      const message = error instanceof Error ? translateServerMessage(error.message) : String(error);
      modalBody.replaceChildren();
      const note = document.createElement("p");
      note.className = "cx-cli-note";
      note.textContent = message;
      modalBody.appendChild(note);
    }
  }

  function showRemote() {
    closeSidebar();
    openModal(t("codex.remote.title"), t("codex.remote.subtitle"));
    modalBody.innerHTML = `
      <section class="cx-settings-section">
        <div class="cx-info-row"><span>Codex</span><strong>${escapeHtml(online ? t("codex.remote.connected") : codexAvailabilityLabel(unavailableCode))}</strong></div>
        <div class="cx-info-row"><span>${escapeHtml(t("codex.remote.transportLabel"))}</span><strong>app-server / stdio</strong></div>
        <div class="cx-info-row"><span>${escapeHtml(t("codex.remote.accessLabel"))}</span><strong>Tailscale / DevMoter</strong></div>
      </section>
    `;
  }

  async function refresh(): Promise<boolean> {
    await loadProjects();
    if (!online) return false;

    try {
      await loadModelCatalog();
    } catch {
      // Thread/chat can still work if the model catalog is temporarily unavailable.
    }

    const threadBeforeRefresh = activeThreadId;
    if (!(await loadThreads())) return false;

    if (threadBeforeRefresh && activeThreadId === threadBeforeRefresh) {
      if (!(await loadThreadHistory(threadBeforeRefresh))) return false;
    }
    return true;
  }

  menu.addEventListener("click", openSidebar);
  detailsToggle.addEventListener("click", toggleDetails);
  window.addEventListener("devmoter:close-chat-history", () => closeSidebar(false));
  window.addEventListener("devmoter:surface-changed", () => closeSidebar(false));
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void resumeFromBackground();
  });
  window.addEventListener("pageshow", () => void resumeFromBackground());
  window.addEventListener("online", () => void resumeFromBackground());
  agentSwitchButton.addEventListener("click", () => {
    const open = agentSwitchMenu.classList.toggle("hidden") === false;
    agentSwitchButton.setAttribute("aria-expanded", String(open));
  });
  sidebarClose.addEventListener("click", () => closeSidebar());
  scrim.addEventListener("click", () => closeSidebar());
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
    whenProjectReady,
    getActiveThreadId: () => activeThreadId,
    showToast,
    uid
  });
  devWorkflowsNav.addEventListener("click", () => void devWorkflowPanel.show());
  integrationsNav.addEventListener("click", () => {
    closeSidebar();
    options.onIntegrations?.();
  });
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
  modal.addEventListener("click", event => {
    if (event.target === modal) closeModal();
  });
  document.addEventListener("keydown", event => {
    const overlay = !modal.classList.contains("hidden") ? modal
      : sidebar.classList.contains("open") ? sidebar
        : !desktopLayout.matches && detailsPanel.classList.contains("open") ? detailsPanel : null;
    if (!document.body.classList.contains("codex-mode")) return;
    if (!overlay) {
      if (event.key === "Escape" && !plusMenu.classList.contains("hidden")) {
        closePlusMenu();
        plus.focus();
      }
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      if (overlay === modal) closeModal();
      else if (overlay === detailsPanel) closeDetails();
      else closeSidebar();
      return;
    }
    if (event.key !== "Tab") return;
    const controls = Array.from(overlay.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex="0"]'
    )).filter(control => control.getClientRects().length && !control.closest('[inert], [aria-hidden="true"]'));
    const first = controls[0];
    const last = controls.at(-1);
    if (!first || !last) {
      if (overlay === detailsPanel) { event.preventDefault(); detailsPanel.focus({ preventScroll: true }); }
      return;
    }
    if (!overlay.contains(document.activeElement) || (event.shiftKey && document.activeElement === first)) {
      event.preventDefault();
      (event.shiftKey ? last : first).focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });

  plus.addEventListener("click", () => {
    plusMenu.classList.toggle("hidden");
    plus.setAttribute("aria-expanded", String(!plusMenu.classList.contains("hidden")));
  });
  photo.addEventListener("click", () => photoInput.click());
  file.addEventListener("click", () => fileInput.click());
  pluginsQuick.addEventListener("click", () => {
    closePlusMenu();
    void showPlugins();
  });
  reasoningTop.addEventListener("click", showReasoningPicker);
  usageTop.addEventListener("click", () => void showUsage());
  voice.addEventListener("click", () => {
    const SpeechRecognition = (window as Window & { SpeechRecognition?: new () => any; webkitSpeechRecognition?: new () => any }).SpeechRecognition ||
      (window as Window & { webkitSpeechRecognition?: new () => any }).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      showToast(t("codex.voice.unsupported"));
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
    recognition.onerror = () => showToast(t("codex.voice.failed"));
    recognition.onend = () => voice.classList.remove("listening");
    recognition.start();
  });

  photoInput.addEventListener("change", () => {
    if (photoInput.files) void addFiles(photoInput.files, true);
    photoInput.value = "";
    closePlusMenu();
  });
  fileInput.addEventListener("change", () => {
    if (fileInput.files) void addFiles(fileInput.files);
    fileInput.value = "";
    closePlusMenu();
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
    closePlusMenu();
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
