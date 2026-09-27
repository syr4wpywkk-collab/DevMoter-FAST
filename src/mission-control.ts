import "./mission-control.css";

type Json = Record<string, unknown>;
type SourceKey = "agents" | "sessions" | "host" | "projects";
type SourceState = { ok: boolean; data: unknown; error: string | null };

type MissionState = Record<SourceKey, SourceState> & {
  loadedAt: number | null;
};

const ACTIVE_AGENT_STATES = new Set(["starting", "running", "waiting_for_approval"]);
const TERMINAL_SESSION_STATES = new Set(["completed", "failed", "cancelled", "closed", "done"]);

function objectValue(value: unknown): Json {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Json : {};
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringValue(value: unknown, fallback = "—") {
  const text = typeof value === "string" ? value.trim() : "";
  return text || fallback;
}

function numberValue(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function formatTime(value: unknown) {
  const numeric = Number(value);
  const date = Number.isFinite(numeric)
    ? new Date(numeric)
    : typeof value === "string" && value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(date);
}

async function getJson(path: string) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(path, {
      method: "GET",
      cache: "no-store",
      credentials: "same-origin",
      signal: controller.signal
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = stringValue(objectValue(payload).error, `HTTP ${response.status}`);
      throw new Error(message);
    }
    return payload;
  } finally {
    window.clearTimeout(timeout);
  }
}

async function loadSource(path: string): Promise<SourceState> {
  try {
    return { ok: true, data: await getJson(path), error: null };
  } catch (error) {
    return {
      ok: false,
      data: null,
      error: error instanceof Error ? error.message : "Unavailable"
    };
  }
}

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className = "",
  text = ""
) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function statusBadge(value: unknown) {
  const status = stringValue(value, "unknown").toLowerCase();
  const badge = element("span", "dm-mission-status", status.replaceAll("_", " "));
  badge.dataset.state = status;
  return badge;
}

function emptyState(message: string) {
  return element("div", "dm-mission-empty", message);
}

function errorState(message: string) {
  const node = element("div", "dm-mission-source-error");
  node.append(
    element("strong", "", "Source unavailable"),
    element("small", "", message)
  );
  return node;
}

function dataRow(title: string, detail: string, status?: unknown, meta?: string) {
  const row = element("div", "dm-mission-row");
  const copy = element("div", "dm-mission-row-copy");
  copy.append(element("strong", "", title), element("small", "", detail));
  if (meta) copy.append(element("small", "dm-mission-row-meta", meta));
  row.append(copy);
  if (status !== undefined) row.append(statusBadge(status));
  return row;
}

function readRuns(source: SourceState) {
  return arrayValue(objectValue(source.data).runs).map(objectValue);
}

function readFleets(source: SourceState) {
  return arrayValue(objectValue(source.data).fleets).map(objectValue);
}

function readSessions(source: SourceState) {
  return arrayValue(objectValue(source.data).sessions).map(objectValue);
}

function readProjects(source: SourceState) {
  return arrayValue(objectValue(source.data).projects).map(objectValue);
}

