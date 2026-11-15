import "./settings.css";
import { describeHealthFetch, formatBuildId, formatNodeVersion } from "./diagnostics-format.mjs";
import { boundedPushWait, inspectPushReadiness, type PushReadiness } from "./push-readiness.js";
import { formatDateTime, formatNumber, getLanguage, setLanguage, t, translateServerMessage } from "./i18n";

type Json = Record<string, any>;
type SettingsPage = "root" | "appearance" | "language" | "account" | "devices" | "vault" | "notifications" | "diagnostics" | "guide";

const THEME_KEY = "devmoter-theme";
const SETUP_GUIDE_URL = "https://github.com/syr4wpywkk-collab/DevMoter-FAST/blob/main/docs/auth-v2.md";
const DENSITY_KEY = "devmoter-settings-density";

// One line-icon set shared with Home and the ☰ menu. Exact copies of
// APP_REGISTRY / SYSTEM_ICONS in app-registry.ts: this module is loaded
// standalone by tests, so it cannot import them (test/line-icons.test.mjs).
const ICONS: Record<string, string> = {
  "agents": '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="7" width="14" height="12" rx="3"/><path d="M12 3v4M9 12h.01M15 12h.01M9 16h6"/></svg>',
  "automation": '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2.5M9 2h6"/></svg>',
  "browser": '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/></svg>',
  "check": '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 5 5 9-10"/></svg>',
  "checkpoint": '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 21V4"/><path d="M5 4h11l-2 4 2 4H5"/></svg>',
  "context": '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 9 5-9 5-9-5Z"/><path d="m3 13 9 5 9-5"/></svg>',
  "dark": '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5Z"/></svg>',
  "density-comfortable": '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="5" width="16" height="6" rx="1.5"/><rect x="4" y="13" width="16" height="6" rx="1.5"/></svg>',
  "density-compact": '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M4 10h16M4 14h16M4 18h16"/></svg>',
  "device": '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="3" width="10" height="18" rx="2"/><path d="M11 18h2"/></svg>',
  "diagnostics": '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 18a8 8 0 1 1 16 0"/><path d="m12 14 4-4"/></svg>',
  "external": '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4h6v6M20 4l-9 9"/><path d="M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4"/></svg>',
  "extensions": '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8h4a2 2 0 1 1 4 0h4v4a2 2 0 1 1 0 4v4H4Z"/></svg>',
  "guide": '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 7c-2-2-5-2-8-2v13c3 0 6 0 8 2 2-2 5-2 8-2V5c-3 0-6 0-8 2Z"/><path d="M12 7v13"/></svg>',
  "hosts": '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="16" height="7" rx="1.5"/><rect x="4" y="13" width="16" height="7" rx="1.5"/><path d="M8 7.5h.01M8 16.5h.01"/></svg>',
  "index": '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M13 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h5"/><path d="M13 3v5h6v3M13 3l6 5"/><circle cx="16" cy="17" r="3"/><path d="m18.2 19.2 2.3 2.3"/></svg>',
  "language": '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h9M8.5 3v2M6 5c0 4 3 7 6 8M11 5c0 4-3 7-7 8"/><path d="m13 21 4-9 4 9M14.5 18h5"/></svg>',
  "light": '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6 7 7M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4"/></svg>',
  "logout": '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4"/><path d="M9 12h11M16 8l4 4-4 4"/></svg>',
  "notifications": '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 16v-5a6 6 0 0 1 12 0v5l2 2H4Z"/><path d="M10 21h4"/></svg>',
  "passkey": '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="8" cy="15" r="4"/><path d="m11 12 9-9M17 6l3 3M14 9l2 2"/></svg>',
  "report": '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4 3 20h18Z"/><path d="M12 10v4M12 17h.01"/></svg>',
  "review": '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 12l2 2 4-4"/><circle cx="12" cy="12" r="9"/></svg>',
  "safety": '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 5 6v5c0 4.5 3 8 7 10 4-2 7-5.5 7-10V6Z"/></svg>',
  "sessions": '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12h4l3-7 4 14 3-7h4"/></svg>',
  "settings": '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/></svg>',
  "system": '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="5" width="14" height="10" rx="1.5"/><path d="M3 19h18"/></svg>',
  "terminal": '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="m7 9 3 3-3 3M12 15h5"/></svg>',
  "theme": '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 3v18M12 8h5M12 12h6M12 16h5"/></svg>',
  "vault": '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>',
};

function rowIcon(icon: string) {
  // Guide steps are numbers, not pictograms.
  if (/^\d+$/.test(icon)) return `<span class="devmoter-settings-icon devmoter-settings-step" aria-hidden="true">${icon}</span>`;
  return `<span class="devmoter-settings-icon" aria-hidden="true">${ICONS[icon] ?? ""}</span>`;
}

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function b64urlToBytes(value: string) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - value.length % 4) % 4);
  const raw = atob(padded);
  return Uint8Array.from(raw, char => char.charCodeAt(0));
}

async function request(path: string, init: RequestInit = {}, deviceAuth = false) {
  const headers = new Headers(init.headers || {});
  const method = String(init.method || "GET").toUpperCase();
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  if (method !== "GET" && method !== "HEAD" && !headers.has("x-pocket-operation-id")) {
    headers.set("x-pocket-operation-id", crypto.randomUUID());
  }
  const response = await fetch(path, { ...init, headers, cache: "no-store", credentials: "same-origin" });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(translateServerMessage(payload?.error) || t("common.httpError", { status: response.status }));
  return payload as Json;
}

function errorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) return translateServerMessage(error.message);
  return fallback;
}

function currentTheme() {
  const stored = localStorage.getItem(THEME_KEY);
  return stored === "light" || stored === "dark" ? stored : "system";
}

function applyTheme(mode: "system" | "light" | "dark") {
  localStorage.setItem(THEME_KEY, mode);
  const resolved =
    mode === "system"
      ? matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light"
      : mode;
  document.documentElement.dataset.devmoterTheme = resolved;
  document.documentElement.dataset.devmoterThemeMode = mode;
  window.dispatchEvent(new CustomEvent("devmoter:theme-changed", { detail: { mode, resolved } }));
}

function themeLabel(mode: string) {
  if (mode === "light") return t("settings.theme.light");
  if (mode === "dark") return t("settings.theme.dark");
  return t("settings.theme.system");
}

function densityLabel(value: string) {
  return value === "compact" ? t("settings.density.compact") : t("settings.density.comfortable");
}

function deviceBrowserLabel() {
  return navigator.userAgent.includes("Mobile")
    ? t("settings.devices.labelMobile")
    : t("settings.devices.labelDesktop");
}

/** "3f2b9c1e…8b9c" for a long ID such as the owner UUID. Display only; copy uses the full value. */
function shortId(value: string, head = 8, tail = 4) {
  const text = value.trim();
  return text.length <= head + tail + 1 ? text : `${text.slice(0, head)}…${text.slice(-tail)}`;
}

async function copyText(text: string) {
  if (!text) return false;
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Clipboard API needs a secure context; plain-http LAN hosts fall back to execCommand.
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.cssText = "position:fixed;opacity:0;pointer-events:none";
    document.body.appendChild(area);
    area.select();
    const copied = document.execCommand("copy");
    area.remove();
    return copied;
  }
}

type OpenTarget =
  | "sessions" | "review" | "agents" | "automation" | "terminal"
  | "passkeys" | "hosts" | "safety" | "index"
  | "context" | "checkpoints" | "extensions" | "files";
