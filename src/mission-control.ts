import "./mission-control.css";
import { createDeviceGate, isDeviceAuthError, responseError } from "./device-gate.mjs";
import { formatNumber, formatTime as formatLocaleTime, t, translateServerMessage } from "./i18n";
import { createSheetHeader } from "./sheet-header.mjs";

type Json = Record<string, unknown>;
type SourceKey = "agents" | "sessions" | "host" | "projects";
type SourceState = { ok: boolean; data: unknown; error: string | null; deviceAuth?: boolean };

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
  return formatLocaleTime(date);
}

const esc = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const KNOWN_MISSION_STATUSES = new Set([
  "running",
  "starting",
  "waiting_for_approval",
  "completed",
  "failed",
  "cancelled",
  "closed",
  "done",
  "available",
  "degraded",
  "unavailable",
  "unknown"
]);

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
      const raw = stringValue(objectValue(payload).error, "");
      const message = raw ? translateServerMessage(raw) : t("common.httpError", { status: response.status });
      throw responseError(response.status, message);
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
      error: error instanceof Error ? translateServerMessage(error.message) : t("mission.unavailable"),
      deviceAuth: isDeviceAuthError(error)
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
  const display = KNOWN_MISSION_STATUSES.has(status) ? t(`mission.status.${status}`) : status.replaceAll("_", " ");
  const badge = element("span", "dm-mission-status", display);
  badge.dataset.state = status;
  return badge;
}

function emptyState(message: string) {
  return element("div", "dm-mission-empty", message);
}

