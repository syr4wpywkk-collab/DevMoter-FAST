import "./app-shell.css";
import type { MainSurface } from "./surface-navigation.mjs";
import { shouldUseUnifiedWorkspace } from "./unified-ui-mode.mjs";
import { getAppDefinition, isAppId } from "./app-registry";
import { mountToolsAi } from "./tools-ai";

type Backend = "opencode" | "codex" | "api" | "integrations";

type ShellOptions = {
  switchBackend: (backend: Backend) => void;
  initialBackend?: Backend;
  initialSurface?: MainSurface;
  openHome: () => void;
};

function bySelector<T extends HTMLElement>(selector: string) {
  return document.querySelector<T>(selector);
}

function clickExisting(selector: string) {
  const target = bySelector<HTMLElement>(selector);
  if (!target) throw new Error("This feature is not available on the current build.");
  target.click();
}

function openToolsTab(tab: "terminal") {
  clickExisting(".dm-tools-launcher");
  window.setTimeout(() => {
    const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>(".dm-tools-tabs button"));
    if (tab === "terminal") buttons[0]?.click();
  }, 0);
}

function openRemoteTab(tab: "automation") {
  clickExisting(".dm-control-trigger");
  window.setTimeout(() => {
    document.querySelector<HTMLButtonElement>(`.dm-control-tabs [data-tab="${tab}"]`)?.click();
  }, 0);
}

