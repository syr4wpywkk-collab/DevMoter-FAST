import "./home.css";
import { APP_REGISTRY, type AppId, type AppDefinition } from "./app-registry";
import { mountHomeBackendShortcuts, type ChatBackend } from "./react/home-backend-shortcuts";
import { formatDateTime, t, tApp } from "./i18n";

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

type HomeOptions = {
  onLaunchApp: (id: AppId) => void;
  onPreviewApp: (id: AppId, message: string) => void;
  onSwitchBackend?: (backend: ChatBackend) => void;
};

type RecentApp = { id: AppId; openedAt: number };

const HOME_RECENTS_KEY = "devmoter-home-recent-apps-v1";
const RECENT_LIMIT = 3;
const HOME_FAVORITES_KEY = "devmoter-home-favorite-apps-v1";

const ICON_PIN = '<svg viewBox="0 0 24 24"><path d="m12 3.6 2.6 5.3 5.8.8-4.2 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.2-4.1 5.8-.8z"></path></svg>';
const ICON_UP = '<svg viewBox="0 0 24 24"><path d="m6 14.5 6-6 6 6"></path></svg>';
const ICON_DOWN = '<svg viewBox="0 0 24 24"><path d="m6 9.5 6 6 6-6"></path></svg>';
const ICON_REMOVE = '<svg viewBox="0 0 24 24"><path d="m6.5 6.5 11 11m0-11-11 11"></path></svg>';

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

function homeLabel(app: AppDefinition): string {
  return tApp(app.id, "title") || app.title;
}

function homeDescription(app: AppDefinition): string {
  return tApp(app.id, "shortDescription") || app.shortDescription;
}

function homePreviewMessage(app: AppDefinition): string {
  return tApp(app.id, "previewMessage") || app.previewMessage || t("apps.unavailable", { title: homeLabel(app) });
}

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

// Favorites are a local display preference: only launchers that Home shows and
// that are currently available survive; anything else in storage is dropped.
function favoriteApp(id: unknown): AppDefinition | undefined {
  if (typeof id !== "string") return undefined;
  return HOME_APPS.find(app => app.id === id && app.availability === "available");
}

function storedFavorites(storage: Storage | undefined): AppId[] {
  if (!storage) return [];
  try {
    const parsed: unknown = JSON.parse(storage.getItem(HOME_FAVORITES_KEY) || "[]");
    if (!Array.isArray(parsed)) return [];
    const valid: AppId[] = [];
    for (const id of parsed.slice(0, 64)) {
      const app = favoriteApp(id);
      if (app && !valid.includes(app.id)) valid.push(app.id);
    }
    return valid;
  } catch {
    return [];
  }
}

function availableStorage(win: Window | null): Storage | undefined {
  try { return win?.localStorage; } catch { return undefined; }
}

