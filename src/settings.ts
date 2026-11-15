import "./settings.css";
import { describeHealthFetch, formatBuildId, formatNodeVersion } from "./diagnostics-format.mjs";
import { boundedPushWait, inspectPushReadiness, type PushReadiness } from "./push-readiness.js";

type Json = Record<string, any>;
type SettingsPage = "root" | "appearance" | "account" | "devices" | "vault" | "notifications" | "diagnostics" | "guide";

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
  if (!response.ok) throw new Error(payload?.error || `HTTP ${response.status}`);
  return payload as Json;
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
  if (mode === "light") return "ライト";
  if (mode === "dark") return "ダーク";
  return "システム";
}

function densityLabel(value: string) {
  return value === "compact" ? "コンパクト" : "標準";
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

// Rows either stay inside Settings ("page:…", chevron) or leave it for another
// screen ("open:…", arrow-out icon + "設定を閉じて開く" for screen readers).
// Every other action works in place and has no trailing indicator.
type OpenTarget =
  | "sessions" | "review" | "agents" | "automation" | "terminal"
  | "passkeys" | "hosts" | "safety" | "index"
  | "context" | "checkpoints" | "extensions" | "files";
const lineIcon = (body: string) =>
  `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
const CHEVRON_ICON = lineIcon('<path d="m9 6 6 6-6 6"/>');
// Leaving Settings uses the shared arrow-out line icon (same as external links).
const LEAVE_ICON = ICONS.external;
const LEAVE_LABEL = "設定を閉じて開く";

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
    <button class="devmoter-settings-trigger" type="button" aria-label="設定を開く">${ICONS.settings}</button>
    <div class="devmoter-settings-modal hidden" role="dialog" aria-modal="true" aria-label="DevMoter FAST 設定">
      <section class="devmoter-settings-sheet">
        <header class="devmoter-settings-head">
          <button class="devmoter-settings-back hidden" type="button" aria-label="設定トップへ戻る">‹</button>
          <div>
            <strong data-settings-title>設定</strong>
            <small data-settings-subtitle>DevMoter FAST</small>
          </div>
          <button class="devmoter-settings-close" type="button" aria-label="閉じる">×</button>
        </header>
        <div class="devmoter-settings-scroll">
          <div class="devmoter-settings-loading">設定を読み込んでいます…</div>
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
    const trailing = kind === "page"
      ? `<span class="devmoter-settings-chevron" aria-hidden="true">${CHEVRON_ICON}</span>`
      : kind === "open"
        ? `<span class="devmoter-settings-leave" title="${LEAVE_LABEL}">${LEAVE_ICON}<span class="devmoter-settings-sr">${LEAVE_LABEL}</span></span>`
        : "";
    return `
      <button
        class="devmoter-settings-row${options.danger ? " danger" : ""}"
        type="button"
        data-kind="${kind}"
        ${options.action ? `data-action="${escapeHtml(options.action)}"` : ""}
        ${options.disabled ? "disabled" : ""}
        ${options.external ? `aria-label="${escapeHtml(`${label}（${options.external}が新しいタブで開きます）`)}"` : ""}
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

  function setHeader(titleText: string, subtitleText = "DevMoter FAST") {
    title.textContent = titleText;
    subtitle.textContent = subtitleText;
    backButton.classList.toggle("hidden", page === "root");
  }

  function renderRoot() {
    setHeader("設定");
    const identity = authStatus?.identity || {};
    const github = authStatus?.providers?.github || authStatus?.github || {};
    const theme = currentTheme();
    const density = localStorage.getItem(DENSITY_KEY) || "comfortable";
    const provider = identity?.provider || "local";
    const login = identity?.login || "devmoter";
    const githubValue = (github?.linked ?? github?.bound)
      ? "接続済み"
      : github?.configured
        ? "接続できます"
        : "未設定";
    const appVersion = diagnostics?.app?.version || "0.2.0";

    scroll.innerHTML = `
      <button class="devmoter-settings-profile" type="button" data-action="page:account">
        <span class="devmoter-settings-avatar">DM</span>
        <span>
          <strong>${escapeHtml(login)}</strong>
          <small>${escapeHtml(provider)} アカウント · GitHub ${escapeHtml(githubValue)}</small>
        </span>
        <span class="devmoter-settings-chevron" aria-hidden="true">${CHEVRON_ICON}</span>
      </button>

      ${section("ワークスペース",
        row("sessions", "アクティビティ", { action: "open:sessions", value: "実行中・キュー・チェックポイント・履歴" }) +
        row("review", "レビューとタスク", { action: "open:review", value: "差分・ワークツリー・GitHub" }) +
        row("agents", "エージェントモード", { action: "open:agents", value: "モード・サブエージェント・フリート" }) +
        row("context", "表示履歴", { action: "open:context", value: "表示量の目安と整理" }) +
        row("checkpoint", "チェックポイント", { action: "open:checkpoints", value: "現在のタスク" })
      )}

      ${section("DevMoter をカスタマイズする",
        row("theme", "テーマと表示", { action: "page:appearance", value: `${themeLabel(theme)} · ${densityLabel(density)}` }) +
        row("notifications", "通知", { action: "page:notifications" })
      )}

      ${section("セキュリティとログイン",
        row("passkey", "パスキー", { action: "open:passkeys" }) +
        row("device", "信頼済み端末", { action: "page:devices", value: "端末の登録とペアリングコード" }) +
        row("vault", "API Vault", { action: "page:vault", value: "ホストで暗号化して保存" })
      )}

      ${section("リモートと自動化",
        row("hosts", "ホスト一覧", { action: "open:hosts" }) +
        row("automation", "自動化", { action: "open:automation" })
      )}

      ${section("開発者ツール",
        row("terminal", "ターミナル", { action: "open:terminal" }) +
        row("index", "プロジェクトインデックス", { action: "open:index" }) +
        row("safety", "セーフティスキャン", { action: "open:safety" }) +
        row("extensions", "拡張機能", { action: "open:extensions" }) +
        row("browser", "ファイルとプレビュー", { action: "open:files" }) +
        row("diagnostics", "診断", { action: "page:diagnostics", value: `v${appVersion}` })
      )}

      ${section("ヘルプ",
        row("guide", "使い方ガイド", { action: "page:guide" }) +
        row("report", "不具合を報告", { action: "report", value: "GitHub の Issue を開く", external: "GitHub" })
      )}

      <div class="devmoter-settings-card devmoter-settings-logout-card">
        ${row("logout", "ログアウト", { action: "logout", danger: true })}
      </div>
    `;
    wireRows();
  }

  function renderAppearance() {
    setHeader("テーマと表示", "DevMoter FAST をカスタマイズ");
    const theme = currentTheme();
    const density = localStorage.getItem(DENSITY_KEY) || "comfortable";
    scroll.innerHTML = `
      ${section("テーマ",
        row("system", "システム", { action: "theme:system", value: theme === "system" ? "選択中" : "" }) +
        row("light", "ライト", { action: "theme:light", value: theme === "light" ? "選択中" : "" }) +
        row("dark", "ダーク", { action: "theme:dark", value: theme === "dark" ? "選択中" : "" })
      )}
      ${section("表示密度",
        row("density-comfortable", "標準", { action: "density:comfortable", value: density === "comfortable" ? "選択中" : "読みやすさ優先" }) +
        row("density-compact", "コンパクト", { action: "density:compact", value: density === "compact" ? "選択中" : "情報量を増やす" })
      )}
      <div class="devmoter-settings-note">
        テーマと表示密度はこの端末に保存されます。高度な画面でも同じ設定を使えるよう順次統合します。
      </div>
    `;
    wireRows();
  }

  function providerButton(provider: "github" | "google" | "microsoft", label: string, configured: boolean, linked: boolean, identity: Json | null = {}) {
    const displayIdentity = identity?.login || identity?.email || identity?.name || "接続済み";
    return '<div class="devmoter-settings-device"><span><strong>' + escapeHtml(label) + '</strong><small>' +
      (linked ? escapeHtml(displayIdentity) : configured ? "未接続" : "このホストでは利用できません") +
      '</small></span>' + (linked
        ? '<button type="button" aria-label="' + escapeHtml(label) + 'の接続を解除" data-action="account:disconnect" data-provider="' + provider + '">接続解除</button>'
        : configured
          ? '<button type="button" aria-label="' + escapeHtml(label) + 'を接続" data-action="account:connect" data-provider="' + provider + '">接続</button>'
          : '<a class="devmoter-settings-link-button" href="' + SETUP_GUIDE_URL + '" target="_blank" rel="noopener noreferrer" aria-label="' + escapeHtml(label) + 'の管理者向けセットアップ案内">セットアップ案内</a>') +
      '</div>';
  }

  function renderSessions(sessions: Json[]) {
    if (!sessions.length) return '<div class="devmoter-settings-empty">セッション情報はありません。</div>';
    return sessions.map(session => {
      const date = (value: unknown) => {
        const parsed = new Date(typeof value === "number" ? value : String(value || ""));
        return Number.isNaN(parsed.getTime()) ? "—" : parsed.toLocaleString();
      };
      const identity = session.identity?.login || session.identity?.email || session.identity?.name || "";
      return '<div class="devmoter-settings-device"><span><strong>' +
        escapeHtml((session.current ? "このセッション · " : "") + (session.provider || "オーナー") + " · " + identity) +
        '</strong><small>' + escapeHtml(session.host || "") + " · 作成 " + escapeHtml(date(session.createdAt)) +
        " · 最終使用 " + escapeHtml(date(session.lastUsedAt)) + " · 期限 " + escapeHtml(date(session.expiresAt)) +
        '</small></span>' + (session.current
          ? '<span class="devmoter-settings-badge">現在</span>'
          : '<button type="button" aria-label="セッションを解除: ' + escapeHtml(session.host || identity || session.id) + '" data-action="account:revoke-session" data-session-id="' + escapeHtml(session.id) + '">解除</button>') +
        '</div>';
    }).join("");
  }

  async function renderAccount() {
    setHeader("アカウント", "ログインとオーナーID");
    const identity = authStatus?.identity || {};
    scroll.innerHTML = '<div class="devmoter-settings-loading">アカウントを読み込んでいます…</div>';
    try {
      accountData = await request("/api/auth/account");
    } catch (error) {
      scroll.innerHTML = '<div class="devmoter-settings-note">' +
        escapeHtml(error instanceof Error ? error.message : "アカウント情報を読み込めませんでした。") + '</div>';
      return;
    }
    const providers = accountData?.providers || {};
    const sessions = Array.isArray(accountData?.sessions) ? accountData.sessions : [];
    const providerRows = providerButton("github", "GitHub", Boolean(providers.github?.configured), Boolean(providers.github?.linked), providers.github?.identity) +
      providerButton("google", "Google", Boolean(providers.google?.configured), Boolean(providers.google?.linked), providers.google?.identity) +
      providerButton("microsoft", "Microsoft", Boolean(providers.microsoft?.configured), Boolean(providers.microsoft?.linked), providers.microsoft?.identity);
    const passkey = accountData?.passkey || {};
    const ownerId = String(accountData?.ownerId || "");
    scroll.innerHTML = `
      <div class="devmoter-settings-profile detail">
        <span class="devmoter-settings-avatar">DM</span>
        <span>
          <strong>${escapeHtml(identity?.login || "devmoter")}</strong>
          <small>オーナーID <span class="devmoter-settings-mono" title="${escapeHtml(ownerId)}">${escapeHtml(shortId(ownerId))}</span></small>
        </span>
        ${ownerId ? '<button type="button" class="devmoter-settings-copy" data-action="account:copy-owner" aria-label="オーナーIDをコピー">コピー</button>' : ""}
      </div>
      <section class="devmoter-settings-section"><h2>サインイン方法</h2><div class="devmoter-settings-card">
        ${providerRows}
        <div class="devmoter-settings-device"><span><strong>パスキー</strong><small>${passkey.available ? "このホストで利用可能 · Face ID / Touch ID / Windows Hello" : "このホストには登録済みのパスキーがありません"}</small></span><button type="button" data-action="open:passkeys" aria-label="パスキーを管理（${LEAVE_LABEL}）">管理${LEAVE_ICON}</button></div>
        <div class="devmoter-settings-device"><span><strong>ローカル復旧</strong><small>${accountData?.localRecovery ? "利用可能" : "利用できません"}</small></span><span class="devmoter-settings-badge">復旧用</span></div>
      </div></section>
      ${githubLink ? '<section class="devmoter-settings-section"><h2>GitHub接続</h2><div class="devmoter-settings-card devmoter-settings-detail-card"><p>GitHubでこのコードを入力してください。</p><strong>' +
        escapeHtml(githubLink.userCode || "") + '</strong><div class="devmoter-settings-actions"><button type="button" data-action="account:github-open">GitHubを開く</button><button type="button" data-action="account:github-cancel">キャンセル</button></div><small>このコードはログイン情報です。共有しないでください。</small></div></section>' : ""}
      <section class="devmoter-settings-section"><h2>ログイン中のセッション</h2><div class="devmoter-settings-card">${renderSessions(sessions)}</div>
        ${sessions.some((session: Json) => !session.current) ? '<div class="devmoter-settings-actions"><button type="button" data-action="account:revoke-others">他のセッションをすべて解除</button></div>' : ""}
      </section>
      <div class="devmoter-settings-card devmoter-settings-logout-card">
        ${row("logout", "ログアウト", { action: "logout", danger: true })}
      </div>
    `;
    wireRows();
  }

  async function renderDevices() {
    setHeader("信頼済み端末", "端末の信頼とペアリング");
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
      ? "このブラウザ（localhost）を最初の信頼済み端末として登録できます。"
      : trustedDeviceCount > 0
        ? "この端末はリモート接続中です。信頼済み端末でペアリングコードを作成し、下に入力してください。"
        : "最初の信頼済み端末は、セキュリティのため localhost（127.0.0.1）から登録してください。その後、この端末を6桁のコードでペアリングできます。";
    scroll.innerHTML = `
      <section class="devmoter-settings-section">
        <h2>この端末</h2>
        <div class="devmoter-settings-card devmoter-settings-detail-card">
          <div class="devmoter-settings-detail-row">
            <span>状態</span><strong>${trusted ? "信頼済み" : "未登録"}</strong>
          </div>
          <div class="devmoter-settings-actions">
            ${trusted
              ? '<button type="button" data-action="device:create-code">ペアリングコードを作成</button>'
              : localBootstrap
                ? '<button type="button" data-action="device:bootstrap">このブラウザを信頼する</button>'
                : ''}
          </div>
          ${trusted ? "" : `<div class="devmoter-settings-note">${escapeHtml(untrustedGuidance)}</div>`}
        </div>
      </section>

      <section class="devmoter-settings-section">
        <h2>別の端末をペアリング</h2>
        <div class="devmoter-settings-card devmoter-settings-form-card">
          <input data-pair-code inputmode="numeric" maxlength="6" placeholder="6桁のペアリングコード" />
          <button type="button" data-action="device:claim">この端末をペアリング</button>
        </div>
      </section>

      <section class="devmoter-settings-section">
        <h2>登録済み端末</h2>
        <div class="devmoter-settings-card">
          ${devices.length ? devices.map((device: Json) => `
            <div class="devmoter-settings-device">
              <span><strong>${escapeHtml(device.label || "端末")}</strong><small>${device.current ? "この端末 · " : ""}最終使用 ${escapeHtml(new Date(device.lastUsedAt).toLocaleString())}</small></span>
              <button type="button" data-action="device:revoke" data-device-id="${escapeHtml(device.id)}">解除</button>
            </div>
          `).join("") : '<div class="devmoter-settings-empty">登録済み端末はありません。</div>'}
        </div>
      </section>
      <div class="devmoter-settings-note">ペアリングコードは他人に共有しないでください。</div>
    `;
    wireRows();
  }

  async function renderVault() {
    setHeader("API Vault", "ホスト側で暗号化する認証情報");
    const trusted = await request("/api/devices", {}, true).then(() => true).catch(() => false);
    if (!trusted) {
      scroll.innerHTML = `
        <div class="devmoter-settings-note">Vaultを使うには、このブラウザを信頼済み端末として登録してください。</div>
        <div class="devmoter-settings-card devmoter-settings-action-card">
          <button type="button" data-action="page:devices">端末の登録へ</button>
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
      message.textContent = error instanceof Error ? error.message : String(error);
      scroll.appendChild(message);
      return;
    }

    if (!status.initialized || !status.unlocked) {
      const action = status.initialized ? "unlock" : "initialize";
      const label = status.initialized ? "Vaultを開く" : "Vaultを作成して開く";
      scroll.innerHTML = `
        <section class="devmoter-settings-section">
          <h2>${status.initialized ? "Vaultはロック中" : "新しいVault"}</h2>
          <form class="devmoter-settings-card devmoter-settings-form-card" data-vault-unlock-form>
            <label for="devmoterVaultPassphrase">パスフレーズ</label>
            <input id="devmoterVaultPassphrase" data-vault-passphrase type="password" autocomplete="current-password" minlength="12" maxlength="1024" required />
            <small>12文字以上。忘れると復元できないため、パスワードマネージャーに保管してください。</small>
            <button type="submit">${label}</button>
          </form>
        </section>
        <p class="devmoter-settings-note">パスフレーズは保存も再表示もしません。シークレットは暗号化してホストに保存します。</p>
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
          toast(action === "initialize" ? "Vaultを作成してロックを解除しました。" : "Vaultのロックを解除しました。");
          await renderVault();
        } catch (error) {
          toast(error instanceof Error ? error.message : String(error));
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
      message.textContent = error instanceof Error ? error.message : String(error);
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
          <small>•••••••• · ${escapeHtml(secret.purpose || "用途未設定")}</small>
          <small>プロジェクト ${Array.isArray(secret.projectIds) ? secret.projectIds.length : 0}件 · 最終使用 ${escapeHtml(secret.lastUsedAt ? new Date(secret.lastUsedAt).toLocaleString() : "未使用")}</small>
          ${secret.duplicate ? '<small class="devmoter-vault-warning">同じ値のシークレットが他にも登録されています</small>' : ""}
        </div>
        <div class="devmoter-vault-secret-actions">
          <button type="button" data-action="vault:edit" data-vault-reference="${escapeHtml(secret.reference)}">更新</button>
          <button type="button" data-action="vault:delete" data-vault-reference="${escapeHtml(secret.reference)}">削除</button>
        </div>
      </article>
    `).join("") : '<div class="devmoter-settings-empty">登録済みのシークレットはありません。</div>';

    scroll.innerHTML = `
      <section class="devmoter-settings-section">
        <h2>Vaultの状態</h2>
        <div class="devmoter-settings-card devmoter-settings-detail-card">
          <div class="devmoter-settings-detail-row"><span>状態</span><strong>ロック解除中 · ${escapeHtml(status.count ?? secrets.length)}件</strong></div>
          <div class="devmoter-settings-actions"><button type="button" data-action="vault:lock">Vaultをロック</button></div>
        </div>
      </section>
      <section class="devmoter-settings-section">
        <h2>登録済み</h2>
        <div class="devmoter-settings-card devmoter-vault-list">${secretRows}</div>
      </section>
      <section class="devmoter-settings-section">
        <h2 data-vault-form-title>シークレットを追加</h2>
        <form class="devmoter-settings-card devmoter-settings-form-card" data-vault-form>
          <label>プロバイダーID<input name="provider" autocomplete="off" maxlength="80" required placeholder="openai" /></label>
          <label>名前<input name="name" autocomplete="off" maxlength="80" required placeholder="personal" /></label>
          <label>値<input name="value" type="password" autocomplete="new-password" maxlength="16384" required /></label>
          <label>用途<input name="purpose" autocomplete="off" maxlength="200" placeholder="ビルド、API Chat など" /></label>
          <label>環境変数名（任意）<input name="envName" autocomplete="off" maxlength="128" placeholder="OPENAI_API_KEY" /></label>
          <fieldset class="devmoter-vault-projects"><legend>利用できるプロジェクト（1つ以上）</legend>${projectOptions || '<small>登録済みのプロジェクトがありません。先にプロジェクトを追加してください。</small>'}</fieldset>
          <button type="submit" ${projects.length ? "" : "disabled"} data-vault-save>Vaultに保存</button>
          <small>保存後は再表示しません。AES-256-GCMで暗号化してホストに保存します</small>
        </form>
      </section>
      <p class="devmoter-settings-note">値の表示・コピーと、API Chat・エージェントとの連携には未対応です</p>
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
        toast("利用するプロジェクトを1つ以上選んでください。");
        return;
      }
      if (replacing && !window.confirm(`${reference} の値を置き換えますか？`)) return;
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
        toast("シークレットを暗号化して保存しました。");
        await renderVault();
      } catch (error) {
        if (saveButton) saveButton.disabled = false;
        toast(error instanceof Error ? error.message : String(error));
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
    setHeader("通知", "完了・承認待ちをスマホへ");
    const renderContent = (state: PushReadiness["state"] | "loading", subscription: PushSubscription | null, trusted: boolean) => {
      const status = state === "loading" ? "確認中…"
        : state === "ready" ? subscription ? "有効" : "無効"
        : state === "unsupported" ? "未対応"
        : state === "unregistered" ? "Service Worker未登録"
        : state === "denied" ? "通知権限が拒否されています"
        : "状態を確認できません";
      const explanation = state === "loading" ? "通知とService Workerの状態を確認しています。"
        : state === "ready" ? subscription ? "通知はこの端末で有効です。" : "この端末でプッシュ通知を有効にできます。"
        : state === "unsupported" ? "このブラウザではプッシュ通知を利用できません。"
        : state === "unregistered" ? "アプリを再読み込みして状態を再確認してください。Service Workerが登録されると通知を有効にできます。"
        : state === "denied" ? "ブラウザのサイト設定で通知を許可してから「状態を再確認」を押してください。"
        : "状態を確認できませんでした。少し待って「状態を再確認」してください。";
      const canEnable = state === "ready" && !subscription;
      const canDisable = state === "ready" && !!subscription;
      scroll.innerHTML = `
      ${section("プッシュ通知",
        row("notifications", "通知の状態", { value: status }) +
        row("device", "信頼済み端末", { action: "page:devices", value: trusted ? "登録済み" : "先に登録が必要" })
      )}
      <div class="devmoter-settings-note">${escapeHtml(explanation)}</div>
      <div class="devmoter-settings-card devmoter-settings-action-card">
        <button type="button" data-action="push:retry">状態を再確認</button>
        <button type="button" data-action="push:enable" ${canEnable ? "" : "disabled"}>通知を有効にする</button>
        <button type="button" data-action="push:disable" ${canDisable ? "" : "disabled"}>通知を無効にする</button>
      </div>
      <div class="devmoter-settings-note">
        通知本文にはプロンプト、コード、ツール出力、認証情報を含めません。
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
    if (!cliStatus.length) return `<div class="devmoter-settings-health-row"><strong>CLI</strong><small>状態を取得できません</small></div>`;
    return cliStatus.map((cli: Json) => {
      const ready = cli?.presence === "ready";
      const state = ready ? "インストール済み" : cli?.presence === "missing" ? "未インストール" : "エラー";
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
        <small>${escapeHtml(value?.version || (value?.available ? "あり" : "なし"))}</small>
      </div>
    `).join("");
  }

  function renderDiagnostics() {
    setHeader("診断", "DevMoter FAST の状態");
    const fetchState = describeHealthFetch(diagnosticsFetch);
    scroll.innerHTML = `
      <section class="devmoter-settings-section">
        <h2>ステータス</h2>
        <div class="devmoter-settings-note" data-diagnostics-fetched data-tone="${escapeHtml(fetchState.tone)}" role="status">${escapeHtml(fetchState.text)}</div>
        <div class="devmoter-settings-actions"><button type="button" data-action="diagnostics:refresh" ${diagnosticsFetch.loading ? "disabled" : ""}>更新</button></div>
        <div class="devmoter-settings-card devmoter-settings-detail-card">
          <div class="devmoter-settings-detail-row"><span>アプリ</span><strong>${escapeHtml(diagnostics?.app?.version || "不明")}</strong></div>
          <div class="devmoter-settings-detail-row"><span>Node.js</span><strong data-diagnostics-node>${escapeHtml(formatNodeVersion(diagnostics?.app?.node))}</strong></div>
          <div class="devmoter-settings-detail-row"><span>ビルド</span><strong data-diagnostics-build>${escapeHtml(formatBuildId(diagnostics?.app?.build))}</strong></div>
          <div class="devmoter-settings-detail-row"><span>OpenCode</span><strong>${diagnostics?.backends?.opencode?.online ? "オンライン" : "オフライン"}</strong></div>
          <div class="devmoter-settings-detail-row"><span>Codex</span><strong>${diagnostics?.backends?.codex?.online ? "オンライン" : "オフライン"}</strong></div>
          <div class="devmoter-settings-detail-row"><span>プロジェクト</span><strong>${escapeHtml(diagnostics?.projects?.count ?? 0)}</strong></div>
          <div class="devmoter-settings-detail-row"><span>ネットワーク</span><strong>${diagnostics?.network?.localhostFirst ? "localhost優先" : "カスタム"}</strong></div>
        </div>
      </section>
      <section class="devmoter-settings-section">
        <h2>CLI</h2>
        <div class="devmoter-settings-card devmoter-settings-health">${cliRows()}</div>
      </section>
      <section class="devmoter-settings-section">
        <h2>ホストの前提条件</h2>
        <div class="devmoter-settings-card devmoter-settings-health">${prerequisiteRows()}</div>
      </section>
      <div class="devmoter-settings-note">${escapeHtml(diagnostics?.network?.message || "")}</div>
    `;
  }

  function renderGuide() {
    setHeader("使い方ガイド", "基本の使い方");
    scroll.innerHTML = `
      <section class="devmoter-guide-hero">
        <strong>よく使う5つの機能</strong>
        <p>チャット・プロジェクト・アクティビティ・自動化・レビュー</p>
      </section>
      ${section("基本",
        row("1", "チャット", { value: "Codex・OpenCode・API Chat に指示" }) +
        row("2", "プロジェクト", { value: "作業するリポジトリとフォルダを選ぶ" }) +
        row("3", "アクティビティ", { value: "実行中・キュー・チェックポイント・引き継ぎ" }) +
        row("4", "自動化", { action: "open:automation", value: "スケジュール・イベントトリガー・オートパイロット" }) +
        row("5", "レビュー", { value: "AIが変えた差分を確認" })
      )}
      ${section("困ったとき",
        row("diagnostics", "診断を見る", { action: "page:diagnostics" }) +
        row("safety", "セーフティスキャン", { action: "open:safety", value: "危険なコマンドと記憶した承認" }) +
        row("terminal", "ターミナル", { action: "open:terminal", value: "登録済みプロジェクトで開く" })
      )}
    `;
    wireRows();
  }

  async function renderPage() {
    if (page === "root") return renderRoot();
    if (page === "appearance") return renderAppearance();
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
      toast("GitHub接続の有効期限が切れました。");
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
        toast("GitHubを接続しました。");
        await renderAccount();
        return;
      }
      const delay = Math.max(1000, Number(result.retryAfterMs || Number(activeFlow.interval || 5) * 1000));
      window.setTimeout(() => void pollGithubLink(), delay);
    } catch (error) {
      if (githubLink?.flowId !== activeFlow.flowId) return;
      githubLink = null;
      toast(error instanceof Error ? error.message : "GitHub接続を確認できませんでした。");
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
      toast("この機能は現在の画面では利用できません。");
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
      toast("先にこの端末を信頼済み端末として登録してください。");
      setPage("devices");
      return;
    }
    if (!("Notification" in window) || !("serviceWorker" in navigator) || !("PushManager" in window)) {
      toast("このブラウザはプッシュ通知に対応していません。");
      return;
    }
    const readiness = await inspectPushReadiness(navigator.serviceWorker, Notification.permission);
    if (readiness.state !== "ready" || !readiness.registration) {
      const message = readiness.state === "unregistered"
        ? "通知用Service Workerが登録されていません。アプリを再読み込みしてから再試行してください。"
        : readiness.state === "unsupported"
          ? "このブラウザはプッシュ通知に対応していません。"
          : readiness.state === "denied"
            ? "ブラウザ設定で通知権限を許可してから再試行してください。"
          : "Service Workerの準備を確認できませんでした。少し待って再試行してください。";
      toast(message);
      return;
    }
    const registration = readiness.registration;
    const permission = Notification.permission === "granted"
      ? Notification.permission
      : await Notification.requestPermission();
    if (permission !== "granted") {
      toast("通知権限が許可されませんでした。");
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
    toast("通知を有効にしました。");
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
    toast("通知を無効にしました。");
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
              toast("接続を開始できませんでした。");
            }
          } catch (error) {
            toast(error instanceof Error ? error.message : "接続を開始できませんでした。");
          }
          return;
        }
        if (action === "account:copy-owner") {
          const ownerId = String(accountData?.ownerId || "");
          toast(await copyText(ownerId) ? "オーナーIDをコピーしました。" : "コピーできませんでした。");
          return;
        }
        if (action === "account:disconnect") {
          const provider = button.dataset.provider || "";
          if (!window.confirm(`${provider}との接続を解除しますか？`)) return;
          try {
            const result = await request(`/api/auth/providers/${encodeURIComponent(provider)}/disconnect`, {
              method: "POST",
              body: "{}"
            });
            if (result.reauthenticate) { location.replace("/login.html"); return; }
            toast("接続を解除しました。");
            await renderAccount();
          } catch (error) {
            toast(error instanceof Error ? error.message : "接続を解除できませんでした。");
          }
          return;
        }
        if (action === "account:github-open") {
          try {
            const uri = new URL(String(githubLink?.verificationUri || ""));
            if (uri.protocol === "https:") window.open(uri.href, "_blank", "noopener,noreferrer");
          } catch { toast("GitHubの確認ページを開けませんでした。"); }
          return;
        }
        if (action === "account:github-cancel") {
          githubLink = null;
          await renderAccount();
          return;
        }
        if (action === "account:revoke-session") {
          const sessionId = button.dataset.sessionId || "";
          if (!window.confirm("このセッションを解除しますか？")) return;
          try {
            await request(`/api/auth/sessions/${encodeURIComponent(sessionId)}`, { method: "DELETE" });
            toast("セッションを解除しました。");
            await renderAccount();
          } catch (error) {
            toast(error instanceof Error ? error.message : "セッションを解除できませんでした。");
          }
          return;
        }
        if (action === "account:revoke-others") {
          if (!window.confirm("他のすべてのセッションを解除しますか？")) return;
          try {
            await request("/api/auth/sessions/revoke-others", { method: "POST", body: "{}" });
            toast("他のセッションを解除しました。");
            await renderAccount();
          } catch (error) {
            toast(error instanceof Error ? error.message : "セッションを解除できませんでした。");
          }
          return;
        }
        if (action === "device:bootstrap") {
          try {
            await request("/api/devices/bootstrap", {
              method: "POST",
              body: JSON.stringify({ label: navigator.userAgent.includes("Mobile") ? "Mobile browser" : "Browser" })
            });
            toast("このブラウザを信頼済み端末に登録しました。");
            await renderDevices();
          } catch (error) {
            toast(error instanceof Error ? error.message : String(error));
          }
          return;
        }
        if (action === "device:create-code") {
          try {
            const result = await request("/api/pairings", { method: "POST" }, true);
            toast(`ペアリングコード: ${result.code} · 5分で失効`);
          } catch (error) {
            toast(error instanceof Error ? error.message : String(error));
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
                label: navigator.userAgent.includes("Mobile") ? "Mobile browser" : "Browser"
              })
            });
            toast("端末をペアリングしました。");
            await renderDevices();
          } catch (error) {
            toast(error instanceof Error ? error.message : String(error));
          }
          return;
        }
        if (action === "device:revoke") {
          try {
            const result = await request(`/api/devices/${encodeURIComponent(button.dataset.deviceId || "")}`, { method: "DELETE" }, true);
            toast("端末の信頼を解除しました。");
            await renderDevices();
          } catch (error) {
            toast(error instanceof Error ? error.message : String(error));
          }
          return;
        }
        if (action === "vault:lock") {
          try {
            await request("/api/secrets/lock", { method: "POST", body: "{}" }, true);
            toast("Vaultをロックしました。");
            await renderVault();
          } catch (error) {
            toast(error instanceof Error ? error.message : String(error));
          }
          return;
        }
        if (action === "vault:delete") {
          const reference = button.dataset.vaultReference || "";
          if (window.prompt(`削除するには次の参照を入力してください:\n${reference}`) !== reference) return;
          const match = reference.match(/^secret:\/\/([^/]+)\/([^/]+)$/);
          if (!match) return;
          try {
            await request(`/api/secrets/${encodeURIComponent(match[1])}/${encodeURIComponent(match[2])}`, {
              method: "DELETE",
              body: JSON.stringify({ confirmReference: reference })
            }, true);
            toast("シークレットを削除しました。");
            await renderVault();
          } catch (error) {
            toast(error instanceof Error ? error.message : String(error));
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
          if (heading) heading.textContent = `更新: ${reference}`;
          const valueInput = vaultFormElement.elements.namedItem("value") as HTMLInputElement;
          valueInput.placeholder = "新しい値を入力（現在値は表示されません）";
          valueInput.focus();
          vaultFormElement.scrollIntoView({ behavior: "smooth", block: "start" });
          return;
        }
        if (action === "push:enable") {
          try { await enablePush(); } catch (error) { toast(error instanceof Error ? error.message : String(error)); }
          return;
        }
        if (action === "push:retry") {
          await renderNotifications();
          return;
        }
        if (action === "push:disable") {
          try { await disablePush(); } catch (error) { toast(error instanceof Error ? error.message : String(error)); }
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
            toast(error instanceof Error ? error.message : String(error));
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
    scroll.innerHTML = '<div class="devmoter-settings-loading">設定を読み込んでいます…</div>';
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
    if (isOpen() && (page === "root" || page === "appearance")) void renderPage();
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
