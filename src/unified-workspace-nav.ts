import type { MainSurface } from "./surface-navigation.mjs";
import "./unified-workspace-nav.css";
// Stage 2: present native provider transcripts/composers consistently, without
// unmounting/reparenting their live input, stream, history or approval controls.
import "./unified-workspace-chat.css";
import { bindLanguageSelectors, t } from "./i18n";
import {
  QWEN_UI_ENABLED,
  isHiddenQwenTarget,
  isVisibleChatBackend,
  normalizeVisibleBackend,
  normalizeVisibleSurface
} from "./feature-flags.mjs";

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// The ☰ menu uses the same line-icon set as Home and Settings. Exact copies of
// APP_REGISTRY / SYSTEM_ICONS (app-registry.ts); this module is loaded standalone
// by tests, so it cannot import them (test/line-icons.test.mjs keeps them equal).
const ICONS: Record<string, string> = {
  "chat": '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 12a8 8 0 0 1-11.6 7.1L4 20l1-4.1A8 8 0 1 1 20 12Z"/></svg>',
  "checkpoint": '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 21V4"/><path d="M5 4h11l-2 4 2 4H5"/></svg>',
  "context": '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 9 5-9 5-9-5Z"/><path d="m3 13 9 5 9-5"/></svg>',
  "extensions": '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8h4a2 2 0 1 1 4 0h4v4a2 2 0 1 1 0 4v4H4Z"/></svg>',
  "home": '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 11l8-7 8 7"/><path d="M6 10v10h12V10"/></svg>',
  "language": '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h9M8.5 3v2M6 5c0 4 3 7 6 8M11 5c0 4-3 7-7 8"/><path d="m13 21 4-9 4 9M14.5 18h5"/></svg>',
  "review": '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 12l2 2 4-4"/><circle cx="12" cy="12" r="9"/></svg>',
  "sessions": '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12h4l3-7 4 14 3-7h4"/></svg>',
  "settings": '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/></svg>',
  "terminal": '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="m7 9 3 3-3 3M12 15h5"/></svg>',
  "theme": '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 3v18M12 8h5M12 12h6M12 16h5"/></svg>',
  "tools": '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="8" width="18" height="12" rx="2"/><path d="M9 8V5h6v3M3 13h18"/></svg>',
};

type ChatBackend = "codex" | "opencode" | "api" | "deepseek" | "devin" | "qwen";
type WorkspaceTab = "tasks" | "chat" | "review" | "tools" | "terminal";
const isWorkspaceTab = (value: unknown): value is WorkspaceTab =>
  value === "tasks" || value === "chat" || value === "review" || value === "tools" || value === "terminal";