function recentTime(time: number): string {
  return formatDateTime(time, { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
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
  let favorites = storedFavorites(storage);
  const disposers: Array<() => void> = [];

  target.innerHTML = [
    '<div class="dm-home-shell">',
      '<header class="dm-home-header">',
        '<div class="dm-home-identity">',
          '<div class="dm-home-brand-mark" aria-hidden="true">D</div>',
          '<div class="dm-home-brand-copy">',
            `<h1 id="devmoterHomeTitle" tabindex="-1">${escapeHtml(t("home.title"))}</h1>`,
          '</div>',
        '</div>',
        '<div class="dm-home-header-actions">',
          `<span class="dm-home-health" data-home-health data-state="checking" role="status" aria-live="polite"><span class="dm-home-health-dot" aria-hidden="true"></span><span data-home-health-label>${escapeHtml(t("home.healthChecking"))}</span></span>`,
          `<button class="dm-home-search-trigger" type="button" data-home-search-toggle aria-controls="dmHomeSearchPanel" aria-expanded="false" aria-label="${escapeHtml(t("home.searchAppsAria"))}">`,
          `<span class="dm-home-search-trigger-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><circle cx="10.8" cy="10.8" r="6.5"></circle><path d="m15.6 15.6 4.1 4.1"></path></svg></span><strong>${escapeHtml(t("home.searchTrigger"))}</strong><kbd>⌘ K</kbd>`,
          '</button>',
        '</div>',
      '</header>',
      '<div class="dm-home-search-panel hidden" id="dmHomeSearchPanel">',
        `<label for="dmHomeSearch">${escapeHtml(t("home.searchAppsAria"))}</label>`,
        '<div class="dm-home-search-row">',
          `<input id="dmHomeSearch" data-home-search type="search" autocomplete="off" placeholder="${escapeHtml(t("home.searchPlaceholder"))}" />`,
          `<button type="button" data-home-search-close aria-label="${escapeHtml(t("home.searchCloseAria"))}">×</button>`,
        '</div>',
      '</div>',
      '<section class="dm-home-section dm-home-quick-section" aria-labelledby="dm-home-quick-title">',
        '<div class="dm-home-section-heading">',
          `<h2 id="dm-home-quick-title">${escapeHtml(t("home.quickActions"))}</h2>`,
        '</div>',
        '<div class="dm-home-quick-actions" data-home-quick-actions></div>',
        '<div data-home-react-pilot></div>',
      '</section>',
      '<section class="dm-home-section" aria-labelledby="dm-home-favorites-title" data-home-favorites-section hidden>',
        '<div class="dm-home-section-heading">',
          `<h2 id="dm-home-favorites-title">${escapeHtml(t("home.favoritesHeading"))}</h2>`,
        '</div>',
        '<ol class="dm-home-favorite-list" data-home-favorites></ol>',
      '</section>',
      '<p class="dm-home-sr-only" role="status" aria-live="polite" data-home-status></p>',
      '<section class="dm-home-section" aria-labelledby="dm-home-apps-title">',
        '<div class="dm-home-section-heading">',
          `<h2 id="dm-home-apps-title">${escapeHtml(t("home.toolsHeading"))}</h2>`,
          '<span class="dm-home-section-note" data-home-app-count></span>',
        '</div>',
        '<div class="dm-home-app-grid" data-home-app-grid></div>',
        `<p class="dm-home-empty hidden" data-home-no-results>${escapeHtml(t("home.noResults"))}</p>`,
      '</section>',
      '<section class="dm-home-section dm-home-activity" aria-labelledby="dm-home-activity-title" data-home-recent-section hidden>',
        '<div class="dm-home-section-heading">',
          `<h2 id="dm-home-activity-title">${escapeHtml(t("home.recentHeading"))}</h2>`,
          '<div class="dm-home-heading-actions">',
            `<button type="button" class="dm-home-history-link" data-home-clear-recents>${escapeHtml(t("home.clearRecents"))}</button>`,
            `<button type="button" class="dm-home-history-link" data-home-sessions>${escapeHtml(t("home.sessionHistoryLink"))} <span aria-hidden="true">↗</span></button>`,
          '</div>',
        '</div>',
        '<div class="dm-home-recent-grid" data-home-recent></div>',
      '</section>',
    '</div>'
  ].join("");

  const grid = target.querySelector<HTMLElement>("[data-home-app-grid]")!;
  const quickActions = target.querySelector<HTMLElement>("[data-home-quick-actions]")!;
  const noResults = target.querySelector<HTMLElement>("[data-home-no-results]")!;
  const count = target.querySelector<HTMLElement>("[data-home-app-count]")!;
  const recentsHost = target.querySelector<HTMLElement>("[data-home-recent]")!;
  const recentSection = target.querySelector<HTMLElement>("[data-home-recent-section]")!;
  const favoritesHost = target.querySelector<HTMLElement>("[data-home-favorites]")!;
  const favoritesSection = target.querySelector<HTMLElement>("[data-home-favorites-section]")!;
  const status = target.querySelector<HTMLElement>("[data-home-status]")!;
  const searchPanel = target.querySelector<HTMLElement>("#dmHomeSearchPanel")!;
  const searchInput = target.querySelector<HTMLInputElement>("[data-home-search]")!;
  const searchToggle = target.querySelector<HTMLButtonElement>("[data-home-search-toggle]")!;

  const launch = (app: AppDefinition) => {
    if (app.availability !== "available") {
      options.onPreviewApp(app.id, homePreviewMessage(app));
      return;
    }
    recent = [{ id: app.id, openedAt: Date.now() }, ...recent.filter(entry => entry.id !== app.id)].slice(0, RECENT_LIMIT);
    try { storage?.setItem(HOME_RECENTS_KEY, JSON.stringify(recent)); } catch { /* Storage may be read-only. */ }
    renderRecents();
    options.onLaunchApp(app.id);
  };

  const renderRecents = () => {
    recentsHost.replaceChildren();
    // Nothing opened yet: the section is simply absent instead of an empty-state message.
    recentSection.hidden = recent.length === 0;
    for (const entry of recent) {
      const app = APP_REGISTRY.find(candidate => candidate.id === entry.id);
      if (!app || app.availability !== "available") continue;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "dm-home-recent-card";
      button.dataset.homeRecentApp = app.id;
      button.setAttribute("aria-label", t("home.reopenAppAria", { title: homeLabel(app) }));
      const top = document.createElement("span");
      top.className = "dm-home-recent-top";
      const icon = document.createElement("span");
      icon.className = "dm-home-recent-icon";
      icon.innerHTML = app.icon; // static SVG from the App Registry
      icon.setAttribute("aria-hidden", "true");
      const opened = document.createElement("time");
      opened.dateTime = new Date(entry.openedAt).toISOString();
      opened.textContent = recentTime(entry.openedAt);
      top.append(icon, opened);
      const heading = document.createElement("strong");
      heading.textContent = homeLabel(app);
      button.append(top, heading);
      button.addEventListener("click", () => launch(app));
      recentsHost.appendChild(button);
    }
  };

  const iconButton = (className: string, svg: string, label: string) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = className;
    button.innerHTML = svg; // static inline SVG constant
    button.setAttribute("aria-label", label);
    button.title = label;
    return button;
  };

  const saveFavorites = () => {
    try { storage?.setItem(HOME_FAVORITES_KEY, JSON.stringify(favorites)); } catch { /* Optional local favorites. */ }
  };

  const syncFavoriteToggles = () => {
    for (const toggle of grid.querySelectorAll<HTMLButtonElement>("[data-home-favorite-toggle]")) {
      const app = favoriteApp(toggle.dataset.homeFavoriteToggle);
      if (!app) continue;
      const pinned = favorites.includes(app.id);
      const label = t(pinned ? "home.favoriteRemoveAria" : "home.favoriteAddAria", { title: homeLabel(app) });
      toggle.setAttribute("aria-pressed", String(pinned));
      toggle.setAttribute("aria-label", label);
      toggle.title = label;
    }
  };

  const moveFavorite = (id: AppId, delta: -1 | 1) => {
    const from = favorites.indexOf(id);
    const to = from + delta;
    if (from < 0 || to < 0 || to >= favorites.length) return;
    const next = [...favorites];
    next.splice(to, 0, ...next.splice(from, 1));
    favorites = next;
    saveFavorites();
    renderFavorites();
    const app = favoriteApp(id);
    if (app) status.textContent = t("home.favoriteMoved", { title: homeLabel(app), position: to + 1, total: favorites.length });
    // Keep keyboard focus on the moved row; fall back to its launcher at an edge.
    const row = favoritesHost.querySelector<HTMLElement>(`[data-home-favorite-item="${id}"]`);
    const control = row?.querySelector<HTMLButtonElement>(delta < 0 ? "[data-home-favorite-up]" : "[data-home-favorite-down]");
    (control && !control.disabled ? control : row?.querySelector<HTMLButtonElement>("[data-home-favorite-app]"))?.focus();
  };

  const toggleFavorite = (id: AppId) => {
    const app = favoriteApp(id);
    if (!app) return;
    const pinned = favorites.includes(app.id);
    favorites = pinned ? favorites.filter(entry => entry !== app.id) : [...favorites, app.id];
    saveFavorites();
    renderFavorites();
    status.textContent = t(pinned ? "home.favoriteRemoved" : "home.favoriteAdded", { title: homeLabel(app) });
  };

  const renderFavorites = () => {
    favoritesHost.replaceChildren();
    favoritesSection.hidden = favorites.length === 0;
    favorites.forEach((id, index) => {
      const app = favoriteApp(id);
      if (!app) return;
      const row = document.createElement("li");
      row.className = "dm-home-favorite-item";
      row.dataset.homeFavoriteItem = app.id;
      const open = document.createElement("button");
      open.type = "button";
      open.className = "dm-home-favorite-open";
      open.dataset.homeFavoriteApp = app.id;
      open.setAttribute("aria-label", t("home.openAppAria", { title: homeLabel(app) }));
      open.setAttribute("aria-keyshortcuts", "Alt+ArrowUp Alt+ArrowDown");
      const icon = document.createElement("span");
      icon.className = "dm-home-card-icon";
      icon.innerHTML = app.icon; // static SVG from the App Registry
      icon.setAttribute("aria-hidden", "true");
      const heading = document.createElement("strong");
      heading.textContent = homeLabel(app);
      open.append(icon, heading);
      open.addEventListener("click", () => launch(app));
      const up = iconButton("dm-home-favorite-control", ICON_UP, t("home.favoriteMoveUpAria", { title: homeLabel(app) }));
      up.dataset.homeFavoriteUp = app.id;
      up.disabled = index === 0;
      up.addEventListener("click", () => moveFavorite(app.id, -1));
      const down = iconButton("dm-home-favorite-control", ICON_DOWN, t("home.favoriteMoveDownAria", { title: homeLabel(app) }));
      down.dataset.homeFavoriteDown = app.id;
      down.disabled = index === favorites.length - 1;
      down.addEventListener("click", () => moveFavorite(app.id, 1));
      const remove = iconButton("dm-home-favorite-control", ICON_REMOVE, t("home.favoriteRemoveAria", { title: homeLabel(app) }));
      remove.dataset.homeFavoriteRemove = app.id;
      remove.addEventListener("click", () => {
        toggleFavorite(app.id);
        const rows = favoritesHost.querySelectorAll<HTMLButtonElement>("[data-home-favorite-app]");
        (rows[Math.min(index, rows.length - 1)] ?? grid.querySelector<HTMLButtonElement>(`[data-home-favorite-toggle="${app.id}"]`))?.focus();
      });
      row.addEventListener("keydown", event => {
        if (!event.altKey || event.ctrlKey || event.metaKey || (event.key !== "ArrowUp" && event.key !== "ArrowDown")) return;
        event.preventDefault();
        moveFavorite(app.id, event.key === "ArrowUp" ? -1 : 1);
      });
      row.append(open, up, down, remove);
      favoritesHost.appendChild(row);
    });
    syncFavoriteToggles();
  };

  // Launch only allowlisted App Registry entries; Home never executes a shell command.
  const quickIds: readonly AppId[] = ["chat", "projects", "terminal", "review", "sessions"];
  for (const id of quickIds) {
    const app = APP_REGISTRY.find(candidate => candidate.id === id)!;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "dm-home-quick-action";
    button.dataset.homeQuickAction = id;
    button.setAttribute("aria-label", t("home.openAppAria", { title: homeLabel(app) }));
    const icon = document.createElement("span");
    icon.className = "dm-home-quick-action-icon";
    icon.innerHTML = app.icon; // static SVG from the App Registry
    icon.setAttribute("aria-hidden", "true");
    const title = document.createElement("strong");
    title.textContent = homeLabel(app);
    button.append(icon, title);
    if (app.availability !== "available") {
      button.disabled = true;
      button.title = homePreviewMessage(app);
    } else {
      button.addEventListener("click", () => launch(app));
    }
    quickActions.append(button);
  }

  for (const app of HOME_APPS) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "dm-home-app-card";
    button.dataset.homeApp = app.id;
    const desc = homeDescription(app);
    button.dataset.homeSearchable = [homeLabel(app), app.title, app.id, desc, app.shortDescription, app.category].join(" ").toLocaleLowerCase();
    button.title = desc;
    const state = app.availability === "preview" ? t("home.statePreview") : app.availability === "unavailable" ? t("home.stateUnavailable") : "";
    button.setAttribute("aria-label", state ? t("home.appStateAria", { title: homeLabel(app), state }) : homeLabel(app));
    // Browser's preview remains partial, but now has a real Files & Preview destination.
    if (state && app.id !== "browser") button.setAttribute("aria-disabled", "true");
    if (app.availability === "unavailable") button.disabled = true;
    const icon = document.createElement("span");
    icon.className = "dm-home-card-icon";
    icon.dataset.appIcon = app.id;
    icon.setAttribute("aria-hidden", "true");
    icon.innerHTML = app.icon; // static SVG from the App Registry
    const copy = document.createElement("span");
    copy.className = "dm-home-card-copy";
    const heading = document.createElement("strong");
    heading.textContent = homeLabel(app);
    copy.append(heading);
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
    const item = document.createElement("div");
    item.className = "dm-home-app-item";
    item.appendChild(button);
    if (favoriteApp(app.id)) {
      const toggle = iconButton("dm-home-favorite-toggle", ICON_PIN, "");
      toggle.dataset.homeFavoriteToggle = app.id;
      toggle.addEventListener("click", () => toggleFavorite(app.id));
      item.appendChild(toggle);
    }
    grid.appendChild(item);
  }

  const filterApps = () => {
    const term = searchInput.value.trim().toLocaleLowerCase();
    let visible = 0;
    for (const button of grid.querySelectorAll<HTMLButtonElement>("[data-home-app]")) {
      const matches = !term || (button.dataset.homeSearchable || "").includes(term);
      button.classList.toggle("hidden", !matches);
      button.parentElement?.classList.toggle("hidden", !matches);
      if (matches) visible++;
    }
    count.textContent = t("home.appCount", { count: visible });
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

  target.querySelector<HTMLButtonElement>("[data-home-sessions]")?.addEventListener("click", () => {
    const sessions = APP_REGISTRY.find(app => app.id === "sessions")!;
    launch(sessions);
  });

  // Clears only this browser's "recently opened" list. Sessions, projects,
  // favorites and every server-side record are left untouched.
  target.querySelector<HTMLButtonElement>("[data-home-clear-recents]")?.addEventListener("click", () => {
    recent = [];
    try { storage?.removeItem(HOME_RECENTS_KEY); } catch { /* Storage may be read-only. */ }
    renderRecents();
    status.textContent = t("home.recentsCleared");
    target.querySelector<HTMLElement>("#devmoterHomeTitle")?.focus();
  });

  if (options.onSwitchBackend) {
    const pilotHost = target.querySelector<HTMLElement>("[data-home-react-pilot]");
    if (pilotHost) {
      pilotDisposers.set(target, mountHomeBackendShortcuts(pilotHost, backend => {
        const chatEntry: RecentApp = { id: "chat", openedAt: Date.now() };
        recent = [chatEntry, ...recent.filter(entry => entry.id !== "chat")].slice(0, RECENT_LIMIT);
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
    healthLabel.textContent = t("home.healthChecking");
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
      health.title = t("home.healthTitle");
    } catch {
      if (serial !== healthSerial || !target.isConnected) return;
      health.dataset.state = "unknown";
      healthLabel.textContent = t("home.healthUnavailable");
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
  renderFavorites();
  filterApps();
  homeDisposers.set(target, () => { for (const dispose of disposers) dispose(); });
}