export function mountUnifiedFeatureShell(options: ShellOptions) {
  if (document.querySelector("#devmoterUnifiedShell")) return;

  document.body.classList.add("devmoter-unified-shell");

  const root = document.createElement("div");
  root.id = "devmoterUnifiedShell";
  root.className = "dm-shell";
  root.innerHTML = `
    <button class="dm-shell-menu-trigger" type="button" aria-label="Open DevMoter sidebar" aria-expanded="false">
      <span aria-hidden="true">☰</span><small>Tools</small>
    </button>

    <div class="dm-shell-scrim hidden" data-shell-scrim></div>

    <aside class="dm-shell-sidebar" aria-hidden="true" aria-label="DevMoter feature sidebar" inert>
      <header class="dm-shell-sidebar-head">
        <div>
          <strong>開発ツール</strong>
        </div>
        <button type="button" data-shell-close aria-label="Close sidebar">×</button>
      </header>

      <div class="dm-shell-sidebar-scroll">
        <div data-tools-ai-root></div>
      </div>
    </aside>

    <div class="dm-shell-toast hidden" role="status" aria-live="polite"></div>
  `;

  document.body.appendChild(root);

  const trigger = root.querySelector<HTMLButtonElement>(".dm-shell-menu-trigger")!;
  const sidebar = root.querySelector<HTMLElement>(".dm-shell-sidebar")!;
  const scrim = root.querySelector<HTMLElement>("[data-shell-scrim]")!;
  const toast = root.querySelector<HTMLElement>(".dm-shell-toast")!;
  let backend: Backend = options.initialBackend || "opencode";
  let surface: MainSurface = options.initialSurface || "home";
  let toastTimer = 0;
  let sidebarReturnFocus: HTMLElement | null = null;
  const toolsAi = mountToolsAi(root.querySelector<HTMLElement>("[data-tools-ai-root]")!, {
    openSettings: () => { closeSidebar(); options.switchBackend("api"); window.requestAnimationFrame(() => document.querySelector<HTMLButtonElement>("#apiSettingsTop")?.click()); }
  });
  // Keep the SAME Stop control outside the scrolling content.
  root.querySelector(".dm-shell-sidebar-head")!.insertBefore(toolsAi.stopButton, root.querySelector("[data-shell-close]"));

  function notify(message: string) {
    if (toastTimer) window.clearTimeout(toastTimer);
    toast.textContent = message;
    toast.classList.remove("hidden");
    toastTimer = window.setTimeout(() => toast.classList.add("hidden"), 2600);
  }

  function isVisibleFocusTarget(target: HTMLElement | null): target is HTMLElement {
    const closedDetails = target?.closest("details:not([open])");
    return Boolean(target?.isConnected && (!closedDetails || target === closedDetails.querySelector("summary")) && !target.closest('[inert], [aria-hidden="true"], [hidden]') && target.getClientRects().length);
  }

  function openSidebar() {
    if (sidebar.classList.contains("open")) return;
    window.dispatchEvent(new CustomEvent("devmoter:global-nav-opened"));
    window.dispatchEvent(new CustomEvent("devmoter:close-chat-history"));
    sidebarReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    sidebar.classList.add("open");
    sidebar.inert = false;
    sidebar.setAttribute("aria-hidden", "false");
    sidebar.setAttribute("role", "dialog");
    sidebar.setAttribute("aria-modal", "true");
    trigger.setAttribute("aria-expanded", "true");
    scrim.classList.remove("hidden");
    document.body.classList.add("devmoter-shell-menu-open");
    root.querySelector<HTMLButtonElement>("[data-shell-close]")!.focus({ preventScroll: true });
    window.dispatchEvent(new CustomEvent("devmoter:workspace-panel-changed", { detail: { tab: "tools", open: true } }));
    void toolsAi.refresh();
  }

  function closeSidebar() {
    const wasOpen = sidebar.classList.contains("open");
    sidebar.classList.remove("open");
    sidebar.inert = true;
    sidebar.setAttribute("aria-hidden", "true");
    sidebar.removeAttribute("role");
    sidebar.removeAttribute("aria-modal");
    trigger.setAttribute("aria-expanded", "false");
    scrim.classList.add("hidden");
    document.body.classList.remove("devmoter-shell-menu-open");
    if (wasOpen) {
      window.dispatchEvent(new CustomEvent("devmoter:workspace-panel-changed", { detail: { tab: "tools", open: false } }));
      const fallback = document.body.classList.contains("codex-mode")
        ? document.querySelector<HTMLElement>("#cxMenu")
        : trigger;
      const target = isVisibleFocusTarget(sidebarReturnFocus)
        ? sidebarReturnFocus
        : fallback;
      if (isVisibleFocusTarget(target)) target.focus({ preventScroll: true });
    }
    sidebarReturnFocus = null;
  }

  function updateBackend(next: Backend) {
    backend = next;
    trigger.dataset.backend = backend;
  }

  function run(action: () => void) {
    closeSidebar();
    try {
      action();
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error));
    }
  }

  trigger.addEventListener("click", () => {
    if (sidebar.classList.contains("open")) closeSidebar();
    else openSidebar();
  });

  const launchApp = (id: unknown) => {
    if (!isAppId(id)) throw new Error("This app is not registered.");
    const app = getAppDefinition(id);
    if (app.availability !== "available") {
      if (id === "browser") clickExisting(".adv-fab");
      else notify(app.previewMessage || `${app.title} is not available yet.`);
      return;
    }
    switch (id) {
      case "chat": {
        const lastBackend = localStorage.getItem("opencode-pocket-backend");
        options.switchBackend(lastBackend === "codex" || lastBackend === "api" ? lastBackend : "opencode");
        break;
      }
      case "projects": options.switchBackend("codex"); updateBackend("codex"); window.setTimeout(() => clickExisting("#cxProjectsNav"), 0); break;
      case "mission-control": window.dispatchEvent(new CustomEvent("devmoter:open-mission-control")); break;
      case "office": void import("./office").then(module => module.openOffice({ configureAi: () => { options.switchBackend("api"); updateBackend("api"); window.setTimeout(() => clickExisting("#apiSettingsTop"), 0); } })).catch(() => notify("Officeを開けませんでした。再読み込みしてください。")); break;
      case "terminal": openToolsTab("terminal"); break;
      case "git": clickExisting(".pocket-git-trigger"); break;
      case "review": clickExisting("#wfLaunch"); break;
      case "agents": clickExisting("#devmoterAgentLauncher"); break;
      case "sessions": clickExisting(".sc-fab"); break;
      case "automation": openRemoteTab("automation"); break;
      case "developer-workflows": options.switchBackend("codex"); updateBackend("codex"); window.setTimeout(() => clickExisting("#cxDevWorkflowsNav"), 0); break;
      case "knowledge":
      case "browser":
        notify(app.previewMessage || `${app.title} is not available yet.`);
        break;
    }
  };

  root.querySelector<HTMLButtonElement>("[data-shell-close]")!.addEventListener("click", closeSidebar);
  scrim.addEventListener("click", closeSidebar);
  document.addEventListener("keydown", event => {
    if (event.key === "Escape") closeSidebar();
    if (event.key !== "Tab" || !sidebar.classList.contains("open")) return;
    const controls = Array.from(sidebar.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), summary, [href], [tabindex]:not([tabindex="-1"])'))
      .filter(control => control.tabIndex >= 0 && isVisibleFocusTarget(control));
    const first = controls[0];
    const last = controls[controls.length - 1];
    if (!first || !last) return;
    const active = document.activeElement;
    if (!sidebar.contains(active) || (event.shiftKey ? active === first : active === last)) {
      event.preventDefault();
      (event.shiftKey ? last : first).focus({ preventScroll: true });
    }
  });

  window.addEventListener("devmoter:backend-changed", event => {
    const next = (event as CustomEvent<{ backend?: Backend }>).detail?.backend;
    if (next) updateBackend(next);
  });

  window.addEventListener("devmoter:launch-app", event => {
    const detail = (event as CustomEvent<{ id?: unknown }>).detail;
    run(() => launchApp(detail?.id));
  });

  window.addEventListener("devmoter:app-preview", event => {
    const detail = (event as CustomEvent<{ id?: unknown; message?: unknown }>).detail;
    if (!isAppId(detail?.id)) return;
    const app = getAppDefinition(detail.id);
    if (app.availability === "available") return;
    notify(typeof detail.message === "string" ? detail.message : app.previewMessage || `${app.title} is not available yet.`);
  });

  window.addEventListener("devmoter:surface-changed", event => {
    const next = (event as CustomEvent<{ surface?: MainSurface }>).detail?.surface;
    closeSidebar();
    if (next) surface = next;
  });
  // History owns its header area. Offer an in-flow Tools entry while the
  // floating launcher is hidden, without adding another overlay layer.
  const openCodeNavigation = document.querySelector<HTMLElement>("#ocxSidebar .ocx-sidebar-head");
  if (openCodeNavigation && !openCodeNavigation.querySelector("[data-open-tools]")) {
    const toolsLink = document.createElement("button");
    toolsLink.type = "button";
    toolsLink.dataset.openTools = "";
    toolsLink.className = "ocx-global-tools-entry";
    toolsLink.textContent = "Tools";
    toolsLink.setAttribute("aria-label", "Open DevMoter Tools and AI");
    toolsLink.addEventListener("click", openSidebar);
    const close = openCodeNavigation.querySelector("#ocxSidebarClose");
    openCodeNavigation.insertBefore(toolsLink, close);
  }

  window.addEventListener("devmoter:workspace-tab-changing", closeSidebar);
  window.addEventListener("devmoter:close-global-nav", closeSidebar);
  window.addEventListener("devmoter:open-global-nav", openSidebar);

  updateBackend(backend);

  // Without the unified ☰ menu (?unifiedUI=0 or a failed mount) Settings is
  // reached from this sidebar's header instead.
  function addFallbackSettingsEntry() {
    const scroll = root.querySelector<HTMLElement>(".dm-shell-sidebar-scroll")!;
    if (scroll.querySelector("[data-shell-settings]")) return;
    const settings = document.createElement("button");
    settings.type = "button";
    settings.className = "dm-shell-settings-entry";
    settings.dataset.shellSettings = "";
    settings.innerHTML = '<span aria-hidden="true">⚙</span><strong>設定</strong>';
    settings.addEventListener("click", () => {
      closeSidebar();
      window.dispatchEvent(new CustomEvent("devmoter:open-settings", { detail: { page: "root" } }));
    });
    // The legacy layout has no unified header, so its AI switch and the
    // language picker (no longer docked in the OpenCode drawer) live here.
    const row = document.createElement("div");
    row.className = "dm-shell-fallback-row";
    row.innerHTML = `
      <label><span>AI</span><select data-fallback-backend aria-label="AIバックエンド切り替え">
        <option value="codex">Codex</option><option value="opencode">OpenCode</option><option value="api">API Chat</option>
      </select></label>
      <label><span>言語</span><select data-language-select aria-label="Language">
        <option value="en">English</option><option value="ja">日本語</option><option value="zh-CN">简体中文</option>
      </select></label>`;
    const backendSelect = row.querySelector<HTMLSelectElement>("[data-fallback-backend]")!;
    const syncBackendSelect = () => {
      const current = surface === "codex" || surface === "opencode" || surface === "api" ? surface : backend;
      backendSelect.value = current === "integrations" ? "opencode" : current;
    };
    syncBackendSelect();
    window.addEventListener("devmoter:surface-changed", syncBackendSelect);
    backendSelect.addEventListener("change", () => {
      const next = backendSelect.value as "codex" | "opencode" | "api";
      closeSidebar();
      options.switchBackend(next);
    });
    scroll.prepend(settings);
    settings.after(row);
  }

  // The unified navigator is now the default on the existing URL.
  // ?unifiedUI=0 is an explicit emergency rollback for visual regressions.
  // The native providers retain all streaming, history, permissions and model
  // controls, including when the unified navigator cannot be loaded.
  if (shouldUseUnifiedWorkspace(window.location.search)) {
    void import("./unified-workspace-nav")
      .then(({ mountTaskFirstWorkspace }) => mountTaskFirstWorkspace({
        initialSurface: surface,
        initialBackend: backend === "integrations" ? "opencode" : backend,
        switchBackend: next => options.switchBackend(next),
        openHome: options.openHome,
        openTasks: () => run(() => launchApp("sessions")),
        openReview: () => run(() => launchApp("review")),
        openTools: openSidebar
      }))
      .catch(error => {
        // A missing/cached JS chunk or a partial mount must never leave the
        // provider screens offset behind an orphaned dark nav surface.
        console.error("Unified Workspace UI mount failed", error);
        document.getElementById("dmTaskFirstWorkspace")?.remove();
        document.body.classList.remove("dm-task-first-enabled");
        document.querySelectorAll<HTMLElement>("[data-unified-agent-label]").forEach(label => {
          label.hidden = true;
        });
        notify("新UIの読み込みに失敗しました。従来UIで表示しています。");
        addFallbackSettingsEntry();
      });
  } else {
    addFallbackSettingsEntry();
  }
}