type WorkspaceActions = {
  initialSurface: MainSurface;
  initialBackend?: ChatBackend;
  switchBackend: (backend: ChatBackend) => void;
  openHome: () => void;
  openTasks: () => void;
  openReview: () => void;
  openTools: () => void;
  openTerminal: () => void;
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
    <button type="button" class="dm-task-first-menu-button" data-workspace-menu-button aria-haspopup="dialog" aria-expanded="false" aria-controls="dmTaskFirstDrawer" aria-label="${escapeHtml(t("nav.switchScreenAria"))}">☰</button>
    <div class="dm-task-first-scrim" data-workspace-scrim hidden></div>
    <aside id="dmTaskFirstDrawer" class="dm-task-first-drawer" role="dialog" aria-modal="true" aria-label="${escapeHtml(t("nav.workspaceNavAria"))}" hidden>
      <div class="dm-task-first-drawer-head">
        <button type="button" data-workspace-home class="dm-task-first-brand" aria-label="${escapeHtml(t("nav.homeAria"))}">
          <span class="dm-task-first-mark" aria-hidden="true">▦</span>
          <span><strong>DevMoter <em>FAST</em></strong><small>${escapeHtml(t("nav.unifiedWorkspace"))}</small></span>
        </button>
        <button type="button" class="dm-task-first-menu-close" data-workspace-menu-close aria-label="${escapeHtml(t("shell.closeSidebar"))}">×</button>
      </div>
      <div class="dm-task-first-drawer-meta">
        <div class="dm-task-first-project-row">
          <span class="dm-task-first-meta-label">${escapeHtml(t("nav.currentProjectAria"))}</span>
          <p class="dm-task-first-project" data-workspace-project aria-label="${escapeHtml(t("nav.currentProjectAria"))}"></p>
        </div>
        <label class="dm-task-first-backend">
          <span>${escapeHtml(t("nav.aiBackend"))}</span>
          <select data-workspace-backend aria-label="${escapeHtml(t("shell.aiSwitchAria"))}">
            <option value="" disabled>${escapeHtml(t("nav.selectAi"))}</option>
            <option value="codex">Codex</option>
            <option value="opencode">OpenCode</option>
            <option value="api">API Chat</option>
            <option value="deepseek">DeepSeek</option>
            <option value="devin">Devin</option>
            ${QWEN_UI_ENABLED ? '<option value="qwen">Qwen Code</option>' : ""}
          </select>
        </label>
      </div>
      <hr aria-hidden="true" />
      <nav id="dmTaskFirstMenu" class="dm-task-first-menu" aria-label="${escapeHtml(t("nav.workspaceNavAria"))}" hidden>
        <button type="button" data-workspace-go="home" aria-label="${escapeHtml(t("nav.home"))}"><span aria-hidden="true">${ICONS.home}</span><strong>${escapeHtml(t("nav.home"))}</strong></button>
        <button type="button" data-workspace-action="tasks" aria-label="${escapeHtml(t("nav.tasksAria"))}"><span aria-hidden="true">${ICONS.sessions}</span><strong>${escapeHtml(t("nav.tasks"))}</strong></button>
        <button type="button" data-workspace-action="chat" aria-label="${escapeHtml(t("nav.chatAria"))}"><span aria-hidden="true">${ICONS.chat}</span><strong>${escapeHtml(t("nav.chat"))}</strong></button>
        <button type="button" data-workspace-action="review" aria-label="${escapeHtml(t("nav.reviewAria"))}"><span aria-hidden="true">${ICONS.review}</span><strong>${escapeHtml(t("nav.review"))}</strong></button>
        <button type="button" data-workspace-action="tools" aria-label="${escapeHtml(t("nav.toolsAria"))}"><span aria-hidden="true">${ICONS.tools}</span><strong>${escapeHtml(t("nav.tools"))}</strong></button>
        <button type="button" data-workspace-action="terminal" aria-label="${escapeHtml(t("nav.terminalAria"))}"><span aria-hidden="true">${ICONS.terminal}</span><strong>${escapeHtml(t("nav.terminal"))}</strong></button>
        <hr aria-hidden="true" />
        <button type="button" data-workspace-command="theme"><span aria-hidden="true">${ICONS.theme}</span><strong>${escapeHtml(t("nav.theme"))}</strong><small data-workspace-theme-value></small></button>
        <button type="button" data-workspace-command="context"><span aria-hidden="true">${ICONS.context}</span><strong>${escapeHtml(t("nav.context"))}</strong></button>
        <button type="button" data-workspace-command="checkpoints"><span aria-hidden="true">${ICONS.checkpoint}</span><strong>${escapeHtml(t("nav.checkpoints"))}</strong></button>
        <button type="button" data-workspace-command="extensions"><span aria-hidden="true">${ICONS.extensions}</span><strong>${escapeHtml(t("nav.extensions"))}</strong></button>
        <hr aria-hidden="true" />
        <button type="button" data-workspace-settings><span aria-hidden="true">${ICONS.settings}</span><strong>${escapeHtml(t("nav.settings"))}</strong></button>
        <label class="dm-task-first-menu-row"><span aria-hidden="true">${ICONS.language}</span><strong>${escapeHtml(t("nav.language"))}</strong>
          <select data-language-select aria-label="${escapeHtml(t("language.ariaLabel"))}">
            <option value="ja">日本語</option>
            <option value="en">English</option>
            <option value="zh-Hans">简体中文</option>
            <option value="zh-Hant">繁體中文</option>
          </select>
        </label>
      </nav>
    </aside>
    <p class="dm-task-first-feedback" role="status" aria-live="polite" data-workspace-feedback></p>
  `;
  document.body.append(root);
  bindLanguageSelectors(root, { reload: true });
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
  const scrim = root.querySelector<HTMLElement>("[data-workspace-scrim]")!;
  const drawer = root.querySelector<HTMLElement>("#dmTaskFirstDrawer")!;
  const closeButton = root.querySelector<HTMLButtonElement>("[data-workspace-menu-close]")!;
  const menu = root.querySelector<HTMLElement>(".dm-task-first-menu")!;

  const updateProject = () => {
    // Project selection is owned by the existing backend; this is a label only.
    const value = localStorage.getItem("opencode-pocket-project") || "";
    const normalized = value.replace(/\\/g, "/").replace(/\/+$/, "");
    projectLabel.textContent = normalized.split("/").filter(Boolean).pop()?.slice(0, 80) || t("nav.workspaceFallback");
  };

  // One state, one transition. The ☰ button opens the drawer; the drawer close
  // button, backdrop scrim, outside taps, Escape, focus leaving the drawer, and
  // item selection all call setMenuOpen(false). "Outside" means outside BOTH the
  // drawer and its button, so a tap on ☰ never races its own click.
  let menuOpen = false;
  function setMenuOpen(next: boolean, restoreFocus = false) {
    if (next === menuOpen) return;
    menuOpen = next;
    drawer.hidden = !next;
    scrim.hidden = !next;
    menu.hidden = !next;
    root.classList.toggle("menu-open", next);
    menuButton.setAttribute("aria-expanded", String(next));
    if (next) {
      updateProject();
      // Short screens scroll the drawer; it always opens at the top (brand first).
      drawer.scrollTop = 0;
      menu.scrollTop = 0;
      const current = menu.querySelector<HTMLButtonElement>('[aria-current="page"]') || menu.querySelector<HTMLButtonElement>("button");
      current?.focus({ preventScroll: true });
    } else if (restoreFocus) menuButton.focus({ preventScroll: true });
  }
  const isMenuTarget = (target: EventTarget | null) =>
    target instanceof window.Node && (drawer.contains(target) || menuButton.contains(target));
  menuButton.addEventListener("click", () => setMenuOpen(!menuOpen, true));
  closeButton.addEventListener("click", () => setMenuOpen(false, true));
  scrim.addEventListener("click", event => {
    event.stopPropagation();
    setMenuOpen(false, true);
  });
  const themeValue = root.querySelector<HTMLElement>("[data-workspace-theme-value]")!;
  const themeLabel = (mode: string) =>
    mode === "light" ? t("nav.themeLight") : mode === "dark" ? t("nav.themeDark") : t("nav.themeSystem");
  const syncThemeValue = () => {
    themeValue.textContent = themeLabel(localStorage.getItem("devmoter-theme") || "system");
  };
  syncThemeValue();
  window.addEventListener("devmoter:theme-changed", syncThemeValue);
  const FOCUSABLE_SELECTOR =
    'button:not(:disabled), input:not([type="hidden"]):not(:disabled), select:not(:disabled), textarea:not(:disabled), summary, [href], [tabindex]:not([tabindex="-1"])';
  const isVisibleFocusTarget = (target: HTMLElement | null): target is HTMLElement => {
    const closedDetails = target?.closest("details:not([open])");
    if (
      !target?.isConnected ||
      (closedDetails && target !== closedDetails.querySelector("summary")) ||
      target.closest('[inert], [aria-hidden="true"], [hidden], .hidden')
    ) {
      return false;
    }
    if (drawer.getClientRects().length > 0 && !target.getClientRects().length) return false;
    for (let el: Element | null = target; el; el = el === drawer ? null : el.parentElement) {
      const style = window.getComputedStyle?.(el);
      if (style && (style.display === "none" || style.visibility === "hidden")) return false;
    }
    return true;
  };
  const onDocumentKeydown = (event: KeyboardEvent) => {
    if (!menuOpen) return;
    if (event.key === "Escape") { event.stopPropagation(); setMenuOpen(false, true); return; }
    if (event.key !== "Tab") return;
    // Keep Tab trapped inside the open modal drawer and prevent underlying
    // document-level handlers (e.g. app-shell sidebar) from pulling focus out.
    event.stopPropagation();
    const controls = Array.from(drawer.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
      .filter(control => control.tabIndex >= 0 && isVisibleFocusTarget(control));
    const first = controls[0];
    const last = controls[controls.length - 1];
    if (!first || !last) { event.preventDefault(); return; }
    const active = document.activeElement;
    if (!drawer.contains(active) || (event.shiftKey ? active === first : active === last)) {
      event.preventDefault();
      (event.shiftKey ? last : first).focus({ preventScroll: true });
    }
  };
  const onDocumentPointerDown = (event: Event) => {
    if (!menuOpen || isMenuTarget(event.target)) return;
    const isScrim = event.target === scrim;
    if (isScrim) event.preventDefault();
    setMenuOpen(false, isScrim);
  };
  document.addEventListener("keydown", onDocumentKeydown, true);
  document.addEventListener("pointerdown", onDocumentPointerDown, true);
  drawer.addEventListener("focusout", event => {
    const next = (event as FocusEvent).relatedTarget;
    if (next && !isMenuTarget(next)) setMenuOpen(false);
  });

  let surface: MainSurface = normalizeVisibleSurface(actions.initialSurface);
  // Preserve the last real backend when starting on Home or Integrations.
  let currentBackend: ChatBackend = isVisibleChatBackend(surface)
    ? surface
    : normalizeVisibleBackend(actions.initialBackend);

  let activeTab: WorkspaceTab | null = null;
  let changingTab = false;
  const renderSelection = () => {
    root.dataset.workspaceTab = activeTab || "";
    for (const button of root.querySelectorAll<HTMLButtonElement>("[data-workspace-action]")) {
      if (button.dataset.workspaceAction === activeTab) button.setAttribute("aria-current", "page");
      else button.removeAttribute("aria-current");
    }
    const home = root.querySelector<HTMLButtonElement>('[data-workspace-go="home"]')!;
    if (!activeTab && surface === "home") home.setAttribute("aria-current", "page");
    else home.removeAttribute("aria-current");
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
    const resolved = normalizeVisibleSurface(next);
    surface = resolved;
    if (isVisibleChatBackend(resolved)) currentBackend = resolved;
    backendSelect.value = currentBackend;
    activeTab = isVisibleChatBackend(resolved) ? "chat" : null;
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
    if (isVisibleChatBackend(next) || isHiddenQwenTarget(next)) {
      currentBackend = normalizeVisibleBackend(next);
      backendSelect.value = currentBackend;
    }
  };
  window.addEventListener("devmoter:backend-changed", onBackendChanged);

  backendSelect.addEventListener("change", () => {
    const next = backendSelect.value;
    if (!isVisibleChatBackend(next)) return;
    feedback.textContent = "";
    setMenuOpen(false);
    selectTab("chat", "push", next);
  });

  function openNativeHistory() {
    // The provider's own history control is authoritative and knows its session IDs.
    const trigger = document.querySelector<HTMLButtonElement>(
      currentBackend === "codex" ? "#cxMenu"
        : currentBackend === "opencode" ? "#ocxMenu"
        // The DeepSeek surface reuses the API Chat markup, so its history
        // trigger shares the #apiMenu id and must be scoped to its own view.
        : currentBackend === "deepseek" ? "#deepseekView #apiMenu"
        : currentBackend === "devin" ? "[data-devin-history]"
        : "#apiMenu"
    );
    if (!trigger) {
      feedback.textContent = t("nav.historyUnavailable");
      return;
    }
    trigger.click();
  }

  // Every ☰ destination goes through here (or goHome). workspace-tab-changing
  // is the single signal that closes whatever covers the screen (Tasks,
  // Review, Tools and Settings), so only the destination stays visible.
  function selectTab(
    tab: WorkspaceTab, historyMode: "push" | "replace" | "none", backend?: ChatBackend
  ) {
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
      else if (tab === "terminal") actions.openTerminal();
      else if (backend || surface === "home" || surface === "integrations") {
        if (backend) backend = normalizeVisibleBackend(backend);
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

  function goHome() {
    setMenuOpen(false);
    changingTab = true;
    try {
      window.dispatchEvent(new window.CustomEvent("devmoter:workspace-tab-changing"));
      actions.openHome();
    } finally {
      changingTab = false;
    }
    activeTab = null;
    renderSelection();
    writeTabRoute(null, "replace");
  }

  // Menu selection is handled in one place: close the menu, then route.
  menu.addEventListener("click", event => {
    const item = (event.target as Element | null)?.closest<HTMLButtonElement>("button");
    if (!item || !menu.contains(item)) return;
    const command = item.dataset.workspaceCommand;
    // Theme cycles in place so the new value stays visible in the open menu.
    if (command === "theme") {
      window.dispatchEvent(new window.CustomEvent("devmoter:workspace-command", { detail: { command } }));
      return;
    }
    setMenuOpen(false);
    const tab = item.dataset.workspaceAction;
    const go = item.dataset.workspaceGo;
    if (isWorkspaceTab(tab)) {
      if (tab === "chat" && activeTab === "chat") {
        // Preserve the established Chat history shortcut on the Chat screen.
        window.dispatchEvent(new window.CustomEvent("devmoter:workspace-tab-changing"));
        openNativeHistory();
      } else {
        // Reselecting the current screen still closes anything covering it.
        selectTab(tab, tab === activeTab ? "none" : "push");
      }
    } else if (go === "home") goHome();
    else if (item.hasAttribute("data-workspace-settings")) {
      // Settings (account, logout, vault, devices…) is an action, not a screen tab.
      window.dispatchEvent(new window.CustomEvent("devmoter:open-settings", { detail: { page: "root" } }));
    } else if (command) {
      window.dispatchEvent(new window.CustomEvent("devmoter:workspace-command", { detail: { command } }));
    }
  });

  root.querySelector<HTMLButtonElement>("[data-workspace-home]")!.addEventListener("click", goHome);
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