function errorState(source: SourceState, fallback: string) {
  // An unregistered device gets the 信頼済み端末 button, not the raw 401 text.
  if (source.deviceAuth) {
    return createDeviceGate(document, {
      compact: true,
      onRegister: () => window.dispatchEvent(new CustomEvent("devmoter:close-mission-control"))
    });
  }
  const message = source.error ? translateServerMessage(source.error) : fallback;
  const node = element("div", "dm-mission-source-error");
  node.append(
    element("strong", "", t("mission.sourceUnavailable")),
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
  const notLoaded = esc(t("mission.notLoaded"));
  const openLabel = esc(t("common.open"));
  root.innerHTML = `
    <div class="dm-mission-modal hidden" role="dialog" aria-modal="true" aria-labelledby="dmMissionTitle">
      <section class="dm-mission-sheet dm-sheet-frame">
        <div class="dm-mission-scroll">
          <div class="dm-mission-updated" data-mission-updated>${notLoaded}</div>
          <section class="dm-mission-kpis" aria-label="${esc(t("mission.summaryAria"))}">
            <article><small>${esc(t("mission.kpi.activeAgents"))}</small><strong data-kpi-agents data-empty="true">${notLoaded}</strong></article>
            <article><small>${esc(t("mission.kpi.fleetQueue"))}</small><strong data-kpi-queue data-empty="true">${notLoaded}</strong></article>
            <article><small>${esc(t("mission.kpi.liveSessions"))}</small><strong data-kpi-sessions data-empty="true">${notLoaded}</strong></article>
            <article><small>${esc(t("mission.kpi.projectsOnline"))}</small><strong data-kpi-projects data-empty="true">${notLoaded}</strong></article>
          </section>
          <div class="dm-mission-grid">
            <section class="dm-mission-panel">
              <header><h2>${esc(t("mission.panel.agentRuns"))}</h2><button type="button" data-open-app="agents">${openLabel}</button></header>
              <div data-mission-agents></div>
            </section>
            <section class="dm-mission-panel">
              <header><h2>${esc(t("mission.panel.sessions"))}</h2><button type="button" data-open-app="sessions">${openLabel}</button></header>
              <div data-mission-sessions></div>
            </section>
            <section class="dm-mission-panel">
              <header><h2>${esc(t("mission.panel.host"))}</h2><button type="button" data-open-system="hosts">${openLabel}</button></header>
              <div data-mission-host></div>
            </section>
            <section class="dm-mission-panel">
              <header><h2>${esc(t("mission.panel.projects"))}</h2><button type="button" data-open-app="projects">${openLabel}</button></header>
              <div data-mission-projects></div>
            </section>
          </div>
        </div>
      </section>
    </div>
  `;
  document.body.appendChild(root);

  const modal = root.querySelector<HTMLElement>(".dm-mission-modal")!;
  // Shared sheet header: title, refresh (icon action) and close.
  const head = createSheetHeader(document, { title: t("mission.title"), titleId: "dmMissionTitle" });
  const refreshButton = document.createElement("button");
  refreshButton.type = "button";
  refreshButton.dataset.missionRefresh = "";
  refreshButton.setAttribute("aria-label", t("common.refresh"));
  refreshButton.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/></svg>';
  head.actions.append(refreshButton);
  const closeButton = head.closeButton;
  root.querySelector<HTMLElement>(".dm-mission-sheet")!.prepend(head.element);
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
    agents: { ok: false, data: null, error: t("mission.notLoaded") },
    sessions: { ok: false, data: null, error: t("mission.notLoaded") },
    host: { ok: false, data: null, error: t("mission.notLoaded") },
    projects: { ok: false, data: null, error: t("mission.notLoaded") },
    loadedAt: null
  };

  function renderAgents() {
    agentsNode.replaceChildren();
    if (!state.agents.ok) {
      agentsNode.append(errorState(state.agents, t("mission.err.agents")));
      return;
    }
    const runs = readRuns(state.agents)
      .sort((a, b) => numberValue(b.updatedAt) - numberValue(a.updatedAt));
    const fleets = readFleets(state.agents);
    const queued = fleets.reduce((sum, fleet) => sum + numberValue(fleet.queued), 0);
    kpiAgents.textContent = formatNumber(runs.filter(run => ACTIVE_AGENT_STATES.has(stringValue(run.state, "").toLowerCase())).length);
    kpiQueue.textContent = formatNumber(queued);
    if (!runs.length) {
      agentsNode.append(emptyState(t("mission.empty.agents")));
      return;
    }
    for (const run of runs.slice(0, 6)) {
      const meta = [stringValue(run.backend, ""), formatTime(run.updatedAt)].filter(Boolean).join(" · ");
      agentsNode.append(dataRow(
        stringValue(run.task, t("mission.untitledAgentTask")),
        `${stringValue(run.role, "agent")} · ${stringValue(run.id, "-")}`,
        run.state,
        meta
      ));
    }
  }

  function renderSessions() {
    sessionsNode.replaceChildren();
    if (!state.sessions.ok) {
      sessionsNode.append(errorState(state.sessions, t("mission.err.sessions")));
      return;
    }
    const sessions = readSessions(state.sessions);
    const live = sessions.filter(session => !TERMINAL_SESSION_STATES.has(stringValue(session.status, "").toLowerCase()));
    kpiSessions.textContent = formatNumber(live.length);
    if (!sessions.length) {
      sessionsNode.append(emptyState(t("mission.empty.sessions")));
      return;
    }
    for (const session of sessions.slice(0, 6)) {
      const meta = [stringValue(session.projectId, ""), formatTime(session.updatedAt)].filter(Boolean).join(" · ");
      sessionsNode.append(dataRow(
        stringValue(session.title, t("mission.untitledSession")),
        `${stringValue(session.backend, t("common.unknown"))} · ${stringValue(session.agent, "agent")}`,
        session.status,
        meta
      ));
    }
  }

  function renderHost() {
    hostNode.replaceChildren();
    if (!state.host.ok) {
      hostNode.append(errorState(state.host, t("mission.err.host")));
      return;
    }
    const payload = objectValue(state.host.data);
    const host = objectValue(payload.host);
    const capabilities = objectValue(payload.capabilities);
    const capabilityEntries = Object.entries(capabilities).map(([id, value]) => [id, objectValue(value)] as const);
    const available = capabilityEntries.filter(([, value]) => stringValue(value.state, "") === "available").length;
    hostNode.append(dataRow(
      stringValue(host.platform, t("mission.unknownHost")),
      `${stringValue(host.runtime, t("common.unknown"))} · ${stringValue(host.architecture, t("mission.unknownArch"))}`,
      available === capabilityEntries.length && capabilityEntries.length ? "available" : "degraded",
      t("mission.capabilitiesMeta", { available: formatNumber(available), total: formatNumber(capabilityEntries.length) })
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
      projectsNode.append(errorState(state.projects, t("mission.err.projects")));
      return;
    }
    const projects = readProjects(state.projects);
    const online = projects.filter(project => project.available === true).length;
    kpiProjects.textContent = projects.length ? `${formatNumber(online)}/${formatNumber(projects.length)}` : "0";
    if (!projects.length) {
      projectsNode.append(emptyState(t("mission.empty.projects")));
      return;
    }
    for (const project of projects.slice(0, 6)) {
      projectsNode.append(dataRow(
        stringValue(project.name, t("mission.unnamedProject")),
        stringValue(project.id, "-"),
        project.available === true ? "available" : "unavailable"
      ));
    }
  }

  // A KPI whose source did not load says so instead of a bare "—".
  function setKpi(node: HTMLElement, ok: boolean) {
    if (!ok) node.textContent = t("mission.notLoaded");
    node.dataset.empty = String(!ok);
  }

  function render() {
    setKpi(kpiAgents, state.agents.ok);
    setKpi(kpiQueue, state.agents.ok);
    setKpi(kpiSessions, state.sessions.ok);
    setKpi(kpiProjects, state.projects.ok);
    renderAgents();
    renderSessions();
    renderHost();
    renderProjects();
    // Label and time are separate text nodes so the label is translated.
    updated.replaceChildren();
    if (state.loadedAt) {
      updated.append(element("span", "", t("mission.updated")), document.createTextNode(" "), element("span", "", formatLocaleTime(state.loadedAt)));
    } else updated.textContent = t("mission.notLoaded");
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
  window.addEventListener("devmoter:close-mission-control", () => close(false));
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
