import "./app-shell.css";

type Backend = "opencode" | "codex" | "api" | "integrations";
type SettingsPage = "root" | "appearance" | "account" | "devices" | "vault" | "notifications" | "diagnostics" | "guide";

type ShellOptions = {
  switchBackend: (backend: Backend) => void;
  initialBackend?: Backend;
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
    <nav class="dm-shell-dock" aria-label="DevMoter main tools">
      <button type="button" data-dock="ai" aria-label="AI"><span>✦</span><small>AI</small></button>
      <button type="button" data-dock="terminal" aria-label="Terminal"><span>⌘</span><small>Terminal</small></button>
      <button type="button" data-dock="git" aria-label="Git"><span>⑂</span><small>Git</small></button>
      <button type="button" data-dock="review" aria-label="Review"><span>⌁</span><small>Review</small></button>
      <button type="button" data-dock="more" aria-label="More tools"><span>•••</span><small>More</small></button>
    </nav>

    <div class="dm-shell-popover hidden" data-ai-popover role="menu" aria-label="AI surfaces">
      <button type="button" data-backend="opencode"><span>OC</span><strong>OpenCode</strong></button>
      <button type="button" data-backend="codex"><span>CX</span><strong>Codex</strong></button>
      <button type="button" data-backend="api"><span>API</span><strong>API Chat</strong></button>
      <button type="button" data-backend="integrations"><span>INT</span><strong>Integrations</strong></button>
    </div>

    <div class="dm-shell-scrim hidden" data-shell-scrim></div>
    <aside class="dm-shell-sheet" aria-hidden="true" aria-label="All DevMoter features">
      <header class="dm-shell-sheet-head">
        <div><strong>DevMoter Control Dock</strong><small>All working surfaces in one place</small></div>
        <button type="button" data-shell-close aria-label="Close">×</button>
      </header>
      <div class="dm-shell-sheet-scroll">
        <section>
          <h2>Agents & sessions</h2>
          ${actionButton("◎", "Agent mode", "Plan / Ask / Debug / Review / orchestration / subagents", "agent")}
          ${actionButton("✦", "Session Control", "Activity, queue, checkpoints, search and handoff", "sessions")}
        </section>

        <section>
          <h2>Workspace</h2>
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

  const dock = root.querySelector<HTMLElement>(".dm-shell-dock")!;
  const aiPopover = root.querySelector<HTMLElement>("[data-ai-popover]")!;
  const sheet = root.querySelector<HTMLElement>(".dm-shell-sheet")!;
  const scrim = root.querySelector<HTMLElement>("[data-shell-scrim]")!;
  const toast = root.querySelector<HTMLElement>(".dm-shell-toast")!;
  let backend: Backend = options.initialBackend || "opencode";
  let toastTimer = 0;

  function notify(message: string) {
    if (toastTimer) window.clearTimeout(toastTimer);
    toast.textContent = message;
    toast.classList.remove("hidden");
    toastTimer = window.setTimeout(() => toast.classList.add("hidden"), 2600);
  }

  function closeAi() {
    aiPopover.classList.add("hidden");
    dock.querySelector<HTMLButtonElement>('[data-dock="ai"]')?.setAttribute("aria-expanded", "false");
  }

  function openSheet() {
    closeAi();
    sheet.classList.add("open");
    sheet.setAttribute("aria-hidden", "false");
    scrim.classList.remove("hidden");
    document.body.classList.add("devmoter-shell-menu-open");
  }

  function closeSheet() {
    sheet.classList.remove("open");
    sheet.setAttribute("aria-hidden", "true");
    scrim.classList.add("hidden");
    document.body.classList.remove("devmoter-shell-menu-open");
  }

  function closeShellLayers() {
    closeAi();
    closeSheet();
  }

  function updateBackend(next: Backend) {
    backend = next;
    for (const button of aiPopover.querySelectorAll<HTMLButtonElement>("[data-backend]")) {
      button.classList.toggle("active", button.dataset.backend === backend);
    }
    const ai = dock.querySelector<HTMLButtonElement>('[data-dock="ai"]');
    if (ai) ai.dataset.backend = backend;
  }

  function run(action: () => void) {
    closeShellLayers();
    try {
      action();
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error));
    }
  }

  dock.querySelector<HTMLButtonElement>('[data-dock="ai"]')!.addEventListener("click", () => {
    const opening = aiPopover.classList.contains("hidden");
    closeSheet();
    aiPopover.classList.toggle("hidden", !opening);
    dock.querySelector<HTMLButtonElement>('[data-dock="ai"]')!.setAttribute("aria-expanded", opening ? "true" : "false");
  });
  dock.querySelector<HTMLButtonElement>('[data-dock="terminal"]')!.addEventListener("click", () => run(() => openToolsTab("terminal")));
  dock.querySelector<HTMLButtonElement>('[data-dock="git"]')!.addEventListener("click", () => run(() => clickExisting(".pocket-git-trigger")));
  dock.querySelector<HTMLButtonElement>('[data-dock="review"]')!.addEventListener("click", () => run(() => clickExisting("#wfLaunch")));
  dock.querySelector<HTMLButtonElement>('[data-dock="more"]')!.addEventListener("click", openSheet);

  for (const button of aiPopover.querySelectorAll<HTMLButtonElement>("[data-backend]")) {
    button.addEventListener("click", () => {
      const next = button.dataset.backend as Backend;
      closeAi();
      options.switchBackend(next);
      updateBackend(next);
    });
  }

  const actions: Record<string, () => void> = {
    agent: () => clickExisting("#devmoterAgentLauncher"),
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

  root.querySelector<HTMLButtonElement>("[data-shell-close]")!.addEventListener("click", closeSheet);
  scrim.addEventListener("click", closeSheet);
  document.addEventListener("keydown", event => {
    if (event.key === "Escape") closeShellLayers();
  });
  document.addEventListener("click", event => {
    const target = event.target as Node;
    if (!aiPopover.classList.contains("hidden") && !aiPopover.contains(target) && !dock.querySelector('[data-dock="ai"]')?.contains(target)) {
      closeAi();
    }
  });

  window.addEventListener("devmoter:backend-changed", event => {
    const next = (event as CustomEvent<{ backend?: Backend }>).detail?.backend;
    if (next) updateBackend(next);
  });

  updateBackend(backend);
}
