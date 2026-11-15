import { t, translateServerMessage } from "./i18n";

type IntegrationId = "antigravity" | "claude" | "qwen";
const INTEGRATION_IDS: IntegrationId[] = ["antigravity", "claude", "qwen"];

type ProjectSummary = {
  id: string;
  name: string;
  path: string;
  available?: boolean;
};

type IntegrationInfo = {
  id: IntegrationId;
  name: string;
  installed: boolean;
  version?: string | null;
  webUrl?: string;
  mobileUrl?: string;
  capabilities: Record<string, boolean>;
  remote?: {
    running?: boolean;
    name?: string | null;
    remoteUrl?: string | null;
    dashboardUrl?: string;
    error?: string | null;
  };
};

type IntegrationOptions = {
  onOpenCode?: () => void;
  onCodex?: () => void;
};

export type IntegrationsController = {
  refresh(): Promise<void>;
};

const ENABLED_KEY = "devmoter-enabled-integrations";
const PROJECT_KEY = "devmoter-integration-project";

function uid() {
  return `${Date.now().toString(36)}-${crypto.randomUUID?.() || Math.random().toString(36).slice(2)}`;
}

function loadEnabled(): Set<IntegrationId> {
  const raw = localStorage.getItem(ENABLED_KEY);
  if (raw === null) return new Set<IntegrationId>(INTEGRATION_IDS);

  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return new Set(parsed.filter((value): value is IntegrationId => INTEGRATION_IDS.includes(value)));
    }
  } catch {
    // Fall back to defaults if storage is corrupted.
  }
  return new Set<IntegrationId>(INTEGRATION_IDS);
}

function saveEnabled(enabled: Set<IntegrationId>) {
  localStorage.setItem(ENABLED_KEY, JSON.stringify([...enabled]));
}

