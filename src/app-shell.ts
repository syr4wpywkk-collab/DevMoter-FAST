import "./app-shell.css";
import type { MainSurface } from "./surface-navigation.mjs";
import { getAppDefinition, getAppsByIds, isAppId, type AppId } from "./app-registry";

type Backend = "opencode" | "codex" | "api" | "integrations";
type SettingsPage = "root" | "appearance" | "account" | "devices" | "vault" | "notifications" | "diagnostics" | "guide";

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

function openToolsTab(tab: "terminal" | "safety" | "index") {
  clickExisting(".dm-tools-launcher");
  window.setTimeout(() => {
    const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>(".dm-tools-tabs button"));
    const index = tab === "terminal" ? 0 : tab === "safety" ? 1 : 2;
    buttons[index]?.click();
  }, 0);
}

function openRemoteTab(tab: "hosts" | "automation" | "passkeys") {
  clickExisting(".dm-control-trigger");
  window.setTimeout(() => {
    document.querySelector<HTMLButtonElement>(`.dm-control-tabs [data-tab="${tab}"]`)?.click();
  }, 0);
}

function openSettings(page: SettingsPage = "root") {
  window.dispatchEvent(new CustomEvent("devmoter:open-settings", { detail: { page } }));
}

function actionButton(appId: AppId) {
  const { icon, title, shortDescription, availability } = getAppDefinition(appId);
  return `
    <button type="button" class="dm-shell-action" data-shell-app="${appId}" aria-label="${title}${availability === "preview" ? ", Preview" : ""}"${availability === "preview" ? " aria-disabled=\"true\"" : availability === "unavailable" ? " disabled aria-disabled=\"true\"" : ""}>
      <span class="dm-shell-action-icon" aria-hidden="true">${icon}</span>
      <span class="dm-shell-action-copy"><strong>${title}</strong><small>${shortDescription}</small></span>
      ${availability === "preview" ? '<span class="dm-shell-action-badge">PREVIEW</span>' : ""}
      <span class="dm-shell-chevron" aria-hidden="true">${availability === "available" ? "›" : "·"}</span>
    </button>
  `;
}

function systemActionButton(icon: string, title: string, detail: string, action: string, badge = "") {
  return `
    <button type="button" class="dm-shell-action" data-shell-action="${action}">
      <span class="dm-shell-action-icon" aria-hidden="true">${icon}</span>
      <span class="dm-shell-action-copy"><strong>${title}</strong><small>${detail}</small></span>
      ${badge ? `<span class="dm-shell-action-badge">${badge}</span>` : ""}
      <span class="dm-shell-chevron" aria-hidden="true">›</span>
    </button>
  `;
}

