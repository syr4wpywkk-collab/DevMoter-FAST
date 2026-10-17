import "./home.css";
import { APP_REGISTRY, type AppId, type AppDefinition } from "./app-registry";
import { mountHomeBackendShortcuts, type ChatBackend } from "./react/home-backend-shortcuts";

type HomeOptions = {
  onLaunchApp: (id: AppId) => void;
  onPreviewApp: (id: AppId, message: string) => void;
  onSwitchBackend?: (backend: ChatBackend) => void;
};

type RecentApp = { id: AppId; openedAt: number };

const HOME_RECENTS_KEY = "devmoter-home-recent-apps-v1";
const RECENT_LIMIT = 3;

// The reference HTML provides a visual hierarchy, not runtime capability data.
// Keep every launcher tied to a shipped/preview entry in the canonical registry.
const HOME_ORDER: readonly AppId[] = [
  "chat", "projects", "terminal", "git", "agents", "knowledge",
  "review", "sessions", "mission-control", "automation",
  "developer-workflows", "office", "browser"
];

const HOME_APPS: readonly AppDefinition[] = HOME_ORDER.map(id => {
  const entry = APP_REGISTRY.find(app => app.id === id);
  if (!entry) throw new Error("Missing home app registry entry: " + id);
  return entry;
});

const pilotDisposers = new WeakMap<HTMLElement, () => void>();
const homeDisposers = new WeakMap<HTMLElement, () => void>();

function storedRecents(storage: Storage | undefined): RecentApp[] {
  if (!storage) return [];
  try {
    const parsed: unknown = JSON.parse(storage.getItem(HOME_RECENTS_KEY) || "[]");
    if (!Array.isArray(parsed)) return [];
    const seen = new Set<AppId>();
    const now = Date.now();
    const valid: RecentApp[] = [];
    for (const entry of parsed) {
      if (!entry || typeof entry !== "object") continue;
      const id = (entry as { id?: unknown }).id;
      const openedAt = (entry as { openedAt?: unknown }).openedAt;
      if (typeof id !== "string" || typeof openedAt !== "number") continue;
      const app = APP_REGISTRY.find(candidate => candidate.id === id && candidate.availability === "available");
      if (!app || seen.has(app.id) || !Number.isFinite(openedAt) || openedAt <= 0 || openedAt > now + 60_000) continue;
      seen.add(app.id);
      valid.push({ id: app.id, openedAt });
      if (valid.length === RECENT_LIMIT) break;
    }
    return valid;
  } catch {
    // Storage is disabled on opaque/private origins or has invalid data.
    return [];
  }
}

function availableStorage(win: Window | null): Storage | undefined {
  try { return win?.localStorage; } catch { return undefined; }
}

