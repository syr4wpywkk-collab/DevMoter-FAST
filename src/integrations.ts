type IntegrationId = "antigravity" | "claude";

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
  installUrl?: string;
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
  if (raw === null) return new Set<IntegrationId>(["antigravity", "claude"]);

  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return new Set(parsed.filter((value): value is IntegrationId =>
        value === "antigravity" || value === "claude"
      ));
    }
  } catch {
    // Fall back to defaults if storage is corrupted.
  }
  return new Set<IntegrationId>(["antigravity", "claude"]);
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
  if (!res.ok) throw new Error(payload?.error || `HTTP ${res.status}`);
  return payload as T;
}

export function mountIntegrations(
  root: HTMLElement,
  options: IntegrationOptions = {}
): IntegrationsController {
  let integrations: IntegrationInfo[] = [];
  let projects: ProjectSummary[] = [];
  let selectedProjectId = localStorage.getItem(PROJECT_KEY) || "";
  const enabled = loadEnabled();

  root.innerHTML = `
    <div class="ix-app">
      <header class="ix-topbar">
        <button id="ixOpenCode" class="ix-icon" type="button" aria-label="OpenCodeへ戻る">◈</button>
        <div class="ix-title">
          <strong>Integrations</strong>
          <small>DevMoter launcher & handoff</small>
        </div>
        <button id="ixCodex" class="ix-icon" type="button" aria-label="Codexへ戻る">⌘</button>
      </header>

      <main class="ix-main">
        <section class="ix-hero">
          <span class="ix-kicker">TOOLS</span>
          <h1>開発ツールをひとつの場所から。</h1>
          <p>使うものだけ表示。認証情報の抜き取りや非公式proxyはせず、各ツールの公式CLI・公式Web導線を使います。</p>
          <p class="ix-security-note">ON/OFFは表示設定です。アクセス制御はDevMoterの認証・same-origin境界で行います。</p>
        </section>

        <section class="ix-project-panel">
          <label for="ixProject">Project</label>
          <select id="ixProject"></select>
          <small id="ixProjectPath">Loading projects…</small>
        </section>

        <div id="ixNotice" class="ix-notice hidden"></div>
        <section id="ixCards" class="ix-cards">
          <div class="ix-loading">Loading integrations…</div>
        </section>
      </main>
    </div>
  `;

  const cards = root.querySelector<HTMLElement>("#ixCards")!;
  const notice = root.querySelector<HTMLElement>("#ixNotice")!;
  const projectSelect = root.querySelector<HTMLSelectElement>("#ixProject")!;
  const projectPath = root.querySelector<HTMLElement>("#ixProjectPath")!;

  root.querySelector<HTMLButtonElement>("#ixOpenCode")!.addEventListener("click", () => {
    options.onOpenCode?.();
  });
  root.querySelector<HTMLButtonElement>("#ixCodex")!.addEventListener("click", () => {
    options.onCodex?.();
  });

  function selectedProject() {
    return projects.find(project => project.id === selectedProjectId) || projects[0] || null;
  }

  function showNotice(message: string, tone: "ok" | "error" = "ok") {
    notice.textContent = message;
    notice.className = `ix-notice ${tone}`;
    window.setTimeout(() => notice.classList.add("hidden"), 4200);
  }

  function renderProjects() {
    if (projects.length === 0) {
      projectSelect.innerHTML = `<option value="">No project</option>`;
      projectSelect.disabled = true;
      projectPath.textContent = "Add a project from Codex first.";
      return;
    }

    projectSelect.disabled = false;
    if (!projects.some(project => project.id === selectedProjectId)) {
      selectedProjectId = projects[0].id;
      localStorage.setItem(PROJECT_KEY, selectedProjectId);
    }
    projectSelect.innerHTML = projects
      .map(project => `<option value="${project.id}">${escapeHtml(project.name)}</option>`)
      .join("");
    projectSelect.value = selectedProjectId;
    projectPath.textContent = selectedProject()?.path || "";
  }

  function toggleIntegration(id: IntegrationId) {
    if (enabled.has(id)) enabled.delete(id);
    else enabled.add(id);
    saveEnabled(enabled);
    renderCards();
  }

  function statusText(info: IntegrationInfo) {
    if (!enabled.has(info.id)) return "Hidden";
    if (!info.installed) return "Not installed";
    if (info.id === "antigravity" && info.remote?.running) {
      return info.remote.name ? `Remote: ${info.remote.name}` : "Remote active";
    }
    return "Ready";
  }

  function renderCards() {
    if (integrations.length === 0) {
      cards.innerHTML = `<div class="ix-loading">No integrations found.</div>`;
      return;
    }

    cards.innerHTML = integrations.map(info => {
      const isEnabled = enabled.has(info.id);
      const version = info.version ? `<small class="ix-version">${escapeHtml(info.version)}</small>` : "";
      const installClass = info.installed ? "ready" : "missing";
      const remoteUrl = info.remote?.remoteUrl || info.remote?.dashboardUrl || info.webUrl || "";
      const antigravityActions = info.id === "antigravity"
        ? `
          <div class="ix-actions">
            <button class="primary" data-action="launch" data-id="antigravity" ${!info.installed || !isEnabled ? "disabled" : ""}>agyを開く</button>
            <button data-action="models" data-id="antigravity" ${!info.installed || !isEnabled ? "disabled" : ""}>Models</button>
          </div>
          <div class="ix-actions">
            <button data-action="open-url" data-url="${escapeAttr(info.webUrl || "https://antigravity.google")}" ${!isEnabled ? "disabled" : ""}>公式サイト</button>
            <button data-action="open-url" data-url="${escapeAttr(info.installUrl || "https://antigravity.google/product/antigravity-cli")}" ${info.installed || !isEnabled ? "disabled" : ""}>CLIを導入</button>
          </div>
          <pre id="ixModels-antigravity" class="ix-qr hidden" aria-live="polite"></pre>
        `
        : `
          <div class="ix-actions">
            <button data-action="launch" data-id="claude" ${!info.installed || !isEnabled ? "disabled" : ""}>PCで開く</button>
            <button class="primary" data-action="open-url" data-url="https://claude.ai/code" ${!isEnabled ? "disabled" : ""}>Claude Code Web</button>
          </div>
          <div class="ix-actions">
            <button data-action="mobile" ${!isEnabled ? "disabled" : ""}>Claudeアプリ</button>
            <button data-action="qr" data-id="claude" ${!isEnabled ? "disabled" : ""}>QR表示</button>
          </div>
          <div id="ixQr-claude" class="ix-qr hidden">
            <img src="/qr/claude-code.png" alt="Claude Code QR code" />
            <span>Claude Code on the web</span>
          </div>
        `;

      return `
        <article class="ix-card ${isEnabled ? "" : "disabled"}">
          <div class="ix-card-head">
            <div>
              <div class="ix-name-row">
                <h2>${escapeHtml(info.name)}</h2>
                <span class="ix-pill ${installClass}">${escapeHtml(statusText(info))}</span>
              </div>
              ${version}
            </div>
            <label class="ix-toggle">
              <input type="checkbox" data-toggle="${info.id}" ${isEnabled ? "checked" : ""} />
              <span></span>
            </label>
          </div>

          <p class="ix-description">
            ${info.id === "antigravity"
              ? "Google公式のAntigravity CLI (agy) をホスト側で検出・起動します。認証と権限管理はagy自身に任せ、DevMoterはCLIをラップします。"
              : "ローカルClaude Codeを端末で開くか、公式Claude Code Web / モバイルアプリへ移動します。"}
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

    if (action === "mobile") {
      window.location.href = "claude://code";
      return;
    }

    if (action === "qr" && id) {
      root.querySelector<HTMLElement>(`#ixQr-${id}`)?.classList.toggle("hidden");
      return;
    }

    if (action === "models" && id === "antigravity") {
      button.disabled = true;
      try {
        const result = await api<{ output?: string }>("/api/integrations/antigravity/models");
        const panel = root.querySelector<HTMLElement>("#ixModels-antigravity");
        if (panel) {
          panel.textContent = result.output || "No models reported by agy.";
          panel.classList.remove("hidden");
        }
      } catch (error) {
        showNotice(error instanceof Error ? error.message : String(error), "error");
      } finally {
        button.disabled = false;
      }
      return;
    }

    if (action === "launch" && id) {
      const project = selectedProject();
      if (!project) {
        showNotice("先にProjectを選んでね。", "error");
        return;
      }
      button.disabled = true;
      try {
        const result = await api<{ terminal?: string }>(`/api/integrations/${id}/launch`, {
          method: "POST",
          body: JSON.stringify({ projectId: project.id })
        });
        showNotice(`${id === "claude" ? "Claude Code" : "Antigravity"}を${result.terminal || "terminal"}で開きました。`);
      } catch (error) {
        showNotice(error instanceof Error ? error.message : String(error), "error");
      } finally {
        button.disabled = false;
      }
      return;
    }

    if ((action === "remote-start" || action === "remote-stop") && id === "antigravity") {
      const confirmation =
        action === "remote-start"
          ? "Antigravity Remote Controlを開始します。PCがリモート操作可能な状態になります。続けますか？"
          : "Antigravity Remote Controlを停止します。続けますか？";
      if (!window.confirm(confirmation)) return;

      button.disabled = true;
      try {
        await api(`/api/integrations/antigravity/remote/${action === "remote-start" ? "start" : "stop"}`, {
          method: "POST",
          body: "{}"
        });
        await refreshIntegrations();
        showNotice(action === "remote-start" ? "Antigravity Remote Controlを開始しました。" : "Antigravity Remote Controlを停止しました。");
      } catch (error) {
        showNotice(error instanceof Error ? error.message : String(error), "error");
      } finally {
        button.disabled = false;
      }
    }
  }

  projectSelect.addEventListener("change", () => {
    selectedProjectId = projectSelect.value;
    localStorage.setItem(PROJECT_KEY, selectedProjectId);
    projectPath.textContent = selectedProject()?.path || "";
  });

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
      renderProjects();
    } catch (error) {
      cards.innerHTML = `<div class="ix-loading error">${escapeHtml(error instanceof Error ? error.message : String(error))}</div>`;
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
