import "./control-center.css";
import type { Terminal as XTerm } from "@xterm/xterm";
import type { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";

type ProjectSummary = {
  id: string;
  name: string;
  path: string;
  available?: boolean;
};

type TerminalSession = {
  id: string;
  name?: string;
  persistent?: boolean;
  expiresAt?: number | null;
  status?: "attached" | "detached" | "exited";
  projectId: string;
  projectName: string;
  cwd: string;
  createdAt: number;
  lastAttachedAt: number | null;
  lastActivityAt: number;
  closed: boolean;
  exitCode: number | null;
  signal: string | null;
  seq: number;
};

type TerminalRecord = {
  session: TerminalSession;
  token: string;
};

type TerminalChunk = {
  seq?: number;
  data?: string;
  stream?: string;
  type?: string;
};

type PermissionRule = {
  id: string;
  scope: {
    backend?: string;
    tool?: string;
    action?: string;
    projectId?: string;
    sessionId?: string;
  };
  createdAt: number;
  expiresAt?: number;
  note?: string;
};

const TERMINAL_RECORD_KEY = "devmoter-terminal-record";
const TERMINAL_AUTH_KEY = "devmoter-terminal-auth";
function uid() {
  return typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function button(label: string, ariaLabel = label) {
  const el = document.createElement("button");
  el.type = "button";
  el.textContent = label;
  el.setAttribute("aria-label", ariaLabel);
  return el;
}

function loadTerminalRecord(): TerminalRecord | null {
  try {
    const parsed = JSON.parse(sessionStorage.getItem(TERMINAL_RECORD_KEY) || "null") as TerminalRecord | null;
    if (!parsed?.session?.id || (!parsed?.token && !parsed?.session?.persistent)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function saveTerminalRecord(record: TerminalRecord | null) {
  if (!record) sessionStorage.removeItem(TERMINAL_RECORD_KEY);
  else sessionStorage.setItem(TERMINAL_RECORD_KEY, JSON.stringify(record));
}

function terminalAuthorization(ask = false) {
  const existing = sessionStorage.getItem(TERMINAL_AUTH_KEY);
  if (existing) return existing;
  if (!ask) return "";
  const password = window.prompt("DevMoter terminal password (DEVMOTER_AUTH_PASSWORD)");
  if (!password) return "";
  const value = `Basic ${btoa(`devmoter:${password}`)}`;
  sessionStorage.setItem(TERMINAL_AUTH_KEY, value);
  return value;
}

async function terminalFetch(
  path: string,
  init: RequestInit = {},
  retryAuth = true
): Promise<Response> {
  const headers = new Headers(init.headers || {});
  const auth = terminalAuthorization(false);
  if (auth) headers.set("authorization", auth);

  let response = await fetch(path, {
    ...init,
    headers,
    cache: "no-store",
    credentials: "same-origin"
  });

  if (response.status === 401 && retryAuth) {
    sessionStorage.removeItem(TERMINAL_AUTH_KEY);
    const next = terminalAuthorization(true);
    if (next) {
      headers.set("authorization", next);
      response = await fetch(path, {
        ...init,
        headers,
        cache: "no-store",
        credentials: "same-origin"
      });
    }
  }

  return response;
}

async function jsonOrError<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => ({})) as { error?: string } & T;
  if (!response.ok) throw new Error(payload?.error || `HTTP ${response.status}`);
  return payload;
}

function scopeSummary(rule: PermissionRule) {
  const rows = [
    rule.scope.backend ? `backend=${rule.scope.backend}` : "",
    rule.scope.tool ? `tool=${rule.scope.tool}` : "",
    rule.scope.projectId ? `project=${rule.scope.projectId}` : "",
    rule.scope.sessionId ? `session=${rule.scope.sessionId}` : "",
    rule.scope.action ? `action=${rule.scope.action}` : ""
  ].filter(Boolean);
  return rows.join("\n");
}

export function mountControlCenter() {
  const launcher = button("⌘", "Open DevMoter tools");
  launcher.className = "dm-tools-launcher";
  launcher.setAttribute("aria-haspopup", "dialog");
  launcher.setAttribute("aria-expanded", "false");

  const scrim = document.createElement("button");
  scrim.type = "button";
  scrim.className = "dm-tools-scrim hidden";
  scrim.setAttribute("aria-label", "Close DevMoter tools");
  scrim.tabIndex = -1;

  const panel = document.createElement("aside");
  panel.className = "dm-tools-panel hidden";
  panel.setAttribute("aria-label", "DevMoter tools");
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-modal", "true");
  panel.setAttribute("aria-labelledby", "dm-tools-title");
  panel.setAttribute("aria-describedby", "dm-tools-subtitle");

  const head = document.createElement("div");
  head.className = "dm-tools-head";
  const heading = document.createElement("div");
  heading.className = "dm-tools-heading";
  const title = document.createElement("strong");
  title.id = "dm-tools-title";
  title.textContent = "DevMoter Tools";
  const subtitle = document.createElement("span");
  subtitle.id = "dm-tools-subtitle";
  subtitle.textContent = "Terminal access, permission review, and local project search";
  heading.append(title, subtitle);
  const close = button("×", "Close DevMoter tools");
  close.className = "dm-tools-close";
  head.append(heading, close);

  const tabs = document.createElement("div");
  tabs.className = "dm-tools-tabs";
  const terminalTab = button("Terminal");
  const safetyTab = button("Safety");
  const indexTab = button("Project Index");
  terminalTab.classList.add("active");
  tabs.setAttribute("role", "tablist");
  tabs.setAttribute("aria-label", "Tools sections");
  const tabEntries = [
    [terminalTab, "terminal", "dm-tools-terminal-panel"],
    [safetyTab, "safety", "dm-tools-safety-panel"],
    [indexTab, "index", "dm-tools-index-panel"]
  ] as const;
  for (const [tab, name, panelId] of tabEntries) {
    tab.id = `dm-tools-${name}-tab`;
    tab.setAttribute("role", "tab");
    tab.setAttribute("aria-controls", panelId);
    tab.setAttribute("aria-selected", name === "terminal" ? "true" : "false");
    tab.tabIndex = name === "terminal" ? 0 : -1;
  }
  tabs.append(terminalTab, safetyTab, indexTab);

  const body = document.createElement("div");
  body.className = "dm-tools-body";

  const terminalSection = document.createElement("section");
  terminalSection.className = "dm-tools-section";
  terminalSection.id = "dm-tools-terminal-panel";
  terminalSection.setAttribute("role", "tabpanel");
  terminalSection.setAttribute("aria-labelledby", "dm-tools-terminal-tab");
  terminalSection.tabIndex = 0;
  const safetySection = document.createElement("section");
  safetySection.className = "dm-tools-section hidden";
  safetySection.id = "dm-tools-safety-panel";
  safetySection.setAttribute("role", "tabpanel");
  safetySection.setAttribute("aria-labelledby", "dm-tools-safety-tab");
  safetySection.tabIndex = 0;
  const indexSection = document.createElement("section");
  indexSection.className = "dm-tools-section hidden";
  indexSection.id = "dm-tools-index-panel";
  indexSection.setAttribute("role", "tabpanel");
  indexSection.setAttribute("aria-labelledby", "dm-tools-index-tab");
  indexSection.tabIndex = 0;
  body.append(terminalSection, safetySection, indexSection);

  panel.append(head, tabs, body);
  document.body.append(scrim, launcher, panel);

  let projects: ProjectSummary[] = [];
  let savedTerminalSessions: TerminalSession[] = [];
  let activeProjectId = localStorage.getItem("opencode-pocket-project") || "";
  let terminalRecord = loadTerminalRecord();
  let terminalShell: HTMLDivElement;
  let terminalPlaceholder: HTMLDivElement;
  let terminalStatus: HTMLDivElement;
  let projectSelect: HTMLSelectElement;
  let indexProjectSelect: HTMLSelectElement | null = null;
  let savedSessionSelect: HTMLSelectElement;
  let sessionNameInput: HTMLInputElement;
  let persistentSessionToggle: HTMLInputElement;
  let terminalView: XTerm | null = null;
  let terminalFit: FitAddon | null = null;
  let rendererPromise: Promise<void> | null = null;
  let terminalSocket: WebSocket | null = null;
  let socketRetryTimer: number | null = null;
  let socketConnecting = false;
  let socketGeneration = 0;
  let terminalResizeObserver: ResizeObserver | null = null;
  let lastSeq = 0;
  let setTerminalControlsBusy: (busy: boolean) => void = () => {};
  let modalOpen = false;
  let returnFocusTarget: HTMLElement | null = null;
  const inertSnapshots = new Map<HTMLElement, { inert: boolean; ariaHidden: string | null }>();
  const syncToolsViewport = () => {
    const height = window.visualViewport?.height ?? window.innerHeight;
    if (Number.isFinite(height) && height > 0) {
      const value = `${Math.max(1, Math.floor(height))}px`;
      panel.style.setProperty("--dm-tools-viewport-height", value);
      scrim.style.setProperty("--dm-tools-viewport-height", value);
    }
  };
  syncToolsViewport();
  window.visualViewport?.addEventListener("resize", syncToolsViewport, { passive: true });
  window.visualViewport?.addEventListener("scroll", syncToolsViewport, { passive: true });
  window.addEventListener("resize", syncToolsViewport, { passive: true });
  window.addEventListener("orientationchange", syncToolsViewport);
  let safetyInitialized = false;
  let indexInitialized = false;
  let safetyRevision = 0;
  let refreshSafetyView: (() => Promise<void>) | null = null;
  let refreshIndexView: (() => Promise<void>) | null = null;

  function setTab(next: "terminal" | "safety" | "index") {
    for (const [tab, name] of tabEntries) {
      const selected = name === next;
      tab.classList.toggle("active", selected);
      tab.setAttribute("aria-selected", String(selected));
      tab.tabIndex = selected ? 0 : -1;
    }
    terminalSection.classList.toggle("hidden", next !== "terminal");
    safetySection.classList.toggle("hidden", next !== "safety");
    indexSection.classList.toggle("hidden", next !== "index");

    if (next === "safety") {
      if (!safetyInitialized) {
        safetyInitialized = true;
        void renderSafety();
      } else void refreshSafetyView?.();
    } else if (next === "index" && !indexInitialized) {
      indexInitialized = true;
      void renderIndex();
    } else if (next === "index") {
      void refreshIndexView?.().catch(error => {
        const status = indexSection.querySelector<HTMLElement>("[role='status']");
        if (status && !indexSection.classList.contains("hidden")) {
          status.textContent = error instanceof Error ? error.message : String(error);
        }
      });
    }
    if (next === "terminal" && terminalView) fitTerminal();
  }

  function focusableInPanel() {
    return [...panel.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )].filter(element => !element.closest(".hidden") && element.getClientRects().length > 0);
  }

  function releaseBackgroundInert() {
    for (const [element, state] of inertSnapshots) {
      element.inert = state.inert;
      if (state.ariaHidden === null) element.removeAttribute("aria-hidden");
      else element.setAttribute("aria-hidden", state.ariaHidden);
    }
    inertSnapshots.clear();
  }

  function lockBackground() {
    releaseBackgroundInert();
    for (const child of [...document.body.children]) {
      if (!(child instanceof HTMLElement) || child === launcher || child === panel || child === scrim) continue;
      inertSnapshots.set(child, { inert: child.inert, ariaHidden: child.getAttribute("aria-hidden") });
      child.inert = true;
      child.setAttribute("aria-hidden", "true");
    }
  }

  function openPanel() {
    if (modalOpen) return;
    const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    returnFocusTarget = active && active !== document.body && active !== launcher ? active : null;
    panel.classList.remove("hidden");
    scrim.classList.remove("hidden");
    launcher.setAttribute("aria-expanded", "true");
    modalOpen = true;
    lockBackground();
    close.focus({ preventScroll: true });
    void loadProjects().then(() => {
      renderProjectOptions();
      if (indexInitialized && !indexSection.classList.contains("hidden")) void refreshIndexView?.();
      return refreshTerminalSessions();
    }).then(() => {
      if (modalOpen && terminalRecord) void reattachTerminal().catch(showTerminalLoadError);
    }).catch(error => {
      if (modalOpen) showTerminalLoadError(error);
    });
  }

  function closePanel(options: { restoreFocus?: boolean } = {}) {
    if (!modalOpen && panel.classList.contains("hidden")) return;
    const wasOpen = modalOpen;
    modalOpen = false;
    releaseBackgroundInert();
    panel.classList.add("hidden");
    scrim.classList.add("hidden");
    launcher.setAttribute("aria-expanded", "false");
    disconnectTerminalSocket();
    if (wasOpen && options.restoreFocus !== false) {
      const isVisible = (element: HTMLElement | null): element is HTMLElement => Boolean(
        element?.isConnected && !element.closest("[inert], [aria-hidden='true']") && element.getClientRects().length
      );
      const fallback = document.body.classList.contains("codex-mode")
        ? document.querySelector<HTMLElement>("#cxMenu")
        : document.querySelector<HTMLElement>(".dm-shell-menu-trigger") || launcher;
      const target = isVisible(returnFocusTarget) ? returnFocusTarget : fallback;
      if (isVisible(target)) target.focus({ preventScroll: true });
    }
    returnFocusTarget = null;
  }
  launcher.addEventListener("click", openPanel);
  close.addEventListener("click", () => closePanel());
  scrim.addEventListener("click", () => closePanel());
  window.addEventListener("devmoter:global-nav-opened", () => closePanel({ restoreFocus: false }));
  window.addEventListener("devmoter:surface-changed", () => closePanel({ restoreFocus: false }));
  window.addEventListener("keydown", event => {
    if (!modalOpen) return;
    if (event.key === "Escape") {
      event.preventDefault();
      closePanel();
      return;
    }
    if (event.key === "Tab") {
      const items = focusableInPanel();
      if (!items.length) {
        event.preventDefault();
        close.focus({ preventScroll: true });
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && (document.activeElement === first || !panel.contains(document.activeElement))) {
        event.preventDefault();
        last.focus({ preventScroll: true });
      } else if (!event.shiftKey && (document.activeElement === last || !panel.contains(document.activeElement))) {
        event.preventDefault();
        first.focus({ preventScroll: true });
      }
    }
  });
  tabs.addEventListener("keydown", event => {
    const currentIndex = tabEntries.findIndex(([tab]) => tab === document.activeElement);
    if (currentIndex < 0) return;
    let nextIndex = currentIndex;
    if (event.key === "ArrowRight") nextIndex = (currentIndex + 1) % tabEntries.length;
    else if (event.key === "ArrowLeft") nextIndex = (currentIndex + tabEntries.length - 1) % tabEntries.length;
    else if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = tabEntries.length - 1;
    else return;
    event.preventDefault();
    const [tab, name] = tabEntries[nextIndex];
    setTab(name);
    tab.focus({ preventScroll: true });
  });
  terminalTab.addEventListener("click", () => setTab("terminal"));
  safetyTab.addEventListener("click", () => setTab("safety"));
  indexTab.addEventListener("click", () => setTab("index"));

  async function loadProjects() {
    const response = await fetch("/api/projects", { cache: "no-store" });
    const payload = await jsonOrError<{ projects?: ProjectSummary[] }>(response);
    projects = (payload.projects || []).filter(project => project.available !== false);
    if (!activeProjectId || !projects.some(project => project.id === activeProjectId)) {
      activeProjectId = projects[0]?.id || "";
    }
  }

  function clearTrustedDeviceGate() {
    terminalSection.querySelector("[data-terminal-device-gate]")?.remove();
  }

  function showTerminalLoadError(error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    terminalStatus.textContent = `Could not load sessions · ${message}`;
    clearTrustedDeviceGate();
    if (!/trusted device/i.test(message)) return;

    const gate = document.createElement("div");
    gate.className = "dm-tools-card";
    gate.dataset.terminalDeviceGate = "true";

    const title = document.createElement("strong");
    title.textContent = "This browser is not a Trusted device";

    const copy = document.createElement("small");
    copy.textContent =
      "Terminal access is device-bound. Pair this browser first, then reopen Terminal.";

    const openDevices = button("Open Trusted devices");
    openDevices.addEventListener("click", () => {
      closePanel({ restoreFocus: false });
      window.dispatchEvent(new CustomEvent("devmoter:open-settings", {
        detail: { page: "devices" }
      }));
    });

    gate.append(title, copy, openDevices);
    terminalStatus.after(gate);
  }

  async function refreshTerminalSessions() {
    const response = await terminalFetch("/api/terminal/sessions");
    const payload = await jsonOrError<{ sessions?: TerminalSession[] }>(response);
    clearTrustedDeviceGate();
    savedTerminalSessions = payload.sessions || [];
    if (!savedSessionSelect) return;
    const selectedId = terminalRecord?.session.id || savedSessionSelect.value;
    savedSessionSelect.replaceChildren();
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "Select saved session…";
    savedSessionSelect.append(placeholder);
    for (const session of savedTerminalSessions.filter(item => item.persistent && !item.closed)) {
      const option = document.createElement("option");
      option.value = session.id;
      option.textContent = `${session.name || "Terminal"} · ${session.projectName} · ${session.status || "detached"}`;
      option.selected = session.id === selectedId;
      savedSessionSelect.append(option);
    }
  }

  function renderProjectOptions() {
    for (const select of [projectSelect, indexProjectSelect]) {
      if (!select) continue;
      const previous = select.value;
      const selected = projects.some(project => project.id === previous) ? previous : activeProjectId;
      select.replaceChildren();
      for (const project of projects) {
        const option = document.createElement("option");
        option.value = project.id;
        option.textContent = select === projectSelect ? `${project.name} — ${project.path}` : project.name;
        option.selected = project.id === selected;
        select.append(option);
      }
      if (select === indexProjectSelect) select.dataset.previousProject = select.value;
    }
  }

  function renderTerminalShell() {
    terminalSection.replaceChildren();

    const projectRow = document.createElement("div");
    projectRow.className = "dm-tools-row";
    const projectLabel = document.createElement("label");
    projectLabel.textContent = "Registered project";
    projectSelect = document.createElement("select");
    projectLabel.append(projectSelect);
    projectRow.append(projectLabel);

    const sessionLabel = document.createElement("label");
    sessionLabel.textContent = "Saved sessions";
    savedSessionSelect = document.createElement("select");
    sessionLabel.append(savedSessionSelect);
    const refreshSessions = button("Refresh");
    projectRow.append(sessionLabel, refreshSessions);

    const persistenceRow = document.createElement("div");
    persistenceRow.className = "dm-tools-row";
    const persistLabel = document.createElement("label");
    persistLabel.className = "dm-terminal-persist-label";
    persistentSessionToggle = document.createElement("input");
    persistentSessionToggle.type = "checkbox";
    persistLabel.append(persistentSessionToggle, document.createTextNode("Keep running after DevMoter restarts (tmux)"));
    const nameLabel = document.createElement("label");
    nameLabel.textContent = "Session name";
    sessionNameInput = document.createElement("input");
    sessionNameInput.maxLength = 48;
    sessionNameInput.placeholder = "e.g. api-dev";
    nameLabel.append(sessionNameInput);
    persistenceRow.append(persistLabel, nameLabel);

    const actions = document.createElement("div");
    actions.className = "dm-terminal-actions";
    const start = button("Start / Reattach");
    start.classList.add("primary");
    const kill = button("Kill session");
    kill.classList.add("danger");
    const clearAuth = button("Forget password");
    actions.append(start, kill, clearAuth);

    terminalStatus = document.createElement("div");
    terminalStatus.className = "dm-terminal-status";
    terminalStatus.textContent = "Terminal is idle.";
    terminalStatus.setAttribute("role", "status");
    terminalStatus.setAttribute("aria-live", "polite");

    terminalShell = document.createElement("div");
    terminalShell.className = "dm-terminal-shell";
    terminalShell.setAttribute("aria-label", "Terminal output");
    terminalPlaceholder = document.createElement("div");
    terminalPlaceholder.className = "dm-terminal-placeholder";
    const placeholderTitle = document.createElement("strong");
    placeholderTitle.textContent = "Ready when you are";
    const placeholderCopy = document.createElement("span");
    placeholderCopy.textContent = "Choose a registered project, then start or reattach a terminal session.";
    terminalPlaceholder.append(placeholderTitle, placeholderCopy);
    terminalShell.append(terminalPlaceholder);

    const keyRow = document.createElement("div");
    keyRow.className = "dm-key-row";
    const keys: Array<[string, string, string]> = [
      ["Esc", "\u001b", "Escape"],
      ["Tab", "\t", "Tab"],
      ["Ctrl+C", "\u0003", "Send Ctrl+C"],
      ["Ctrl+D", "\u0004", "Send Ctrl+D"],
      ["Ctrl+Z", "\u001a", "Send Ctrl+Z"],
      ["←", "\u001b[D", "Left arrow"],
      ["↑", "\u001b[A", "Up arrow"],
      ["↓", "\u001b[B", "Down arrow"],
      ["→", "\u001b[C", "Right arrow"],
      ["Home", "\u001b[H", "Home"],
      ["End", "\u001b[F", "End"],
      ["PgUp", "\u001b[5~", "Page up"],
      ["PgDn", "\u001b[6~", "Page down"]
    ];
    for (const [label, sequence, aria] of keys) {
      const key = button(label, aria);
      key.addEventListener("click", () => terminalView?.input(sequence, true));
      keyRow.append(key);
    }

    const note = document.createElement("div");
    note.className = "dm-tools-note";
    note.textContent =
      "PTY cwd is resolved from the registered Project ID. The terminal stays active when this panel closes; the page reconnects through a short-lived single-use ticket.";

    terminalSection.append(projectRow, persistenceRow, actions, terminalStatus, terminalShell, keyRow, note);

    projectSelect.addEventListener("change", () => {
      activeProjectId = projectSelect.value;
      localStorage.setItem("opencode-pocket-project", activeProjectId);
      if (indexProjectSelect && indexProjectSelect.value !== activeProjectId) {
        indexProjectSelect.value = activeProjectId;
        indexProjectSelect.dispatchEvent(new Event("change"));
      }
    });
    refreshSessions.addEventListener("click", () => {
      void refreshTerminalSessions().catch(showTerminalLoadError);
    });
    savedSessionSelect.addEventListener("change", () => {
      if (savedSessionSelect.value) void claimAndAttachSession(savedSessionSelect.value);
    });
    persistentSessionToggle.addEventListener("change", () => {
      sessionNameInput.disabled = !persistentSessionToggle.checked;
    });
    sessionNameInput.disabled = true;
    start.addEventListener("click", () => {
      setTerminalControlsBusy(true);
      terminalStatus.textContent = "Preparing terminal…";
      void startOrReattachTerminal().catch(error => {
        terminalStatus.textContent = `Could not start terminal · ${error instanceof Error ? error.message : String(error)}`;
      }).finally(() => { setTerminalControlsBusy(false); });
    });
    kill.addEventListener("click", () => {
      setTerminalControlsBusy(true);
      void killTerminal().catch(error => {
        terminalStatus.textContent = `Could not kill terminal · ${error instanceof Error ? error.message : String(error)}`;
      }).finally(() => { setTerminalControlsBusy(false); });
    });
    clearAuth.addEventListener("click", () => {
      sessionStorage.removeItem(TERMINAL_AUTH_KEY);
      terminalStatus.textContent = "Stored terminal password cleared for this browser tab.";
    });
    setTerminalControlsBusy = busy => {
      start.disabled = busy;
      kill.disabled = busy;
      savedSessionSelect.disabled = busy;
      refreshSessions.disabled = busy;
      projectSelect.disabled = busy;
      persistentSessionToggle.disabled = busy;
      sessionNameInput.disabled = busy || !persistentSessionToggle.checked;
    };
    renderProjectOptions();
  }

  async function ensureTerminalRenderer() {
    if (terminalView) return;
    if (!rendererPromise) {
      rendererPromise = (async () => {
        const [{ Terminal }, { FitAddon }] = await Promise.all([
          import("@xterm/xterm"),
          import("@xterm/addon-fit")
        ]);
        if (terminalView) return;
        const view = new Terminal({
          cursorBlink: true,
          scrollback: 5000,
          fontSize: 13,
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
          theme: { background: "#070809", foreground: "#e7e7ea", cursor: "#e7e7ea" },
          disableStdin: true
        });
        const fit = new FitAddon();
        view.loadAddon(fit);
        view.open(terminalShell);
        view.onData(data => {
          if (terminalSocket?.readyState === WebSocket.OPEN) {
            terminalSocket.send(JSON.stringify({ type: "input", data }));
          }
        });
        view.onResize(({ cols, rows }) => {
          if (terminalSocket?.readyState === WebSocket.OPEN) {
            terminalSocket.send(JSON.stringify({ type: "resize", cols, rows }));
          }
        });
        terminalView = view;
        terminalFit = fit;
        terminalPlaceholder.remove();
        terminalResizeObserver = new ResizeObserver(() => fitTerminal());
        terminalResizeObserver.observe(terminalShell);
      })().catch(error => {
        rendererPromise = null;
        throw error;
      });
    }
    await rendererPromise;
    fitTerminal();
  }

  function fitTerminal() {
    if (!terminalView || !terminalFit || panel.classList.contains("hidden")) return;
    window.requestAnimationFrame(() => {
      if (!terminalView || !terminalFit || panel.classList.contains("hidden")) return;
      try { terminalFit.fit(); } catch { return; }
      if (terminalSocket?.readyState === WebSocket.OPEN) {
        terminalSocket.send(JSON.stringify({ type: "resize", cols: terminalView.cols, rows: terminalView.rows }));
      }
    });
  }

  function disconnectTerminalSocket() {
    socketGeneration += 1;
    if (socketRetryTimer !== null) window.clearTimeout(socketRetryTimer);
    socketRetryTimer = null;
    socketConnecting = false;
    const socket = terminalSocket;
    terminalSocket = null;
    if (terminalView) terminalView.options.disableStdin = true;
    if (socket && socket.readyState < WebSocket.CLOSING) socket.close(1000, "Client detached.");
  }

  function scheduleTerminalReconnect(generation: number) {
    if (socketRetryTimer !== null) window.clearTimeout(socketRetryTimer);
    if (!terminalRecord || terminalRecord.session.closed || panel.classList.contains("hidden")) return;
    socketRetryTimer = window.setTimeout(() => {
      socketRetryTimer = null;
      if (generation === socketGeneration) void connectTerminalSocket();
    }, 700);
  }

  async function connectTerminalSocket() {
    if (!terminalRecord || panel.classList.contains("hidden") || terminalSocket || socketConnecting) return;
    socketConnecting = true;
    const generation = socketGeneration;
    const record = terminalRecord;
    try {
      const ticketResponse = await terminalFetch(
        `/api/terminal/sessions/${encodeURIComponent(record.session.id)}/socket-ticket`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-devmoter-terminal-token": record.token,
            "x-pocket-operation-id": `terminal-ticket-${uid()}`
          },
          body: "{}"
        }
      );
      const ticketPayload = await jsonOrError<{ ticket: string }>(ticketResponse);
      if (generation !== socketGeneration || panel.classList.contains("hidden") || terminalRecord !== record) return;

      const protocol = location.protocol === "https:" ? "wss:" : "ws:";
      const socketUrl = `${protocol}//${location.host}/api/terminal/sessions/${encodeURIComponent(record.session.id)}/socket?after=${lastSeq}`;
      const socket = new WebSocket(socketUrl, ["devmoter-terminal.v1", `devmoter-ticket.${ticketPayload.ticket}`]);
      terminalSocket = socket;
      socket.onopen = () => {
        if (generation !== socketGeneration || socket !== terminalSocket) {
          socket.close(1000, "Stale connection.");
          return;
        }
        socketConnecting = false;
        if (terminalView) terminalView.options.disableStdin = false;
        terminalStatus.textContent = `Connected · ${record.session.projectName} · ${record.session.cwd}`;
        fitTerminal();
      };
      socket.onmessage = event => {
        if (socket !== terminalSocket || typeof event.data !== "string") return;
        try {
          const chunk = JSON.parse(event.data) as TerminalChunk;
          if (typeof chunk.seq === "number") lastSeq = Math.max(lastSeq, chunk.seq);
          if (chunk.data) terminalView?.write(chunk.data);
        } catch {
          socket.close(1008, "Invalid terminal output.");
        }
      };
      socket.onerror = () => socket.close();
      socket.onclose = event => {
        if (socket === terminalSocket) terminalSocket = null;
        socketConnecting = false;
        if (event.reason === "Terminal process exited.") {
          record.session.closed = true;
          terminalStatus.textContent = "Terminal process exited.";
          saveTerminalRecord(record);
        }
        if (terminalView) terminalView.options.disableStdin = true;
        if (generation !== socketGeneration || panel.classList.contains("hidden")) return;
        if (record.session.closed) return;
        terminalStatus.textContent = "Terminal disconnected. Reconnecting…";
        scheduleTerminalReconnect(generation);
      };
    } catch (error) {
      socketConnecting = false;
      if (generation !== socketGeneration || panel.classList.contains("hidden")) return;
      terminalStatus.textContent = `Terminal reconnecting… ${error instanceof Error ? error.message : String(error)}`;
      scheduleTerminalReconnect(generation);
    } finally {
      if (!terminalSocket) socketConnecting = false;
    }
  }

  async function startOrReattachTerminal() {
    if (!activeProjectId) {
      terminalStatus.textContent = "Register/select a project first.";
      return;
    }

    if (terminalRecord) {
      try {
        await reattachTerminal();
        return;
      } catch {
        saveTerminalRecord(null);
        terminalRecord = null;
      }
    }

    const response = await terminalFetch("/api/terminal/sessions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-devmoter-terminal-entry": "explicit",
        "x-pocket-operation-id": `terminal-create-${uid()}`
      },
      body: JSON.stringify({
        projectId: activeProjectId,
        persistent: persistentSessionToggle.checked,
        name: persistentSessionToggle.checked ? sessionNameInput.value : undefined
      })
    });
    const payload = await jsonOrError<{ session: TerminalSession; token?: string }>(response);
    terminalRecord = { session: payload.session, token: payload.token || "" };
    saveTerminalRecord(terminalRecord);
    lastSeq = 0;
    terminalStatus.textContent = `Starting · ${payload.session.projectName} · ${payload.session.cwd}`;
    await ensureTerminalRenderer();
    terminalView?.reset();
    void connectTerminalSocket();
  }

  async function claimAndAttachSession(sessionId: string) {
    const session = savedTerminalSessions.find(item => item.id === sessionId);
    if (!session) return;
    setTerminalControlsBusy(true);
    terminalStatus.textContent = `Claiming ${session.name || "terminal session"}…`;
    try {
      const response = await terminalFetch(
        `/api/terminal/sessions/${encodeURIComponent(session.id)}/claim`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-devmoter-terminal-entry": "explicit",
            "x-pocket-operation-id": `terminal-claim-${uid()}`
          },
          body: "{}"
        }
      );
      const payload = await jsonOrError<{ session: TerminalSession }>(response);
      terminalRecord = { session: payload.session, token: "" };
      saveTerminalRecord(terminalRecord);
      lastSeq = 0;
      await ensureTerminalRenderer();
      terminalView?.reset();
      void connectTerminalSocket();
      await refreshTerminalSessions();
    } catch (error) {
      terminalStatus.textContent = `Could not attach session · ${error instanceof Error ? error.message : String(error)}`;
    } finally {
      setTerminalControlsBusy(false);
    }
  }

  async function reattachTerminal() {
    if (!terminalRecord) return;
    const response = await terminalFetch(
      `/api/terminal/sessions/${encodeURIComponent(terminalRecord.session.id)}`,
      {
        headers: {
          "x-devmoter-terminal-token": terminalRecord.token
        }
      }
    );
    const payload = await jsonOrError<{ session: TerminalSession }>(response);
    terminalRecord.session = payload.session;
    saveTerminalRecord(terminalRecord);
    lastSeq = Math.min(lastSeq, payload.session.seq);
    terminalStatus.textContent = payload.session.closed
      ? `Session closed · exit ${String(payload.session.exitCode ?? "")}`
      : `Reattached · ${payload.session.projectName} · ${payload.session.cwd}`;
    await ensureTerminalRenderer();
    void connectTerminalSocket();
  }

  async function killTerminal() {
    if (!terminalRecord) {
      terminalStatus.textContent = "No terminal session to kill.";
      return;
    }
    if (terminalRecord.session.persistent && !window.confirm(`Terminate persistent session “${terminalRecord.session.name || "Terminal"}”? Its background process will stop.`)) {
      return;
    }
    const response = await terminalFetch(
      `/api/terminal/sessions/${encodeURIComponent(terminalRecord.session.id)}`,
      {
        method: "DELETE",
        headers: {
          "x-devmoter-terminal-token": terminalRecord.token,
          "x-pocket-operation-id": `terminal-kill-${uid()}`
        }
      }
    );
    await jsonOrError(response);
    disconnectTerminalSocket();
    terminalStatus.textContent = "Terminal session killed.";
    saveTerminalRecord(null);
    terminalRecord = null;
  }

  async function renderSafety() {
    const revision = ++safetyRevision;
    let approvalList = safetySection.querySelector<HTMLElement>("[data-safety-approval-list]");
    if (!approvalList) {
      const scanner = document.createElement("div");
      scanner.className = "dm-tools-card";
      const scannerTitle = document.createElement("strong");
      scannerTitle.textContent = "High-risk command scan";
      const command = document.createElement("textarea");
      command.setAttribute("aria-label", "Command to scan");
      command.placeholder = "Paste a command to inspect before approval…";
      const scanButton = button("Scan");
      scanButton.classList.add("primary");
      const scanResult = document.createElement("pre");
      scanResult.setAttribute("role", "status");
      scanResult.setAttribute("aria-live", "polite");
      scanButton.addEventListener("click", () => {
        scanButton.disabled = true;
        scanResult.textContent = "Scanning command…";
        void (async () => {
          try {
            const response = await fetch("/api/safety/command-scan", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ command: command.value })
            });
            const payload = await jsonOrError<{
              command: string;
              dangerous: boolean;
              risk: string;
              reasons: string[];
              note: string;
            }>(response);
            scanner.classList.toggle("dm-risk-high", payload.dangerous === true);
            scanner.classList.toggle("dm-risk-low", payload.dangerous === false);
            const risk = typeof payload.risk === "string" && payload.risk ? payload.risk : "Unknown";
            const returnedCommand = typeof payload.command === "string" ? payload.command : "(not returned)";
            const reasons = Array.isArray(payload.reasons) ? payload.reasons.filter(reason => typeof reason === "string") : [];
            scanResult.textContent = [
              `Risk: ${risk}`,
              `Command: ${returnedCommand}`,
              ...reasons.map(reason => `• ${reason}`),
              ...(typeof payload.note === "string" && payload.note ? [payload.note] : [])
            ].join("\n");
          } catch (error) {
            scanner.classList.remove("dm-risk-high", "dm-risk-low");
            scanResult.textContent = error instanceof Error ? error.message : String(error);
          } finally {
            scanButton.disabled = false;
          }
        })();
      });
      scanner.append(scannerTitle, command, scanButton, scanResult);

      const approvals = document.createElement("div");
      approvals.className = "dm-tools-card";
      const approvalsTitle = document.createElement("strong");
      approvalsTitle.textContent = "Remembered approvals";
      approvalList = document.createElement("div");
      approvalList.className = "dm-tools-list";
      approvalList.dataset.safetyApprovalList = "true";
      approvals.append(approvalsTitle, approvalList);
      safetySection.append(scanner, approvals);
    }
    approvalList.replaceChildren();

    try {
      const response = await fetch("/api/safety/permissions", { cache: "no-store" });
      const payload = await jsonOrError<{ rules?: PermissionRule[] }>(response);
      if (revision !== safetyRevision) return;
      const rules = payload.rules || [];
      if (!rules.length) {
        const empty = document.createElement("small");
        empty.textContent = "No remembered approvals.";
        approvalList.append(empty);
      }
      for (const rule of rules) {
        const row = document.createElement("div");
        row.className = "dm-tools-card";
        const name = document.createElement("strong");
        name.textContent = `${rule.scope.backend || "backend"} · ${rule.scope.tool || "tool"}`;
        const detail = document.createElement("pre");
        detail.textContent = scopeSummary(rule);
        const revoke = button("Revoke");
        revoke.addEventListener("click", () => {
          revoke.disabled = true;
          void (async () => {
            try {
              const response = await fetch(`/api/safety/permissions/${encodeURIComponent(rule.id)}`, {
                method: "DELETE",
                headers: { "x-pocket-operation-id": `permission-revoke-${uid()}` }
              });
              await jsonOrError(response);
              await renderSafety();
            } catch (error) {
              const fail = document.createElement("small");
              fail.textContent = error instanceof Error ? error.message : String(error);
              row.append(fail);
              revoke.disabled = false;
            }
          })();
        });
        row.append(name, detail, revoke);
        approvalList.append(row);
      }
    } catch (error) {
      if (revision !== safetyRevision) return;
      const fail = document.createElement("small");
      fail.textContent = error instanceof Error ? error.message : String(error);
      approvalList.append(fail);
    }
  }
  refreshSafetyView = renderSafety;

  async function renderIndex() {
    indexSection.replaceChildren();

    const row = document.createElement("div");
    row.className = "dm-tools-row";
    const label = document.createElement("label");
    label.textContent = "Project";
    const select = document.createElement("select");
    indexProjectSelect = select;
    renderProjectOptions();
    select.dataset.previousProject = select.value;
    label.append(select);
    row.append(label);

    const excludeLabel = document.createElement("label");
    excludeLabel.textContent = "Extra excludes (comma-separated)";
    const excludes = document.createElement("input");
    excludes.placeholder = "private, fixtures/secrets";
    let excludesTouched = false;
    const excludesDrafts = new Map<string, string>();
    excludes.addEventListener("input", () => {
      excludesTouched = true;
      excludesDrafts.set(select.value, excludes.value);
    });
    excludeLabel.append(excludes);

    const actions = document.createElement("div");
    actions.className = "dm-tools-row";
    const rebuild = button("Rebuild index");
    const remove = button("Delete index");
    const showMap = button("Repo map");
    actions.append(rebuild, remove, showMap);

    const searchLabel = document.createElement("label");
    searchLabel.textContent = "Local full-text search";
    const query = document.createElement("input");
    query.placeholder = "symbol, filename, phrase…";
    searchLabel.append(query);
    const searchButton = button("Search");

    const status = document.createElement("div");
    status.className = "dm-terminal-status";
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    const results = document.createElement("div");
    results.className = "dm-tools-list";

    indexSection.append(row, excludeLabel, actions, searchLabel, searchButton, status, results);

    const currentProject = () => select.value || activeProjectId;
    let projectRevision = 0;

    async function refreshStatus() {
      if (!currentProject()) return;
      const projectId = currentProject();
      const revision = projectRevision;
      status.textContent = "Loading index status…";
      try {
        const response = await fetch(
          `/api/projects/${encodeURIComponent(projectId)}/index/status`,
          { cache: "no-store" }
        );
        const payload = await jsonOrError<{
          ready: boolean;
          builtAt?: number;
          files?: number;
          indexedBytes?: number;
          reusedFiles?: number;
          exclude?: string[];
        }>(response);
        if (revision !== projectRevision || projectId !== currentProject()) return;
        status.textContent = payload.ready
          ? `Ready · ${payload.files || 0} files · ${Math.round((payload.indexedBytes || 0) / 1024)} KiB · ${payload.reusedFiles || 0} reused on last rebuild`
          : "Index not built.";
        if (payload.exclude?.length && !excludesTouched) excludes.value = payload.exclude.join(", ");
      } catch (error) {
        if (revision === projectRevision && projectId === currentProject()) {
          status.textContent = error instanceof Error ? error.message : String(error);
        }
      }
    }
    refreshIndexView = refreshStatus;

    select.addEventListener("change", () => {
      excludesDrafts.set(select.dataset.previousProject || "", excludes.value);
      const nextProject = select.value;
      select.dataset.previousProject = nextProject;
      activeProjectId = select.value;
      projectRevision += 1;
      results.replaceChildren();
      excludesTouched = excludesDrafts.has(nextProject);
      excludes.value = excludesDrafts.get(nextProject) || "";
      localStorage.setItem("opencode-pocket-project", activeProjectId);
      if (projectSelect && projects.some(project => project.id === activeProjectId)) projectSelect.value = activeProjectId;
      void refreshStatus().catch(() => {});
    });

    rebuild.addEventListener("click", async () => {
      const projectId = currentProject();
      const revision = projectRevision;
      results.replaceChildren();
      status.textContent = "Building local index…";
      rebuild.disabled = true;
      remove.disabled = true;
      select.disabled = true;
      try {
        const exclude = excludes.value.split(",").map(value => value.trim()).filter(Boolean);
        const response = await fetch(
          `/api/projects/${encodeURIComponent(projectId)}/index/rebuild`,
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "x-pocket-operation-id": `index-rebuild-${uid()}`
            },
            body: JSON.stringify({ exclude })
          }
        );
        const payload = await jsonOrError<{ files: number; indexedBytes: number; reusedFiles: number }>(response);
        if (revision === projectRevision && projectId === currentProject()) {
          status.textContent =
            `Built · ${payload.files} files · ${Math.round(payload.indexedBytes / 1024)} KiB · ${payload.reusedFiles} unchanged files reused`;
        }
      } catch (error) {
        if (revision === projectRevision) status.textContent = error instanceof Error ? error.message : String(error);
      } finally {
        rebuild.disabled = false;
        remove.disabled = false;
        select.disabled = false;
      }
    });

    remove.addEventListener("click", async () => {
      const projectId = currentProject();
      const revision = projectRevision;
      remove.disabled = true;
      rebuild.disabled = true;
      select.disabled = true;
      status.textContent = "Deleting project index…";
      try {
        const response = await fetch(
          `/api/projects/${encodeURIComponent(projectId)}/index`,
          {
            method: "DELETE",
            headers: { "x-pocket-operation-id": `index-delete-${uid()}` }
          }
        );
        await jsonOrError(response);
        if (revision === projectRevision && projectId === currentProject()) {
          results.replaceChildren();
          status.textContent = "Index deleted.";
        }
      } catch (error) {
        if (revision === projectRevision) status.textContent = error instanceof Error ? error.message : String(error);
      } finally {
        remove.disabled = false;
        rebuild.disabled = false;
        select.disabled = false;
      }
    });

    searchButton.addEventListener("click", async () => {
      const projectId = currentProject();
      const revision = projectRevision;
      results.replaceChildren();
      status.textContent = "Searching local index…";
      searchButton.disabled = true;
      try {
        const response = await fetch(
          `/api/projects/${encodeURIComponent(projectId)}/index/search?q=${encodeURIComponent(query.value)}`,
          { cache: "no-store" }
        );
        const payload = await jsonOrError<{
          results?: Array<{ path: string; line: number; snippet: string; score: number }>;
        }>(response);
        if (revision !== projectRevision || projectId !== currentProject()) return;
        status.textContent = `${(payload.results || []).length} search result${(payload.results || []).length === 1 ? "" : "s"}.`;
        for (const item of payload.results || []) {
          const card = document.createElement("div");
          card.className = "dm-tools-card";
          const name = document.createElement("strong");
          name.textContent = `${item.path}:${item.line}`;
          const snippet = document.createElement("pre");
          snippet.textContent = item.snippet;
          card.append(name, snippet);
          results.append(card);
        }
        if (!(payload.results || []).length) {
          const empty = document.createElement("small");
          empty.textContent = "No matches.";
          results.append(empty);
        }
      } catch (error) {
        if (revision === projectRevision) status.textContent = error instanceof Error ? error.message : String(error);
      } finally {
        searchButton.disabled = false;
      }
    });

    showMap.addEventListener("click", async () => {
      const projectId = currentProject();
      const revision = projectRevision;
      results.replaceChildren();
      status.textContent = "Loading repository map…";
      showMap.disabled = true;
      try {
        const response = await fetch(
          `/api/projects/${encodeURIComponent(projectId)}/map`,
          { cache: "no-store" }
        );
        const payload = await jsonOrError<{
          directories?: Array<{ path: string; fileCount: number }>;
          symbols?: Array<{ name: string; kind: string; path: string; line: number }>;
        }>(response);
        if (revision !== projectRevision || projectId !== currentProject()) return;
        status.textContent = "Repository map loaded.";
        const directoryCard = document.createElement("div");
        directoryCard.className = "dm-tools-card";
        const directoryTitle = document.createElement("strong");
        directoryTitle.textContent = "Structure";
        const directoryText = document.createElement("pre");
        directoryText.textContent = (payload.directories || [])
          .slice(0, 120)
          .map(item => `${item.path}  (${item.fileCount})`)
          .join("\n");
        directoryCard.append(directoryTitle, directoryText);
        results.append(directoryCard);

        const symbolCard = document.createElement("div");
        symbolCard.className = "dm-tools-card";
        const symbolTitle = document.createElement("strong");
        symbolTitle.textContent = "Symbols";
        const symbolText = document.createElement("pre");
        symbolText.textContent = (payload.symbols || [])
          .slice(0, 220)
          .map(item => `${item.kind} ${item.name} — ${item.path}:${item.line}`)
          .join("\n");
        symbolCard.append(symbolTitle, symbolText);
        results.append(symbolCard);
      } catch (error) {
        if (revision === projectRevision) status.textContent = error instanceof Error ? error.message : String(error);
      } finally {
        showMap.disabled = false;
      }
    });

    await refreshStatus().catch(error => {
      status.textContent = error instanceof Error ? error.message : String(error);
    });
  }

  renderTerminalShell();
  void loadProjects().then(() => {
    renderProjectOptions();
    if (indexInitialized && !indexSection.classList.contains("hidden")) void refreshIndexView?.();
    return refreshTerminalSessions();
  }).catch(showTerminalLoadError);
}