const lineIcon = (body: string) =>
  `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
const CHEVRON_ICON = lineIcon('<path d="m9 6 6 6-6 6"/>');
// Leaving Settings uses the shared arrow-out line icon (same as external links).
const LEAVE_ICON = ICONS.external;

function rowKind(action = "") {
  if (action.startsWith("page:")) return "page";
  if (action.startsWith("open:")) return "open";
  return action ? "action" : "info";
}

function isLoopbackBrowser() {
  const host = location.hostname.toLowerCase();
  return host === "localhost" || host === "127.0.0.1" || host === "::1";
}

export function mountSettingsPanel() {
  const root = document.createElement("div");
  root.className = "devmoter-settings-root";
  root.innerHTML = `
    <button class="devmoter-settings-trigger" type="button" aria-label="${escapeHtml(t("settings.openAria"))}">${ICONS.settings}</button>
    <div class="devmoter-settings-modal hidden" role="dialog" aria-modal="true" aria-label="${escapeHtml(t("settings.dialogAria"))}">
      <section class="devmoter-settings-sheet">
        <header class="devmoter-settings-head">
          <button class="devmoter-settings-back hidden" type="button" aria-label="${escapeHtml(t("settings.backAria"))}">‹</button>
          <div>
            <strong data-settings-title>${escapeHtml(t("settings.title"))}</strong>
            <small data-settings-subtitle>${escapeHtml(t("settings.subtitleDefault"))}</small>
          </div>
          <button class="devmoter-settings-close" type="button" aria-label="${escapeHtml(t("common.close"))}">×</button>
        </header>
        <div class="devmoter-settings-scroll">
          <div class="devmoter-settings-loading">${escapeHtml(t("settings.loading"))}</div>
        </div>
      </section>
    </div>
  `;
  document.body.appendChild(root);

  const trigger = root.querySelector<HTMLButtonElement>(".devmoter-settings-trigger")!;
  const modal = root.querySelector<HTMLDivElement>(".devmoter-settings-modal")!;
  const closeButton = root.querySelector<HTMLButtonElement>(".devmoter-settings-close")!;
  const backButton = root.querySelector<HTMLButtonElement>(".devmoter-settings-back")!;
  const scroll = root.querySelector<HTMLDivElement>(".devmoter-settings-scroll")!;
  const title = root.querySelector<HTMLElement>("[data-settings-title]")!;
  const subtitle = root.querySelector<HTMLElement>("[data-settings-subtitle]")!;

  let page: SettingsPage = "root";
  let authStatus: Json = {};
  let diagnostics: Json = {};
  // #473: when /api/system/diagnostics last succeeded / failed, so stale health is never shown as current.
  const diagnosticsFetch: { fetchedAt: number | null; failedAt: number | null; loading: boolean } = { fetchedAt: null, failedAt: null, loading: false };
  let cliStatus: Json[] = [];
  let vaultFormElement: HTMLFormElement | null = null;
  let vaultSecrets: Json[] = [];
  let notificationRenderId = 0;
  let accountData: Json | null = null;
  let githubLink: Json | null = null;

  function toast(message: string) {
    let node = root.querySelector<HTMLDivElement>(".devmoter-settings-toast");
    if (!node) {
      node = document.createElement("div");
      node.className = "devmoter-settings-toast";
      root.appendChild(node);
    }
    node.textContent = message;
    node.classList.add("show");
    window.setTimeout(() => node?.classList.remove("show"), 2400);
  }

  function row(icon: string, label: string, options: {
    action?: string;
    value?: string;
    badge?: string;
    danger?: boolean;
    disabled?: boolean;
    /** Leaves the app (new tab): trailing external icon instead of the chevron. */
    external?: string;
  } = {}) {
    const kind = rowKind(options.action);
    const leaveLabel = t("settings.leaveLabel");
    const trailing = kind === "page"
      ? `<span class="devmoter-settings-chevron" aria-hidden="true">${CHEVRON_ICON}</span>`
      : kind === "open"
        ? `<span class="devmoter-settings-leave" title="${escapeHtml(leaveLabel)}">${LEAVE_ICON}<span class="devmoter-settings-sr">${escapeHtml(leaveLabel)}</span></span>`
        : "";
    return `
      <button
        class="devmoter-settings-row${options.danger ? " danger" : ""}"
        type="button"
        data-kind="${kind}"
        ${options.action ? `data-action="${escapeHtml(options.action)}"` : ""}
        ${options.disabled ? "disabled" : ""}
        ${options.external ? `aria-label="${escapeHtml(t("settings.externalAria", { label, target: options.external }))}"` : ""}
      >
        ${rowIcon(icon)}
        <span class="devmoter-settings-row-copy">
          <strong>${escapeHtml(label)}</strong>
          ${options.value ? `<small>${escapeHtml(options.value)}</small>` : ""}
        </span>
        ${options.badge ? `<span class="devmoter-settings-badge">${escapeHtml(options.badge)}</span>` : ""}
        ${options.external
          ? `<span class="devmoter-settings-chevron external" aria-hidden="true">${ICONS.external}</span>`
          : trailing}
      </button>
    `;
  }

  function section(titleText: string, rows: string) {
    return `
      <section class="devmoter-settings-section">
        <h2>${escapeHtml(titleText)}</h2>
        <div class="devmoter-settings-card">${rows}</div>
      </section>
    `;
  }

  function setPage(next: SettingsPage) {
    page = next;
    scroll.scrollTop = 0;
    void renderPage();
  }

  function setHeader(titleText: string, subtitleText = t("settings.subtitleDefault")) {
    title.textContent = titleText;
    subtitle.textContent = subtitleText;
    backButton.classList.toggle("hidden", page === "root");
  }

  function renderRoot() {
    setHeader(t("settings.title"));
    const identity = authStatus?.identity || {};
    const github = authStatus?.providers?.github || authStatus?.github || {};
    const theme = currentTheme();
    const density = localStorage.getItem(DENSITY_KEY) || "comfortable";
    const lang = getLanguage();
    const provider = identity?.provider || "local";
    const login = identity?.login || "devmoter";
    const githubValue = (github?.linked ?? github?.bound)
      ? t("settings.root.githubConnected")
      : github?.configured
        ? t("settings.root.githubConnectable")
        : t("settings.root.githubUnconfigured");
    const appVersion = diagnostics?.app?.version || "0.2.0";

    scroll.innerHTML = `
      <button class="devmoter-settings-profile" type="button" data-action="page:account">
        <span class="devmoter-settings-avatar">DM</span>
        <span>
          <strong>${escapeHtml(login)}</strong>
          <small>${escapeHtml(t("settings.root.accountSub", { provider, github: githubValue }))}</small>
        </span>
        <span class="devmoter-settings-chevron" aria-hidden="true">${CHEVRON_ICON}</span>
      </button>

      ${section(t("settings.root.sectionWorkspace"),
        row("sessions", t("settings.root.sessions"), { action: "open:sessions", value: t("settings.root.sessionsSub") }) +
        row("review", t("settings.root.review"), { action: "open:review", value: t("settings.root.reviewSub") }) +
        row("agents", t("settings.root.agents"), { action: "open:agents", value: t("settings.root.agentsSub") }) +
        row("context", t("settings.root.context"), { action: "open:context", value: t("settings.root.contextSub") }) +
        row("checkpoint", t("settings.root.checkpoints"), { action: "open:checkpoints", value: t("settings.root.checkpointsSub") })
      )}

      ${section(t("settings.root.sectionCustomize"),
        row("theme", t("settings.root.appearance"), { action: "page:appearance", value: `${themeLabel(theme)} · ${densityLabel(density)}` }) +
        row("language", t("settings.root.language"), { action: "page:language", value: t(`language.${lang}`) }) +
        row("notifications", t("settings.root.notifications"), { action: "page:notifications" })
      )}

      ${section(t("settings.root.sectionSecurity"),
        row("passkey", t("settings.root.passkey"), { action: "open:passkeys" }) +
        row("device", t("settings.root.devices"), { action: "page:devices", value: t("settings.root.devicesSub") }) +
        row("vault", t("settings.root.vault"), { action: "page:vault", value: t("settings.root.vaultSub") })
      )}

      ${section(t("settings.root.sectionRemote"),
        row("hosts", t("settings.root.hosts"), { action: "open:hosts" }) +
        row("automation", t("settings.root.automation"), { action: "open:automation" })
      )}

      ${section(t("settings.root.sectionDevTools"),
        row("terminal", t("settings.root.terminal"), { action: "open:terminal" }) +
        row("index", t("settings.root.index"), { action: "open:index" }) +
        row("safety", t("settings.root.safety"), { action: "open:safety" }) +
        row("extensions", t("settings.root.extensions"), { action: "open:extensions" }) +
        row("browser", t("settings.root.files"), { action: "open:files" }) +
        row("diagnostics", t("settings.root.diagnostics"), { action: "page:diagnostics", value: `v${appVersion}` })
      )}

      ${section(t("settings.root.sectionHelp"),
        row("guide", t("settings.root.guide"), { action: "page:guide" }) +
        row("report", t("settings.root.report"), { action: "report", value: t("settings.root.reportSub"), external: "GitHub" })
      )}

      <div class="devmoter-settings-card devmoter-settings-logout-card">
        ${row("logout", t("settings.root.logout"), { action: "logout", danger: true })}
      </div>
    `;
    wireRows();
  }

  function renderAppearance() {
    setHeader(t("settings.root.appearance"), t("settings.appearance.subtitle"));
    const theme = currentTheme();
    const density = localStorage.getItem(DENSITY_KEY) || "comfortable";
    scroll.innerHTML = `
      ${section(t("settings.appearance.themeSection"),
        row("system", t("settings.theme.system"), { action: "theme:system", value: theme === "system" ? t("settings.selected") : "" }) +
        row("light", t("settings.theme.light"), { action: "theme:light", value: theme === "light" ? t("settings.selected") : "" }) +
        row("dark", t("settings.theme.dark"), { action: "theme:dark", value: theme === "dark" ? t("settings.selected") : "" })
      )}
      ${section(t("settings.appearance.densitySection"),
        row("density-comfortable", t("settings.density.comfortable"), { action: "density:comfortable", value: density === "comfortable" ? t("settings.selected") : t("settings.density.comfortableHint") }) +
        row("density-compact", t("settings.density.compact"), { action: "density:compact", value: density === "compact" ? t("settings.selected") : t("settings.density.compactHint") })
      )}
      <div class="devmoter-settings-note">
        ${escapeHtml(t("settings.appearance.note"))}
      </div>
    `;
    wireRows();
  }

  function providerButton(provider: "github" | "google" | "microsoft", label: string, configured: boolean, linked: boolean, identity: Json | null = {}) {
    const displayIdentity = identity?.login || identity?.email || identity?.name || t("settings.account.connected");
    return '<div class="devmoter-settings-device"><span><strong>' + escapeHtml(label) + '</strong><small>' +
      (linked ? escapeHtml(displayIdentity) : configured ? escapeHtml(t("settings.account.notConnected")) : escapeHtml(t("settings.account.unavailableHost"))) +
      '</small></span>' + (linked
        ? '<button type="button" aria-label="' + escapeHtml(t("settings.account.disconnectAria", { provider: label })) + '" data-action="account:disconnect" data-provider="' + provider + '">' + escapeHtml(t("common.disconnect")) + '</button>'
        : configured
          ? '<button type="button" aria-label="' + escapeHtml(t("settings.account.connectAria", { provider: label })) + '" data-action="account:connect" data-provider="' + provider + '">' + escapeHtml(t("common.connect")) + '</button>'
          : '<a class="devmoter-settings-link-button" href="' + SETUP_GUIDE_URL + '" target="_blank" rel="noopener noreferrer" aria-label="' + escapeHtml(t("settings.account.setupGuideAria", { provider: label })) + '">' + escapeHtml(t("settings.account.setupGuide")) + '</a>') +
      '</div>';
  }

  function renderSessions(sessions: Json[]) {
    if (!sessions.length) return `<div class="devmoter-settings-empty">${escapeHtml(t("settings.account.noSessions"))}</div>`;
    return sessions.map(session => {
      const date = (value: unknown) => {
        const parsed = new Date(typeof value === "number" ? value : String(value || ""));
        return Number.isNaN(parsed.getTime()) ? "—" : formatDateTime(parsed);
      };
      const identity = session.identity?.login || session.identity?.email || session.identity?.name || "";
      return '<div class="devmoter-settings-device"><span><strong>' +
        escapeHtml((session.current ? t("settings.account.currentSessionPrefix") : "") + (session.provider || t("settings.account.owner")) + " · " + identity) +
        '</strong><small>' + escapeHtml(t("settings.account.sessionMeta", {
          host: session.host || "",
          created: date(session.createdAt),
          lastUsed: date(session.lastUsedAt),
          expires: date(session.expiresAt)
        })) +
        '</small></span>' + (session.current
          ? `<span class="devmoter-settings-badge">${escapeHtml(t("settings.account.currentBadge"))}</span>`
          : '<button type="button" aria-label="' + escapeHtml(t("settings.account.revokeAria", { target: session.host || identity || session.id })) + '" data-action="account:revoke-session" data-session-id="' + escapeHtml(session.id) + '">' + escapeHtml(t("common.revoke")) + '</button>') +
        '</div>';
    }).join("");
  }

  async function renderAccount() {
    setHeader(t("settings.account.title"), t("settings.account.subtitle"));
    const identity = authStatus?.identity || {};
    scroll.innerHTML = `<div class="devmoter-settings-loading">${escapeHtml(t("settings.account.loading"))}</div>`;
    try {
      accountData = await request("/api/auth/account");
    } catch (error) {
      scroll.innerHTML = '<div class="devmoter-settings-note">' +
        escapeHtml(errorMessage(error, t("settings.account.loadError"))) + '</div>';
      return;
    }
    const providers = accountData?.providers || {};
    const sessions = Array.isArray(accountData?.sessions) ? accountData.sessions : [];
    const providerRows = providerButton("github", "GitHub", Boolean(providers.github?.configured), Boolean(providers.github?.linked), providers.github?.identity) +
      providerButton("google", "Google", Boolean(providers.google?.configured), Boolean(providers.google?.linked), providers.google?.identity) +
      providerButton("microsoft", "Microsoft", Boolean(providers.microsoft?.configured), Boolean(providers.microsoft?.linked), providers.microsoft?.identity);
    const passkey = accountData?.passkey || {};
    const ownerId = String(accountData?.ownerId || "");
    const leaveLabel = t("settings.leaveLabel");
    scroll.innerHTML = `
      <div class="devmoter-settings-profile detail">
        <span class="devmoter-settings-avatar">DM</span>
        <span>
          <strong>${escapeHtml(identity?.login || "devmoter")}</strong>
          <small>${escapeHtml(t("settings.account.ownerId"))} <span class="devmoter-settings-mono" title="${escapeHtml(ownerId)}">${escapeHtml(shortId(ownerId))}</span></small>
        </span>
        ${ownerId ? `<button type="button" class="devmoter-settings-copy" data-action="account:copy-owner" aria-label="${escapeHtml(t("settings.account.copyOwnerAria"))}">${escapeHtml(t("common.copy"))}</button>` : ""}
      </div>
      <section class="devmoter-settings-section"><h2>${escapeHtml(t("settings.account.signInMethods"))}</h2><div class="devmoter-settings-card">
        ${providerRows}
        <div class="devmoter-settings-device"><span><strong>${escapeHtml(t("settings.account.passkeyName"))}</strong><small>${escapeHtml(passkey.available ? t("settings.account.passkeyAvailable") : t("settings.account.passkeyMissing"))}</small></span><button type="button" data-action="open:passkeys" aria-label="${escapeHtml(t("settings.account.managePasskeysAria", { leave: leaveLabel }))}">${escapeHtml(t("settings.account.manage"))}${LEAVE_ICON}</button></div>
        <div class="devmoter-settings-device"><span><strong>${escapeHtml(t("settings.account.localRecovery"))}</strong><small>${escapeHtml(accountData?.localRecovery ? t("settings.account.available") : t("settings.account.unavailable"))}</small></span><span class="devmoter-settings-badge">${escapeHtml(t("settings.account.recoveryBadge"))}</span></div>
      </div></section>
      ${githubLink ? '<section class="devmoter-settings-section"><h2>' + escapeHtml(t("settings.account.githubLinkTitle")) + '</h2><div class="devmoter-settings-card devmoter-settings-detail-card"><p>' + escapeHtml(t("settings.account.githubLinkPrompt")) + '</p><strong>' +
        escapeHtml(githubLink.userCode || "") + '</strong><div class="devmoter-settings-actions"><button type="button" data-action="account:github-open">' + escapeHtml(t("settings.account.openGithub")) + '</button><button type="button" data-action="account:github-cancel">' + escapeHtml(t("common.cancel")) + '</button></div><small>' + escapeHtml(t("settings.account.githubCodeWarning")) + '</small></div></section>' : ""}
      <section class="devmoter-settings-section"><h2>${escapeHtml(t("settings.account.sessionsHeading"))}</h2><div class="devmoter-settings-card">${renderSessions(sessions)}</div>
        ${sessions.some((session: Json) => !session.current) ? `<div class="devmoter-settings-actions"><button type="button" data-action="account:revoke-others">${escapeHtml(t("settings.account.revokeOthers"))}</button></div>` : ""}
      </section>
      <div class="devmoter-settings-card devmoter-settings-logout-card">
        ${row("logout", t("settings.root.logout"), { action: "logout", danger: true })}
      </div>
    `;
    wireRows();
  }

  async function renderDevices() {
    setHeader(t("settings.root.devices"), t("settings.devices.subtitle"));
    let deviceData: Json | null = null;
    try {
      deviceData = await request("/api/devices", {}, true);
    } catch {
      deviceData = null;
    }
    const trusted = Boolean(deviceData);
    const devices = Array.isArray(deviceData?.devices) ? deviceData!.devices : [];
    const localBootstrap = isLoopbackBrowser();
    const trustedDeviceCount = Number(diagnostics?.deviceSecurity?.trustedDevices || 0);
    const untrustedGuidance = localBootstrap
      ? t("settings.devices.guidanceLocal")
      : trustedDeviceCount > 0
        ? t("settings.devices.guidanceRemote")
        : t("settings.devices.guidanceBootstrap");
    scroll.innerHTML = `
      <section class="devmoter-settings-section">
        <h2>${escapeHtml(t("settings.devices.thisDevice"))}</h2>
        <div class="devmoter-settings-card devmoter-settings-detail-card">
          <div class="devmoter-settings-detail-row">
            <span>${escapeHtml(t("settings.devices.status"))}</span><strong>${escapeHtml(trusted ? t("settings.devices.trusted") : t("settings.devices.unregistered"))}</strong>
          </div>
          <div class="devmoter-settings-actions">
            ${trusted
              ? `<button type="button" data-action="device:create-code">${escapeHtml(t("settings.devices.createCode"))}</button>`
              : localBootstrap
                ? `<button type="button" data-action="device:bootstrap">${escapeHtml(t("settings.devices.trustThisBrowser"))}</button>`
                : ""}
          </div>
          ${trusted ? "" : `<div class="devmoter-settings-note">${escapeHtml(untrustedGuidance)}</div>`}
        </div>
      </section>

      <section class="devmoter-settings-section">
        <h2>${escapeHtml(t("settings.devices.pairAnother"))}</h2>
        <div class="devmoter-settings-card devmoter-settings-form-card">
          <input data-pair-code inputmode="numeric" maxlength="6" placeholder="${escapeHtml(t("settings.devices.pairPlaceholder"))}" />
          <button type="button" data-action="device:claim">${escapeHtml(t("settings.devices.pairButton"))}</button>
        </div>
      </section>

      <section class="devmoter-settings-section">
        <h2>${escapeHtml(t("settings.devices.registeredHeading"))}</h2>
        <div class="devmoter-settings-card">
          ${devices.length ? devices.map((device: Json) => `
            <div class="devmoter-settings-device">
              <span><strong>${escapeHtml(device.label || t("settings.devices.deviceDefaultLabel"))}</strong><small>${escapeHtml(t("settings.devices.deviceMeta", {
                current: device.current ? t("settings.devices.thisDevicePrefix") : "",
                lastUsed: formatDateTime(device.lastUsedAt)
              }))}</small></span>
              <button type="button" data-action="device:revoke" data-device-id="${escapeHtml(device.id)}">${escapeHtml(t("common.revoke"))}</button>
            </div>
          `).join("") : `<div class="devmoter-settings-empty">${escapeHtml(t("settings.devices.empty"))}</div>`}
        </div>
      </section>
      <div class="devmoter-settings-note">${escapeHtml(t("settings.devices.note"))}</div>
    `;
    wireRows();
  }

  async function renderVault() {
    setHeader(t("settings.root.vault"), t("settings.vault.subtitle"));
    const trusted = await request("/api/devices", {}, true).then(() => true).catch(() => false);
    if (!trusted) {
      scroll.innerHTML = `
        <div class="devmoter-settings-note">${escapeHtml(t("settings.vault.needTrust"))}</div>
        <div class="devmoter-settings-card devmoter-settings-action-card">
          <button type="button" data-action="page:devices">${escapeHtml(t("settings.vault.goToDevices"))}</button>
        </div>
      `;
      wireRows();
      return;
    }

    let status: Json;
    try {
      status = await request("/api/secrets/status", {}, true);
    } catch (error) {
      scroll.replaceChildren();
      const message = document.createElement("p");
      message.className = "devmoter-settings-note";
      message.textContent = errorMessage(error, t("common.error"));
      scroll.appendChild(message);
      return;
    }

    if (!status.initialized || !status.unlocked) {
      const action = status.initialized ? "unlock" : "initialize";
      const label = status.initialized ? t("settings.vault.unlockButton") : t("settings.vault.createButton");
      scroll.innerHTML = `
        <section class="devmoter-settings-section">
          <h2>${escapeHtml(status.initialized ? t("settings.vault.lockedHeading") : t("settings.vault.newHeading"))}</h2>
          <form class="devmoter-settings-card devmoter-settings-form-card" data-vault-unlock-form>
            <label for="devmoterVaultPassphrase">${escapeHtml(t("settings.vault.passphraseLabel"))}</label>
            <input id="devmoterVaultPassphrase" data-vault-passphrase type="password" autocomplete="current-password" minlength="12" maxlength="1024" required />
            <small>${escapeHtml(t("settings.vault.passphraseHelp"))}</small>
            <button type="submit">${escapeHtml(label)}</button>
          </form>
        </section>
        <p class="devmoter-settings-note">${escapeHtml(t("settings.vault.unlockNote"))}</p>
      `;
      scroll.querySelector<HTMLFormElement>("[data-vault-unlock-form]")?.addEventListener("submit", async event => {
        event.preventDefault();
        const input = scroll.querySelector<HTMLInputElement>("[data-vault-passphrase]");
        const passphrase = input?.value || "";
        if (input) input.value = "";
        try {
          await request(`/api/secrets/${action}`, {
            method: "POST",
            body: JSON.stringify({ passphrase })
          }, true);
          toast(action === "initialize" ? t("settings.vault.initializedToast") : t("settings.vault.unlockedToast"));
          await renderVault();
        } catch (error) {
          toast(errorMessage(error, t("common.error")));
        }
      });
      wireRows();
      return;
    }

    let secrets: Json[] = [];
    let projects: Json[] = [];
    try {
      const [vaultData, projectData] = await Promise.all([
        request("/api/secrets", {}, true),
        request("/api/projects")
      ]);
      secrets = Array.isArray(vaultData.secrets) ? vaultData.secrets : [];
      vaultSecrets = secrets;
      projects = Array.isArray(projectData.projects) ? projectData.projects.filter((project: Json) => project.available !== false) : [];
    } catch (error) {
      scroll.replaceChildren();
      const message = document.createElement("p");
      message.className = "devmoter-settings-note";
      message.textContent = errorMessage(error, t("common.error"));
      scroll.appendChild(message);
      return;
    }

    const projectOptions = projects.map(project => `
      <label class="devmoter-vault-project-option">
        <input type="checkbox" data-vault-project value="${escapeHtml(project.id)}" />
        <span>${escapeHtml(project.name || project.id)}</span>
      </label>
    `).join("");
    const secretRows = secrets.length ? secrets.map(secret => `
      <article class="devmoter-vault-secret">
        <div class="devmoter-vault-secret-main">
          <strong>${escapeHtml(secret.provider)}/${escapeHtml(secret.name)}</strong>
          <small>•••••••• · ${escapeHtml(secret.purpose || t("settings.vault.purposeEmpty"))}</small>
          <small>${escapeHtml(t("settings.vault.secretMeta", {
            count: Array.isArray(secret.projectIds) ? secret.projectIds.length : 0,
            lastUsed: secret.lastUsedAt ? formatDateTime(secret.lastUsedAt) : t("settings.vault.unused")
          }))}</small>
          ${secret.duplicate ? `<small class="devmoter-vault-warning">${escapeHtml(t("settings.vault.duplicateWarning"))}</small>` : ""}
        </div>
        <div class="devmoter-vault-secret-actions">
          <button type="button" data-action="vault:edit" data-vault-reference="${escapeHtml(secret.reference)}">${escapeHtml(t("settings.vault.updateAction"))}</button>
          <button type="button" data-action="vault:delete" data-vault-reference="${escapeHtml(secret.reference)}">${escapeHtml(t("common.delete"))}</button>
        </div>
      </article>
    `).join("") : `<div class="devmoter-settings-empty">${escapeHtml(t("settings.vault.empty"))}</div>`;

    scroll.innerHTML = `
      <section class="devmoter-settings-section">
        <h2>${escapeHtml(t("settings.vault.statusHeading"))}</h2>
        <div class="devmoter-settings-card devmoter-settings-detail-card">
          <div class="devmoter-settings-detail-row"><span>${escapeHtml(t("settings.devices.status"))}</span><strong>${escapeHtml(t("settings.vault.unlockedCount", { count: formatNumber(Number(status.count ?? secrets.length)) }))}</strong></div>
          <div class="devmoter-settings-actions"><button type="button" data-action="vault:lock">${escapeHtml(t("settings.vault.lockButton"))}</button></div>
        </div>
      </section>
      <section class="devmoter-settings-section">
        <h2>${escapeHtml(t("settings.vault.registeredHeading"))}</h2>
        <div class="devmoter-settings-card devmoter-vault-list">${secretRows}</div>
      </section>
      <section class="devmoter-settings-section">
        <h2 data-vault-form-title>${escapeHtml(t("settings.vault.addHeading"))}</h2>
        <form class="devmoter-settings-card devmoter-settings-form-card" data-vault-form>
          <label>${escapeHtml(t("settings.vault.providerLabel"))}<input name="provider" autocomplete="off" maxlength="80" required placeholder="${escapeHtml(t("settings.vault.providerPlaceholder"))}" /></label>
          <label>${escapeHtml(t("settings.vault.nameLabel"))}<input name="name" autocomplete="off" maxlength="80" required placeholder="${escapeHtml(t("settings.vault.namePlaceholder"))}" /></label>
          <label>${escapeHtml(t("settings.vault.valueLabel"))}<input name="value" type="password" autocomplete="new-password" maxlength="16384" required /></label>
          <label>${escapeHtml(t("settings.vault.purposeLabel"))}<input name="purpose" autocomplete="off" maxlength="200" placeholder="${escapeHtml(t("settings.vault.purposePlaceholder"))}" /></label>
          <label>${escapeHtml(t("settings.vault.envLabel"))}<input name="envName" autocomplete="off" maxlength="128" placeholder="${escapeHtml(t("settings.vault.envPlaceholder"))}" /></label>
          <fieldset class="devmoter-vault-projects"><legend>${escapeHtml(t("settings.vault.projectsLegend"))}</legend>${projectOptions || `<small>${escapeHtml(t("settings.vault.noProjects"))}</small>`}</fieldset>
          <button type="submit" ${projects.length ? "" : "disabled"} data-vault-save>${escapeHtml(t("settings.vault.saveButton"))}</button>
          <small>${escapeHtml(t("settings.vault.aesNote"))}</small>
        </form>
      </section>
      <p class="devmoter-settings-note">${escapeHtml(t("settings.vault.footerNote"))}</p>
    `;

    vaultFormElement = scroll.querySelector<HTMLFormElement>("[data-vault-form]");
    vaultFormElement?.addEventListener("submit", async event => {
      event.preventDefault();
      const form = event.currentTarget as HTMLFormElement;
      const data = new FormData(form);
      const projectIds = [...scroll.querySelectorAll<HTMLInputElement>("[data-vault-project]:checked")].map(input => input.value);
      const provider = String(data.get("provider") || "").trim();
      const name = String(data.get("name") || "").trim();
      const reference = `secret://${provider}/${name}`;
      const replacing = secrets.some(secret => secret.reference === reference);
      if (!projectIds.length) {
        toast(t("settings.vault.selectProjectToast"));
        return;
      }
      if (replacing && !window.confirm(t("settings.vault.confirmReplace", { reference }))) return;
      const saveButton = form.querySelector<HTMLButtonElement>("[data-vault-save]");
      if (saveButton) saveButton.disabled = true;
      try {
        await request("/api/secrets", {
          method: "PUT",
          body: JSON.stringify({
            provider,
            name,
            value: data.get("value"),
            purpose: data.get("purpose"),
            envName: data.get("envName"),
            projectIds,
            ...(replacing ? { confirmReplace: true } : {})
          })
        }, true);
        form.reset();
        toast(t("settings.vault.savedToast"));
        await renderVault();
      } catch (error) {
        if (saveButton) saveButton.disabled = false;
        toast(errorMessage(error, t("common.error")));
      }
    });

    wireRows();
  }

  async function currentSubscription(): Promise<{ readiness: PushReadiness; subscription: PushSubscription | null }> {
    const supported = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
    const readiness = await inspectPushReadiness(
      supported ? navigator.serviceWorker : null,
      supported ? Notification.permission : null
    );
    if (readiness.state !== "ready" || !readiness.registration) return { readiness, subscription: null };
    try {
      return { readiness, subscription: await boundedPushWait(readiness.registration.pushManager.getSubscription()) };
    } catch {
      return { readiness: { state: "error" }, subscription: null };
    }
  }

  async function renderNotifications() {
    const renderId = ++notificationRenderId;
    setHeader(t("settings.root.notifications"), t("settings.notifications.subtitle"));
    const renderContent = (state: PushReadiness["state"] | "loading", subscription: PushSubscription | null, trusted: boolean) => {
      const status = state === "loading" ? t("settings.notifications.statusChecking")
        : state === "ready" ? (subscription ? t("common.enabled") : t("common.disabled"))
        : state === "unsupported" ? t("settings.notifications.statusUnsupported")
        : state === "unregistered" ? t("settings.notifications.statusUnregistered")
        : state === "denied" ? t("settings.notifications.statusDenied")
        : t("settings.notifications.statusError");
      const explanation = state === "loading" ? t("settings.notifications.expChecking")
        : state === "ready" ? (subscription ? t("settings.notifications.expEnabled") : t("settings.notifications.expReady"))
        : state === "unsupported" ? t("settings.notifications.expUnsupported")
        : state === "unregistered" ? t("settings.notifications.expUnregistered")
        : state === "denied" ? t("settings.notifications.expDenied")
        : t("settings.notifications.expError");
      const canEnable = state === "ready" && !subscription;
      const canDisable = state === "ready" && !!subscription;
      scroll.innerHTML = `
      ${section(t("settings.notifications.sectionPush"),
        row("notifications", t("settings.notifications.statusLabel"), { value: status }) +
        row("device", t("settings.root.devices"), { action: "page:devices", value: trusted ? t("settings.notifications.registered") : t("settings.notifications.registerFirst") })
      )}
      <div class="devmoter-settings-note">${escapeHtml(explanation)}</div>
      <div class="devmoter-settings-card devmoter-settings-action-card">
        <button type="button" data-action="push:retry">${escapeHtml(t("settings.notifications.retry"))}</button>
        <button type="button" data-action="push:enable" ${canEnable ? "" : "disabled"}>${escapeHtml(t("settings.notifications.enable"))}</button>
        <button type="button" data-action="push:disable" ${canDisable ? "" : "disabled"}>${escapeHtml(t("settings.notifications.disable"))}</button>
      </div>
      <div class="devmoter-settings-note">
        ${escapeHtml(t("settings.notifications.privacyNote"))}
      </div>
      `;
      wireRows();
    };
    let state: PushReadiness["state"] | "loading" = "loading";
    let subscription: PushSubscription | null = null;
    let trusted = false;
    renderContent(state, subscription, trusted);
    void currentSubscription()
      .catch(() => ({ readiness: { state: "error" as const }, subscription: null }))
      .then(push => {
        if (renderId !== notificationRenderId || page !== "notifications") return;
        state = push.readiness.state;
        subscription = push.subscription;
        renderContent(state, subscription, trusted);
      });
    void request("/api/devices", {}, true).then(() => {
      if (renderId !== notificationRenderId || page !== "notifications") return;
      trusted = true;
      renderContent(state, subscription, trusted);
    }).catch(() => {});
  }

  function cliRows() {
    if (!cliStatus.length) return `<div class="devmoter-settings-health-row"><strong>${escapeHtml(t("settings.diagnostics.cliHeading"))}</strong><small>${escapeHtml(t("settings.diagnostics.cliUnavailable"))}</small></div>`;
    return cliStatus.map((cli: Json) => {
      const ready = cli?.presence === "ready";
      const state = ready ? t("settings.diagnostics.cliReady") : cli?.presence === "missing" ? t("settings.diagnostics.cliMissing") : t("settings.diagnostics.cliError");
      const detail = ready && cli?.version ? `${state} ${cli.version}` : state;
      return `
        <div class="devmoter-settings-health-row">
          <span class="${ready ? "ok" : "bad"}" aria-hidden="true">${ready ? ICONS.check : ICONS.report}</span>
          <strong>${escapeHtml(cli?.label || cli?.command || "")}</strong>
          <small>${escapeHtml(detail)}</small>
        </div>`;
    }).join("");
  }

  function prerequisiteRows() {
    const required = diagnostics?.prerequisites?.required || {};
    return Object.entries(required).map(([name, value]: [string, any]) => `
      <div class="devmoter-settings-health-row">
        <span class="${value?.available ? "ok" : "bad"}" aria-hidden="true">${value?.available ? ICONS.check : ICONS.report}</span>
        <strong>${escapeHtml(name)}</strong>
        <small>${escapeHtml(value?.version || (value?.available ? t("settings.diagnostics.prereqAvailable") : t("settings.diagnostics.prereqMissing")))}</small>
      </div>
    `).join("");
  }

  function renderDiagnostics() {
    setHeader(t("settings.root.diagnostics"), t("settings.diagnostics.subtitle"));
    const fetchState = describeHealthFetch(diagnosticsFetch);
    scroll.innerHTML = `
      <section class="devmoter-settings-section">
        <h2>${escapeHtml(t("settings.diagnostics.statusHeading"))}</h2>
        <div class="devmoter-settings-note" data-diagnostics-fetched data-tone="${escapeHtml(fetchState.tone)}" role="status">${escapeHtml(fetchState.text)}</div>
        <div class="devmoter-settings-actions"><button type="button" data-action="diagnostics:refresh" ${diagnosticsFetch.loading ? "disabled" : ""}>${escapeHtml(t("common.refresh"))}</button></div>
        <div class="devmoter-settings-card devmoter-settings-detail-card">
          <div class="devmoter-settings-detail-row"><span>${escapeHtml(t("settings.diagnostics.appLabel"))}</span><strong>${escapeHtml(diagnostics?.app?.version || t("common.unknown"))}</strong></div>
          <div class="devmoter-settings-detail-row"><span>${escapeHtml(t("settings.diagnostics.nodeLabel"))}</span><strong data-diagnostics-node>${escapeHtml(formatNodeVersion(diagnostics?.app?.node))}</strong></div>
          <div class="devmoter-settings-detail-row"><span>${escapeHtml(t("settings.diagnostics.buildLabel"))}</span><strong data-diagnostics-build>${escapeHtml(formatBuildId(diagnostics?.app?.build))}</strong></div>
          <div class="devmoter-settings-detail-row"><span>OpenCode</span><strong>${escapeHtml(diagnostics?.backends?.opencode?.online ? t("common.online") : t("common.offline"))}</strong></div>
          <div class="devmoter-settings-detail-row"><span>Codex</span><strong>${escapeHtml(diagnostics?.backends?.codex?.online ? t("common.online") : t("common.offline"))}</strong></div>
          <div class="devmoter-settings-detail-row"><span>${escapeHtml(t("settings.diagnostics.projectsLabel"))}</span><strong>${escapeHtml(formatNumber(Number(diagnostics?.projects?.count ?? 0)))}</strong></div>
          <div class="devmoter-settings-detail-row"><span>${escapeHtml(t("settings.diagnostics.networkLabel"))}</span><strong>${escapeHtml(diagnostics?.network?.localhostFirst ? t("settings.diagnostics.networkLocalhost") : t("settings.diagnostics.networkCustom"))}</strong></div>
        </div>
      </section>
      <section class="devmoter-settings-section">
        <h2>${escapeHtml(t("settings.diagnostics.cliHeading"))}</h2>
        <div class="devmoter-settings-card devmoter-settings-health">${cliRows()}</div>
      </section>
      <section class="devmoter-settings-section">
        <h2>${escapeHtml(t("settings.diagnostics.prereqHeading"))}</h2>
        <div class="devmoter-settings-card devmoter-settings-health">${prerequisiteRows()}</div>
      </section>
      <div class="devmoter-settings-note">${escapeHtml(diagnostics?.network?.message || "")}</div>
    `;
  }

  function renderGuide() {
    setHeader(t("settings.root.guide"), t("settings.guide.subtitle"));
    scroll.innerHTML = `
      <section class="devmoter-guide-hero">
        <strong>${escapeHtml(t("settings.guide.heroTitle"))}</strong>
        <p>${escapeHtml(t("settings.guide.heroCopy"))}</p>
      </section>
      ${section(t("settings.guide.sectionBasics"),
        row("1", t("settings.guide.step1Title"), { value: t("settings.guide.step1Value") }) +
        row("2", t("settings.guide.step2Title"), { value: t("settings.guide.step2Value") }) +
        row("3", t("settings.guide.step3Title"), { value: t("settings.guide.step3Value") }) +
        row("4", t("settings.guide.step4Title"), { action: "open:automation", value: t("settings.guide.step4Value") }) +
        row("5", t("settings.guide.step5Title"), { value: t("settings.guide.step5Value") })
      )}
      ${section(t("settings.guide.sectionHelp"),
        row("diagnostics", t("settings.guide.viewDiagnostics"), { action: "page:diagnostics" }) +
        row("safety", t("settings.root.safety"), { action: "open:safety", value: t("settings.guide.safetyValue") }) +
        row("terminal", t("settings.root.terminal"), { action: "open:terminal", value: t("settings.guide.terminalValue") })
      )}
    `;
    wireRows();
  }

  function renderLanguage() {
    setHeader(t("settings.root.language"), t("settings.appearance.languageSection"));
    const lang = getLanguage();
    scroll.innerHTML = `
      ${section(t("settings.appearance.languageSection"),
        row("language", t("language.ja"), { action: "lang:ja", value: lang === "ja" ? t("settings.selected") : "" }) +
        row("language", t("language.en"), { action: "lang:en", value: lang === "en" ? t("settings.selected") : "" }) +
        row("language", t("language.zh-Hans"), { action: "lang:zh-Hans", value: lang === "zh-Hans" ? t("settings.selected") : "" }) +
        row("language", t("language.zh-Hant"), { action: "lang:zh-Hant", value: lang === "zh-Hant" ? t("settings.selected") : "" })
      )}
      <div class="devmoter-settings-note">
        ${escapeHtml(t("settings.appearance.languageNote"))}
      </div>
    `;
    wireRows();
  }

  async function renderPage() {
    if (page === "root") return renderRoot();
    if (page === "appearance") return renderAppearance();
    if (page === "language") return renderLanguage();
    if (page === "account") return renderAccount();
    if (page === "devices") return void renderDevices();
    if (page === "vault") return void renderVault();
    if (page === "notifications") return void renderNotifications();
    if (page === "diagnostics") return renderDiagnostics();
    return renderGuide();
  }

  async function pollGithubLink() {
    const activeFlow = githubLink;
    if (!activeFlow?.flowId) return;
    if (Date.now() >= Number(activeFlow.expiresAt || 0)) {
      githubLink = null;
      toast(t("settings.account.githubExpired"));
      await renderAccount();
      return;
    }
    try {
      const result = await request("/api/auth/github/poll", {
        method: "POST",
        body: JSON.stringify({ flowId: activeFlow.flowId })
      });
      if (githubLink?.flowId !== activeFlow.flowId) return;
      if (result.status === "complete" || result.complete === true) {
        githubLink = null;
        toast(t("settings.account.githubLinked"));
        await renderAccount();
        return;
      }
      const delay = Math.max(1000, Number(result.retryAfterMs || Number(activeFlow.interval || 5) * 1000));
      window.setTimeout(() => void pollGithubLink(), delay);
    } catch (error) {
      if (githubLink?.flowId !== activeFlow.flowId) return;
      githubLink = null;
      toast(errorMessage(error, t("settings.account.githubVerifyFailed")));
      await renderAccount();
    }
  }

  function close() {
    modal.classList.add("hidden");
    document.body.classList.remove("devmoter-settings-open");
    page = "root";
  }

  const clickFirst = (selector: string) => {
    const target = document.querySelector<HTMLElement>(selector);
    if (!target) {
      toast(t("settings.featureUnavailableToast"));
      return false;
    }
    target.click();
    return true;
  };
  // Each target opens the same control its own screen uses. On mobile the
  // floating launchers are hidden by CSS, so these rows may be the only entry.
  const launchApp = (id: string) => () => window.dispatchEvent(new CustomEvent("devmoter:launch-app", { detail: { id } }));
  const command = (name: string) => () => window.dispatchEvent(new CustomEvent("devmoter:workspace-command", { detail: { command: name } }));
  const controlTab = (tab: string) => () => {
    if (!clickFirst(".dm-control-trigger")) return;
    window.setTimeout(() => document.querySelector<HTMLButtonElement>(`.dm-control-tabs [data-tab="${tab}"]`)?.click(), 0);
  };
  const toolsTab = (index: number) => () => {
    if (!clickFirst(".dm-tools-launcher")) return;
    window.setTimeout(() => document.querySelectorAll<HTMLButtonElement>(".dm-tools-tabs button")[index]?.click(), 0);
  };
  const OPEN_TARGETS: Record<OpenTarget, () => void> = {
    sessions: launchApp("sessions"),
    review: launchApp("review"),
    agents: launchApp("agents"),
    automation: launchApp("automation"),
    terminal: launchApp("terminal"),
    passkeys: controlTab("passkeys"),
    hosts: controlTab("hosts"),
    safety: toolsTab(1),
    index: toolsTab(2),
    context: command("context"),
    checkpoints: command("checkpoints"),
    extensions: command("extensions"),
    files: () => void clickFirst(".adv-fab")
  };

  /** The only way a row leaves Settings: close first, then open the target. */
  function leave(target: string) {
    const open = OPEN_TARGETS[target as OpenTarget];
    if (!open) return;
    close();
    // Defer past this click so the target's own outside-click handlers do not
    // see the Settings tap and close it again.
    window.setTimeout(open, 0);
  }

  async function enablePush() {
    const trusted = await request("/api/devices", {}, true).then(() => true).catch(() => false);
    if (!trusted) {
      toast(t("settings.notifications.needTrustToast"));
      setPage("devices");
      return;
    }
    if (!("Notification" in window) || !("serviceWorker" in navigator) || !("PushManager" in window)) {
      toast(t("settings.notifications.expUnsupported"));
      return;
    }
    const readiness = await inspectPushReadiness(navigator.serviceWorker, Notification.permission);
    if (readiness.state !== "ready" || !readiness.registration) {
      const message = readiness.state === "unregistered"
        ? t("settings.notifications.swUnregisteredToast")
        : readiness.state === "unsupported"
          ? t("settings.notifications.expUnsupported")
          : readiness.state === "denied"
            ? t("settings.notifications.swDeniedToast")
            : t("settings.notifications.swErrorToast");
      toast(message);
      return;
    }
    const registration = readiness.registration;
    const permission = Notification.permission === "granted"
      ? Notification.permission
      : await Notification.requestPermission();
    if (permission !== "granted") {
      toast(t("settings.notifications.permissionDeniedToast"));
      return;
    }
    const key = await request("/api/push/key");
    let subscription = await boundedPushWait(registration.pushManager.getSubscription());
    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: b64urlToBytes(key.publicKey)
      });
    }
    await request("/api/push/subscriptions", {
      method: "POST",
      body: JSON.stringify({ endpoint: subscription.endpoint })
    }, true);
    toast(t("settings.notifications.enabledToast"));
    await renderNotifications();
  }

  async function disablePush() {
    const { subscription } = await currentSubscription();
    if (subscription) {
      await request("/api/push/subscriptions", {
        method: "DELETE",
        body: JSON.stringify({ endpoint: subscription.endpoint })
      }, true).catch(() => {});
      await subscription.unsubscribe().catch(() => false);
    }
    toast(t("settings.notifications.disabledToast"));
    await renderNotifications();
  }

  function wireRows() {
    for (const button of scroll.querySelectorAll<HTMLButtonElement>("[data-action]")) {
      button.addEventListener("click", async () => {
        const action = button.dataset.action || "";
        if (action.startsWith("page:")) {
          setPage(action.slice(5) as SettingsPage);
          return;
        }
        if (action.startsWith("theme:")) {
          applyTheme(action.slice(6) as "system" | "light" | "dark");
          renderAppearance();
          return;
        }
        if (action.startsWith("density:")) {
          const density = action.slice(8);
          localStorage.setItem(DENSITY_KEY, density);
          document.documentElement.dataset.devmoterDensity = density;
          renderAppearance();
          return;
        }
        if (action.startsWith("lang:")) {
          const nextLang = action.slice(5);
          toast(t("language.reloadNotice"));
          setLanguage(nextLang, { reload: true });
          void renderPage();
          return;
        }
        if (action.startsWith("open:")) {
          leave(action.slice(5));
          return;
        }
        if (action === "diagnostics:refresh") {
          diagnosticsFetch.loading = true;
          renderDiagnostics();
          wireRows();
          await refreshDiagnostics();
          if (page === "diagnostics") renderDiagnostics();
          wireRows();
          return;
        }
        if (action === "account:connect") {
          const provider = button.dataset.provider || "";
          try {
            const result = await request(`/api/auth/${encodeURIComponent(provider)}/start`, {
              method: "POST",
              body: JSON.stringify({ intent: "link" })
            });
            if (provider === "github") {
              githubLink = {
                flowId: result.flowId,
                userCode: result.userCode,
                verificationUri: result.verificationUri,
                interval: result.interval,
                expiresAt: Date.now() + Number(result.expiresIn || 0) * 1000
              };
              await renderAccount();
              const uri = new URL(String(result.verificationUri || ""));
              if (uri.protocol === "https:") window.open(uri.href, "_blank", "noopener,noreferrer");
              void pollGithubLink();
            } else if (typeof result.authorizationUrl === "string") {
              location.assign(result.authorizationUrl);
            } else {
              toast(t("settings.account.connectFailed"));
            }
          } catch (error) {
            toast(errorMessage(error, t("settings.account.connectFailed")));
          }
          return;
        }
        if (action === "account:copy-owner") {
          const ownerId = String(accountData?.ownerId || "");
          toast(await copyText(ownerId) ? t("settings.account.ownerCopied") : t("common.copyFailed"));
          return;
        }
        if (action === "account:disconnect") {
          const provider = button.dataset.provider || "";
          if (!window.confirm(t("settings.account.confirmDisconnect", { provider }))) return;
          try {
            const result = await request(`/api/auth/providers/${encodeURIComponent(provider)}/disconnect`, {
              method: "POST",
              body: "{}"
            });
            if (result.reauthenticate) { location.replace("/login.html"); return; }
            toast(t("settings.account.disconnected"));
            await renderAccount();
          } catch (error) {
            toast(errorMessage(error, t("settings.account.disconnectFailed")));
          }
          return;
        }
        if (action === "account:github-open") {
          try {
            const uri = new URL(String(githubLink?.verificationUri || ""));
            if (uri.protocol === "https:") window.open(uri.href, "_blank", "noopener,noreferrer");
          } catch { toast(t("settings.account.githubOpenFailed")); }
          return;
        }
        if (action === "account:github-cancel") {
          githubLink = null;
          await renderAccount();
          return;
        }
        if (action === "account:revoke-session") {
          const sessionId = button.dataset.sessionId || "";
          if (!window.confirm(t("settings.account.confirmRevokeSession"))) return;
          try {
            await request(`/api/auth/sessions/${encodeURIComponent(sessionId)}`, { method: "DELETE" });
            toast(t("settings.account.sessionRevoked"));
            await renderAccount();
          } catch (error) {
            toast(errorMessage(error, t("settings.account.sessionRevokeFailed")));
          }
          return;
        }
        if (action === "account:revoke-others") {
          if (!window.confirm(t("settings.account.confirmRevokeOthers"))) return;
          try {
            await request("/api/auth/sessions/revoke-others", { method: "POST", body: "{}" });
            toast(t("settings.account.othersRevoked"));
            await renderAccount();
          } catch (error) {
            toast(errorMessage(error, t("settings.account.sessionRevokeFailed")));
          }
          return;
        }
        if (action === "device:bootstrap") {
          try {
            await request("/api/devices/bootstrap", {
              method: "POST",
              body: JSON.stringify({ label: deviceBrowserLabel() })
            });
            toast(t("settings.devices.bootstrapped"));
            await renderDevices();
          } catch (error) {
            toast(errorMessage(error, t("common.error")));
          }
          return;
        }
        if (action === "device:create-code") {
          try {
            const result = await request("/api/pairings", { method: "POST" }, true);
            toast(t("settings.devices.codeToast", { code: result.code }));
          } catch (error) {
            toast(errorMessage(error, t("common.error")));
          }
          return;
        }
        if (action === "device:claim") {
          const input = scroll.querySelector<HTMLInputElement>("[data-pair-code]");
          try {
            await request("/api/pairings/claim", {
              method: "POST",
              body: JSON.stringify({
                code: input?.value || "",
                label: deviceBrowserLabel()
              })
            });
            toast(t("settings.devices.pairedToast"));
            await renderDevices();
          } catch (error) {
            toast(errorMessage(error, t("common.error")));
          }
          return;
        }
        if (action === "device:revoke") {
          try {
            await request(`/api/devices/${encodeURIComponent(button.dataset.deviceId || "")}`, { method: "DELETE" }, true);
            toast(t("settings.devices.revokedToast"));
            await renderDevices();
          } catch (error) {
            toast(errorMessage(error, t("common.error")));
          }
          return;
        }
        if (action === "vault:lock") {
          try {
            await request("/api/secrets/lock", { method: "POST", body: "{}" }, true);
            toast(t("settings.vault.lockedToast"));
            await renderVault();
          } catch (error) {
            toast(errorMessage(error, t("common.error")));
          }
          return;
        }
        if (action === "vault:delete") {
          const reference = button.dataset.vaultReference || "";
          if (window.prompt(t("settings.vault.deletePrompt", { reference })) !== reference) return;
          const match = reference.match(/^secret:\/\/([^/]+)\/([^/]+)$/);
          if (!match) return;
          try {
            await request(`/api/secrets/${encodeURIComponent(match[1])}/${encodeURIComponent(match[2])}`, {
              method: "DELETE",
              body: JSON.stringify({ confirmReference: reference })
            }, true);
            toast(t("settings.vault.deletedToast"));
            await renderVault();
          } catch (error) {
            toast(errorMessage(error, t("common.error")));
          }
          return;
        }
        if (action === "vault:edit") {
          const reference = button.dataset.vaultReference || "";
          const secret = vaultSecrets.find(item => item.reference === reference);
          if (!secret || !vaultFormElement) return;
          const providerInput = vaultFormElement.elements.namedItem("provider") as HTMLInputElement;
          const nameInput = vaultFormElement.elements.namedItem("name") as HTMLInputElement;
          const purposeInput = vaultFormElement.elements.namedItem("purpose") as HTMLInputElement;
          const envInput = vaultFormElement.elements.namedItem("envName") as HTMLInputElement;
          providerInput.value = secret.provider;
          nameInput.value = secret.name;
          purposeInput.value = secret.purpose || "";
          envInput.value = secret.envName || "";
          for (const projectInput of scroll.querySelectorAll<HTMLInputElement>("[data-vault-project]")) {
            projectInput.checked = Array.isArray(secret.projectIds) && secret.projectIds.includes(projectInput.value);
          }
          const heading = scroll.querySelector<HTMLElement>("[data-vault-form-title]");
          if (heading) heading.textContent = t("settings.vault.editHeading", { reference });
          const valueInput = vaultFormElement.elements.namedItem("value") as HTMLInputElement;
          valueInput.placeholder = t("settings.vault.newValuePlaceholder");
          valueInput.focus();
          vaultFormElement.scrollIntoView({ behavior: "smooth", block: "start" });
          return;
        }
        if (action === "push:enable") {
          try { await enablePush(); } catch (error) { toast(errorMessage(error, t("common.error"))); }
          return;
        }
        if (action === "push:retry") {
          await renderNotifications();
          return;
        }
        if (action === "push:disable") {
          try { await disablePush(); } catch (error) { toast(errorMessage(error, t("common.error"))); }
          return;
        }
        if (action === "report") {
          window.open("https://github.com/syr4wpywkk-collab/DevMoter-FAST/issues/new", "_blank", "noopener,noreferrer");
          return;
        }
        if (action === "logout") {
          try {
            await request("/api/auth/logout", { method: "POST", body: "{}" });
            location.replace("/login.html");
          } catch (error) {
            toast(errorMessage(error, t("common.error")));
          }
        }
      });
    }
  }

  async function refreshDiagnostics() {
    diagnosticsFetch.loading = true;
    try {
      diagnostics = await request("/api/system/diagnostics");
      diagnosticsFetch.fetchedAt = Date.now();
    } catch {
      // Keep the last good values but mark them as stale (#473).
      diagnosticsFetch.failedAt = Date.now();
    } finally {
      diagnosticsFetch.loading = false;
    }
  }

  async function refresh() {
    scroll.innerHTML = `<div class="devmoter-settings-loading">${escapeHtml(t("settings.loading"))}</div>`;
    try {
      const [auth, , clis] = await Promise.all([
        request("/api/auth/status"),
        refreshDiagnostics(),
        request("/api/cli").catch(() => ({ clis: [] }))
      ]);
      authStatus = auth;
      cliStatus = Array.isArray(clis?.clis) ? clis.clis : [];
    } catch {
      // Keep the shell usable even when one diagnostics endpoint is unavailable.
    }
    await renderPage();
  }

  function open(targetPage: SettingsPage = "root") {
    page = targetPage;
    modal.classList.remove("hidden");
    document.body.classList.add("devmoter-settings-open");
    void refresh();
  }

  trigger.addEventListener("click", () => open("root"));
  window.addEventListener("devmoter:open-settings", event => {
    const requested = (event as CustomEvent<{ page?: SettingsPage }>).detail?.page;
    open(requested || "root");
  });
  // Navigation elsewhere (☰ destinations, Home, provider switch, Back) always
  // closes Settings, so only the destination stays visible.
  const isOpen = () => !modal.classList.contains("hidden");
  const closeForNavigation = () => { if (isOpen()) close(); };
  window.addEventListener("devmoter:surface-changed", closeForNavigation);
  window.addEventListener("devmoter:workspace-tab-changing", closeForNavigation);
  // Theme can change from the ☰ menu while Settings is open; keep its value current.
  window.addEventListener("devmoter:theme-changed", () => {
    if (isOpen() && (page === "root" || page === "appearance" || page === "language")) void renderPage();
  });
  closeButton.addEventListener("click", close);
  backButton.addEventListener("click", () => setPage("root"));
  modal.addEventListener("click", event => {
    if (event.target === modal) close();
  });
  document.addEventListener("keydown", event => {
    if (event.key !== "Escape" || modal.classList.contains("hidden")) return;
    if (page !== "root") setPage("root");
    else close();
  });

  const initialDensity = localStorage.getItem(DENSITY_KEY);
  if (initialDensity) document.documentElement.dataset.devmoterDensity = initialDensity;
}
