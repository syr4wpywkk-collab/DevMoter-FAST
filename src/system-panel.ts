import { boundedPushWait, inspectPushReadiness } from "./push-readiness.js";
import { formatDateTime, t, translateServerMessage } from "./i18n";
import { fetchReadWithTimeout } from "./fetch-with-timeout.mjs";

const SETUP_DISMISSED_KEY = "devmoter-setup-dismissed-v1";
function base64urlToBytes(value: string) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - value.length % 4) % 4);
  const raw = atob(padded);
  return Uint8Array.from(raw, char => char.charCodeAt(0));
}

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function deviceBrowserLabel() {
  return navigator.userAgent.includes("Mobile")
    ? t("settings.devices.labelMobile")
    : t("settings.devices.labelDesktop");
}

export function mountSystemPanel() {
  let activeSessionId = "";
  let activeBackend: "codex" | "opencode" = "opencode";

  const root = document.createElement("div");
  root.className = "devmoter-system-root";
  root.innerHTML = `
    <button class="devmoter-system-button" type="button" aria-label="${escapeHtml(t("system.buttonAria"))}">⚙</button>
    <div class="devmoter-system-modal hidden" role="dialog" aria-modal="true" aria-label="${escapeHtml(t("system.modalAria"))}">
      <div class="devmoter-system-card">
        <div class="devmoter-system-head">
          <div><strong>${escapeHtml(t("system.title"))}</strong><small>${escapeHtml(t("system.subtitle"))}</small></div>
          <button class="devmoter-system-close" type="button" aria-label="${escapeHtml(t("common.close"))}">×</button>
        </div>
        <div class="devmoter-system-body"><p>${escapeHtml(t("common.loading"))}</p></div>
      </div>
    </div>
  `;
  document.body.appendChild(root);

  const openButton = root.querySelector<HTMLButtonElement>(".devmoter-system-button")!;
  const modal = root.querySelector<HTMLDivElement>(".devmoter-system-modal")!;
  const closeButton = root.querySelector<HTMLButtonElement>(".devmoter-system-close")!;
  const body = root.querySelector<HTMLDivElement>(".devmoter-system-body")!;

  async function request(path: string, init: RequestInit = {}, auth = false) {
    const headers = new Headers(init.headers || {});
    const method = String(init.method || "GET").toUpperCase();
    if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
    if (method !== "GET" && method !== "HEAD" && !headers.has("x-pocket-operation-id")) {
      headers.set("x-pocket-operation-id", crypto.randomUUID());
    }
    const response = await fetchReadWithTimeout((input, request) => fetch(input, request), path, { ...init, headers, cache: "no-store" }, () => new Error(t("common.requestTimeout")));
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(translateServerMessage(payload?.error) || t("common.httpError", { status: response.status }));
    return payload;
  }

  function setMessage(message: string, tone: "ok" | "error" | "info" = "info") {
    const target = body.querySelector<HTMLElement>("[data-system-message]");
    if (!target) return;
    target.textContent = message;
    target.dataset.tone = tone;
  }

  async function diagnostics() {
    return request("/api/system/diagnostics");
  }

  async function hostSnapshot() {
    return request("/api/host");
  }

  function hostRows(data: any) {
    const capabilities = data?.capabilities && typeof data.capabilities === "object"
      ? Object.entries(data.capabilities) as Array<[string, any]>
      : [];
    const names: Record<string, string> = {
      terminal: t("system.capTerminal"),
      files: t("system.capFiles"),
      processes: t("system.capProcesses"),
      services: t("system.capServices"),
      ports: t("system.capPorts"),
      git: t("system.capGit"),
      browser: t("system.capBrowser"),
      secrets: t("system.capSecrets"),
      agents: t("system.capAgents"),
      notifications: t("system.capNotifications")
    };
    const rows = capabilities.map(([id, capability]) => `
      <span>${escapeHtml(names[id] || id)}</span>
      <b>${escapeHtml(capability?.state || t("common.unknown"))}${capability?.reason ? ` <small>${escapeHtml(String(capability.reason))}</small>` : ""}</b>
    `).join("");
    return `
      <div class="devmoter-diagnostics-grid">
        <span>${escapeHtml(t("system.platform"))}</span><b>${escapeHtml(data?.host?.platform || t("common.unknown"))}</b>
        <span>${escapeHtml(t("system.runtime"))}</span><b>${escapeHtml(data?.host?.runtime || t("common.unknown"))}</b>
        <span>${escapeHtml(t("system.protocol"))}</span><b>${escapeHtml(data?.protocolVersion || t("common.unknown"))}</b>
        ${rows}
      </div>
    `;
  }

  async function devices() {
    try {
      return await request("/api/devices", {}, true);
    } catch {
      return null;
    }
  }

  function prerequisiteRows(data: any) {
    const required = data?.prerequisites?.required || {};
    return Object.entries(required).map(([name, value]: [string, any]) =>
      `<li><span>${value?.available ? "✓" : "!"}</span><strong>${escapeHtml(name)}</strong><small>${escapeHtml(value?.version || (value?.available ? t("setup.available") : t("setup.missing")))}</small></li>`
    ).join("");
  }

  function deviceRows(data: any, diag: any) {
    const diagSec = diag?.deviceSecurity;
    const list = Array.isArray(data?.devices)
      ? data.devices
      : Array.isArray(diagSec?.devices)
        ? diagSec.devices
        : [];
    const trustedCount = Number.isFinite(Number(diagSec?.trustedDevices))
      ? Math.max(Number(diagSec.trustedDevices), list.length)
      : list.length;
    const canRevoke = typeof diagSec?.canRevokeDevices === "boolean"
      ? Boolean(diagSec.canRevokeDevices) || Boolean(data)
      : Boolean(data);
    if (!list.length) {
      return trustedCount > 0
        ? `<p class="devmoter-system-muted">${escapeHtml(t("settings.devices.countSummary", { count: String(trustedCount) }))}</p>`
        : `<p class="devmoter-system-muted">${escapeHtml(t("system.noTrustedDevices"))}</p>`;
    }
    return list.map((device: any) => `
      <div class="devmoter-device-row">
        <div><strong>${escapeHtml(device.label)}</strong><small>${escapeHtml(t("system.deviceMeta", {
          created: formatDateTime(device.createdAt),
          lastUsed: formatDateTime(device.lastUsedAt) || t("common.unknown"),
          current: device.current ? t("system.thisDeviceSuffix") : ""
        }))}</small></div>
        ${canRevoke ? `<button type="button" data-revoke-device="${escapeHtml(device.id)}" data-device-label="${escapeHtml(device.label || "")}" data-device-last-used="${escapeHtml(formatDateTime(device.lastUsedAt) || t("common.unknown"))}" data-device-current="${device.current ? "true" : "false"}">${escapeHtml(t("common.revoke"))}</button>` : ""}
      </div>
    `).join("");
  }

  async function render() {
    const [diag, deviceData, authStatus, hostData] = await Promise.all([
      diagnostics(),
      devices(),
      request("/api/auth/status"),
      hostSnapshot()
    ]);
    const trusted = Boolean(deviceData);
    const diagSec = diag?.deviceSecurity;
    const trustedCount = Number.isFinite(Number(diagSec?.trustedDevices))
      ? Number(diagSec.trustedDevices)
      : (Array.isArray(deviceData?.devices) ? deviceData.devices.length : 0);
    const bootstrapAllowed = typeof diagSec?.bootstrapAvailable === "boolean"
      ? Boolean(diagSec.bootstrapAvailable) && !trusted
      : (!trusted && trustedCount === 0);
    const canIssuePairing = typeof diagSec?.canIssuePairing === "boolean"
      ? Boolean(diagSec.canIssuePairing) || trusted
      : trusted;
    const identity = authStatus?.identity || null;

    body.innerHTML = `
      <div data-system-message class="devmoter-system-message" data-tone="info"></div>

      <section class="devmoter-system-section">
        <strong>${escapeHtml(t("system.accountHeading"))}</strong>
        <div class="devmoter-diagnostics-grid">
          <span>${escapeHtml(t("system.signedInWith"))}</span><b>${escapeHtml(identity?.provider || t("system.recoveryMethod"))}</b>
          <span>${escapeHtml(t("system.identity"))}</span><b>${escapeHtml(identity?.login || t("system.ownerDefault"))}</b>
          <span>${escapeHtml(t("system.githubLogin"))}</span><b>${escapeHtml(authStatus?.github?.bound ? t("system.githubConnected") : authStatus?.github?.configured ? t("system.githubReady") : t("system.githubNotConfigured"))}</b>
        </div>
        <div class="devmoter-system-actions">
          ${authStatus?.authenticated ? `<button type="button" data-sign-out>${escapeHtml(t("system.signOut"))}</button>` : ""}
        </div>
      </section>

      <section class="devmoter-system-section">
        <div class="devmoter-system-title"><strong>${escapeHtml(t("system.checklistHeading"))}</strong><button type="button" data-dismiss-setup>${escapeHtml(t("system.skipForNow"))}</button></div>
        <ul class="devmoter-checklist">${prerequisiteRows(diag)}</ul>
        <p class="devmoter-system-muted">${escapeHtml(diag?.prerequisites?.message)}</p>
        <p class="devmoter-system-muted">${escapeHtml(t("system.noBootstrapNote"))}</p>
      </section>

      <section class="devmoter-system-section">
        <strong>${escapeHtml(t("system.diagnosticsHeading"))}</strong>
        <div class="devmoter-diagnostics-grid">
          <span>${escapeHtml(t("system.app"))}</span><b>${escapeHtml(diag?.app?.version || t("common.unknown"))}</b>
          <span>OpenCode</span><b>${escapeHtml(diag?.backends?.opencode?.online ? t("common.online") : t("common.offline"))}</b>
          <span>Codex</span><b>${escapeHtml(diag?.backends?.codex?.online ? t("common.online") : t("common.offline"))}</b>
          <span>${escapeHtml(t("system.projects"))}</span><b>${escapeHtml(diag?.projects?.count ?? 0)}</b>
          <span>${escapeHtml(t("system.network"))}</span><b>${escapeHtml(diag?.network?.localhostFirst ? t("system.localhostFirst") : t("system.customBind"))}</b>
        </div>
        <p class="devmoter-system-muted">${escapeHtml(diag?.network?.message)}</p>
      </section>

      <section class="devmoter-system-section">
        <strong>${escapeHtml(t("system.hostCapabilities"))}</strong>
        ${hostRows(hostData)}
        <p class="devmoter-system-muted">${escapeHtml(t("system.reportedByHost"))}</p>
      </section>

      <section class="devmoter-system-section">
        <strong>${escapeHtml(t("system.trustedDevicesHeading"))}</strong>
        <div data-device-list>${deviceRows(deviceData, diag)}</div>
        <div class="devmoter-system-actions">
          ${canIssuePairing
            ? `<button type="button" data-create-pairing>${escapeHtml(t("system.createPairingCode"))}</button>`
            : ""}
          ${bootstrapAllowed
            ? `<button type="button" data-bootstrap-device>${escapeHtml(t("system.trustLocalhost"))}</button>`
            : ""}
        </div>
        <div class="devmoter-pairing-claim">
          <input data-pairing-code inputmode="numeric" maxlength="6" placeholder="${escapeHtml(t("system.pairPlaceholder"))}" />
          <button type="button" data-claim-pairing>${escapeHtml(t("system.pairDevice"))}</button>
        </div>
      </section>

      <section class="devmoter-system-section">
        <strong>${escapeHtml(t("system.notificationsHeading"))}</strong>
        <p class="devmoter-system-muted">${escapeHtml(t("system.notificationsPrivacy"))}</p>
        <div class="devmoter-system-actions">
          <button type="button" data-enable-push>${escapeHtml(t("system.enableNotifications"))}</button>
          <button type="button" data-disable-push>${escapeHtml(t("system.disableNotifications"))}</button>
        </div>
      </section>

      <section class="devmoter-system-section">
        <strong>${escapeHtml(t("system.offlineDemoHeading"))}</strong>
        <p class="devmoter-system-muted">${escapeHtml(t("system.offlineDemoCopy"))}</p>
        <a class="devmoter-system-link" href="/?demo=1">${escapeHtml(t("system.openDemo"))}</a>
      </section>
    `;

    body.querySelector("[data-sign-out]")?.addEventListener("click", async () => {
      try {
        await request("/api/auth/logout", { method: "POST", body: "{}" });
        location.replace("/login.html");
      } catch (error) {
        setMessage(error instanceof Error ? translateServerMessage(error.message) : String(error), "error");
      }
    });

    body.querySelector("[data-dismiss-setup]")?.addEventListener("click", () => {
      localStorage.setItem(SETUP_DISMISSED_KEY, "1");
      close();
    });

    body.querySelector("[data-bootstrap-device]")?.addEventListener("click", async () => {
      try {
        await request("/api/devices/bootstrap", {
          method: "POST",
          body: JSON.stringify({ label: deviceBrowserLabel() })
        });
            window.dispatchEvent(new CustomEvent("devmoter:device-trust-changed", { detail: { trusted: true, action: "bootstrap" } }));
        window.dispatchEvent(new CustomEvent("devmoter:device-trusted"));
        await render();
        setMessage(t("system.browserTrusted"), "ok");
      } catch (error) {
        setMessage(error instanceof Error ? translateServerMessage(error.message) : String(error), "error");
      }
    });

    body.querySelector("[data-create-pairing]")?.addEventListener("click", async () => {
      try {
        const result = await request("/api/pairings", { method: "POST" }, true);
        setMessage(t("system.pairingCodeCreated", { code: result.code }), "ok");
      } catch (error) {
        setMessage(error instanceof Error ? translateServerMessage(error.message) : String(error), "error");
      }
    });

    body.querySelector("[data-claim-pairing]")?.addEventListener("click", async () => {
      const input = body.querySelector<HTMLInputElement>("[data-pairing-code]")!;
      try {
        await request("/api/pairings/claim", {
          method: "POST",
          body: JSON.stringify({ code: input.value.trim(), label: deviceBrowserLabel() })
        });
            window.dispatchEvent(new CustomEvent("devmoter:device-trust-changed", { detail: { trusted: true, action: "claim" } }));
        window.dispatchEvent(new CustomEvent("devmoter:device-trusted"));
        await render();
        setMessage(t("system.devicePaired"), "ok");
      } catch (error) {
        setMessage(error instanceof Error ? translateServerMessage(error.message) : String(error), "error");
      }
    });

    for (const button of body.querySelectorAll<HTMLButtonElement>("[data-revoke-device]")) {
      button.addEventListener("click", async () => {
        const confirmKey = button.dataset.deviceCurrent === "true"
          ? "settings.devices.confirmRevokeCurrent"
          : "settings.devices.confirmRevoke";
        if (!window.confirm(t(confirmKey, {
          label: button.dataset.deviceLabel || t("settings.devices.deviceDefaultLabel"),
          lastUsed: button.dataset.deviceLastUsed || t("common.unknown")
        }))) return;
        try {
          const result = await request(`/api/devices/${encodeURIComponent(button.dataset.revokeDevice || "")}`, { method: "DELETE" }, true);
          const revokedCurrent = result.revokedCurrentDevice === true;
          window.dispatchEvent(new CustomEvent("devmoter:device-trust-changed", { detail: { action: "revoke", revokedCurrent } }));
          await render();
          setMessage(result.revokedCurrentDevice ? t("system.currentDeviceRevoked") : t("system.deviceRevoked"), "ok");
        } catch (error) {
          setMessage(error instanceof Error ? translateServerMessage(error.message) : String(error), "error");
        }
      });
    }

    body.querySelector("[data-enable-push]")?.addEventListener("click", () => void enablePush().catch(() => setMessage(t("system.enablePushError"), "error")));
    body.querySelector("[data-disable-push]")?.addEventListener("click", () => void disablePush().catch(() => setMessage(t("system.disablePushError"), "error")));
  }

  async function currentSubscription() {
    const supported = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
    const readiness = await inspectPushReadiness(
      supported ? navigator.serviceWorker : null,
      supported ? Notification.permission : null
    );
    if (readiness.state !== "ready" || !readiness.registration) return null;
    return boundedPushWait(readiness.registration.pushManager.getSubscription());
  }

  async function enablePush() {
    if (!(await devices())) {
      setMessage(t("system.trustFirstError"), "error");
      return;
    }
    if (!("Notification" in window) || !("serviceWorker" in navigator) || !("PushManager" in window)) {
      setMessage(t("system.pushUnsupported"), "error");
      return;
    }

    const readiness = await inspectPushReadiness(navigator.serviceWorker, Notification.permission);
    if (readiness.state !== "ready" || !readiness.registration) {
      const message = readiness.state === "unregistered"
        ? t("system.swUnregistered")
        : readiness.state === "denied"
          ? t("system.pushDenied")
          : readiness.state === "unsupported"
            ? t("system.pushUnsupported")
            : t("system.swNotReady");
      setMessage(message, "error");
      return;
    }
    const registration = readiness.registration;
    const permission = Notification.permission === "granted"
      ? Notification.permission
      : await Notification.requestPermission();
    if (permission !== "granted") {
      setMessage(t("system.permissionNotGranted"), "error");
      return;
    }

    const key = await request("/api/push/key");
    let subscription = await boundedPushWait(registration.pushManager.getSubscription());
    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: base64urlToBytes(key.publicKey)
      });
    }

    await request("/api/push/subscriptions", {
      method: "POST",
      body: JSON.stringify({ endpoint: subscription.endpoint })
    }, true);
    await syncVisibility();
    setMessage(t("system.notificationsEnabled"), "ok");
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
    setMessage(t("system.notificationsDisabled"), "ok");
  }

  async function syncVisibility() {
    const subscription = await currentSubscription().catch(() => null);
    if (!subscription) return;
    await request("/api/push/visibility", {
      method: "POST",
      body: JSON.stringify({
        endpoint: subscription.endpoint,
        sessionId: activeSessionId,
        visible: document.visibilityState === "visible"
      })
    }, true).catch(() => {});
  }

  window.addEventListener("devmoter-agent-state", ((event: CustomEvent<{ backend?: "codex" | "opencode"; sessionId?: string | null }>) => {
    const detail = event.detail || {};
    activeSessionId = String(detail.sessionId || "");
    activeBackend = detail.backend === "codex" ? "codex" : "opencode";
    void syncVisibility();
  }) as EventListener);

  document.addEventListener("visibilitychange", () => void syncVisibility());

  function open() {
    modal.classList.remove("hidden");
    void render().catch(error => {
      body.innerHTML = `<p class="devmoter-system-error">${escapeHtml(error instanceof Error ? translateServerMessage(error.message) : String(error))}</p>`;
    });
  }

  function close() {
    modal.classList.add("hidden");
  }

  openButton.addEventListener("click", open);
  closeButton.addEventListener("click", close);
  window.addEventListener("devmoter:surface-changed", () => {
    close();
  });
  modal.addEventListener("click", event => {
    if (event.target === modal) close();
  });

  void currentSubscription().then(() => void syncVisibility()).catch(() => {});
}
