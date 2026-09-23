import "./settings.css";

type Json = Record<string, any>;

const THEME_KEY = "devmoter-theme";

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function json(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers || {});
  const method = String(init.method || "GET").toUpperCase();
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  if (method !== "GET" && method !== "HEAD" && !headers.has("x-pocket-operation-id")) {
    headers.set("x-pocket-operation-id", crypto.randomUUID());
  }
  const response = await fetch(path, { ...init, headers, cache: "no-store" });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.error || `HTTP ${response.status}`);
  return payload;
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
}

function themeLabel(mode: string) {
  if (mode === "light") return "ライト";
  if (mode === "dark") return "ダーク";
  return "システム";
}

export function mountSettingsPanel() {
  const root = document.createElement("div");
  root.className = "devmoter-settings-root";
  root.innerHTML = `
    <button class="devmoter-settings-trigger" type="button" aria-label="設定を開く">⚙</button>
    <div class="devmoter-settings-modal hidden" role="dialog" aria-modal="true" aria-label="DevMoter FAST 設定">
      <section class="devmoter-settings-sheet">
        <header class="devmoter-settings-head">
          <div>
            <strong>設定</strong>
            <small>DevMoter FAST</small>
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
  const scroll = root.querySelector<HTMLDivElement>(".devmoter-settings-scroll")!;

  let authStatus: Json = {};
  let diagnostics: Json = {};

  function toast(message: string) {
    let node = root.querySelector<HTMLDivElement>(".devmoter-settings-toast");
    if (!node) {
      node = document.createElement("div");
      node.className = "devmoter-settings-toast";
      root.appendChild(node);
    }
    node.textContent = message;
    node.classList.add("show");
    window.setTimeout(() => node?.classList.remove("show"), 2200);
  }

  function row(icon: string, label: string, options: {
    action?: string;
    value?: string;
    badge?: string;
    danger?: boolean;
    disabled?: boolean;
  } = {}) {
    return `
      <button
        class="devmoter-settings-row${options.danger ? " danger" : ""}"
        type="button"
        ${options.action ? `data-action="${escapeHtml(options.action)}"` : ""}
        ${options.disabled ? "disabled" : ""}
      >
        <span class="devmoter-settings-icon" aria-hidden="true">${icon}</span>
        <span class="devmoter-settings-row-copy">
          <strong>${escapeHtml(label)}</strong>
          ${options.value ? `<small>${escapeHtml(options.value)}</small>` : ""}
        </span>
        ${options.badge ? `<span class="devmoter-settings-badge">${escapeHtml(options.badge)}</span>` : ""}
        <span class="devmoter-settings-chevron" aria-hidden="true">›</span>
      </button>
    `;
  }

  function section(title: string, rows: string) {
    return `
      <section class="devmoter-settings-section">
        <h2>${escapeHtml(title)}</h2>
        <div class="devmoter-settings-card">${rows}</div>
      </section>
    `;
  }

  function render() {
    const identity = authStatus?.identity || {};
    const github = authStatus?.github || {};
    const theme = currentTheme();
    const provider = identity?.provider || "local";
    const login = identity?.login || "devmoter";
    const githubValue = github?.bound
      ? "接続済み"
      : github?.configured
        ? "接続できます"
        : "未設定";
    const appVersion = diagnostics?.app?.version || "0.2.0";
    const projectCount = diagnostics?.projects?.count ?? 0;

    scroll.innerHTML = `
      <button class="devmoter-settings-profile" type="button" data-action="account">
        <span class="devmoter-settings-avatar">DM</span>
        <span>
          <strong>${escapeHtml(login)}</strong>
          <small>${escapeHtml(provider)} アカウント · GitHub ${escapeHtml(githubValue)}</small>
        </span>
        <span aria-hidden="true">›</span>
      </button>

      ${section("DevMoter をカスタマイズする",
        row("▣", "表示とレイアウト", { action: "appearance", value: "モバイル最適化" }) +
        row("◐", "テーマ", { action: "theme", value: themeLabel(theme) }) +
        row("◉", "アクセントカラー", { action: "accent", value: "既定" }) +
        row("♢", "通知", { action: "notifications" })
      )}

      ${section("アカウント",
        row("◎", "サインイン", { action: "account", value: `${provider} · ${login}` }) +
        row("◈", "GitHub ログイン", { action: "account", value: githubValue }) +
        row("◌", "使用状況と制限", { action: "diagnostics", value: `${projectCount} Projects` })
      )}

      ${section("セキュリティとログイン",
        row("▣", "ローカルログイン", { action: "account" }) +
        row("◆", "Passkeys", { action: "passkeys" }) +
        row("▱", "Trusted devices", { action: "trusted-devices" }) +
        row("G", "Google ログイン", { badge: "Coming soon", disabled: true }) +
        row("M", "Microsoft ログイン", { badge: "Coming soon", disabled: true }) +
        row("●", "Apple ログイン", { badge: "Coming soon", disabled: true })
      )}

      ${section("リモートと自動化",
        row("▤", "ホスト registry", { action: "hosts" }) +
        row("◷", "Automation / Schedules", { action: "automation" }) +
        row("⌁", "ペアリングコード", { action: "trusted-devices" }) +
        row("♢", "通知設定", { action: "notifications" })
      )}

      ${section("開発者ツール",
        row("⌘", "ターミナル", { action: "terminal" }) +
        row("▥", "プロジェクトインデックス", { action: "index" }) +
        row("◇", "セーフティスキャン", { action: "safety" }) +
        row("✦", "拡張機能と Skills", { action: "extensions" }) +
        row("◎", "クラウドブラウザー / Preview", { action: "advanced" }) +
        row("⌁", "診断", { action: "diagnostics", value: `v${appVersion}` })
      )}

      ${section("データ管理",
        row("▰", "ストレージ", { action: "advanced" }) +
        row("◫", "データコントロール", { action: "diagnostics" })
      )}

      ${section("ヘルプ",
        row("?", "使い方ガイド", { action: "guide" }) +
        row("⚑", "不具合を報告", { action: "report" }) +
        row("ⓘ", "詳細", { action: "diagnostics", value: `DevMoter FAST v${appVersion}` })
      )}

      <div class="devmoter-settings-card devmoter-settings-logout-card">
        ${row("↪", "ログアウト", { action: "logout", danger: true })}
      </div>
    `;

    wireRows();
  }

  function close() {
    modal.classList.add("hidden");
    document.body.classList.remove("devmoter-settings-open");
  }

  function openExisting(selector: string) {
    close();
    window.setTimeout(() => {
      const target = document.querySelector<HTMLElement>(selector);
      if (!target) {
        toast("この機能は現在の画面では利用できません。");
        return;
      }
      target.click();
    }, 0);
  }

  function openRemote(tab: "hosts" | "automation" | "passkeys") {
    close();
    window.setTimeout(() => {
      const trigger = document.querySelector<HTMLElement>(".dm-control-trigger");
      trigger?.click();
      window.setTimeout(() => {
        const tabButton = document.querySelector<HTMLButtonElement>(`.dm-control-tabs [data-tab="${tab}"]`);
        tabButton?.click();
      }, 0);
    }, 0);
  }

  function openTools(tab: "terminal" | "safety" | "index") {
    close();
    window.setTimeout(() => {
      const launcher = document.querySelector<HTMLElement>(".dm-tools-launcher");
      launcher?.click();
      window.setTimeout(() => {
        const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>(".dm-tools-tabs button"));
        const index = tab === "terminal" ? 0 : tab === "safety" ? 1 : 2;
        buttons[index]?.click();
      }, 0);
    }, 0);
  }

  function wireRows() {
    for (const button of scroll.querySelectorAll<HTMLButtonElement>("[data-action]")) {
      button.addEventListener("click", async () => {
        const action = button.dataset.action || "";
        if (action === "theme") {
          const modes: Array<"system" | "light" | "dark"> = ["system", "light", "dark"];
          const current = currentTheme() as "system" | "light" | "dark";
          const next = modes[(modes.indexOf(current) + 1) % modes.length];
          applyTheme(next);
          render();
          return;
        }
        if (action === "appearance" || action === "accent") {
          toast("表示設定はこのSettings画面へ順次統合します。");
          return;
        }
        if (action === "account" || action === "trusted-devices" || action === "notifications" || action === "diagnostics") {
          openExisting(".devmoter-system-button");
          return;
        }
        if (action === "hosts") {
          openRemote("hosts");
          return;
        }
        if (action === "automation") {
          openRemote("automation");
          return;
        }
        if (action === "passkeys") {
          openRemote("passkeys");
          return;
        }
        if (action === "terminal") {
          openTools("terminal");
          return;
        }
        if (action === "safety") {
          openTools("safety");
          return;
        }
        if (action === "index") {
          openTools("index");
          return;
        }
        if (action === "extensions") {
          openExisting(".dm-extensions");
          return;
        }
        if (action === "advanced") {
          openExisting(".adv-fab");
          return;
        }
        if (action === "guide") {
          toast("使い方ガイドはSettings v1.1で統合予定です。");
          return;
        }
        if (action === "report") {
          toast("GitHub Issueへの報告導線を次のUI更新で追加します。");
          return;
        }
        if (action === "logout") {
          try {
            await json("/api/auth/logout", { method: "POST", body: "{}" });
            location.replace("/login.html");
          } catch (error) {
            toast(error instanceof Error ? error.message : String(error));
          }
        }
      });
    }
  }

  async function refresh() {
    scroll.innerHTML = '<div class="devmoter-settings-loading">設定を読み込んでいます…</div>';
    try {
      [authStatus, diagnostics] = await Promise.all([
        json("/api/auth/status"),
        json("/api/system/diagnostics")
      ]);
    } catch {
      // The shell should remain usable even if one diagnostics endpoint is temporarily unavailable.
    }
    render();
  }

  function open() {
    modal.classList.remove("hidden");
    document.body.classList.add("devmoter-settings-open");
    void refresh();
  }

  trigger.addEventListener("click", open);
  closeButton.addEventListener("click", close);
  modal.addEventListener("click", event => {
    if (event.target === modal) close();
  });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && !modal.classList.contains("hidden")) close();
  });
}
