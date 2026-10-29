import type { MainSurface } from "./surface-navigation.mjs";
import "./unified-workspace-nav.css";
// Stage 2: present native provider transcripts/composers consistently, without
// unmounting/reparenting their live input, stream, history or approval controls.
import "./unified-workspace-chat.css";
// Static line icons, inlined so this module stays import-free for its tests.
const ICON_SVG = (body: string) => `<svg class="dm-line-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`;
const LINE_ICONS: Record<string, string> = {
  "tasks": ICON_SVG('<path d="M9 6h11M9 12h11M9 18h11"/><path d="M4 6l1 1 2-2M4 12l1 1 2-2M4 18l1 1 2-2"/>'),
  "chat": ICON_SVG('<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/>'),
  "git": ICON_SVG('<circle cx="6" cy="6" r="2"/><circle cx="6" cy="18" r="2"/><circle cx="18" cy="8" r="2"/><path d="M6 8v8M18 10a6 6 0 0 1-6 6H8"/>'),
  "tools": ICON_SVG('<path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L4 17l3 3 5.3-5.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.5-2.5z"/>'),
};
const lineIcon = (id: string): string => LINE_ICONS[id] ?? "";


type ChatBackend = "codex" | "opencode" | "api";
type WorkspaceTab = "tasks" | "chat" | "review" | "tools";
const isWorkspaceTab = (value: unknown): value is WorkspaceTab =>
  value === "tasks" || value === "chat" || value === "review" || value === "tools";

type WorkspaceActions = {
  initialSurface: MainSurface;
  initialBackend?: ChatBackend;
  switchBackend: (backend: ChatBackend) => void;
  openHome: () => void;
  openTasks: () => void;
  openReview: () => void;
  openTools: () => void;
};

/**
 * Presentation-only workspace navigator.
 * Sessions, messages, tools and approvals remain owned by their existing providers.
 * This view never invents task records, connectivity, models or permissions.
 */
