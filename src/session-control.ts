import "./session-control.css";

type Backend = "codex" | "opencode";
type RunState = "running" | "waiting" | "idle" | "done" | "failed" | "interrupted" | "unknown";
type Message = { role: "user" | "assistant" | "system"; text: string };
type Session = {
  key: string;
  id: string;
  backend: Backend;
  title: string;
  project: string;
  projectId?: string;
  agent: string;
  model: string;
  status: RunState;
  updatedAt: number;
  tokens: number;
  turns: number;
  activeTurnId?: string | null;
  excerpt?: string;
};
type QueueItem = { id: string; sessionKey: string; text: string; createdAt: number };
type Budget = {
  maxTurns: number | null;
  maxTokens: number | null;
  baseTurns: number;
  baseTokens: number;
  createdAt: number;
  inheritedFrom?: string;
  stopReason?: string;
};
type Checkpoint = {
  id: string;
  sessionKey: string;
  title: string;
  messages: Message[];
  files: string[];
  sourcePoint: number;
  createdAt: number;
};
type EventLog = {
  id: string;
  sessionKey: string;
  type: "handoff" | "queue" | "budget" | "checkpoint" | "fork" | "rewind" | "side" | "restore";
  detail: string;
  createdAt: number;
  relatedSessionKey?: string;
};
type Owner = { owner: Backend; priorOwner?: Backend; changedAt: number };
type Store = {
  version: 1;
  queue: QueueItem[];
  budgets: Record<string, Budget>;
  checkpoints: Checkpoint[];
  events: EventLog[];
  owners: Record<string, Owner>;
  sideOrigins: Record<string, string>;
};

const STORAGE = "devmoter-session-control-v1";
const POLL_MS = 4000;
const SEARCH_LIMIT = 40;
const MAX_CONTEXT_MESSAGES = 80;
const MAX_CONTEXT_CHARS = 28000;

function uid() {
  return globalThis.crypto?.randomUUID?.() || Date.now().toString(36) + "-" + Math.random().toString(36).slice(2);
}

function emptyStore(): Store {
  return { version: 1, queue: [], budgets: {}, checkpoints: [], events: [], owners: {}, sideOrigins: {} };
}

function loadStore(): Store {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE) || "null");
    if (parsed?.version === 1) {
      return {
        ...emptyStore(),
        ...parsed,
        queue: Array.isArray(parsed.queue) ? parsed.queue : [],
        checkpoints: Array.isArray(parsed.checkpoints) ? parsed.checkpoints : [],
        events: Array.isArray(parsed.events) ? parsed.events : [],
        budgets: parsed.budgets || {},
        owners: parsed.owners || {},
        sideOrigins: parsed.sideOrigins || {}
      };
    }
  } catch {}
  return emptyStore();
}

function persist(store: Store) {
  store.events = store.events.slice(-300);
  store.checkpoints = store.checkpoints.slice(-24);
  localStorage.setItem(STORAGE, JSON.stringify(store));
}

async function requestJson<T = any>(url: string, init: RequestInit = {}): Promise<T> {
  const method = String(init.method || "GET").toUpperCase();
  const mutating = method !== "GET" && method !== "HEAD";
  const response = await fetch(url, {
    ...init,
    cache: method === "GET" ? "no-store" : undefined,
    headers: {
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...(mutating ? { "x-pocket-operation-id": uid() } : {}),
      ...(init.headers || {})
    }
  });
  if (response.status === 204) return undefined as T;
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.error?.message || payload?.error || payload?.message || "HTTP " + response.status);
  }
  return payload as T;
}

async function codexRpc<T = any>(method: string, params: Record<string, any> = {}): Promise<T> {
  const payload = await requestJson<{ result?: T }>("/api/codex/rpc", {
    method: "POST",
    body: JSON.stringify({ method, params })
  });
  return payload.result as T;
}

async function openCode<T = any>(path: string, init: RequestInit = {}, projectId?: string): Promise<T> {
  const payload = await requestJson<any>("/api/opencode" + path, {
    ...init,
    headers: {
      ...(projectId ? { "x-pocket-project-id": projectId } : {}),
      ...(init.headers || {})
    }
  });
  if (payload && typeof payload === "object" && !Array.isArray(payload) && Object.prototype.hasOwnProperty.call(payload, "data")) {
    return payload.data as T;
  }
  return payload as T;
}

function stateOf(value: unknown): RunState {
  const raw = typeof value === "string"
    ? value
    : value && typeof value === "object"
      ? String((value as any).type || (value as any).status || (value as any).state || "")
      : "";
  const text = raw.toLowerCase();
  if (/wait|approval|input|question/.test(text)) return "waiting";
  if (/run|work|progress|active|start/.test(text)) return "running";
  if (/fail|error/.test(text)) return "failed";
  if (/interrupt|cancel|abort|stop/.test(text)) return "interrupted";
  if (/complete|success|done|finish/.test(text)) return "done";
  if (/idle|ready/.test(text)) return "idle";
  return "unknown";
}

function countTokens(value: unknown): number {
  if (!value || typeof value !== "object") return 0;
  const obj = value as Record<string, any>;
  for (const key of ["totalTokens", "total_tokens", "total"]) {
    const n = Number(obj[key]);
    if (Number.isFinite(n) && n >= 0) return n;
  }
  const direct = ["inputTokens", "input_tokens", "outputTokens", "output_tokens", "reasoningTokens", "reasoning_tokens"]
    .map(key => Number(obj[key]))
    .filter(Number.isFinite);
  if (direct.length) return direct.reduce((a, b) => a + b, 0);
  let best = 0;
  for (const child of Object.values(obj)) best = Math.max(best, countTokens(child));
  return best;
}

function sessionKey(backend: Backend, id: string) {
  return backend + ":" + id;
}