function appActionButtons(ids: readonly AppId[]) {
  return getAppsByIds(ids).map(app => actionButton(app.id)).join("");
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
          <strong>DevMoter FAST</strong>
          <small>Control Center</small>
        </div>
        <button type="button" data-shell-close aria-label="Close sidebar">×</button>
      </header>

      <div class="dm-shell-sidebar-scroll">
        <section class="dm-shell-primary">
          <button class="dm-shell-home-link" type="button" data-home-nav>
            <span aria-hidden="true">⌂</span><strong>Home</strong><span class="dm-shell-home-arrow" aria-hidden="true">↗</span>
          </button>
          <h2>AI</h2>
          <div class="dm-shell-ai-grid" role="group" aria-label="AI surfaces">
            <button type="button" data-backend="opencode"><span>OC</span><strong>OpenCode</strong></button>
            <button type="button" data-backend="codex"><span>CX</span><strong>Codex</strong></button>
            <button type="button" data-backend="api"><span>API</span><strong>API Chat</strong></button>
            <button type="button" data-backend="integrations"><span>INT</span><strong>Integrations</strong></button>
          </div>

          <h2>Quick access</h2>
          ${appActionButtons(["mission-control", "terminal", "git", "review"])}
        </section>

        <section>
          <h2>Agents & sessions</h2>
          ${appActionButtons(["agents", "sessions"])}
        </section>

        <section>
          <h2>Workspace</h2>
          ${appActionButtons(["projects", "developer-workflows"])}
          ${systemActionButton("▦", "Files & Preview", "Project files, outputs, live preview, browser automation and models", "advanced")}
          ${systemActionButton("⚑", "Safety", "High-risk command scan and remembered approvals", "safety")}
          ${systemActionButton("⌕", "Project Index", "Local full-text and structural project search", "index")}
        </section>

        <section>
          <h2>Remote & automation</h2>
          ${systemActionButton("◉", "Hosts", "Host registry, capabilities and connectivity", "hosts")}
          ${actionButton("automation")}
          ${systemActionButton("◇", "Passkeys", "WebAuthn registration, login and host-origin state", "passkeys")}
        </section>

        <section>
          <h2>Security & settings</h2>
          ${systemActionButton("🔐", "API Vault", "Encrypted project-bound secrets without reveal", "vault")}
          ${systemActionButton("▣", "Trusted devices", "Pair, inspect and revoke browser devices", "devices")}
          ${systemActionButton("●", "Notifications", "Push notification controls", "notifications")}
          ${systemActionButton("◇", "Diagnostics", "Backends, network and capability health", "diagnostics")}
          ${systemActionButton("⚙", "Settings", "Account, appearance, guide and all settings", "settings")}
        </section>

        <section>
          <h2>Experimental</h2>
          ${systemActionButton("⇩", "Setup Wizard", "Installer v2 foundation — currently paused for further expansion", "setup", "EXPERIMENTAL")}
        </section>
      </div>
    </aside>

    <div class="dm-shell-toast hidden" role="status" aria-live="polite"></div>
  `;

  document.body.appendChild(root);

  const syncVisualViewportHeight = () => {
    const height = window.visualViewport?.height ?? window.innerHeight;
    if (!Number.isFinite(height) || height <= 0) return;
    root.style.setProperty("--dm-shell-viewport-height", `${Math.max(1, Math.floor(height))}px`);
  };
  syncVisualViewportHeight();
  window.visualViewport?.addEventListener("resize", syncVisualViewportHeight, { passive: true });
  window.visualViewport?.addEventListener("scroll", syncVisualViewportHeight, { passive: true });
  window.addEventListener("resize", syncVisualViewportHeight, { passive: true });
  window.addEventListener("orientationchange", syncVisualViewportHeight);

  const trigger = root.querySelector<HTMLButtonElement>(".dm-shell-menu-trigger")!;
  const sidebar = root.querySelector<HTMLElement>(".dm-shell-sidebar")!;
  const scrim = root.querySelector<HTMLElement>("[data-shell-scrim]")!;
  const toast = root.querySelector<HTMLElement>(".dm-shell-toast")!;
  const homeLink = root.querySelector<HTMLButtonElement>("[data-home-nav]")!;
  let backend: Backend = options.initialBackend || "opencode";
  let surface: MainSurface = options.initialSurface || "home";
  let toastTimer = 0;
  let sidebarReturnFocus: HTMLElement | null = null;

  function notify(message: string) {
    if (toastTimer) window.clearTimeout(toastTimer);
    toast.textContent = message;
    toast.classList.remove("hidden");
    toastTimer = window.setTimeout(() => toast.classList.add("hidden"), 2600);
  }

  function isVisibleFocusTarget(target: HTMLElement | null): target is HTMLElement {
    return Boolean(target?.isConnected && !target.closest('[inert], [aria-hidden="true"]') && target.getClientRects().length);
  }

  function openSidebar() {
    if (sidebar.classList.contains("open")) return;
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
    for (const button of root.querySelectorAll<HTMLButtonElement>(".dm-shell-ai-grid [data-backend]")) {
      button.classList.toggle("active", button.dataset.backend === backend);
    }
    trigger.dataset.backend = backend;
  }

  function updateSurface(next: MainSurface) {
    surface = next;
    homeLink.classList.toggle("active", surface === "home");
    if (surface === "home") homeLink.setAttribute("aria-current", "page");
    else homeLink.removeAttribute("aria-current");
    for (const button of root.querySelectorAll<HTMLButtonElement>(".dm-shell-ai-grid [data-backend]")) {
      const active = button.dataset.backend === surface;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    }
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

  homeLink.addEventListener("click", () => {
    closeSidebar();
    options.openHome();
    window.requestAnimationFrame(() => document.querySelector<HTMLElement>("#devmoterHomeTitle")?.focus({ preventScroll: true }));
  });

  for (const button of root.querySelectorAll<HTMLButtonElement>("[data-backend]")) {
    button.addEventListener("click", () => {
      const next = button.dataset.backend as Backend;
      closeSidebar();
      options.switchBackend(next);
      updateBackend(next);
    });
  }

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

  const actions: Record<string, () => void> = {
    advanced: () => clickExisting(".adv-fab"),
    safety: () => openToolsTab("safety"),
    index: () => openToolsTab("index"),
    hosts: () => openRemoteTab("hosts"),
    automation: () => openRemoteTab("automation"),
    passkeys: () => openRemoteTab("passkeys"),
    vault: () => openSettings("vault"),
    devices: () => openSettings("devices"),
    notifications: () => openSettings("notifications"),
    diagnostics: () => openSettings("diagnostics"),
    settings: () => openSettings("root"),
    setup: () => { window.location.assign("/?setup=1"); }
  };

  root.querySelectorAll<HTMLButtonElement>("[data-shell-app]").forEach(button => {
    button.addEventListener("click", () => run(() => launchApp(button.dataset.shellApp)));
  });

  for (const button of root.querySelectorAll<HTMLButtonElement>("[data-shell-action]")) {
    button.addEventListener("click", () => {
      const action = actions[button.dataset.shellAction || ""];
      if (action) run(action);
    });
  }

  root.querySelector<HTMLButtonElement>("[data-shell-close]")!.addEventListener("click", closeSidebar);
  scrim.addEventListener("click", closeSidebar);
  document.addEventListener("keydown", event => {
    if (event.key === "Escape") closeSidebar();
    if (event.key !== "Tab" || !sidebar.classList.contains("open")) return;
    const controls = Array.from(sidebar.querySelectorAll<HTMLElement>('button:not(:disabled), [href], [tabindex]:not([tabindex="-1"])'))
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
    if (next) updateSurface(next);
  });
  window.addEventListener("devmoter:close-global-nav", closeSidebar);
  window.addEventListener("devmoter:open-global-nav", openSidebar);

  updateBackend(backend);
  updateSurface(surface);
}