function recentTime(time: number): string {
  return new Date(time).toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function mountHomeSurface(target: HTMLElement, options: HomeOptions) {
  // Keep the pre-existing isolated React quick-switch owner and tear down
  // global listeners if the vanilla home is ever re-mounted.
  pilotDisposers.get(target)?.();
  pilotDisposers.delete(target);
  homeDisposers.get(target)?.();
  homeDisposers.delete(target);

  const document = target.ownerDocument;
  const win = document.defaultView;
  const storage = availableStorage(win);
  let recent = storedRecents(storage);
  const disposers: Array<() => void> = [];

  target.innerHTML = [
    '<div class="dm-home-shell">',
      '<header class="dm-home-header">',
        '<div class="dm-home-identity">',
          '<div class="dm-home-brand-mark" aria-hidden="true">D</div>',
          '<div class="dm-home-brand-copy">',
            '<p class="dm-home-eyebrow"><span>DEV MOTER FAST</span><span class="dm-home-eyebrow-slash">/</span><span>UNIFIED WORKSPACE</span></p>',
            '<h1 id="devmoterHomeTitle" tabindex="-1">統合コントロールホーム</h1>',
            '<p class="dm-home-subtitle">AI、プロジェクト、開発ツールをひとつの場所から。</p>',
          '</div>',
        '</div>',
        '<div class="dm-home-header-actions">',
          '<span class="dm-home-health" data-home-health data-state="checking" role="status" aria-live="polite"><span class="dm-home-health-dot" aria-hidden="true"></span><span data-home-health-label>接続状況を確認中</span></span>',
          '<button class="dm-home-search-trigger" type="button" data-home-search-toggle aria-controls="dmHomeSearchPanel" aria-expanded="false" aria-label="アプリを検索">',
            '<span aria-hidden="true">⌕</span><strong>Search</strong><kbd>⌘ K</kbd>',
          '</button>',
        '</div>',
      '</header>',
      '<div class="dm-home-search-panel hidden" id="dmHomeSearchPanel">',
        '<label for="dmHomeSearch">アプリを検索</label>',
        '<div class="dm-home-search-row">',
          '<input id="dmHomeSearch" data-home-search type="search" autocomplete="off" placeholder="Chat、Git、Terminalなどを検索" />',
          '<button type="button" data-home-search-close aria-label="検索を閉じる">×</button>',
        '</div>',
      '</div>',
      '<section class="dm-home-section" aria-labelledby="dm-home-apps-title">',
        '<div class="dm-home-section-heading">',
          '<div><p class="dm-home-eyebrow">WORKSPACE</p><h2 id="dm-home-apps-title">クイックランチャー</h2></div>',
          '<span class="dm-home-section-note" data-home-app-count></span>',
        '</div>',
        '<div class="dm-home-app-grid" data-home-app-grid></div>',
        '<p class="dm-home-empty hidden" data-home-no-results>該当するアプリはありません。</p>',
      '</section>',
      '<section class="dm-home-section dm-home-activity" aria-labelledby="dm-home-activity-title">',
        '<div class="dm-home-section-heading">',
          '<div><p class="dm-home-eyebrow">PICK UP WHERE YOU LEFT OFF</p><h2 id="dm-home-activity-title">最近使ったアプリ</h2></div>',
          '<button type="button" class="dm-home-history-link" data-home-sessions>セッション履歴を見る <span aria-hidden="true">↗</span></button>',
        '</div>',
        '<p class="dm-home-section-context">このブラウザで実際に開いたアプリを表示します。サンプルの活動履歴は使用しません。</p>',
        '<div class="dm-home-recent-grid" data-home-recent></div>',
        '<div class="dm-home-continue" data-home-continue>',
          '<div><h3>作業を続ける</h3><p>前回のAIワークスペースに戻るか、利用するエージェントを選べます。</p></div>',
          '<button type="button" class="dm-home-text-action" data-home-open-chat aria-label="Open your last chat workspace">Chatを開く <span aria-hidden="true">↗</span></button>',
          '<div data-home-react-pilot></div>',
        '</div>',
      '</section>',
      '<footer class="dm-home-footer"><span>DevMoter FAST</span><span>Local-first · Your workspace, your agents.</span></footer>',
    '</div>'
  ].join("");

  const grid = target.querySelector<HTMLElement>("[data-home-app-grid]")!;
  const noResults = target.querySelector<HTMLElement>("[data-home-no-results]")!;
  const count = target.querySelector<HTMLElement>("[data-home-app-count]")!;
  const recentsHost = target.querySelector<HTMLElement>("[data-home-recent]")!;
  const searchPanel = target.querySelector<HTMLElement>("#dmHomeSearchPanel")!;
  const searchInput = target.querySelector<HTMLInputElement>("[data-home-search]")!;
  const searchToggle = target.querySelector<HTMLButtonElement>("[data-home-search-toggle]")!;

  const launch = (app: AppDefinition) => {
    if (app.availability !== "available") {
      options.onPreviewApp(app.id, app.previewMessage || app.title + " is not available yet.");
      return;
    }
    recent = [{ id: app.id, openedAt: Date.now() }, ...recent.filter(entry => entry.id !== app.id)].slice(0, RECENT_LIMIT);
    try { storage?.setItem(HOME_RECENTS_KEY, JSON.stringify(recent)); } catch { /* Storage may be read-only. */ }
    renderRecents();
    options.onLaunchApp(app.id);
  };

  const renderRecents = () => {
    recentsHost.replaceChildren();
    if (recent.length === 0) {
      const empty = document.createElement("p");
      empty.className = "dm-home-recent-empty";
      empty.textContent = "まだ最近開いたアプリはありません。上のランチャーから始められます。";
      recentsHost.appendChild(empty);
      return;
    }
    for (const entry of recent) {
      const app = APP_REGISTRY.find(candidate => candidate.id === entry.id);
      if (!app || app.availability !== "available") continue;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "dm-home-recent-card";
      button.dataset.homeRecent = app.id;
      button.setAttribute("aria-label", app.title + " をもう一度開く");
      const top = document.createElement("span");
      top.className = "dm-home-recent-top";
      const icon = document.createElement("span");
      icon.className = "dm-home-recent-icon";
      icon.textContent = app.icon;
      icon.setAttribute("aria-hidden", "true");
      const opened = document.createElement("time");
      opened.dateTime = new Date(entry.openedAt).toISOString();
      opened.textContent = recentTime(entry.openedAt);
      top.append(icon, opened);
      const heading = document.createElement("strong");
      heading.textContent = app.title;
      const description = document.createElement("small");
      description.textContent = app.shortDescription;
      const arrow = document.createElement("span");
      arrow.className = "dm-home-recent-open";
      arrow.textContent = "再開 ↗";
      button.append(top, heading, description, arrow);
      button.addEventListener("click", () => launch(app));
      recentsHost.appendChild(button);
    }
  };

  for (const app of HOME_APPS) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "dm-home-app-card";
    button.dataset.homeApp = app.id;
    button.dataset.homeSearchable = [app.title, app.id, app.shortDescription, app.category].join(" ").toLocaleLowerCase();
    const state = app.availability === "preview" ? "Preview" : app.availability === "unavailable" ? "Unavailable" : "";
    button.setAttribute("aria-label", app.title + (state ? ", " + state : ""));
    if (state) button.setAttribute("aria-disabled", "true");
    if (app.availability === "unavailable") button.disabled = true;
    const icon = document.createElement("span");
    icon.className = "dm-home-card-icon";
    icon.dataset.appIcon = app.id;
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = app.icon;
    const copy = document.createElement("span");
    copy.className = "dm-home-card-copy";
    const heading = document.createElement("strong");
    heading.textContent = app.title;
    const hint = document.createElement("small");
    hint.textContent = app.shortDescription;
    copy.append(heading, hint);
    if (state) {
      const badge = document.createElement("em");
      badge.className = "dm-home-app-state";
      badge.textContent = state;
      copy.appendChild(badge);
    }
    const arrow = document.createElement("span");
    arrow.className = "dm-home-card-arrow";
    arrow.textContent = app.availability === "available" ? "↗" : "·";
    arrow.setAttribute("aria-hidden", "true");
    button.append(icon, copy, arrow);
    button.addEventListener("click", () => launch(app));
    grid.appendChild(button);
  }

  const filterApps = () => {
    const term = searchInput.value.trim().toLocaleLowerCase();
    let visible = 0;
    for (const button of grid.querySelectorAll<HTMLButtonElement>("[data-home-app]")) {
      const matches = !term || (button.dataset.homeSearchable || "").includes(term);
      button.classList.toggle("hidden", !matches);
      if (matches) visible++;
    }
    count.textContent = visible + " modules";
    noResults.classList.toggle("hidden", visible > 0);
  };

  const openSearch = () => {
    searchPanel.classList.remove("hidden");
    searchToggle.setAttribute("aria-expanded", "true");
    searchInput.focus();
  };
  const closeSearch = () => {
    searchPanel.classList.add("hidden");
    searchToggle.setAttribute("aria-expanded", "false");
    searchInput.value = "";
    filterApps();
    searchToggle.focus();
  };

  searchToggle.addEventListener("click", () => {
    if (searchPanel.classList.contains("hidden")) openSearch();
    else closeSearch();
  });
  target.querySelector<HTMLButtonElement>("[data-home-search-close]")?.addEventListener("click", closeSearch);
  searchInput.addEventListener("input", filterApps);

  const onKeydown = (event: KeyboardEvent) => {
    if (target.classList.contains("hidden") || !target.isConnected) return;
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      openSearch();
    } else if (event.key === "Escape" && !searchPanel.classList.contains("hidden")) {
      event.preventDefault();
      closeSearch();
    }
  };
  document.addEventListener("keydown", onKeydown);
  disposers.push(() => document.removeEventListener("keydown", onKeydown));

  target.querySelector<HTMLButtonElement>("[data-home-open-chat]")?.addEventListener("click", () => {
    const chat = APP_REGISTRY.find(app => app.id === "chat")!;
    launch(chat);
  });
  target.querySelector<HTMLButtonElement>("[data-home-sessions]")?.addEventListener("click", () => {
    const sessions = APP_REGISTRY.find(app => app.id === "sessions")!;
    launch(sessions);
  });

  if (options.onSwitchBackend) {
    const pilotHost = target.querySelector<HTMLElement>("[data-home-react-pilot]");
    if (pilotHost) {
      pilotDisposers.set(target, mountHomeBackendShortcuts(pilotHost, backend => {
        recent = [{ id: "chat", openedAt: Date.now() }, ...recent.filter(entry => entry.id !== "chat")].slice(0, RECENT_LIMIT);
        try { storage?.setItem(HOME_RECENTS_KEY, JSON.stringify(recent)); } catch { /* Optional local recents. */ }
        renderRecents();
        options.onSwitchBackend?.(backend);
      }));
    }
  }

  const health = target.querySelector<HTMLElement>("[data-home-health]")!;
  const healthLabel = target.querySelector<HTMLElement>("[data-home-health-label]")!;
  let healthSerial = 0;
  const refreshHealth = async () => {
    if (typeof win?.fetch !== "function") return;
    const serial = ++healthSerial;
    health.dataset.state = "checking";
    healthLabel.textContent = "接続状況を確認中";
    try {
      const response = await win.fetch("/api/health", { credentials: "same-origin", cache: "no-store" });
      if (!response.ok) throw new Error("Health HTTP " + response.status);
      const result: unknown = await response.json();
      if (serial !== healthSerial || !target.isConnected) return;
      const backends = (result as { backends?: { opencode?: { online?: boolean }; codex?: { online?: boolean } } })?.backends;
      if (typeof backends?.opencode?.online !== "boolean" || typeof backends?.codex?.online !== "boolean") {
        throw new Error("Incomplete health payload");
      }
      const count = Number(backends.opencode.online) + Number(backends.codex.online);
      health.dataset.state = count === 2 ? "online" : count === 1 ? "partial" : "offline";
      healthLabel.textContent = "OpenCode " + (backends.opencode.online ? "●" : "○") + " / Codex " + (backends.codex.online ? "●" : "○");
      health.title = "サーバーが報告する実際の接続状態";
    } catch {
      if (serial !== healthSerial || !target.isConnected) return;
      health.dataset.state = "unknown";
      healthLabel.textContent = "接続状況を取得できません";
    }
  };
  const onSurfaceChanged = (event: Event) => {
    if ((event as CustomEvent<{ surface?: string }>).detail?.surface === "home") void refreshHealth();
  };
  win?.addEventListener("devmoter:surface-changed", onSurfaceChanged);
  win?.addEventListener("online", refreshHealth);
  disposers.push(() => {
    healthSerial++;
    win?.removeEventListener("devmoter:surface-changed", onSurfaceChanged);
    win?.removeEventListener("online", refreshHealth);
  });
  // Rendering is synchronous and self-contained in unit tests; runtime
  // connectivity is queried when the existing surface controller opens Home.
  renderRecents();
  filterApps();
  homeDisposers.set(target, () => { for (const dispose of disposers) dispose(); });
}
