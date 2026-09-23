import "./settings.css";

type Json = Record<string, any>;
type SettingsPage = "root" | "appearance" | "account" | "devices" | "notifications" | "diagnostics" | "guide";

const THEME_KEY = "devmoter-theme";
const DEVICE_TOKEN_KEY = "devmoter-device-token";
const DENSITY_KEY = "devmoter-settings-density";

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
  if (deviceAuth) {
    const token = localStorage.getItem(DEVICE_TOKEN_KEY);
    if (token) headers.set("x-devmoter-device-token", token);
  }
  if (method !== "GET" && method !== "HEAD" && !headers.has("x-pocket-operation-id")) {
    headers.set("x-pocket-operation-id", crypto.randomUUID());
  }
  const response = await fetch(path, { ...init, headers, cache: "no-store" });
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
}

function themeLabel(mode: string) {
  if (mode === "light") return "ライト";
  if (mode === "dark") return "ダーク";
  return "システム";
}

function densityLabel(value: string) {
  return value === "compact" ? "コンパクト" : "標準";
}

export function mountSettingsPanel() {
  const root = document.createElement("div");
  root.className = "devmoter-settings-root";
  root.innerHTML = `
    <button class="devmoter-settings-trigger" type="button" aria-label="設定を開く">⚙</button>
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
    const github = authStatus?.github || {};
    const theme = currentTheme();
    const density = localStorage.getItem(DENSITY_KEY) || "comfortable";
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
      <button class="devmoter-settings-profile" type="button" data-action="page:account">
        <span class="devmoter-settings-avatar">DM</span>
        <span>
          <strong>${escapeHtml(login)}</strong>
          <small>${escapeHtml(provider)} アカウント · GitHub ${escapeHtml(githubValue)}</small>
        </span>
        <span aria-hidden="true">›</span>
      </button>

      ${section("ワークスペース",
        row("✦", "Activity / Session Control", { action: "existing:.sc-fab", value: "実行中・Queue・Checkpoint・History" }) +
        row("⌁", "Review & Tasks", { action: "existing:#wfLaunch", value: "差分・Worktree・GitHub" }) +
        row("◇", "エージェントモード", { action: "existing:#devmoterAgentLauncher", value: "Mode・Subagent・Fleet" }) +
        row("◒", "Context", { action: "existing:.dm-context", value: "使用量・Auto compact" }) +
        row("✓", "Task checkpoints", { action: "existing:.dm-tasks", value: "現在のmicro-task" })
      )}

      ${section("DevMoter をカスタマイズする",
        row("▣", "表示とレイアウト", { action: "page:appearance", value: densityLabel(density) }) +
        row("◐", "テーマ", { action: "page:appearance", value: themeLabel(theme) }) +
        row("♢", "通知", { action: "page:notifications" })
      )}

      ${section("アカウント",
        row("◎", "サインイン", { action: "page:account", value: `${provider} · ${login}` }) +
        row("◈", "GitHub ログイン", { action: "page:account", value: githubValue }) +
        row("◌", "使用状況と制限", { action: "page:diagnostics", value: `${projectCount} Projects` })
      )}

      ${section("セキュリティとログイン",
        row("▣", "ローカルログイン", { action: "page:account" }) +
        row("◆", "Passkeys", { action: "remote:passkeys" }) +
        row("▱", "Trusted devices", { action: "page:devices" }) +
        row("G", "Google ログイン", { badge: "Coming soon", disabled: true }) +
        row("M", "Microsoft ログイン", { badge: "Coming soon", disabled: true }) +
        row("●", "Apple ログイン", { badge: "Coming soon", disabled: true })
      )}

      ${section("リモートと自動化",
        row("▤", "ホスト registry", { action: "remote:hosts" }) +
        row("◷", "Automation / Schedules", { action: "remote:automation" }) +
        row("⌁", "ペアリングコード", { action: "page:devices" }) +
        row("♢", "通知設定", { action: "page:notifications" })
      )}

      ${section("開発者ツール",
        row("⌘", "ターミナル", { action: "tool:terminal" }) +
        row("▥", "プロジェクトインデックス", { action: "tool:index" }) +
        row("◇", "セーフティスキャン", { action: "tool:safety" }) +
        row("✦", "拡張機能と Skills", { action: "existing:.dm-extensions" }) +
        row("◎", "クラウドブラウザー / Preview", { action: "existing:.adv-fab" }) +
        row("⌁", "診断", { action: "page:diagnostics", value: `v${appVersion}` })
      )}

      ${section("データ管理",
        row("▰", "ストレージ", { action: "existing:.adv-fab" }) +
        row("◫", "データコントロール", { action: "page:diagnostics" })
      )}

      ${section("ヘルプ",
        row("?", "使い方ガイド", { action: "page:guide" }) +
        row("⚑", "不具合を報告", { action: "report" }) +
        row("ⓘ", "詳細", { action: "page:diagnostics", value: `DevMoter FAST v${appVersion}` })
      )}

      <div class="devmoter-settings-card devmoter-settings-logout-card">
        ${row("↪", "ログアウト", { action: "logout", danger: true })}
      </div>
    `;
    wireRows();
  }

  function renderAppearance() {
    setHeader("表示とレイアウト", "DevMoter FAST をカスタマイズ");
    const theme = currentTheme();
    const density = localStorage.getItem(DENSITY_KEY) || "comfortable";
    scroll.innerHTML = `
      ${section("テーマ",
        row("◐", "システム", { action: "theme:system", value: theme === "system" ? "選択中" : "" }) +
        row("☀", "ライト", { action: "theme:light", value: theme === "light" ? "選択中" : "" }) +
        row("●", "ダーク", { action: "theme:dark", value: theme === "dark" ? "選択中" : "" })
      )}
      ${section("表示密度",
        row("▤", "標準", { action: "density:comfortable", value: density === "comfortable" ? "選択中" : "読みやすさ優先" }) +
        row("≡", "コンパクト", { action: "density:compact", value: density === "compact" ? "選択中" : "情報量を増やす" })
      )}
      <div class="devmoter-settings-note">
        テーマと表示密度はこの端末に保存されます。高度な画面でも同じ設定を使えるよう順次統合します。
      </div>
    `;
    wireRows();
  }

  function renderAccount() {
    setHeader("アカウント", "ログインとオーナーID");
    const identity = authStatus?.identity || {};
    const github = authStatus?.github || {};
    scroll.innerHTML = `
      <div class="devmoter-settings-profile detail">
        <span class="devmoter-settings-avatar">DM</span>
        <span>
          <strong>${escapeHtml(identity?.login || "devmoter")}</strong>
          <small>${escapeHtml(identity?.provider || "local")} でサインイン中</small>
        </span>
      </div>
      ${section("現在のセッション",
        row("◎", "サインイン方式", { value: identity?.provider || "local" }) +
        row("◈", "GitHub", { value: github?.bound ? "接続済み" : github?.configured ? "接続できます" : "未設定" }) +
        row("⌁", "Owner session", { value: authStatus?.authenticated ? "有効" : "未認証" })
      )}
      ${section("ログイン方法",
        row("▣", "ローカル recovery", { value: "緊急時・初回接続用" }) +
        row("◆", "Passkeys", { action: "remote:passkeys", value: "Face ID / Touch ID 対応" }) +
        row("G", "Google", { badge: "Coming soon", disabled: true }) +
        row("M", "Microsoft", { badge: "Coming soon", disabled: true }) +
        row("●", "Apple", { badge: "Coming soon", disabled: true })
      )}
      <div class="devmoter-settings-card devmoter-settings-logout-card">
        ${row("↪", "ログアウト", { action: "logout", danger: true })}
      </div>
    `;
    wireRows();
  }

  async function renderDevices() {
    setHeader("Trusted devices", "端末の信頼とペアリング");
    const token = localStorage.getItem(DEVICE_TOKEN_KEY) || "";
    let deviceData: Json | null = null;
    if (token) {
      try {
        deviceData = await request("/api/devices", {}, true);
      } catch {
        localStorage.removeItem(DEVICE_TOKEN_KEY);
      }
    }
    const devices = Array.isArray(deviceData?.devices) ? deviceData!.devices : [];
    scroll.innerHTML = `
      <section class="devmoter-settings-section">
        <h2>この端末</h2>
        <div class="devmoter-settings-card devmoter-settings-detail-card">
          <div class="devmoter-settings-detail-row">
            <span>状態</span><strong>${token ? "Trusted" : "未登録"}</strong>
          </div>
          <div class="devmoter-settings-actions">
            ${token
              ? '<button type="button" data-action="device:create-code">ペアリングコードを作成</button>'
              : '<button type="button" data-action="device:bootstrap">このブラウザを信頼する</button>'}
          </div>
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
              <span><strong>${escapeHtml(device.label || "Device")}</strong><small>${device.current ? "この端末 · " : ""}最終使用 ${escapeHtml(new Date(device.lastUsedAt).toLocaleString())}</small></span>
              <button type="button" data-action="device:revoke" data-device-id="${escapeHtml(device.id)}">解除</button>
            </div>
          `).join("") : '<div class="devmoter-settings-empty">登録済み端末はありません。</div>'}
        </div>
      </section>
      <div class="devmoter-settings-note">ペアリングコードは他人に共有しないでください。</div>
    `;
    wireRows();
  }

  async function currentSubscription() {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) return null;
    const registration = await navigator.serviceWorker.ready;
    return registration.pushManager.getSubscription();
  }

  async function renderNotifications() {
    setHeader("通知", "完了・承認待ちをスマホへ");
    const subscription = await currentSubscription().catch(() => null);
    const token = localStorage.getItem(DEVICE_TOKEN_KEY) || "";
    scroll.innerHTML = `
      ${section("Push 通知",
        row("♢", "通知の状態", { value: subscription ? "有効" : "無効" }) +
        row("▱", "Trusted device", { action: "page:devices", value: token ? "登録済み" : "先に登録が必要" })
      )}
      <div class="devmoter-settings-card devmoter-settings-action-card">
        <button type="button" data-action="push:enable">通知を有効にする</button>
        <button type="button" data-action="push:disable">通知を無効にする</button>
      </div>
      <div class="devmoter-settings-note">
        通知本文にはプロンプト、コード、ツール出力、認証情報を含めません。
      </div>
    `;
    wireRows();
  }

  function prerequisiteRows() {
    const required = diagnostics?.prerequisites?.required || {};
    return Object.entries(required).map(([name, value]: [string, any]) => `
      <div class="devmoter-settings-health-row">
        <span class="${value?.available ? "ok" : "bad"}">${value?.available ? "✓" : "!"}</span>
        <strong>${escapeHtml(name)}</strong>
        <small>${escapeHtml(value?.version || (value?.available ? "available" : "missing"))}</small>
      </div>
    `).join("");
  }

  function renderDiagnostics() {
    setHeader("診断", "DevMoter FAST の状態");
    scroll.innerHTML = `
      <section class="devmoter-settings-section">
        <h2>ステータス</h2>
        <div class="devmoter-settings-card devmoter-settings-detail-card">
          <div class="devmoter-settings-detail-row"><span>App</span><strong>${escapeHtml(diagnostics?.app?.version || "unknown")}</strong></div>
          <div class="devmoter-settings-detail-row"><span>OpenCode</span><strong>${diagnostics?.backends?.opencode?.online ? "online" : "offline"}</strong></div>
          <div class="devmoter-settings-detail-row"><span>Codex</span><strong>${diagnostics?.backends?.codex?.online ? "online" : "offline"}</strong></div>
          <div class="devmoter-settings-detail-row"><span>Projects</span><strong>${escapeHtml(diagnostics?.projects?.count ?? 0)}</strong></div>
          <div class="devmoter-settings-detail-row"><span>Network</span><strong>${diagnostics?.network?.localhostFirst ? "localhost-first" : "custom bind"}</strong></div>
        </div>
      </section>
      <section class="devmoter-settings-section">
        <h2>ホストの前提条件</h2>
        <div class="devmoter-settings-card devmoter-settings-health">${prerequisiteRows()}</div>
      </section>
      <div class="devmoter-settings-note">${escapeHtml(diagnostics?.network?.message || "")}</div>
    `;
  }

  function renderGuide() {
    setHeader("使い方ガイド", "迷ったらここ");
    scroll.innerHTML = `
      <section class="devmoter-guide-hero">
        <strong>普段使うのは5つでOK</strong>
        <p>全部覚える必要はありません。Chat / Projects / Activity / Automation / Settings を中心に使えば十分です。</p>
      </section>
      ${section("基本",
        row("1", "Chat", { value: "Codex / OpenCode / API Chat に指示" }) +
        row("2", "Projects", { value: "作業するrepo・cwdを選ぶ" }) +
        row("3", "Activity", { value: "実行中・Queue・Checkpoint・Handoff" }) +
        row("4", "Automation", { action: "remote:automation", value: "Schedules / Event triggers / Autopilot" }) +
        row("5", "Review / Git", { value: "AIが変えた差分を人間が確認" })
      )}
      ${section("困ったとき",
        row("⌁", "診断を見る", { action: "page:diagnostics" }) +
        row("◇", "Safety", { action: "tool:safety", value: "危険コマンドや remembered approvals" }) +
        row("⌘", "Terminal", { action: "tool:terminal", value: "登録Project上のPTY" })
      )}
    `;
    wireRows();
  }

  async function renderPage() {
    if (page === "root") return renderRoot();
    if (page === "appearance") return renderAppearance();
    if (page === "account") return renderAccount();
    if (page === "devices") return void renderDevices();
    if (page === "notifications") return void renderNotifications();
    if (page === "diagnostics") return renderDiagnostics();
    return renderGuide();
  }

  function close() {
    modal.classList.add("hidden");
    document.body.classList.remove("devmoter-settings-open");
    page = "root";
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
      document.querySelector<HTMLElement>(".dm-control-trigger")?.click();
      window.setTimeout(() => {
        document.querySelector<HTMLButtonElement>(`.dm-control-tabs [data-tab="${tab}"]`)?.click();
      }, 0);
    }, 0);
  }

  function openTools(tab: "terminal" | "safety" | "index") {
    close();
    window.setTimeout(() => {
      document.querySelector<HTMLElement>(".dm-tools-launcher")?.click();
      window.setTimeout(() => {
        const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>(".dm-tools-tabs button"));
        buttons[tab === "terminal" ? 0 : tab === "safety" ? 1 : 2]?.click();
      }, 0);
    }, 0);
  }

  async function enablePush() {
    const token = localStorage.getItem(DEVICE_TOKEN_KEY);
    if (!token) {
      toast("先にこの端末をTrusted deviceとして登録してください。");
      setPage("devices");
      return;
    }
    if (!("Notification" in window) || !("serviceWorker" in navigator) || !("PushManager" in window)) {
      toast("このブラウザはPush通知に対応していません。");
      return;
    }
    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      toast("通知権限が許可されませんでした。");
      return;
    }
    const registration = await navigator.serviceWorker.ready;
    const key = await request("/api/push/key");
    let subscription = await registration.pushManager.getSubscription();
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
    const subscription = await currentSubscription();
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
        if (action.startsWith("remote:")) {
          openRemote(action.slice(7) as "hosts" | "automation" | "passkeys");
          return;
        }
        if (action.startsWith("tool:")) {
          openTools(action.slice(5) as "terminal" | "safety" | "index");
          return;
        }
        if (action.startsWith("existing:")) {
          openExisting(action.slice(9));
          return;
        }
        if (action === "device:bootstrap") {
          try {
            const result = await request("/api/devices/bootstrap", {
              method: "POST",
              body: JSON.stringify({ label: navigator.userAgent.includes("Mobile") ? "Mobile browser" : "Browser" })
            });
            localStorage.setItem(DEVICE_TOKEN_KEY, result.token);
            toast("このブラウザをTrusted deviceに登録しました。");
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
            const result = await request("/api/pairings/claim", {
              method: "POST",
              body: JSON.stringify({
                code: input?.value || "",
                label: navigator.userAgent.includes("Mobile") ? "Mobile browser" : "Browser"
              })
            });
            localStorage.setItem(DEVICE_TOKEN_KEY, result.token);
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
            if (result.revokedCurrentDevice) localStorage.removeItem(DEVICE_TOKEN_KEY);
            toast("端末の信頼を解除しました。");
            await renderDevices();
          } catch (error) {
            toast(error instanceof Error ? error.message : String(error));
          }
          return;
        }
        if (action === "push:enable") {
          try { await enablePush(); } catch (error) { toast(error instanceof Error ? error.message : String(error)); }
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

  async function refresh() {
    scroll.innerHTML = '<div class="devmoter-settings-loading">設定を読み込んでいます…</div>';
    try {
      [authStatus, diagnostics] = await Promise.all([
        request("/api/auth/status"),
        request("/api/system/diagnostics")
      ]);
    } catch {
      // Keep the shell usable even when one diagnostics endpoint is unavailable.
    }
    await renderPage();
  }

  function open() {
    page = "root";
    modal.classList.remove("hidden");
    document.body.classList.add("devmoter-settings-open");
    void refresh();
  }

  trigger.addEventListener("click", open);
  window.addEventListener("devmoter:open-settings", open);
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