async function api<T = any>(path: string, init: RequestInit = {}): Promise<T> {
  const method = String(init.method || "GET").toUpperCase();
  const mutating = method !== "GET" && method !== "HEAD";
  const res = await fetch(path, {
    ...init,
    headers: {
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...(mutating ? { "x-pocket-operation-id": uid() } : {}),
      ...(init.headers || {})
    },
    cache: method === "GET" ? "no-store" : undefined
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(translateServerMessage(payload?.error) || t("common.httpError", { status: res.status }));
  return payload as T;
}

export function mountIntegrations(
  root: HTMLElement,
  options: IntegrationOptions = {}
): IntegrationsController {
  let integrations: IntegrationInfo[] = [];
  let projects: ProjectSummary[] = [];
  const enabled = loadEnabled();

  root.innerHTML = `
    <div class="ix-app">
      <header class="ix-topbar">
        <button id="ixOpenCode" class="ix-icon" type="button" aria-label="${escapeAttr(t("integrations.backToOpenCodeAria"))}">◈</button>
        <h1 class="ix-title">${escapeHtml(t("integrations.title"))}</h1>
        <button id="ixCodex" class="ix-icon" type="button" aria-label="${escapeAttr(t("integrations.backToCodexAria"))}">⌘</button>
      </header>

      <main class="ix-main">
        <div id="ixNotice" class="ix-notice hidden"></div>
        <section id="ixCards" class="ix-cards">
          <div class="ix-loading">${escapeHtml(t("integrations.loading"))}</div>
        </section>
      </main>
    </div>
  `;

  const cards = root.querySelector<HTMLElement>("#ixCards")!;
  const notice = root.querySelector<HTMLElement>("#ixNotice")!;

  root.querySelector<HTMLButtonElement>("#ixOpenCode")!.addEventListener("click", () => {
    options.onOpenCode?.();
  });
  root.querySelector<HTMLButtonElement>("#ixCodex")!.addEventListener("click", () => {
    options.onCodex?.();
  });

  // No Project card: launches use the workspace's current project (the one the
  // header shows), then the last Integrations choice, then the first project.
  function selectedProject() {
    const current = (localStorage.getItem("opencode-pocket-project") || "").replace(/\\/g, "/").replace(/\/+$/, "");
    const stored = localStorage.getItem(PROJECT_KEY) || "";
    return projects.find(project => current && project.path.replace(/\\/g, "/").replace(/\/+$/, "") === current)
      || projects.find(project => project.id === stored)
      || projects[0]
      || null;
  }

  function showNotice(message: string, tone: "ok" | "error" = "ok") {
    notice.textContent = message;
    notice.className = `ix-notice ${tone}`;
    window.setTimeout(() => notice.classList.add("hidden"), 4200);
  }

  function toggleIntegration(id: IntegrationId) {
    if (enabled.has(id)) enabled.delete(id);
    else enabled.add(id);
    saveEnabled(enabled);
    renderCards();
  }

  function statusText(info: IntegrationInfo) {
    if (!enabled.has(info.id)) return t("integrations.status.hidden");
    if (!info.installed) return t("integrations.status.notInstalled");
    if (info.id === "antigravity" && info.remote?.running) {
      return info.remote.name
        ? t("integrations.status.remoteNamed", { name: info.remote.name })
        : t("integrations.status.remoteActive");
    }
    return t("integrations.status.ready");
  }

  function renderCards() {
    if (integrations.length === 0) {
      cards.innerHTML = `<div class="ix-loading">${escapeHtml(t("integrations.empty"))}</div>`;
      return;
    }

    cards.innerHTML = integrations.map(info => {
      const isEnabled = enabled.has(info.id);
      const version = info.version ? `<small class="ix-version">${escapeHtml(info.version)}</small>` : "";
      const installClass = info.installed ? "ready" : "missing";
      const remoteUrl = info.remote?.remoteUrl || info.remote?.dashboardUrl || info.webUrl || "";
      // One column of actions per card.
      const antigravityActions = info.id === "antigravity"
        ? `
          <div class="ix-actions">
            <button data-action="launch" data-id="antigravity" ${!info.installed || !isEnabled ? "disabled" : ""}>${escapeHtml(t("integrations.action.openOnPc"))}</button>
            <button class="primary" data-action="${info.remote?.running ? "remote-stop" : "remote-start"}" data-id="antigravity" ${!info.installed || !isEnabled ? "disabled" : ""}>
              ${escapeHtml(info.remote?.running ? t("integrations.action.remoteStop") : t("integrations.action.remoteStart"))}
            </button>
            <button data-action="open-url" data-url="${escapeAttr(remoteUrl)}" ${!remoteUrl || !isEnabled ? "disabled" : ""}>${escapeHtml(t("integrations.action.openRemote"))}</button>
            <button data-action="qr" data-id="antigravity" ${!isEnabled ? "disabled" : ""}>${escapeHtml(t("integrations.action.showQr"))}</button>
          </div>
          <div id="ixQr-antigravity" class="ix-qr hidden">
            <img src="/qr/antigravity-remote.png" alt="${escapeAttr(t("integrations.qrAlt.antigravity"))}" />
            <span>${escapeHtml(t("integrations.antigravityCaption"))}</span>
          </div>
        `
        : info.id === "qwen"
        ? `
          <div class="ix-actions">
            <button class="primary" data-action="launch" data-id="qwen" ${!info.installed || !isEnabled ? "disabled" : ""}>${escapeHtml(t("integrations.action.openOnPc"))}</button>
          </div>
        `
        : `
          <div class="ix-actions">
            <button data-action="launch" data-id="claude" ${!info.installed || !isEnabled ? "disabled" : ""}>${escapeHtml(t("integrations.action.openOnPc"))}</button>
            <button class="primary" data-action="open-url" data-url="https://claude.ai/code" ${!isEnabled ? "disabled" : ""}>${escapeHtml(t("integrations.claudeWebButton"))}</button>
            <button data-action="qr" data-id="claude" ${!isEnabled ? "disabled" : ""}>${escapeHtml(t("integrations.action.showQr"))}</button>
          </div>
          <div id="ixQr-claude" class="ix-qr hidden">
            <img src="/qr/claude-code.png" alt="${escapeAttr(t("integrations.qrAlt.claude"))}" />
            <span>${escapeHtml(t("integrations.claudeWebCaption"))}</span>
          </div>
        `;

      return `
        <article class="ix-card ${isEnabled ? "" : "disabled"}">
          <div class="ix-card-head">
            <div>
              <div class="ix-name-row">
                <h2>${escapeHtml(info.name)}</h2>
                <span class="ix-pill ${installClass}" title="${escapeAttr(statusText(info))}">${escapeHtml(statusText(info))}</span>
              </div>
              ${version}
            </div>
            <label class="ix-toggle">
              <input type="checkbox" data-toggle="${info.id}" ${isEnabled ? "checked" : ""} />
              <span></span>
            </label>
          </div>

          <p class="ix-description">
            ${escapeHtml(info.id === "antigravity"
              ? t("integrations.desc.antigravity")
              : info.id === "qwen"
              ? t("integrations.desc.qwen")
              : t("integrations.desc.claude"))}
          </p>

          ${antigravityActions}
        </article>
      `;
    }).join("");

    cards.querySelectorAll<HTMLInputElement>("[data-toggle]").forEach(input => {
      input.addEventListener("change", () => toggleIntegration(input.dataset.toggle as IntegrationId));
    });

    cards.querySelectorAll<HTMLButtonElement>("[data-action]").forEach(button => {
      button.addEventListener("click", () => void handleAction(button));
    });
  }

  async function handleAction(button: HTMLButtonElement) {
    const action = button.dataset.action;
    const id = button.dataset.id as IntegrationId | undefined;

    if (action === "open-url") {
      const url = button.dataset.url;
      if (url) window.open(url, "_blank", "noopener,noreferrer");
      return;
    }

    if (action === "qr" && id) {
      root.querySelector<HTMLElement>(`#ixQr-${id}`)?.classList.toggle("hidden");
      return;
    }

    if (action === "launch" && id) {
      const project = selectedProject();
      if (!project) {
        showNotice(t("integrations.noProjectError"), "error");
        return;
      }
      button.disabled = true;
      try {
        const result = await api<{ terminal?: string }>(`/api/integrations/${id}/launch`, {
          method: "POST",
          body: JSON.stringify({ projectId: project.id })
        });
        const terminal = result.terminal || t("integrations.terminalFallback");
        showNotice(
          id === "antigravity"
            ? t("integrations.launchConfirmedAntigravity", { terminal })
            : t("integrations.launchRequested", { name: id === "qwen" ? "Qwen Code" : "Claude Code", terminal })
        );
      } catch (error) {
        showNotice(translateServerMessage(error instanceof Error ? error.message : String(error)), "error");
      } finally {
        button.disabled = false;
      }
      return;
    }

    if ((action === "remote-start" || action === "remote-stop") && id === "antigravity") {
      const confirmation =
        action === "remote-start"
          ? t("integrations.confirmRemoteStart")
          : t("integrations.confirmRemoteStop");
      if (!window.confirm(confirmation)) return;

      button.disabled = true;
      try {
        await api(`/api/integrations/antigravity/remote/${action === "remote-start" ? "start" : "stop"}`, {
          method: "POST",
          body: "{}"
        });
        await refreshIntegrations();
        showNotice(action === "remote-start" ? t("integrations.remoteStarted") : t("integrations.remoteStopped"));
      } catch (error) {
        showNotice(translateServerMessage(error instanceof Error ? error.message : String(error)), "error");
      } finally {
        button.disabled = false;
      }
    }
  }

  async function refreshIntegrations() {
    const result = await api<{ integrations?: IntegrationInfo[] }>("/api/integrations/status", {
      method: "POST",
      body: "{}"
    });
    integrations = result.integrations || [];
    renderCards();
  }

  async function refresh() {
    try {
      const [projectResult] = await Promise.all([
        api<{ projects?: ProjectSummary[] }>("/api/projects"),
        refreshIntegrations()
      ]);
      projects = (projectResult.projects || []).filter(project => project.available !== false);
    } catch (error) {
      cards.innerHTML = `<div class="ix-loading error">${escapeHtml(translateServerMessage(error instanceof Error ? error.message : String(error)))}</div>`;
    }
  }

  return { refresh };
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttr(value: string) {
  return escapeHtml(value);
}