export function mountMissionControl() {
  if (document.querySelector("#devmoterMissionControl")) return;

  const root = document.createElement("div");
  root.id = "devmoterMissionControl";
  root.className = "dm-mission-root";
  root.innerHTML = `
    <div class="dm-mission-modal hidden" role="dialog" aria-modal="true" aria-labelledby="dmMissionTitle">
      <section class="dm-mission-sheet">
        <header class="dm-mission-head">
          <div>
            <small>DevMoter FAST</small>
            <strong id="dmMissionTitle">Mission Control</strong>
          </div>
          <div class="dm-mission-head-actions">
            <button type="button" data-mission-refresh aria-label="Refresh Mission Control">↻</button>
            <button type="button" data-mission-close aria-label="Close Mission Control">×</button>
          </div>
        </header>
        <div class="dm-mission-scroll">
          <div class="dm-mission-updated" data-mission-updated>Not loaded yet</div>
          <section class="dm-mission-kpis" aria-label="Mission Control summary">
            <article><small>Active agents</small><strong data-kpi-agents>—</strong></article>
            <article><small>Fleet queue</small><strong data-kpi-queue>—</strong></article>
            <article><small>Live sessions</small><strong data-kpi-sessions>—</strong></article>
            <article><small>Projects online</small><strong data-kpi-projects>—</strong></article>
          </section>
          <div class="dm-mission-grid">
            <section class="dm-mission-panel">
              <header><div><small>Runtime</small><h2>Agent Runs</h2></div><button type="button" data-open-app="agents">Open Agents</button></header>
              <div data-mission-agents></div>
            </section>
            <section class="dm-mission-panel">
              <header><div><small>Backends</small><h2>Sessions</h2></div><button type="button" data-open-app="sessions">Open Activity</button></header>
              <div data-mission-sessions></div>
            </section>
            <section class="dm-mission-panel">
              <header><div><small>Machine</small><h2>Host</h2></div><button type="button" data-open-system="hosts">Open Hosts</button></header>
              <div data-mission-host></div>
            </section>
            <section class="dm-mission-panel">
              <header><div><small>Workspace</small><h2>Projects</h2></div><button type="button" data-open-app="projects">Open Projects</button></header>
              <div data-mission-projects></div>
            </section>
          </div>
        </div>
      </section>
    </div>
  `;
  document.body.appendChild(root);

  const modal = root.querySelector<HTMLElement>(".dm-mission-modal")!;
  const refreshButton = root.querySelector<HTMLButtonElement>("[data-mission-refresh]")!;
  const closeButton = root.querySelector<HTMLButtonElement>("[data-mission-close]")!;
  const updated = root.querySelector<HTMLElement>("[data-mission-updated]")!;
  const agentsNode = root.querySelector<HTMLElement>("[data-mission-agents]")!;
  const sessionsNode = root.querySelector<HTMLElement>("[data-mission-sessions]")!;
  const hostNode = root.querySelector<HTMLElement>("[data-mission-host]")!;
  const projectsNode = root.querySelector<HTMLElement>("[data-mission-projects]")!;
  const kpiAgents = root.querySelector<HTMLElement>("[data-kpi-agents]")!;
  const kpiQueue = root.querySelector<HTMLElement>("[data-kpi-queue]")!;
  const kpiSessions = root.querySelector<HTMLElement>("[data-kpi-sessions]")!;
  const kpiProjects = root.querySelector<HTMLElement>("[data-kpi-projects]")!;

  let opened = false;
  let lastFocus: HTMLElement | null = null;
  let refreshTimer: number | null = null;
  let refreshInFlight: Promise<void> | null = null;
  let state: MissionState = {
    agents: { ok: false, data: null, error: "Not loaded" },
    sessions: { ok: false, data: null, error: "Not loaded" },
    host: { ok: false, data: null, error: "Not loaded" },
    projects: { ok: false, data: null, error: "Not loaded" },
    loadedAt: null
  };

  function renderAgents() {
    agentsNode.replaceChildren();
    if (!state.agents.ok) {
      agentsNode.append(errorState(state.agents.error || "Agent runtime unavailable"));
      return;
    }
    const runs = readRuns(state.agents)
      .sort((a, b) => numberValue(b.updatedAt) - numberValue(a.updatedAt));
    const fleets = readFleets(state.agents);
    const queued = fleets.reduce((sum, fleet) => sum + numberValue(fleet.queued), 0);
    kpiAgents.textContent = String(runs.filter(run => ACTIVE_AGENT_STATES.has(stringValue(run.state, "").toLowerCase())).length);
    kpiQueue.textContent = String(queued);
    if (!runs.length) {
      agentsNode.append(emptyState("No Agent Runs yet."));
      return;
    }
    for (const run of runs.slice(0, 6)) {
      const meta = [stringValue(run.backend, ""), formatTime(run.updatedAt)].filter(Boolean).join(" · ");
      agentsNode.append(dataRow(
        stringValue(run.task, "Untitled agent task"),
        `${stringValue(run.role, "agent")} · ${stringValue(run.id, "unknown run")}`,
        run.state,
        meta
      ));
    }
  }

  function renderSessions() {
    sessionsNode.replaceChildren();
    if (!state.sessions.ok) {
      sessionsNode.append(errorState(state.sessions.error || "Session inventory unavailable"));
      return;
    }
    const sessions = readSessions(state.sessions);
    const live = sessions.filter(session => !TERMINAL_SESSION_STATES.has(stringValue(session.status, "").toLowerCase()));
    kpiSessions.textContent = String(live.length);
    if (!sessions.length) {
      sessionsNode.append(emptyState("No OpenCode or Codex sessions reported."));
      return;
    }
    for (const session of sessions.slice(0, 6)) {
      const meta = [stringValue(session.projectId, ""), formatTime(session.updatedAt)].filter(Boolean).join(" · ");
      sessionsNode.append(dataRow(
        stringValue(session.title, "Untitled session"),
        `${stringValue(session.backend, "unknown")} · ${stringValue(session.agent, "agent")}`,
        session.status,
        meta
      ));
    }
  }

  function renderHost() {
    hostNode.replaceChildren();
    if (!state.host.ok) {
      hostNode.append(errorState(state.host.error || "Host snapshot unavailable"));
      return;
    }
    const payload = objectValue(state.host.data);
    const host = objectValue(payload.host);
    const capabilities = objectValue(payload.capabilities);
    const capabilityEntries = Object.entries(capabilities).map(([id, value]) => [id, objectValue(value)] as const);
    const available = capabilityEntries.filter(([, value]) => stringValue(value.state, "") === "available").length;
    hostNode.append(dataRow(
      stringValue(host.platform, "Unknown host"),
      `${stringValue(host.runtime, "unknown")} · ${stringValue(host.architecture, "unknown arch")}`,
      available === capabilityEntries.length && capabilityEntries.length ? "available" : "degraded",
      `${available}/${capabilityEntries.length} capabilities available`
    ));
    const caps = element("div", "dm-mission-capabilities");
    for (const [id, value] of capabilityEntries) {
      const chip = element("span", "dm-mission-capability", id);
      chip.dataset.state = stringValue(value.state, "unknown");
      chip.title = stringValue(value.reason, "");
      caps.append(chip);
    }
    hostNode.append(caps);
  }

  function renderProjects() {
    projectsNode.replaceChildren();
    if (!state.projects.ok) {
      projectsNode.append(errorState(state.projects.error || "Project registry unavailable"));
      return;
    }
    const projects = readProjects(state.projects);
    const online = projects.filter(project => project.available === true).length;
    kpiProjects.textContent = projects.length ? `${online}/${projects.length}` : "0";
    if (!projects.length) {
      projectsNode.append(emptyState("No registered projects."));
      return;
    }
    for (const project of projects.slice(0, 6)) {
      projectsNode.append(dataRow(
        stringValue(project.name, "Unnamed project"),
        stringValue(project.id, "unknown project"),
        project.available === true ? "available" : "unavailable"
      ));
    }
  }

  function render() {
    kpiAgents.textContent = state.agents.ok ? kpiAgents.textContent : "—";
    kpiQueue.textContent = state.agents.ok ? kpiQueue.textContent : "—";
    kpiSessions.textContent = state.sessions.ok ? kpiSessions.textContent : "—";
    kpiProjects.textContent = state.projects.ok ? kpiProjects.textContent : "—";
    renderAgents();
    renderSessions();
    renderHost();
    renderProjects();
    updated.textContent = state.loadedAt
      ? `Updated ${new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date(state.loadedAt))}`
      : "Not loaded yet";
  }

  function syncAutoRefresh() {
    if (refreshTimer !== null) {
      window.clearInterval(refreshTimer);
      refreshTimer = null;
    }
    if (!opened || document.visibilityState !== "visible") return;
    refreshTimer = window.setInterval(() => void refresh(), 10_000);
  }

  async function refresh() {
    if (refreshInFlight) return refreshInFlight;
    refreshButton.disabled = true;
    refreshButton.classList.add("spinning");
    refreshInFlight = (async () => {
      const [agents, sessions, host, projects] = await Promise.all([
        loadSource("/api/agent-runs"),
        loadSource("/api/automation/sessions"),
        loadSource("/api/host"),
        loadSource("/api/projects")
      ]);
      state = { agents, sessions, host, projects, loadedAt: Date.now() };
      render();
    })().finally(() => {
      refreshInFlight = null;
      refreshButton.disabled = false;
      refreshButton.classList.remove("spinning");
    });
    return refreshInFlight;
  }

  function open() {
    if (opened) {
      void refresh();
      return;
    }
    opened = true;
    lastFocus = document.activeElement as HTMLElement | null;
    modal.classList.remove("hidden");
    document.body.classList.add("dm-mission-open");
    syncAutoRefresh();
    void refresh();
    window.requestAnimationFrame(() => closeButton.focus({ preventScroll: true }));
  }

  function close(restoreFocus = true) {
    if (!opened) return;
    opened = false;
    modal.classList.add("hidden");
    document.body.classList.remove("dm-mission-open");
    syncAutoRefresh();
    if (restoreFocus) lastFocus?.focus?.();
  }

  refreshButton.addEventListener("click", () => void refresh());
  closeButton.addEventListener("click", () => close());

  root.querySelectorAll<HTMLButtonElement>("[data-open-app]").forEach(button => {
    button.addEventListener("click", () => {
      const id = button.dataset.openApp;
      close(false);
      window.dispatchEvent(new CustomEvent("devmoter:launch-app", { detail: { id } }));
    });
  });
  root.querySelector<HTMLButtonElement>('[data-open-system="hosts"]')?.addEventListener("click", () => {
    close(false);
    document.querySelector<HTMLElement>(".dm-control-trigger")?.click();
    window.setTimeout(() => {
      document.querySelector<HTMLButtonElement>('.dm-control-tabs [data-tab="hosts"]')?.click();
    }, 0);
  });

  window.addEventListener("devmoter:open-mission-control", open);
  window.addEventListener("devmoter:surface-changed", () => close(false));
  window.addEventListener("online", () => { if (opened) void refresh(); });
  document.addEventListener("visibilitychange", () => {
    syncAutoRefresh();
    if (opened && document.visibilityState === "visible") void refresh();
  });
  document.addEventListener("keydown", event => {
    if (opened && event.key === "Escape") close();
  });
}
