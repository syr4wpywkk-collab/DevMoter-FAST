import "./control-center.css";

type ProjectSummary = {
  id: string;
  name: string;
  path: string;
  available?: boolean;
};

type TerminalSession = {
  id: string;
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

function delay(ms: number) {
  return new Promise<void>(resolve => window.setTimeout(resolve, ms));
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
    if (!parsed?.session?.id || !parsed?.token) return null;
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
    cache: "no-store"
  });

  if (response.status === 401 && retryAuth) {
    sessionStorage.removeItem(TERMINAL_AUTH_KEY);
    const next = terminalAuthorization(true);
    if (next) {
      headers.set("authorization", next);
      response = await fetch(path, {
        ...init,
        headers,
        cache: "no-store"
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

  const panel = document.createElement("aside");
  panel.className = "dm-tools-panel hidden";
  panel.setAttribute("aria-label", "DevMoter tools");

  const head = document.createElement("div");
  head.className = "dm-tools-head";
  const title = document.createElement("strong");
  title.textContent = "DevMoter Tools";
  const close = button("×", "Close DevMoter tools");
  head.append(title, close);

  const tabs = document.createElement("div");
  tabs.className = "dm-tools-tabs";
  const terminalTab = button("Terminal");
  const safetyTab = button("Safety");
  const indexTab = button("Project Index");
  terminalTab.classList.add("active");
  tabs.append(terminalTab, safetyTab, indexTab);

  const body = document.createElement("div");
  body.className = "dm-tools-body";

  const terminalSection = document.createElement("section");
  terminalSection.className = "dm-tools-section";
  const safetySection = document.createElement("section");
  safetySection.className = "dm-tools-section hidden";
  const indexSection = document.createElement("section");
  indexSection.className = "dm-tools-section hidden";
  body.append(terminalSection, safetySection, indexSection);

  panel.append(head, tabs, body);
  document.body.append(launcher, panel);

  let projects: ProjectSummary[] = [];
  let activeProjectId = localStorage.getItem("opencode-pocket-project") || "";
  let terminalRecord = loadTerminalRecord();
  let terminalInput: HTMLInputElement;
  let terminalFallback: HTMLPreElement | null = null;
  let terminalShell: HTMLDivElement;
  let terminalStatus: HTMLDivElement;
  let projectSelect: HTMLSelectElement;
  let streamAbort: AbortController | null = null;
  let lastSeq = 0;
  let inputQueue = "";
  let inputTimer: number | null = null;
  let ctrlArmed = false;
  let ctrlButton: HTMLButtonElement | null = null;

  function setTab(next: "terminal" | "safety" | "index") {
    terminalTab.classList.toggle("active", next === "terminal");
    safetyTab.classList.toggle("active", next === "safety");
    indexTab.classList.toggle("active", next === "index");
    terminalSection.classList.toggle("hidden", next !== "terminal");
    safetySection.classList.toggle("hidden", next !== "safety");
    indexSection.classList.toggle("hidden", next !== "index");

    if (next === "safety") {
      void renderSafety();
    } else {
      void renderIndex();
    }
  }

  launcher.addEventListener("click", () => {
    panel.classList.remove("hidden");
    void loadProjects().then(() => {
      renderProjectOptions();
      if (terminalRecord) void reattachTerminal();
    });
  });
  close.addEventListener("click", () => {
    panel.classList.add("hidden");
    streamAbort?.abort();
    streamAbort = null;
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

  function renderProjectOptions() {
    if (!projectSelect) return;
    projectSelect.replaceChildren();
    for (const project of projects) {
      const option = document.createElement("option");
      option.value = project.id;
      option.textContent = `${project.name} — ${project.path}`;
      option.selected = project.id === activeProjectId;
      projectSelect.append(option);
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

    const actions = document.createElement("div");
    actions.className = "dm-terminal-actions";
    const start = button("Start / Reattach");
    const kill = button("Kill session");
    kill.classList.add("danger");
    const clearAuth = button("Forget password");
    actions.append(start, kill, clearAuth);

    terminalStatus = document.createElement("div");
    terminalStatus.className = "dm-terminal-status";
    terminalStatus.textContent = "Terminal is idle.";

    terminalShell = document.createElement("div");
    terminalShell.className = "dm-terminal-shell";

    const keyRow = document.createElement("div");
    keyRow.className = "dm-key-row";
    const keys: Array<[string, string, string]> = [
      ["Esc", "\u001b", "Escape"],
      ["Tab", "\t", "Tab"],
      ["Ctrl", "", "Control modifier"],
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
      if (label === "Ctrl") {
        ctrlButton = key;
        key.addEventListener("click", () => {
          ctrlArmed = !ctrlArmed;
          key.classList.toggle("active", ctrlArmed);
          terminalInput?.focus();
        });
      } else {
        key.addEventListener("click", () => {
          queueTerminalInput(sequence);
          terminalInput?.focus();
        });
      }
      keyRow.append(key);
    }

    const note = document.createElement("div");
    note.className = "dm-tools-note";
    note.textContent =
      "PTY cwd is resolved from the registered Project ID on the server. The shell session survives panel close/reload until you kill it or the shell exits.";

    const inputRow = document.createElement("form");
    inputRow.className = "dm-terminal-input";
    terminalInput = document.createElement("input");
    terminalInput.type = "text";
    terminalInput.autocomplete = "off";
    terminalInput.spellcheck = false;
    terminalInput.placeholder = "Terminal input";
    const sendInput = button("Send");
    inputRow.append(terminalInput, sendInput);
    inputRow.addEventListener("submit", event => {
      event.preventDefault();
      if (!terminalInput.value) return;
      queueTerminalInput(terminalInput.value + "\n");
      terminalInput.value = "";
      terminalInput.focus();
    });

    terminalSection.append(projectRow, actions, terminalStatus, terminalShell, inputRow, keyRow, note);

    projectSelect.addEventListener("change", () => {
      activeProjectId = projectSelect.value;
      localStorage.setItem("opencode-pocket-project", activeProjectId);
    });
    start.addEventListener("click", () => void startOrReattachTerminal());
    kill.addEventListener("click", () => void killTerminal());
    clearAuth.addEventListener("click", () => {
      sessionStorage.removeItem(TERMINAL_AUTH_KEY);
      terminalStatus.textContent = "Stored terminal password cleared for this browser tab.";
    });
    renderProjectOptions();
  }

  async function ensureTerminalRenderer() {
    if (terminalFallback) return;
    terminalFallback = document.createElement("pre");
    terminalFallback.className = "dm-terminal-fallback";
    terminalFallback.textContent = "";
    terminalShell.append(terminalFallback);
  }

  function writeTerminal(data: string) {
    if (terminalFallback) {
      terminalFallback.textContent += data;
      if (terminalFallback.textContent.length > 200_000) {
        terminalFallback.textContent = terminalFallback.textContent.slice(-160_000);
      }
      terminalFallback.scrollTop = terminalFallback.scrollHeight;
    }
  }

  function queueTerminalInput(data: string) {
    if (!terminalRecord || terminalRecord.session.closed || !data) return;
    inputQueue += data;
    if (inputTimer !== null) return;
    inputTimer = window.setTimeout(() => {
      inputTimer = null;
      void flushTerminalInput();
    }, 24);
  }

  async function flushTerminalInput() {
    if (!terminalRecord || !inputQueue) return;
    const data = inputQueue;
    inputQueue = "";
    const response = await terminalFetch(
      `/api/terminal/sessions/${encodeURIComponent(terminalRecord.session.id)}/input`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-devmoter-terminal-token": terminalRecord.token,
          "x-pocket-operation-id": `terminal-input-${uid()}`
        },
        body: JSON.stringify({ data })
      }
    );
    if (!response.ok) {
      const payload = await response.json().catch(() => ({})) as { error?: string };
      terminalStatus.textContent = payload.error || `Terminal input failed (HTTP ${response.status}).`;
    }
  }

  async function startOrReattachTerminal() {
    if (!activeProjectId) {
      terminalStatus.textContent = "Register/select a project first.";
      return;
    }

    if (terminalRecord && !terminalRecord.session.closed) {
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
      body: JSON.stringify({ projectId: activeProjectId })
    });
    const payload = await jsonOrError<{ session: TerminalSession; token: string }>(response);
    terminalRecord = { session: payload.session, token: payload.token };
    saveTerminalRecord(terminalRecord);
    lastSeq = 0;
    terminalStatus.textContent = `Connected · ${payload.session.projectName} · ${payload.session.cwd}`;
    await ensureTerminalRenderer();
    void attachTerminalStream();
    terminalInstance?.focus();
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
    void attachTerminalStream();
  }

  async function attachTerminalStream() {
    if (!terminalRecord) return;
    streamAbort?.abort();
    const controller = new AbortController();
    streamAbort = controller;

    let replayClosed = Boolean(terminalRecord.session.closed);
    while (
      terminalRecord &&
      (replayClosed || !terminalRecord.session.closed) &&
      !controller.signal.aborted &&
      !panel.classList.contains("hidden")
    ) {
      replayClosed = false;
      try {
        const response = await terminalFetch(
          `/api/terminal/sessions/${encodeURIComponent(terminalRecord.session.id)}/stream?after=${lastSeq}`,
          {
            headers: {
              "x-devmoter-terminal-token": terminalRecord.token
            },
            signal: controller.signal
          },
          false
        );
        if (!response.ok || !response.body) {
          if (response.status === 401) {
            sessionStorage.removeItem(TERMINAL_AUTH_KEY);
            terminalAuthorization(true);
          }
          throw new Error(`Stream HTTP ${response.status}`);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (!controller.signal.aborted) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let newline = buffer.indexOf("\n");
          while (newline >= 0) {
            const line = buffer.slice(0, newline).trim();
            buffer = buffer.slice(newline + 1);
            newline = buffer.indexOf("\n");
            if (!line) continue;
            const chunk = JSON.parse(line) as TerminalChunk;
            if (typeof chunk.seq === "number") lastSeq = Math.max(lastSeq, chunk.seq);
            if (chunk.data) writeTerminal(chunk.data);
          }
        }
      } catch (error) {
        if (controller.signal.aborted) return;
        terminalStatus.textContent =
          `Terminal stream reconnecting… ${error instanceof Error ? error.message : String(error)}`;
      }
      if (!controller.signal.aborted) await delay(700);
    }
  }

  async function killTerminal() {
    if (!terminalRecord) {
      terminalStatus.textContent = "No terminal session to kill.";
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
    streamAbort?.abort();
    terminalStatus.textContent = "Terminal session killed.";
    saveTerminalRecord(null);
    terminalRecord = null;
  }

  async function renderSafety() {
    safetySection.replaceChildren();

    const scanner = document.createElement("div");
    scanner.className = "dm-tools-card";
    const scannerTitle = document.createElement("strong");
    scannerTitle.textContent = "High-risk command scan";
    const command = document.createElement("textarea");
    command.placeholder = "Paste a command to inspect before approval…";
    const scanButton = button("Scan");
    const scanResult = document.createElement("pre");
    scanButton.addEventListener("click", async () => {
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
        scanner.classList.toggle("dm-risk-high", payload.dangerous);
        scanResult.textContent = [
          `Risk: ${payload.risk}`,
          `Command: ${payload.command || "(empty)"}`,
          ...(payload.reasons || []).map(reason => `• ${reason}`),
          payload.note
        ].join("\n");
      } catch (error) {
        scanResult.textContent = error instanceof Error ? error.message : String(error);
      }
    });
    scanner.append(scannerTitle, command, scanButton, scanResult);

    const approvals = document.createElement("div");
    approvals.className = "dm-tools-card";
    const approvalsTitle = document.createElement("strong");
    approvalsTitle.textContent = "Remembered approvals";
    const approvalList = document.createElement("div");
    approvalList.className = "dm-tools-list";
    approvals.append(approvalsTitle, approvalList);

    safetySection.append(scanner, approvals);

    try {
      const response = await fetch("/api/safety/permissions", { cache: "no-store" });
      const payload = await jsonOrError<{ rules?: PermissionRule[] }>(response);
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
        revoke.addEventListener("click", async () => {
          const response = await fetch(`/api/safety/permissions/${encodeURIComponent(rule.id)}`, {
            method: "DELETE",
            headers: { "x-pocket-operation-id": `permission-revoke-${uid()}` }
          });
          await jsonOrError(response);
          await renderSafety();
        });
        row.append(name, detail, revoke);
        approvalList.append(row);
      }
    } catch (error) {
      const fail = document.createElement("small");
      fail.textContent = error instanceof Error ? error.message : String(error);
      approvalList.append(fail);
    }
  }

  async function renderIndex() {
    indexSection.replaceChildren();

    const row = document.createElement("div");
    row.className = "dm-tools-row";
    const label = document.createElement("label");
    label.textContent = "Project";
    const select = document.createElement("select");
    for (const project of projects) {
      const option = document.createElement("option");
      option.value = project.id;
      option.textContent = project.name;
      option.selected = project.id === activeProjectId;
      select.append(option);
    }
    label.append(select);
    row.append(label);

    const excludeLabel = document.createElement("label");
    excludeLabel.textContent = "Extra excludes (comma-separated)";
    const excludes = document.createElement("input");
    excludes.placeholder = "private, fixtures/secrets";
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
    const results = document.createElement("div");
    results.className = "dm-tools-list";

    indexSection.append(row, excludeLabel, actions, searchLabel, searchButton, status, results);

    const currentProject = () => select.value || activeProjectId;

    async function refreshStatus() {
      if (!currentProject()) return;
      const response = await fetch(
        `/api/projects/${encodeURIComponent(currentProject())}/index/status`,
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
      status.textContent = payload.ready
        ? `Ready · ${payload.files || 0} files · ${Math.round((payload.indexedBytes || 0) / 1024)} KiB · ${payload.reusedFiles || 0} reused on last rebuild`
        : "Index not built.";
      if (payload.exclude?.length) excludes.value = payload.exclude.join(", ");
    }

    select.addEventListener("change", () => {
      activeProjectId = select.value;
      localStorage.setItem("opencode-pocket-project", activeProjectId);
      void refreshStatus();
    });

    rebuild.addEventListener("click", async () => {
      results.replaceChildren();
      status.textContent = "Building local index…";
      try {
        const exclude = excludes.value.split(",").map(value => value.trim()).filter(Boolean);
        const response = await fetch(
          `/api/projects/${encodeURIComponent(currentProject())}/index/rebuild`,
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
        status.textContent =
          `Built · ${payload.files} files · ${Math.round(payload.indexedBytes / 1024)} KiB · ${payload.reusedFiles} unchanged files reused`;
      } catch (error) {
        status.textContent = error instanceof Error ? error.message : String(error);
      }
    });

    remove.addEventListener("click", async () => {
      const response = await fetch(
        `/api/projects/${encodeURIComponent(currentProject())}/index`,
        {
          method: "DELETE",
          headers: { "x-pocket-operation-id": `index-delete-${uid()}` }
        }
      );
      await jsonOrError(response);
      results.replaceChildren();
      status.textContent = "Index deleted.";
    });

    searchButton.addEventListener("click", async () => {
      results.replaceChildren();
      try {
        const response = await fetch(
          `/api/projects/${encodeURIComponent(currentProject())}/index/search?q=${encodeURIComponent(query.value)}`,
          { cache: "no-store" }
        );
        const payload = await jsonOrError<{
          results?: Array<{ path: string; line: number; snippet: string; score: number }>;
        }>(response);
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
        status.textContent = error instanceof Error ? error.message : String(error);
      }
    });

    showMap.addEventListener("click", async () => {
      results.replaceChildren();
      try {
        const response = await fetch(
          `/api/projects/${encodeURIComponent(currentProject())}/map`,
          { cache: "no-store" }
        );
        const payload = await jsonOrError<{
          directories?: Array<{ path: string; fileCount: number }>;
          symbols?: Array<{ name: string; kind: string; path: string; line: number }>;
        }>(response);
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
        status.textContent = error instanceof Error ? error.message : String(error);
      }
    });

    await refreshStatus().catch(error => {
      status.textContent = error instanceof Error ? error.message : String(error);
    });
  }

  renderTerminalShell();
  void loadProjects().then(renderProjectOptions).catch(() => {});
}
