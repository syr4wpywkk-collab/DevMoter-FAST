import type { MainSurface } from "./surface-navigation.mjs";
import "./unified-workspace-nav.css";
// Stage 2: present native provider transcripts/composers consistently, without
// unmounting/reparenting their live input, stream, history or approval controls.
import "./unified-workspace-chat.css";

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
        <span><strong>DevMoter <em>FAST</em></strong><small>UNIFIED WORKSPACE</small></span>
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
      <button type="button" class="dm-task-first-menu-button" data-workspace-menu-button aria-haspopup="true" aria-expanded="false" aria-controls="dmTaskFirstMenu" aria-label="Switch screen">☰</button>
    </header>
    <nav id="dmTaskFirstMenu" class="dm-task-first-menu" aria-label="DevMoter workspace" hidden>
      <button type="button" data-workspace-action="tasks" aria-label="Tasks and sessions"><span aria-hidden="true">▤</span><strong>タスク</strong></button>
      <button type="button" data-workspace-action="chat" aria-label="Current chat and conversation history"><span aria-hidden="true">◇</span><strong>Chat</strong></button>
      <button type="button" data-workspace-action="review" aria-label="Review changes"><span aria-hidden="true">⑂</span><strong>Review</strong></button>
      <button type="button" data-workspace-action="tools" aria-label="Open tools"><span aria-hidden="true">⌘</span><strong>Tools</strong></button>
      <hr aria-hidden="true" />
      <button type="button" data-workspace-command="theme"><span aria-hidden="true">◐</span><strong>テーマ</strong><small data-workspace-theme-value></small></button>
      <button type="button" data-workspace-command="context"><span aria-hidden="true">◒</span><strong>表示履歴</strong></button>
      <button type="button" data-workspace-command="checkpoints"><span aria-hidden="true">✓</span><strong>チェックポイント</strong></button>
      <button type="button" data-workspace-command="extensions"><span aria-hidden="true">＋</span><strong>拡張</strong></button>
      <hr aria-hidden="true" />
      <button type="button" data-workspace-settings><span aria-hidden="true">⚙</span><strong>設定</strong></button>
    </nav>
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
  const menuButton = root.querySelector<HTMLButtonElement>("[data-workspace-menu-button]")!;
  const menu = root.querySelector<HTMLElement>(".dm-task-first-menu")!;

  const isMenuOpen = () => !menu.hidden;
  function closeMenu(restoreFocus = false) {
    if (menu.hidden) return;
    menu.hidden = true;
    menuButton.setAttribute("aria-expanded", "false");
    if (restoreFocus) menuButton.focus({ preventScroll: true });
  }
  function openMenu() {
    menu.hidden = false;
    menuButton.setAttribute("aria-expanded", "true");
    const current = menu.querySelector<HTMLButtonElement>('[aria-current="page"]') || menu.querySelector<HTMLButtonElement>("button");
    current?.focus({ preventScroll: true });
  }
  menuButton.addEventListener("click", () => (isMenuOpen() ? closeMenu(true) : openMenu()));
  // Settings (account, logout, vault, devices…) is an action, not a screen tab.
  root.querySelector<HTMLButtonElement>("[data-workspace-settings]")!.addEventListener("click", () => {
    closeMenu();
    window.dispatchEvent(new window.CustomEvent("devmoter:open-settings", { detail: { page: "root" } }));
  });
  // Theme / display history / checkpoints / extensions used to be a button
  // group docked in every chat drawer; they are menu commands now.
  const themeValue = root.querySelector<HTMLElement>("[data-workspace-theme-value]")!;
  const THEME_LABELS: Record<string, string> = { system: "システム", light: "ライト", dark: "ダーク" };
  const syncThemeValue = () => {
    themeValue.textContent = THEME_LABELS[localStorage.getItem("devmoter-theme") || "system"] || THEME_LABELS.system;
  };
  syncThemeValue();
  window.addEventListener("devmoter:theme-changed", syncThemeValue);
  for (const button of root.querySelectorAll<HTMLButtonElement>("[data-workspace-command]")) {
    button.addEventListener("click", () => {
      const command = button.dataset.workspaceCommand;
      // Theme cycles in place so the new value stays visible in the open menu.
      if (command !== "theme") closeMenu();
      window.dispatchEvent(new window.CustomEvent("devmoter:workspace-command", { detail: { command } }));
    });
  }
  const onDocumentKeydown = (event: KeyboardEvent) => {
    if (event.key === "Escape" && isMenuOpen()) { event.stopPropagation(); closeMenu(true); }
  };
  const onDocumentPointerDown = (event: Event) => {
    if (isMenuOpen() && !root.contains(event.target as Node)) closeMenu();
  };
  document.addEventListener("keydown", onDocumentKeydown, true);
  document.addEventListener("pointerdown", onDocumentPointerDown, true);
  menu.addEventListener("focusout", event => {
    const next = (event as FocusEvent).relatedTarget as Node | null;
    if (next && !menu.contains(next) && next !== menuButton) closeMenu();
  });

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
        if (tab === "tasks" || tab === "chat") menuButton.focus({ preventScroll: true });
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
      closeMenu();
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
    window.removeEventListener("devmoter:theme-changed", syncThemeValue);
    document.removeEventListener("keydown", onDocumentKeydown, true);
    document.removeEventListener("pointerdown", onDocumentPointerDown, true);
    for (const label of agentLabels) label.hidden = true;
    root.remove();
    document.body.classList.remove("dm-task-first-enabled");
  } };
}