export function mountTaskFirstWorkspace(actions: WorkspaceActions) {
  if (document.getElementById("dmTaskFirstWorkspace")) return;

  const root = document.createElement("div");
  root.id = "dmTaskFirstWorkspace";
  root.className = "dm-task-first-nav";
  root.innerHTML = `
    <header class="dm-task-first-header">
      <button type="button" data-workspace-home class="dm-task-first-brand" aria-label="DevMoter FAST Home">
        <span class="dm-task-first-mark" aria-hidden="true">▦</span>
        <span><strong>DevMoter <em>FAST</em></strong><small>Unified workspace</small></span>
      </button>
      <p class="dm-task-first-project" data-workspace-project aria-label="Current project"></p>
      <label class="dm-task-first-backend">
        <span>AI backend</span>
        <select data-workspace-backend aria-label="AIバックエンド切り替え">
          <option value="" disabled>AIを選択</option>
          <option value="codex">Codex</option>
          <option value="opencode">OpenCode</option>
          <option value="api">API Chat</option>
        </select>
      </label>
    </header>
    <nav class="dm-task-first-tabs" aria-label="DevMoter workspace">
      <button type="button" data-workspace-action="tasks" aria-label="Tasks and sessions"><span aria-hidden="true">${lineIcon("tasks")}</span><strong>Tasks</strong></button>
      <button type="button" data-workspace-action="chat" aria-label="Current chat and conversation history"><span aria-hidden="true">${lineIcon("chat")}</span><strong>Chat</strong></button>
      <button type="button" data-workspace-action="review" aria-label="Review changes"><span aria-hidden="true">${lineIcon("git")}</span><strong>Review</strong></button>
      <button type="button" data-workspace-action="tools" aria-label="Open tools"><span aria-hidden="true">${lineIcon("tools")}</span><strong>Tools</strong></button>
    </nav>
    <p class="dm-task-first-caption">タスク・会話・レビューを一か所から</p>
    <p class="dm-task-first-feedback" role="status" aria-live="polite" data-workspace-feedback></p>
  `;
  document.body.append(root);
  document.body.classList.add("dm-task-first-enabled");
  // The unified selector is the only agent switcher in this view. Native
  // Codex/API switchers stay mounted for legacy UI, but a read-only identity
  // label replaces them inside their history drawers while this view is active.
  const agentLabels = Array.from(document.querySelectorAll<HTMLElement>("[data-unified-agent-label]"));
  for (const label of agentLabels) label.hidden = false;

  const backendSelect = root.querySelector<HTMLSelectElement>("[data-workspace-backend]")!;
  const projectLabel = root.querySelector<HTMLElement>("[data-workspace-project]")!;
  const feedback = root.querySelector<HTMLElement>("[data-workspace-feedback]")!;

  let surface: MainSurface = actions.initialSurface;
  // Preserve the last real backend when starting on Home or Integrations.
  let currentBackend: ChatBackend = surface === "codex" || surface === "api" || surface === "opencode"
    ? surface
    : actions.initialBackend === "codex" || actions.initialBackend === "api" || actions.initialBackend === "opencode"
      ? actions.initialBackend
      : "opencode";

  const updateProject = () => {
    // Project selection is owned by the existing backend; this is a label only.
    const value = localStorage.getItem("opencode-pocket-project") || "";
    const normalized = value.replace(/\\/g, "/").replace(/\/+$/, "");
    projectLabel.textContent = normalized.split("/").filter(Boolean).pop()?.slice(0, 80) || "Workspace";
  };

  let activeTab: WorkspaceTab | null = null;
  let changingTab = false;
  const renderSelection = () => {
    root.dataset.workspaceTab = activeTab || "";
    for (const button of root.querySelectorAll<HTMLButtonElement>("[data-workspace-action]")) {
      if (button.dataset.workspaceAction === activeTab) button.setAttribute("aria-current", "page");
      else button.removeAttribute("aria-current");
    }
  };
  const writeTabRoute = (tab: WorkspaceTab | null, mode: "push" | "replace") => {
    const url = new URL(window.location.href);
    if (tab) url.searchParams.set("workspaceTab", tab);
    else url.searchParams.delete("workspaceTab");
    if (url.href === window.location.href) return;
    // Keep the existing surface router's state and unrelated deep-link parameters.
    window.history[mode === "push" ? "pushState" : "replaceState"](
      window.history.state, "", url.pathname + url.search + url.hash
    );
  };
  const updateSurface = (next: MainSurface) => {
    surface = next;
    if (next === "codex" || next === "opencode" || next === "api") currentBackend = next;
    backendSelect.value = currentBackend;
    activeTab = next === "codex" || next === "opencode" || next === "api" ? "chat" : null;
    renderSelection();
    updateProject();
  };

  const onSurfaceChanged = (event: Event) => {
    const next = (event as CustomEvent<{ surface?: MainSurface }>).detail?.surface;
    if (next) updateSurface(next);
  };
  // Reset selection before provider listeners close their old overlays. Otherwise
  // their close notifications could replace the destination history entry.
  window.addEventListener("devmoter:surface-changed", onSurfaceChanged, true);

  const onBackendChanged = (event: Event) => {
    const next = (event as CustomEvent<{ backend?: ChatBackend }>).detail?.backend;
    if (next === "codex" || next === "opencode" || next === "api") {
      currentBackend = next;
      backendSelect.value = next;
    }
  };
  window.addEventListener("devmoter:backend-changed", onBackendChanged);

  backendSelect.addEventListener("change", () => {
    const next = backendSelect.value;
    if (next !== "codex" && next !== "opencode" && next !== "api") return;
    feedback.textContent = "";
    selectTab("chat", "push", next);
  });

  function openNativeHistory() {
    // The provider's own history control is authoritative and knows its session IDs.
    const trigger = document.querySelector<HTMLButtonElement>(
      currentBackend === "codex" ? "#cxMenu" : currentBackend === "opencode" ? "#ocxMenu" : "#apiMenu"
    );
    if (!trigger) {
      feedback.textContent = "この画面では会話履歴を開けません。";
      return;
    }
    trigger.click();
  }

  function selectTab(tab: WorkspaceTab, historyMode: "push" | "replace" | "none", backend?: ChatBackend) {
    changingTab = true;
    try {
      // Tasks and Review are provider-owned overlays, not MainSurface routes.
      // Close them explicitly even when the underlying backend did not change.
      window.dispatchEvent(new window.CustomEvent("devmoter:workspace-tab-changing"));
      window.dispatchEvent(new window.CustomEvent("devmoter:close-chat-history"));
      feedback.textContent = "";
      let providerRouteChanged = false;
      if (tab === "tasks") actions.openTasks();
      else if (tab === "review") actions.openReview();
      else if (tab === "tools") actions.openTools();
      else if (backend || surface === "home" || surface === "integrations") {
        const previousSurface = new URL(window.location.href).searchParams.get("surface");
        actions.switchBackend(backend || currentBackend);
        // The main-surface navigator already pushed a history entry. Reuse it
        // instead of adding a second Back stop for the identical Chat screen.
        providerRouteChanged = new URL(window.location.href).searchParams.get("surface") !== previousSurface;
      }
      activeTab = tab;
      renderSelection();
      if (historyMode !== "none") {
        writeTabRoute(tab, providerRouteChanged ? "replace" : historyMode);
        // Closing Review/Tools may move focus to their old trigger. Keep it on
        // the destination when no new modal takes ownership of focus.
        if (tab === "tasks" || tab === "chat") {
          root.querySelector<HTMLButtonElement>(`[data-workspace-action="${tab}"]`)?.focus({ preventScroll: true });
        }
      }
    } finally {
      changingTab = false;
    }
  }

  const onPanelChanged = (event: Event) => {
    if (changingTab) return;
    const detail = (event as CustomEvent<{ tab?: unknown; open?: boolean }>).detail;
    if (!detail || !isWorkspaceTab(detail.tab)) return;
    if (detail.open) activeTab = detail.tab;
    else if (activeTab === detail.tab) activeTab = surface === "home" || surface === "integrations" ? null : "chat";
    else return;
    renderSelection();
    writeTabRoute(activeTab, "replace");
  };
  window.addEventListener("devmoter:workspace-panel-changed", onPanelChanged);

  const restoreTabRoute = () => {
    const tab = new URLSearchParams(window.location.search).get("workspaceTab");
    if (isWorkspaceTab(tab)) selectTab(tab, "none");
    else {
      changingTab = true;
      try { window.dispatchEvent(new window.CustomEvent("devmoter:workspace-tab-changing")); }
      finally { changingTab = false; }
      updateSurface(surface);
    }
  };
  window.addEventListener("popstate", restoreTabRoute);

  for (const button of root.querySelectorAll<HTMLButtonElement>("[data-workspace-action]")) {
    button.addEventListener("click", () => {
      const tab = button.dataset.workspaceAction;
      if (!isWorkspaceTab(tab)) return;
      // Preserve the established Chat history shortcut only on the Chat screen.
      if (tab === "chat" && activeTab === "chat") openNativeHistory();
      else if (tab !== activeTab) selectTab(tab, "push");
    });
  }

  root.querySelector<HTMLButtonElement>("[data-workspace-home]")!.addEventListener("click", actions.openHome);
  updateSurface(surface);
  restoreTabRoute();
  return { destroy() {
    window.removeEventListener("devmoter:surface-changed", onSurfaceChanged, true);
    window.removeEventListener("devmoter:backend-changed", onBackendChanged);
    window.removeEventListener("devmoter:workspace-panel-changed", onPanelChanged);
    window.removeEventListener("popstate", restoreTabRoute);
    for (const label of agentLabels) label.hidden = true;
    root.remove();
    document.body.classList.remove("dm-task-first-enabled");
  } };
}