function backendLabel(backend: Backend) {
  return backend === "codex" ? "Codex" : "OpenCode";
}

function compactMessages(messages: Message[]) {
  const selected = messages.slice(-MAX_CONTEXT_MESSAGES);
  let remaining = MAX_CONTEXT_CHARS;
  const out: Message[] = [];
  for (let i = selected.length - 1; i >= 0 && remaining > 0; i--) {
    const item = selected[i];
    const text = item.text.slice(0, remaining);
    remaining -= text.length;
    out.unshift({ ...item, text });
  }
  return out;
}

function fileRefs(messages: Message[]) {
  const found = new Set<string>();
  const re = /(?:^|\s)([./~][\w@%+.,:=~/-]+\.[A-Za-z0-9]{1,12}|[A-Za-z0-9_.-]+\/[A-Za-z0-9_./-]+\.[A-Za-z0-9]{1,12})/g;
  for (const message of messages) {
    for (const match of message.text.matchAll(re)) {
      const value = match[1]?.replace(/[)\],.;:'"]+$/, "");
      if (value) found.add(value);
    }
  }
  return [...found].slice(0, 80);
}

function handoffText(source: Session, messages: Message[], mode: string, note = "") {
  const files = fileRefs(messages);
  const lines = [
    "[DevMoter " + mode + "]",
    "Source backend: " + backendLabel(source.backend),
    "Source session: " + source.id,
    "Source project: " + (source.project || "unknown"),
    note ? "Instruction: " + note : "",
    files.length ? "Referenced files:\n" + files.map(file => "- " + file).join("\n") : "Referenced files: none detected",
    "",
    "Conversation context:"
  ].filter(Boolean);
  messages.forEach((message, index) => lines.push(String(index + 1) + ". " + message.role.toUpperCase() + ": " + message.text));
  return { text: lines.join("\n"), files };
}

