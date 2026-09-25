import "./app-shell.css";
import type { MainSurface } from "./surface-navigation.mjs";

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

function actionButton(icon: string, title: string, detail: string, action: string, badge = "") {
  return `
    <button type="button" class="dm-shell-action" data-shell-action="${action}">
      <span class="dm-shell-action-icon" aria-hidden="true">${icon}</span>
      <span class="dm-shell-action-copy"><strong>${title}</strong><small>${detail}</small></span>
      ${badge ? `<span class="dm-shell-action-badge">${badge}</span>` : ""}
      <span class="dm-shell-chevron" aria-hidden="true">›</span>
    </button>
  `;
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

    <aside class="dm-shell-sidebar" aria-hidden="true" aria-label="DevMoter feature sidebar">
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
          ${actionButton("⌘", "Terminal", "Persistent project terminal / tmux sessions", "terminal")}
          ${actionButton("⑂", "Git", "Working tree, changed files and bounded diff viewer", "git")}
          ${actionButton("⌁", "Review", "Changes, worktrees and GitHub task workflow", "review")}
        </section>

        <section>
          <h2>Agents & sessions</h2>
          ${actionButton("◎", "Agent mode", "Plan / Ask / Debug / Review / orchestration / subagents", "agent")}
          ${actionButton("✦", "Session Control", "Activity, queue, checkpoints, search and handoff", "sessions")}
        </section>

        <section>
          <h2>Workspace</h2>
          ${actionButton("▱", "Projects & GitHub", "Browse repositories, branches and registered project workspaces", "projects")}
          ${actionButton("◇", "Developer workflows", "MCP, Skills, Rules, ACP, review, CI and verification", "dev-workflows")}
          ${actionButton("▦", "Files & Preview", "Project files, outputs, live preview, browser automation and models", "advanced")}
          ${actionButton("⚑", "Safety", "High-risk command scan and remembered approvals", "safety")}
          ${actionButton("⌕", "Project Index", "Local full-text and structural project search", "index")}
        </section>

        <section>
          <h2>Remote & automation</h2>
          ${actionButton("◉", "Hosts", "Host registry, capabilities and connectivity", "hosts")}
          ${actionButton("⏱", "Automation", "Schedules, triggers, runs and bounded autopilot", "automation")}
          ${actionButton("◇", "Passkeys", "WebAuthn registration, login and host-origin state", "passkeys")}
        </section>

        <section>
          <h2>Security & settings</h2>
          ${actionButton("🔐", "API Vault", "Encrypted project-bound secrets without reveal", "vault")}
          ${actionButton("▣", "Trusted devices", "Pair, inspect and revoke browser devices", "devices")}
          ${actionButton("●", "Notifications", "Push notification controls", "notifications")}
          ${actionButton("◇", "Diagnostics", "Backends, network and capability health", "diagnostics")}
          ${actionButton("⚙", "Settings", "Account, appearance, guide and all settings", "settings")}
        </section>

        <section>
          <h2>Experimental</h2>
          ${actionButton("⇩", "Setup Wizard", "Installer v2 foundation — currently paused for further expansion", "setup", "EXPERIMENTAL")}
        </section>
      </div>
    </aside>

    <div class="dm-shell-toast hidden" role="status" aria-live="polite"></div>
  `;

  document.body.appendChild(root);

  const trigger = root.querySelector<HTMLButtonElement>(".dm-shell-menu-trigger")!;
  const sidebar = root.querySelector<HTMLElement>(".dm-shell-sidebar")!;
  const scrim = root.querySelector<HTMLElement>("[data-shell-scrim]")!;
  const toast = root.querySelector<HTMLElement>(".dm-shell-toast")!;
  const homeLink = root.querySelector<HTMLButtonElement>("[data-home-nav]")!;
  let backend: Backend = options.initialBackend || "opencode";
  let surface: MainSurface = options.initialSurface || "home";
  let toastTimer = 0;

  function notify(message: string) {
    if (toastTimer) window.clearTimeout(toastTimer);
    toast.textContent = message;
    toast.classList.remove("hidden");
    toastTimer = window.setTimeout(() => toast.classList.add("hidden"), 2600);
  }

  function openSidebar() {
    sidebar.classList.add("open");
    sidebar.setAttribute("aria-hidden", "false");
    trigger.setAttribute("aria-expanded", "true");
    scrim.classList.remove("hidden");
    document.body.classList.add("devmoter-shell-menu-open");
  }

  function closeSidebar() {
    sidebar.classList.remove("open");
    sidebar.setAttribute("aria-hidden", "true");
    trigger.setAttribute("aria-expanded", "false");
    scrim.classList.add("hidden");
    document.body.classList.remove("devmoter-shell-menu-open");
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
      button.setAttribute("aria-pressed", String(button.dataset.backend === surface));
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

  const openCodexSurface = (selector: string) => {
    options.switchBackend("codex");
    updateBackend("codex");
    window.setTimeout(() => clickExisting(selector), 0);
  };

  const actions: Record<string, () => void> = {
    terminal: () => openToolsTab("terminal"),
    git: () => clickExisting(".pocket-git-trigger"),
    review: () => clickExisting("#wfLaunch"),
    agent: () => clickExisting("#devmoterAgentLauncher"),
    projects: () => openCodexSurface("#cxProjectsNav"),
    "dev-workflows": () => openCodexSurface("#cxDevWorkflowsNav"),
    sessions: () => clickExisting(".sc-fab"),
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
  });

  window.addEventListener("devmoter:backend-changed", event => {
    const next = (event as CustomEvent<{ backend?: Backend }>).detail?.backend;
    if (next) updateBackend(next);
  });

  window.addEventListener("devmoter:surface-changed", event => {
    const next = (event as CustomEvent<{ surface?: MainSurface }>).detail?.surface;
    closeSidebar();
    if (next) updateSurface(next);
  });

  updateBackend(backend);
  updateSurface(surface);
}
