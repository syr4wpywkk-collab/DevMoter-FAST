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

export function mountSystemPanel() {
  let activeSessionId = "";
  let activeBackend: "codex" | "opencode" = "opencode";

  const root = document.createElement("div");
  root.className = "devmoter-system-root";
  root.innerHTML = `
    <button class="devmoter-system-button" type="button" aria-label="DevMoter system settings">⚙</button>
    <div class="devmoter-system-modal hidden" role="dialog" aria-modal="true" aria-label="DevMoter setup and diagnostics">
      <div class="devmoter-system-card">
        <div class="devmoter-system-head">
          <div><strong>DevMoter system</strong><small>Setup · diagnostics · trusted devices · notifications</small></div>
          <button class="devmoter-system-close" type="button" aria-label="Close">×</button>
        </div>
        <div class="devmoter-system-body"><p>Loading…</p></div>
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
    const response = await fetch(path, { ...init, headers, cache: "no-store" });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload?.error || `HTTP ${response.status}`);
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
      terminal: "Terminal", files: "Files", processes: "Processes", services: "Services",
      ports: "Ports", git: "Git", browser: "Browser", secrets: "Secrets",
      agents: "Agents", notifications: "Notifications"
    };
    const rows = capabilities.map(([id, capability]) => `
      <span>${escapeHtml(names[id] || id)}</span>
      <b>${escapeHtml(capability?.state || "unknown")}</b>
    `).join("");
    return `
      <div class="devmoter-diagnostics-grid">
        <span>Platform</span><b>${escapeHtml(data?.host?.platform || "unknown")}</b>
        <span>Runtime</span><b>${escapeHtml(data?.host?.runtime || "unknown")}</b>
        <span>Protocol</span><b>${escapeHtml(data?.protocolVersion || "unknown")}</b>
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
      `<li><span>${value?.available ? "✓" : "!"}</span><strong>${escapeHtml(name)}</strong><small>${escapeHtml(value?.version || (value?.available ? "available" : "missing"))}</small></li>`
    ).join("");
  }

  function deviceRows(data: any) {
    const list = Array.isArray(data?.devices) ? data.devices : [];
    if (!list.length) return "<p class=\"devmoter-system-muted\">No trusted devices yet.</p>";
    return list.map((device: any) => `
      <div class="devmoter-device-row">
        <div><strong>${escapeHtml(device.label)}</strong><small>Created ${new Date(device.createdAt).toLocaleString()} · Last used ${new Date(device.lastUsedAt).toLocaleString()}${device.current ? " · this device" : ""}</small></div>
        <button type="button" data-revoke-device="${escapeHtml(device.id)}">Revoke</button>
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
    const identity = authStatus?.identity || null;

    body.innerHTML = `
      <div data-system-message class="devmoter-system-message" data-tone="info"></div>

      <section class="devmoter-system-section">
        <strong>Account</strong>
        <div class="devmoter-diagnostics-grid">
          <span>Signed in with</span><b>${escapeHtml(identity?.provider || "recovery")}</b>
          <span>Identity</span><b>${escapeHtml(identity?.login || "DevMoter owner")}</b>
          <span>GitHub login</span><b>${authStatus?.github?.bound ? "connected" : authStatus?.github?.configured ? "ready to connect" : "not configured"}</b>
        </div>
        <div class="devmoter-system-actions">
          ${authStatus?.authenticated ? '<button type="button" data-sign-out>Sign out</button>' : ""}
        </div>
      </section>

      <section class="devmoter-system-section">
        <div class="devmoter-system-title"><strong>First-run checklist</strong><button type="button" data-dismiss-setup>Skip for now</button></div>
        <ul class="devmoter-checklist">${prerequisiteRows(diag)}</ul>
        <p class="devmoter-system-muted">${escapeHtml(diag?.prerequisites?.message)}</p>
        <p class="devmoter-system-muted">DevMoter never auto-runs repository bootstrap scripts from this checklist.</p>
      </section>

      <section class="devmoter-system-section">
        <strong>Diagnostics</strong>
        <div class="devmoter-diagnostics-grid">
          <span>App</span><b>${escapeHtml(diag?.app?.version || "unknown")}</b>
          <span>OpenCode</span><b>${diag?.backends?.opencode?.online ? "online" : "offline"}</b>
          <span>Codex</span><b>${diag?.backends?.codex?.online ? "online" : "offline"}</b>
          <span>Projects</span><b>${escapeHtml(diag?.projects?.count ?? 0)}</b>
          <span>Network</span><b>${diag?.network?.localhostFirst ? "localhost-first" : "custom bind"}</b>
        </div>
        <p class="devmoter-system-muted">${escapeHtml(diag?.network?.message)}</p>
      </section>

      <section class="devmoter-system-section">
        <strong>Host capabilities</strong>
        ${hostRows(hostData)}
        <p class="devmoter-system-muted">Availability is reported by this Host. Unsupported capabilities stay unavailable.</p>
      </section>

      <section class="devmoter-system-section">
        <strong>Trusted devices</strong>
        <div data-device-list>${deviceRows(deviceData)}</div>
        <div class="devmoter-system-actions">
          ${trusted
            ? '<button type="button" data-create-pairing>Create pairing code</button>'
            : '<button type="button" data-bootstrap-device>Trust this localhost browser</button>'}
        </div>
        <div class="devmoter-pairing-claim">
          <input data-pairing-code inputmode="numeric" maxlength="6" placeholder="6-digit pairing code" />
          <button type="button" data-claim-pairing>Pair this device</button>
        </div>
      </section>

      <section class="devmoter-system-section">
        <strong>Notifications</strong>
        <p class="devmoter-system-muted">Opt-in only. Notification text is generic and never includes prompts, code, tool output, or credentials.</p>
        <div class="devmoter-system-actions">
          <button type="button" data-enable-push>Enable notifications</button>
          <button type="button" data-disable-push>Disable notifications</button>
        </div>
      </section>

      <section class="devmoter-system-section">
        <strong>Offline demo</strong>
        <p class="devmoter-system-muted">Runs scripted fake sessions only; no CLI or project files are touched.</p>
        <a class="devmoter-system-link" href="/?demo=1">Open scripted demo</a>
      </section>
    `;

    body.querySelector("[data-sign-out]")?.addEventListener("click", async () => {
      try {
        await request("/api/auth/logout", { method: "POST", body: "{}" });
        location.replace("/login.html");
      } catch (error) {
        setMessage(error instanceof Error ? error.message : String(error), "error");
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
          body: JSON.stringify({ label: navigator.userAgent.includes("Mobile") ? "Mobile browser" : "Browser" })
        });
        await render();
        setMessage("This browser is now trusted.", "ok");
      } catch (error) {
        setMessage(error instanceof Error ? error.message : String(error), "error");
      }
    });

    body.querySelector("[data-create-pairing]")?.addEventListener("click", async () => {
      try {
        const result = await request("/api/pairings", { method: "POST" }, true);
        setMessage(`Pairing code: ${result.code} (expires in 5 minutes)`, "ok");
      } catch (error) {
        setMessage(error instanceof Error ? error.message : String(error), "error");
      }
    });

    body.querySelector("[data-claim-pairing]")?.addEventListener("click", async () => {
      const input = body.querySelector<HTMLInputElement>("[data-pairing-code]")!;
      try {
        await request("/api/pairings/claim", {
          method: "POST",
          body: JSON.stringify({ code: input.value, label: navigator.userAgent.includes("Mobile") ? "Mobile browser" : "Browser" })
        });
        await render();
        setMessage("Device paired.", "ok");
      } catch (error) {
        setMessage(error instanceof Error ? error.message : String(error), "error");
      }
    });

    for (const button of body.querySelectorAll<HTMLButtonElement>("[data-revoke-device]")) {
      button.addEventListener("click", async () => {
        try {
          const result = await request(`/api/devices/${encodeURIComponent(button.dataset.revokeDevice || "")}`, { method: "DELETE" }, true);
          await render();
          setMessage(result.revokedCurrentDevice ? "This device was revoked." : "Device revoked.", "ok");
        } catch (error) {
          setMessage(error instanceof Error ? error.message : String(error), "error");
        }
      });
    }

    body.querySelector("[data-enable-push]")?.addEventListener("click", () => void enablePush());
    body.querySelector("[data-disable-push]")?.addEventListener("click", () => void disablePush());
  }

  async function currentSubscription() {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) return null;
    const registration = await navigator.serviceWorker.ready;
    return registration.pushManager.getSubscription();
  }

  async function enablePush() {
    if (!(await devices())) {
      setMessage("Trust or pair this device first.", "error");
      return;
    }
    if (!("Notification" in window) || !("serviceWorker" in navigator) || !("PushManager" in window)) {
      setMessage("Push notifications are not supported in this browser.", "error");
      return;
    }

    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      setMessage("Notification permission was not granted.", "error");
      return;
    }

    const registration = await navigator.serviceWorker.ready;
    const key = await request("/api/push/key");
    let subscription = await registration.pushManager.getSubscription();
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
    setMessage("Notifications enabled.", "ok");
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
    setMessage("Notifications disabled.", "ok");
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
      body.innerHTML = `<p class="devmoter-system-error">${escapeHtml(error instanceof Error ? error.message : String(error))}</p>`;
    });
  }

  function close() {
    modal.classList.add("hidden");
  }

  openButton.addEventListener("click", open);
  closeButton.addEventListener("click", close);
  window.addEventListener("devmoter:surface-changed", close);
  modal.addEventListener("click", event => {
    if (event.target === modal) close();
  });

  void currentSubscription().then(() => void syncVisibility());

  if (!localStorage.getItem(SETUP_DISMISSED_KEY)) {
    window.setTimeout(open, 250);
  }
}