function dom<K extends keyof HTMLElementTagNameMap>(tag: K, className = "", text = "") {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function button(text: string, handler: () => void, className = "") {
  const node = dom("button", className, text);
  node.type = "button";
  node.addEventListener("click", handler);
  return node;
}

export function mountSessionControl(options: { switchBackend(backend: Backend): void }) {
  let store = loadStore();
  let sessions: Session[] = [];
  let projects: Array<{ id: string; path: string; name: string }> = [];
  let searchSnippets = new Map<string, string>();
  let activeTab = "activity";
  let pollTimer: number | null = null;
  let busy = false;

  const shell = dom("div", "sc-shell");
  const fab = button("⌘", openPanel, "sc-fab");
  fab.setAttribute("aria-label", "Session Control");
  const scrim = dom("div", "sc-scrim hidden");
  const panel = dom("section", "sc-panel");
  panel.setAttribute("aria-hidden", "true");

  const head = dom("header", "sc-head");
  const headCopy = dom("div");
  headCopy.append(dom("strong", "", "Session Control"), dom("small", "", "#31–#40"));
  head.append(headCopy, button("×", closePanel, "sc-close"));

  const toolbar = dom("div", "sc-toolbar");
  const search = dom("input", "sc-search") as HTMLInputElement;
  search.type = "search";
  search.placeholder = "Search session text…";
  const backendFilter = dom("select", "sc-backend") as HTMLSelectElement;
  backendFilter.append(new Option("All agents", ""), new Option("Codex", "codex"), new Option("OpenCode", "opencode"));
  const projectFilter = dom("select", "sc-project") as HTMLSelectElement;
  projectFilter.append(new Option("All projects", ""));
  const statusFilter = dom("select", "sc-status") as HTMLSelectElement;
  ["", "running", "waiting", "idle", "done", "failed", "interrupted"].forEach(value => {
    statusFilter.append(new Option(value ? value[0].toUpperCase() + value.slice(1) : "All states", value));
  });
  toolbar.append(search, backendFilter, projectFilter, statusFilter, button("Refresh", () => void refresh(), "sc-refresh"));

  const tabs = dom("div", "sc-tabs");
  [["activity", "Activity"], ["queue", "Queue"], ["checkpoints", "Checkpoints"], ["history", "History"]].forEach(([value, label]) => {
    const b = button(label, () => {
      activeTab = value;
      tabs.querySelectorAll("button").forEach(item => item.classList.toggle("active", item === b));
      render();
    });
    b.dataset.tab = value;
    if (value === "activity") b.classList.add("active");
    tabs.append(b);
  });
  const queueCount = dom("span", "sc-queue-count");
  tabs.querySelector('[data-tab="queue"]')?.append(" ", queueCount);

  const body = dom("div", "sc-body");
  const toast = dom("div", "sc-toast hidden");
  panel.append(head, toolbar, tabs, body, toast);
  shell.append(fab, scrim, panel);
  document.body.append(shell);

  let toastTimer: number | null = null;
  function notify(message: string) {
    if (toastTimer !== null) clearTimeout(toastTimer);
    toast.textContent = message;
    toast.classList.remove("hidden");
    toastTimer = window.setTimeout(() => {
      toast.classList.add("hidden");
      toastTimer = null;
    }, 2600);
  }

  function save() {
    persist(store);
    queueCount.textContent = store.queue.length ? String(store.queue.length) : "";
  }

  function addEvent(event: Omit<EventLog, "id" | "createdAt">) {
    store.events.push({ id: uid(), createdAt: Date.now(), ...event });
    save();
  }

  function openPanel() {
    panel.classList.add("open");
    panel.setAttribute("aria-hidden", "false");
    scrim.classList.remove("hidden");
    void refresh();
  }

  function closePanel() {
    panel.classList.remove("open");
    panel.setAttribute("aria-hidden", "true");
    scrim.classList.add("hidden");
  }

  function findSession(key: string) {
    return sessions.find(session => session.key === key) || null;
  }

  async function codexDetail(id: string) {
    const payload = await codexRpc<any>("thread/read", { threadId: id, includeTurns: true });
    const turns = payload?.thread?.turns || [];
    const last = turns.at(-1);
    let status = stateOf(payload?.thread?.status);
    if (status === "unknown") status = stateOf(last?.status);
    if (status === "unknown") status = turns.length ? "done" : "idle";
    const active = [...turns].reverse().find((turn: any) => stateOf(turn?.status) === "running");
    return {
      payload,
      messages: codexMessages(payload),
      turns: turns.length,
      tokens: countTokens(payload?.thread?.usage || payload?.thread),
      status,
      activeTurnId: active?.id ? String(active.id) : null
    };
  }

  function codexMessages(payload: any): Message[] {
    const out: Message[] = [];
    for (const turn of payload?.thread?.turns || []) {
      for (const item of turn?.items || []) {
        if (item?.type === "userMessage") {
          const text = (Array.isArray(item.content) ? item.content : [])
            .filter((part: any) => part?.type === "text" && typeof part.text === "string")
            .map((part: any) => part.text)
            .join("");
          if (text) out.push({ role: "user", text });
        } else if (item?.type === "agentMessage" && typeof item.text === "string" && item.text) {
          out.push({ role: "assistant", text: item.text });
        }
      }
    }
    return out;
  }

  function openCodeMessages(list: any[]): Message[] {
    const out: Message[] = [];
    for (const item of Array.isArray(list) ? list : []) {
      if (item?.type === "user") {
        const text = String(item.text || "");
        if (text) out.push({ role: "user", text });
      } else if (item?.type === "assistant") {
        const text = (Array.isArray(item.content) ? item.content : [])
          .filter((part: any) => part?.type === "text")
          .map((part: any) => String(part.text || ""))
          .join("\n");
        if (text) out.push({ role: "assistant", text });
      } else {
        const role = item?.info?.role;
        if (role === "user" || role === "assistant") {
          const text = (Array.isArray(item.parts) ? item.parts : [])
            .filter((part: any) => part?.type === "text")
            .map((part: any) => String(part.text || ""))
            .join("\n");
          if (text) out.push({ role, text });
        }
      }
    }
    return out;
  }

  async function loadMessages(session: Session) {
    if (session.backend === "codex") return (await codexDetail(session.id)).messages;
    const list = await openCode<any[]>("/session/" + encodeURIComponent(session.id) + "/context", {}, session.projectId);
    return openCodeMessages(list);
  }

  async function metrics(session: Session) {
    if (session.backend === "codex") {
      const detail = await codexDetail(session.id);
      return { turns: detail.turns, tokens: detail.tokens, status: detail.status, activeTurnId: detail.activeTurnId };
    }
    const [list, activeRaw] = await Promise.all([
      openCode<any[]>("/session/" + encodeURIComponent(session.id) + "/context", {}, session.projectId),
      openCode<any>("/session/active", {}, session.projectId).catch(() => ({}))
    ]);
    const active = activeRaw?.data && typeof activeRaw.data === "object" ? activeRaw.data : activeRaw;
    const messages = openCodeMessages(list);
    return {
      turns: messages.filter(item => item.role === "user").length,
      tokens: Math.max(session.tokens, countTokens(list)),
      status: active && active[session.id] ? "running" as RunState : session.status === "running" ? "done" as RunState : session.status,
      activeTurnId: null
    };
  }

  async function refresh() {
    if (busy) return;
    busy = true;
    const refreshButton = toolbar.querySelector<HTMLButtonElement>(".sc-refresh");
    if (refreshButton) refreshButton.disabled = true;
    try {
      const projectPayload = await requestJson<{ projects?: Array<{ id: string; path: string; name: string; available?: boolean }> }>("/api/projects").catch(() => ({ projects: [] }));
      projects = (projectPayload.projects || []).filter(project => project.available !== false);

      const [codexList, openList, openActiveRaw] = await Promise.all([
        codexRpc<any>("thread/list", { limit: 60 }).catch(() => ({ data: [] })),
        openCode<any[]>("/session?limit=80&order=desc").catch(() => []),
        openCode<any>("/session/active").catch(() => ({}))
      ]);
      const activeRaw = openActiveRaw?.data && typeof openActiveRaw.data === "object" ? openActiveRaw.data : openActiveRaw;
      const codexThreads = codexList?.data || [];
      const codexBase: Session[] = codexThreads.map((thread: any) => ({
        key: sessionKey("codex", String(thread.id)),
        id: String(thread.id),
        backend: "codex",
        title: String(thread.name || thread.preview || "Untitled Codex thread"),
        project: String(thread.cwd || ""),
        agent: "Codex",
        model: String(thread.model || "default"),
        updatedAt: Number(thread.updatedAt || thread.updated_at || 0),
        status: "unknown",
        tokens: 0,
        turns: 0,
        excerpt: String(thread.preview || "")
      }));

      const details = await mapLimit(codexBase.slice(0, 24), 4, async session => {
        try {
          const detail = await codexDetail(session.id);
          return { ...session, status: detail.status, tokens: detail.tokens, turns: detail.turns, activeTurnId: detail.activeTurnId };
        } catch {
          return session;
        }
      });
      const detailMap = new Map(details.map(item => [item.key, item]));

      const openBase: Session[] = (Array.isArray(openList) ? openList : []).map((item: any) => {
        const id = String(item.id || "");
        const project = typeof item.location === "string" ? item.location : String(item.location?.directory || "");
        const tokenInfo = item.tokens || {};
        const tokens = Number(tokenInfo.input || 0) + Number(tokenInfo.output || 0) + Number(tokenInfo.reasoning || 0) + Number(tokenInfo.cache?.read || 0) + Number(tokenInfo.cache?.write || 0);
        return {
          key: sessionKey("opencode", id),
          id,
          backend: "opencode",
          title: String(item.title || "Untitled OpenCode session"),
          project,
          projectId: projects.find(entry => entry.path === project)?.id,
          agent: String(item.agent || "OpenCode"),
          model: String(item.model?.modelID || item.model?.id || "default"),
          updatedAt: Number(item.time?.updated || item.time?.created || 0),
          status: activeRaw && activeRaw[id] ? "running" : tokens > 0 ? "done" : "idle",
          tokens,
          turns: 0
        } as Session;
      });

      sessions = [...codexBase.map(item => detailMap.get(item.key) || item), ...openBase]
        .filter(item => item.id)
        .sort((a, b) => b.updatedAt - a.updatedAt);

      for (const session of sessions) {
        if (!store.owners[session.key]) store.owners[session.key] = { owner: session.backend, changedAt: session.updatedAt || Date.now() };
      }
      save();
      rebuildProjectFilter();
      render();
    } catch (error) {
      notify(error instanceof Error ? error.message : "Session refresh failed");
    } finally {
      busy = false;
      if (refreshButton) refreshButton.disabled = false;
    }
  }

  async function mapLimit<T, R>(items: T[], limit: number, mapper: (item: T, index: number) => Promise<R>) {
    const results = new Array<R>(items.length);
    let cursor = 0;
    const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (cursor < items.length) {
        const index = cursor++;
        results[index] = await mapper(items[index], index);
      }
    });
    await Promise.all(workers);
    return results;
  }

  function rebuildProjectFilter() {
    const current = projectFilter.value;
    const paths = [...new Set(sessions.map(session => session.project).filter(Boolean))].sort();
    projectFilter.replaceChildren(new Option("All projects", ""));
    paths.forEach(path => projectFilter.append(new Option(path.split("/").filter(Boolean).at(-1) || path, path)));
    if (paths.includes(current)) projectFilter.value = current;
  }

  function filteredSessions() {
    const query = search.value.trim().toLowerCase();
    return sessions.filter(session => {
      if (backendFilter.value && session.backend !== backendFilter.value) return false;
      if (projectFilter.value && session.project !== projectFilter.value) return false;
      if (statusFilter.value && session.status !== statusFilter.value) return false;
      if (!query) return true;
      const snippet = searchSnippets.get(session.key) || "";
      return [session.title, session.project, session.agent, session.model, session.excerpt || "", snippet]
        .join(" ").toLowerCase().includes(query);
    });
  }

  async function fullTextSearch() {
    const query = search.value.trim().toLowerCase();
    if (!query) {
      searchSnippets.clear();
      render();
      return;
    }
    notify("Searching local session transcripts…");
    const candidates = sessions.slice(0, SEARCH_LIMIT);
    await mapLimit(candidates, 4, async session => {
      try {
        const messages = await loadMessages(session);
        const hit = messages.find(message => message.text.toLowerCase().includes(query));
        if (!hit) {
          searchSnippets.delete(session.key);
          return;
        }
        const lower = hit.text.toLowerCase();
        const at = lower.indexOf(query);
        searchSnippets.set(session.key, hit.text.slice(Math.max(0, at - 80), at + query.length + 140));
      } catch {
        searchSnippets.delete(session.key);
      }
    });
    render();
  }

  function render() {
    queueCount.textContent = store.queue.length ? String(store.queue.length) : "";
    if (activeTab === "queue") return renderQueue();
    if (activeTab === "checkpoints") return renderCheckpoints();
    if (activeTab === "history") return renderHistory();
    renderActivity();
  }

  function renderActivity() {
    body.replaceChildren();
    const list = dom("div", "sc-list");
    const items = filteredSessions();
    if (!items.length) list.append(dom("div", "sc-empty", "No matching sessions."));
    items.forEach(session => list.append(sessionCard(session)));
    body.append(list);
  }

  function sessionCard(session: Session) {
    const card = dom("article", "sc-card");
    card.dataset.status = session.status;
    const head = dom("div", "sc-card-head");
    const copy = dom("div");
    copy.append(dom("strong", "", session.title), dom("small", "", backendLabel(session.backend) + " · " + session.agent + " · " + session.status));
    head.append(copy, dom("span", "sc-state " + session.status, session.status));

    const facts = dom("div", "sc-facts");
    const owner = store.owners[session.key] || { owner: session.backend, changedAt: 0 };
    facts.append(dom("span", "", "owner " + backendLabel(owner.owner) + (owner.priorOwner ? " ← " + backendLabel(owner.priorOwner) : "")));
    if (session.project) facts.append(dom("span", "", session.project.split("/").filter(Boolean).at(-1) || session.project));
    if (session.tokens) facts.append(dom("span", "", session.tokens.toLocaleString() + " tok"));
    const queued = store.queue.filter(item => item.sessionKey === session.key).length;
    if (queued) facts.append(dom("span", "", queued + " queued"));
    const budget = store.budgets[session.key];
    if (budget) facts.append(dom("span", "", budget.stopReason || "budget set"));

    const snippet = searchSnippets.get(session.key);
    const actions = dom("div", "sc-actions");
    actions.append(
      button("Open", () => openSession(session)),
      button("Queue", () => queuePrompt(session)),
      button("Handoff", () => void previewTransfer(session, "handoff")),
      button("More", () => showMore(session))
    );
    if (session.status === "running" || session.status === "waiting") {
      actions.append(button("Stop", () => void cancelRun(session), "danger"));
    }
    card.append(head, facts);
    if (snippet) card.append(dom("p", "sc-excerpt", snippet));
    card.append(actions);
    return card;
  }

  function openSession(session: Session) {
    localStorage.setItem("opencode-pocket-backend", session.backend);
    if (session.backend === "codex") localStorage.setItem("opencode-pocket-codex-thread", session.id);
    else localStorage.setItem("opencode-pocket-opencode-session", session.id);
    options.switchBackend(session.backend);
    closePanel();
    location.reload();
  }

  function queuePrompt(session: Session) {
    const text = window.prompt("Queue a follow-up for " + session.title)?.trim();
    if (!text) return;
    store.queue.push({ id: uid(), sessionKey: session.key, text, createdAt: Date.now() });
    addEvent({ sessionKey: session.key, type: "queue", detail: "Queued a follow-up instruction" });
    save();
    render();
    notify("Queued. It will dispatch when this session becomes idle.");
  }

  function renderQueue() {
    body.replaceChildren();
    if (!store.queue.length) {
      body.append(dom("div", "sc-empty", "No queued follow-ups."));
      return;
    }
    const list = dom("div", "sc-list");
    store.queue.forEach((item, index) => {
      const session = findSession(item.sessionKey);
      const card = dom("article", "sc-card");
      card.append(dom("strong", "", String(index + 1) + ". " + (session?.title || item.sessionKey)));
      const input = dom("textarea") as HTMLTextAreaElement;
      input.rows = 3;
      input.value = item.text;
      input.addEventListener("change", () => {
        item.text = input.value.trim();
        save();
      });
      const actions = dom("div", "sc-actions");
      actions.append(
        button("↑", () => moveQueue(index, -1)),
        button("↓", () => moveQueue(index, 1)),
        button("Cancel", () => {
          store.queue = store.queue.filter(entry => entry.id !== item.id);
          save();
          renderQueue();
        }, "danger")
      );
      card.append(input, actions);
      list.append(card);
    });
    body.append(list);
  }

  function moveQueue(index: number, delta: number) {
    const next = index + delta;
    if (next < 0 || next >= store.queue.length) return;
    [store.queue[index], store.queue[next]] = [store.queue[next], store.queue[index]];
    save();
    renderQueue();
  }

  async function cancelRun(session: Session) {
    try {
      if (session.backend === "codex") {
        const detail = await codexDetail(session.id);
        if (!detail.activeTurnId) throw new Error("No active Codex turn found");
        await codexRpc("turn/interrupt", { threadId: session.id, turnId: detail.activeTurnId });
      } else {
        await openCode("/session/" + encodeURIComponent(session.id) + "/interrupt", { method: "POST" }, session.projectId);
      }
      notify("Run interrupted");
      await refresh();
    } catch (error) {
      notify(error instanceof Error ? error.message : "Could not stop run");
    }
  }

  function showMore(session: Session) {
    body.replaceChildren();
    const wrap = dom("div", "sc-detail");
    wrap.append(button("‹ Activity", renderActivity), dom("h3", "", session.title));
    const grid = dom("div", "sc-menu-grid");
    grid.append(
      button("Set budget", () => void setBudget(session)),
      button("Checkpoint", () => void createCheckpoint(session)),
      button("Fork thread", () => void previewTransfer(session, "fork")),
      button("Safe rewind", () => void previewTransfer(session, "rewind")),
      button("Side conversation", () => void createSideConversation(session)),
      button("Handoff", () => void previewTransfer(session, "handoff"))
    );
    const sideKey = Object.entries(store.sideOrigins).find(([, origin]) => origin === session.key)?.[0];
    if (sideKey) {
      const side = findSession(sideKey);
      if (side) grid.append(button("Merge side result", () => void mergeSideResult(session, side)));
    }
    const history = dom("div", "sc-mini-history");
    const events = store.events.filter(event => event.sessionKey === session.key).slice(-8).reverse();
    if (!events.length) history.append(dom("div", "", "No control events yet."));
    events.forEach(event => history.append(dom("div", "", new Date(event.createdAt).toLocaleString() + " · " + event.type + " · " + event.detail)));
    wrap.append(grid, history);
    body.append(wrap);
  }

  async function setBudget(session: Session) {
    try {
      const current = await metrics(session);
      const turnRaw = window.prompt("Max additional turns (blank = unlimited)", store.budgets[session.key]?.maxTurns?.toString() || "6");
      if (turnRaw === null) return;
      const tokenRaw = window.prompt("Max additional tokens (blank = unlimited)", store.budgets[session.key]?.maxTokens?.toString() || "20000");
      if (tokenRaw === null) return;
      const maxTurns = turnRaw.trim() ? Number(turnRaw) : null;
      const maxTokens = tokenRaw.trim() ? Number(tokenRaw) : null;
      if ((maxTurns !== null && (!Number.isFinite(maxTurns) || maxTurns < 0)) || (maxTokens !== null && (!Number.isFinite(maxTokens) || maxTokens < 0))) {
        throw new Error("Budget must be a non-negative number");
      }
      store.budgets[session.key] = { maxTurns, maxTokens, baseTurns: current.turns, baseTokens: current.tokens, createdAt: Date.now() };
      addEvent({ sessionKey: session.key, type: "budget", detail: "Budget: " + (maxTurns ?? "∞") + " turns / " + (maxTokens ?? "∞") + " tokens" });
      save();
      render();
      notify("Budget saved");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Could not set budget");
    }
  }

  async function createCheckpoint(session: Session) {
    try {
      const messages = compactMessages(await loadMessages(session));
      if (!messages.length) throw new Error("Nothing to checkpoint yet");
      const checkpoint: Checkpoint = {
        id: uid(),
        sessionKey: session.key,
        title: session.title + " · " + new Date().toLocaleString(),
        messages,
        files: fileRefs(messages),
        sourcePoint: messages.length,
        createdAt: Date.now()
      };
      store.checkpoints.push(checkpoint);
      addEvent({ sessionKey: session.key, type: "checkpoint", detail: "Checkpoint created at message " + messages.length });
      save();
      render();
      notify("Checkpoint created");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Checkpoint failed");
    }
  }

  function renderCheckpoints() {
    body.replaceChildren();
    if (!store.checkpoints.length) {
      body.append(dom("div", "sc-empty", "No checkpoints yet."));
      return;
    }
    const list = dom("div", "sc-list");
    [...store.checkpoints].reverse().forEach(checkpoint => {
      const card = dom("article", "sc-card");
      card.append(dom("strong", "", checkpoint.title));
      card.append(dom("small", "", checkpoint.messages.length + " messages · " + checkpoint.files.length + " referenced files · non-destructive restore"));
      const actions = dom("div", "sc-actions");
      actions.append(
        button("Preview / restore", () => showCheckpoint(checkpoint)),
        button("Delete", () => {
          store.checkpoints = store.checkpoints.filter(item => item.id !== checkpoint.id);
          save();
          renderCheckpoints();
        }, "danger")
      );
      card.append(actions);
      list.append(card);
    });
    body.append(list);
  }

  function showCheckpoint(checkpoint: Checkpoint) {
    const source = findSession(checkpoint.sessionKey);
    if (!source) {
      notify("Source session is not currently available");
      return;
    }
    body.replaceChildren();
    const wrap = dom("div", "sc-preview");
    wrap.append(button("‹ Checkpoints", renderCheckpoints), dom("h3", "", "Restore checkpoint safely"));
    wrap.append(dom("p", "", "Restore creates a new thread from the saved context. It does not delete or overwrite unrelated workspace files."));
    const files = dom("pre");
    files.textContent = checkpoint.files.length ? checkpoint.files.join("\n") : "No referenced files detected";
    const preview = dom("pre");
    preview.textContent = checkpoint.messages.map((message, index) => String(index + 1) + ". " + message.role + ": " + message.text).join("\n\n");
    wrap.append(files, preview, button("Restore into new thread", () => void createFromContext(source, source.backend, checkpoint.messages, "checkpoint restore", "", checkpoint.sourcePoint).then(target => {
      if (!target) return;
      addEvent({ sessionKey: source.key, type: "restore", detail: "Restored checkpoint into " + target.key, relatedSessionKey: target.key });
      notify("Checkpoint restored into a new thread");
      void refresh();
    })));
    body.append(wrap);
  }

  async function previewTransfer(session: Session, mode: "handoff" | "fork" | "rewind") {
    try {
      const all = compactMessages(await loadMessages(session));
      if (!all.length) throw new Error("This session has no transferable context");
      let point = all.length;
      if (mode === "fork") {
        const raw = window.prompt("Fork after how many messages? (1-" + all.length + ")", String(all.length));
        if (raw === null) return;
        point = Number(raw);
      }
      if (mode === "rewind") {
        const max = Math.max(1, all.length - 1);
        const raw = window.prompt("Rewind to how many messages? (1-" + max + ")", String(Math.max(1, all.length - 2)));
        if (raw === null) return;
        point = Number(raw);
      }
      if (!Number.isInteger(point) || point < 1 || point > all.length || (mode === "rewind" && point >= all.length)) {
        throw new Error("That source point cannot be reconstructed safely");
      }
      const messages = all.slice(0, point);
      const targetBackend: Backend = mode === "handoff" ? (session.backend === "codex" ? "opencode" : "codex") : session.backend;
      const payload = handoffText(session, messages, mode, mode === "rewind" ? "Rewind excludes " + (all.length - point) + " later messages." : "");

      body.replaceChildren();
      const wrap = dom("div", "sc-preview");
      wrap.append(button("‹ Back", () => showMore(session)));
      wrap.append(dom("h3", "", mode === "handoff" ? "Handoff to " + backendLabel(targetBackend) : mode === "fork" ? "Fork session" : "Safe rewind"));
      wrap.append(dom("p", "", messages.length + " messages and " + payload.files.length + " detected file references will be included. Source point: " + point + "/" + all.length + "."));
      const files = dom("pre");
      files.textContent = payload.files.length ? "FILES\n" + payload.files.join("\n") : "FILES\n(none detected)";
      const exact = dom("pre");
      exact.textContent = payload.text;
      const model = dom("input") as HTMLInputElement;
      model.placeholder = targetBackend === "codex" ? "Optional Codex model" : "Optional OpenCode provider/model";
      const agent = dom("input") as HTMLInputElement;
      agent.placeholder = targetBackend === "opencode" ? "Optional OpenCode agent/mode (for example plan)" : "Optional mode label";
      const consent = dom("label", "sc-consent");
      const check = dom("input") as HTMLInputElement;
      check.type = "checkbox";
      const consentText = dom("span", "", mode === "handoff"
        ? "I approve sending exactly the previewed context to " + backendLabel(targetBackend) + "."
        : "I understand a new thread will be created; the original remains unchanged.");
      consent.append(check, consentText);
      const execute = button(mode === "handoff" ? "Confirm handoff" : mode === "fork" ? "Create fork" : "Create rewound thread", () => void executeTransfer());
      execute.disabled = true;
      check.addEventListener("change", () => { execute.disabled = !check.checked; });

      const executeTransfer = async () => {
        execute.disabled = true;
        try {
          const target = await createFromContext(session, targetBackend, messages, mode, model.value.trim(), point, undefined, agent.value.trim());
          if (!target) return;
          if (mode === "handoff") {
            store.owners[target.key] = { owner: targetBackend, priorOwner: session.backend, changedAt: Date.now() };
            addEvent({ sessionKey: session.key, type: "handoff", detail: backendLabel(session.backend) + " → " + backendLabel(targetBackend) + "; source point " + point, relatedSessionKey: target.key });
            addEvent({ sessionKey: target.key, type: "handoff", detail: "Ownership received from " + backendLabel(session.backend) + "; source " + session.id, relatedSessionKey: session.key });
          } else if (mode === "fork") {
            addEvent({ sessionKey: session.key, type: "fork", detail: "Forked at message " + point, relatedSessionKey: target.key });
            addEvent({ sessionKey: target.key, type: "fork", detail: "Fork source " + session.id + " at message " + point, relatedSessionKey: session.key });
          } else {
            addEvent({ sessionKey: session.key, type: "rewind", detail: "Safe rewind to message " + point + "; original unchanged", relatedSessionKey: target.key });
            addEvent({ sessionKey: target.key, type: "rewind", detail: "Created from " + session.id + " at message " + point, relatedSessionKey: session.key });
          }
          await inheritBudget(session, target);
          save();
          notify((mode === "handoff" ? "Handoff" : mode === "fork" ? "Fork" : "Rewind") + " created");
          await refresh();
        } catch (error) {
          notify(error instanceof Error ? error.message : "Transfer failed");
        } finally {
          execute.disabled = false;
        }
      };

      wrap.append(files, exact, model, agent, consent, execute);
      body.append(wrap);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Could not prepare preview");
    }
  }

  async function createFromContext(
    source: Session,
    targetBackend: Backend,
    messages: Message[],
    mode: string,
    model = "",
    point = messages.length,
    targetProject?: { id?: string; path: string },
    agentOverride = ""
  ) {
    const payload = handoffText(source, messages, mode, "Source point: " + point);
    const projectPath = targetProject?.path || source.project;
    const projectId = targetProject?.id || source.projectId || projects.find(project => project.path === source.project)?.id;

    if (targetBackend === "codex") {
      const params: Record<string, any> = {};
      if (projectPath) params.cwd = projectPath;
      if (model) params.model = model;
      const started = await codexRpc<any>("thread/start", params);
      const id = String(started?.thread?.id || "");
      if (!id) throw new Error("Codex did not create a thread");
      await codexRpc("turn/start", {
        threadId: id,
        input: [{ type: "text", text: payload.text }],
        clientUserMessageId: uid(),
        ...(model ? { model } : {})
      });
      const target: Session = {
        key: sessionKey("codex", id),
        id,
        backend: "codex",
        title: mode + ": " + source.title,
        project: projectPath,
        projectId,
        agent: agentOverride || "Codex",
        model: model || source.model,
        updatedAt: Date.now(),
        status: "running",
        tokens: 0,
        turns: 1
      };
      store.owners[target.key] ||= { owner: "codex", changedAt: Date.now() };
      return target;
    }

    const body: Record<string, any> = {};
    if (agentOverride) body.agent = agentOverride;
    else if (mode === "side") body.agent = "plan";
    else if (source.agent && source.agent !== "OpenCode") body.agent = source.agent;
    if (model.includes("/")) {
      const [providerID, ...rest] = model.split("/");
      const modelID = rest.join("/");
      if (providerID && modelID) body.model = { id: modelID, providerID };
    }
    let created: any;
    try {
      created = await openCode<any>("/session", { method: "POST", body: JSON.stringify(body) }, projectId);
    } catch (error) {
      if (mode !== "side" || !body.agent) throw error;
      delete body.agent;
      created = await openCode<any>("/session", { method: "POST", body: JSON.stringify(body) }, projectId);
    }
    const id = String(created?.id || "");
    if (!id) throw new Error("OpenCode did not create a session");
    await openCode("/session/" + encodeURIComponent(id) + "/prompt", {
      method: "POST",
      body: JSON.stringify({ text: payload.text })
    }, projectId);
    const target: Session = {
      key: sessionKey("opencode", id),
      id,
      backend: "opencode",
      title: String(created.title || mode + ": " + source.title),
      project: projectPath,
      projectId,
      agent: String(created.agent || body.agent || "OpenCode"),
      model: model || source.model,
      updatedAt: Date.now(),
      status: "running",
      tokens: 0,
      turns: 1
    };
    store.owners[target.key] ||= { owner: "opencode", changedAt: Date.now() };
    return target;
  }

  async function inheritBudget(source: Session, target: Session) {
    const budget = store.budgets[source.key];
    if (!budget) return;
    const current = await metrics(source).catch(() => ({ turns: budget.baseTurns, tokens: budget.baseTokens, status: source.status, activeTurnId: null }));
    const usedTurns = Math.max(0, current.turns - budget.baseTurns);
    const usedTokens = Math.max(0, current.tokens - budget.baseTokens);
    const remainingTurns = budget.maxTurns === null ? null : Math.max(0, budget.maxTurns - usedTurns);
    const remainingTokens = budget.maxTokens === null ? null : Math.max(0, budget.maxTokens - usedTokens);
    store.budgets[target.key] = {
      maxTurns: remainingTurns,
      maxTokens: remainingTokens,
      baseTurns: 0,
      baseTokens: 0,
      createdAt: Date.now(),
      inheritedFrom: source.key,
      ...((remainingTurns === 0 || remainingTokens === 0) ? { stopReason: "Inherited budget exhausted" } : {})
    };
    addEvent({ sessionKey: target.key, type: "budget", detail: "Inherited remaining budget from " + source.id });
  }

  async function createSideConversation(source: Session) {
    const question = window.prompt("Side conversation question (isolated scratch workspace)")?.trim();
    if (!question) return;
    try {
      const context = compactMessages(await loadMessages(source)).slice(-24);
      const scratchName = "DevMoter-Side-" + Date.now().toString(36);
      const scratch = await requestJson<{ project?: { id?: string; path?: string } }>("/api/projects", {
        method: "POST",
        body: JSON.stringify({ action: "create", path: "~/" + scratchName, name: scratchName })
      });
      const projectId = String(scratch.project?.id || "");
      const projectPath = String(scratch.project?.path || "");
      if (!projectId || !projectPath) throw new Error("Could not create isolated side workspace");
      const note: Message = {
        role: "user",
        text: "SIDE CONVERSATION QUESTION: " + question + "\n\nIsolation rule: this is a separate scratch workspace. Research and answer only. Do not edit the source project. Return a concise result that can be explicitly merged back by the user."
      };
      const target = await createFromContext(source, source.backend, [...context, note], "side", "", context.length, { id: projectId, path: projectPath }, source.backend === "opencode" ? "plan" : "side-readonly");
      if (!target) return;
      store.sideOrigins[target.key] = source.key;
      addEvent({ sessionKey: source.key, type: "side", detail: "Opened isolated side conversation: " + question.slice(0, 80), relatedSessionKey: target.key });
      addEvent({ sessionKey: target.key, type: "side", detail: "Side conversation for " + source.id + "; scratch workspace " + projectPath + "; merge-back is explicit", relatedSessionKey: source.key });
      await inheritBudget(source, target);
      save();
      notify("Side conversation created in an isolated scratch workspace");
      await refresh();
    } catch (error) {
      notify(error instanceof Error ? error.message : "Could not create side conversation");
    }
  }

  async function mergeSideResult(source: Session, side: Session) {
    try {
      const messages = await loadMessages(side);
      const last = [...messages].reverse().find(message => message.role === "assistant");
      if (!last?.text) throw new Error("No side-conversation result is available yet");
      if (!window.confirm("Queue this side result back to " + source.title + "?\n\n" + last.text.slice(0, 600))) return;
      store.queue.push({
        id: uid(),
        sessionKey: source.key,
        text: "[Side conversation result — review before applying]\n" + last.text,
        createdAt: Date.now()
      });
      addEvent({ sessionKey: source.key, type: "side", detail: "User chose to merge result from " + side.id, relatedSessionKey: side.key });
      save();
      render();
      notify("Side result queued for explicit merge-back");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Could not merge side result");
    }
  }

  function renderHistory() {
    body.replaceChildren();
    const list = dom("div", "sc-history");
    [...store.events].reverse().forEach(event => {
      const session = findSession(event.sessionKey);
      const row = dom("div");
      row.append(dom("strong", "", event.type + " · " + (session?.title || event.sessionKey)));
      row.append(dom("small", "", new Date(event.createdAt).toLocaleString() + " · " + event.detail));
      list.append(row);
    });
    if (!store.events.length) list.append(dom("div", "sc-empty", "No control history yet."));
    body.append(list);
  }

  async function dispatchQueued(item: QueueItem, session: Session) {
    if (session.backend === "codex") {
      await codexRpc("turn/start", {
        threadId: session.id,
        input: [{ type: "text", text: item.text }],
        clientUserMessageId: item.id
      });
    } else {
      await openCode("/session/" + encodeURIComponent(session.id) + "/prompt", {
        method: "POST",
        body: JSON.stringify({ text: item.text })
      }, session.projectId);
    }
    store.queue = store.queue.filter(entry => entry.id !== item.id);
    addEvent({ sessionKey: session.key, type: "queue", detail: "Dispatched queued follow-up" });
    save();
  }

  async function enforceBudget(session: Session, current: { turns: number; tokens: number; status: RunState; activeTurnId?: string | null }) {
    const budget = store.budgets[session.key];
    if (!budget || budget.stopReason) return true;
    const usedTurns = Math.max(0, current.turns - budget.baseTurns);
    const usedTokens = Math.max(0, current.tokens - budget.baseTokens);
    const reason = budget.maxTurns !== null && usedTurns >= budget.maxTurns
      ? "Turn budget reached (" + usedTurns + "/" + budget.maxTurns + ")"
      : budget.maxTokens !== null && usedTokens >= budget.maxTokens
        ? "Token budget reached (" + usedTokens + "/" + budget.maxTokens + ")"
        : "";
    if (!reason) return true;
    budget.stopReason = reason;
    addEvent({ sessionKey: session.key, type: "budget", detail: reason });
    save();
    if (current.status === "running" || current.status === "waiting") await cancelRun(session).catch(() => {});
    return false;
  }

  async function pollControls() {
    const keys = new Set<string>([
      ...store.queue.map(item => item.sessionKey),
      ...Object.keys(store.budgets).filter(key => !store.budgets[key]?.stopReason)
    ]);
    if (!keys.size) return;
    for (const key of keys) {
      const session = findSession(key);
      if (!session) continue;
      try {
        const current = await metrics(session);
        if (!(await enforceBudget(session, current))) continue;
        const first = store.queue.find(item => item.sessionKey === key);
        if (first && ["idle", "done", "failed", "interrupted", "unknown"].includes(current.status)) {
          await dispatchQueued(first, session);
        }
      } catch {
        // Reconnect-safe: queued work stays persisted for the next reconciliation pass.
      }
    }
    if (panel.classList.contains("open")) void refresh();
  }

  fab.addEventListener("click", openPanel);
  scrim.addEventListener("click", closePanel);
  search.addEventListener("search", () => void fullTextSearch());
  search.addEventListener("keydown", event => {
    if (event.key === "Enter") {
      event.preventDefault();
      void fullTextSearch();
    }
  });
  backendFilter.addEventListener("change", render);
  projectFilter.addEventListener("change", render);
  statusFilter.addEventListener("change", render);

  save();
  pollTimer = window.setInterval(() => void pollControls(), POLL_MS);
  window.addEventListener("beforeunload", () => {
    if (pollTimer !== null) window.clearInterval(pollTimer);
  }, { once: true });
}
