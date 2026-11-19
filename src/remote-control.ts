import { createDeviceGate, isDeviceAuthError, responseError } from "./device-gate.mjs";
import { formatNumber, t, translateServerMessage } from "./i18n";
import { createSheetHeader } from "./sheet-header.mjs";

const esc = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

type Json = Record<string, any>;

function uid() {
  return crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function b64urlToBytes(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - normalized.length % 4) % 4);
  const raw = atob(padded);
  return Uint8Array.from(raw, char => char.charCodeAt(0));
}

function bytesToB64url(value: ArrayBuffer | ArrayBufferView) {
  const bytes = value instanceof ArrayBuffer
    ? new Uint8Array(value)
    : new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  let raw = "";
  for (const byte of bytes) raw += String.fromCharCode(byte);
  return btoa(raw).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function registrationResponseJSON(credential: PublicKeyCredential): Json {
  const response = credential.response as AuthenticatorAttestationResponse & {
    getTransports?: () => string[];
  };
  const attachment = (credential as PublicKeyCredential & { authenticatorAttachment?: string | null }).authenticatorAttachment;
  return {
    id: credential.id,
    rawId: bytesToB64url(credential.rawId),
    type: credential.type,
    response: {
      clientDataJSON: bytesToB64url(response.clientDataJSON),
      attestationObject: bytesToB64url(response.attestationObject),
      transports: response.getTransports?.() || []
    },
    clientExtensionResults: credential.getClientExtensionResults(),
    ...(attachment ? { authenticatorAttachment: attachment } : {})
  };
}

function authenticationResponseJSON(credential: PublicKeyCredential): Json {
  const response = credential.response as AuthenticatorAssertionResponse;
  const attachment = (credential as PublicKeyCredential & { authenticatorAttachment?: string | null }).authenticatorAttachment;
  return {
    id: credential.id,
    rawId: bytesToB64url(credential.rawId),
    type: credential.type,
    response: {
      clientDataJSON: bytesToB64url(response.clientDataJSON),
      authenticatorData: bytesToB64url(response.authenticatorData),
      signature: bytesToB64url(response.signature),
      userHandle: response.userHandle ? bytesToB64url(response.userHandle) : null
    },
    clientExtensionResults: credential.getClientExtensionResults(),
    ...(attachment ? { authenticatorAttachment: attachment } : {})
  };
}

async function api<T = Json>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  if (init.method && !["GET", "HEAD"].includes(init.method.toUpperCase())) {
    headers.set("x-pocket-operation-id", uid());
  }
  const response = await fetch(path, { ...init, headers, cache: "no-store" });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw responseError(response.status, payload?.error ? translateServerMessage(String(payload.error)) : undefined);
  return payload as T;
}

// Forms stay folded until asked for, so each tab shows its list first.
function collapsible(label: string, content: HTMLElement) {
  const details = document.createElement("details");
  details.className = "dm-collapsible";
  const summary = document.createElement("summary");
  summary.textContent = label;
  details.append(summary, content);
  return details;
}

function emptyRow(text: string) {
  const empty = document.createElement("small");
  empty.className = "dm-empty";
  empty.textContent = text;
  return empty;
}

function button(text: string, className = "") {
  const el = document.createElement("button");
  el.type = "button";
  el.textContent = text;
  if (className) el.className = className;
  return el;
}

function field(labelText: string, input: HTMLElement) {
  const label = document.createElement("label");
  label.className = "dm-field";
  const span = document.createElement("span");
  span.textContent = labelText;
  label.append(span, input);
  return label;
}

function textInput(placeholder = "") {
  const input = document.createElement("input");
  input.type = "text";
  input.placeholder = placeholder;
  return input;
}

function selectInput(values: Array<[string, string]>) {
  const select = document.createElement("select");
  for (const [value, label] of values) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    select.appendChild(option);
  }
  return select;
}

function fmtState(state: string) {
  switch (state) {
    case "online": return t("common.online");
    case "auth-required": return t("remote.state.authRequired");
    case "timeout": return t("remote.state.timeout");
    default: return t("common.offline");
  }
}

export function hostScopedStorageKey(key: string) {
  return `devmoter:${location.host}:${key}`;
}

export function mountRemoteControlCenter() {
  const shell = document.createElement("div");
  shell.className = "dm-control-shell";
  const remoteLabel = esc(t("remote.ariaLabel"));
  const hostsTitle = esc(t("remote.tabs.hosts"));
  const automationTitle = esc(t("remote.tabs.automation"));
  const passkeysTitle = esc(t("remote.tabs.passkeys"));
  shell.innerHTML = `
    <button class="dm-control-trigger" type="button" aria-label="${remoteLabel}" aria-haspopup="dialog" aria-expanded="false">⚙</button>
    <div class="dm-control-modal hidden" role="dialog" aria-modal="true" aria-labelledby="dmControlTitle">
      <div class="dm-control-card dm-sheet-frame">
        <div class="dm-control-tabs" role="tablist" aria-label="${remoteLabel}">
          <button type="button" role="tab" data-tab="hosts" data-title="${hostsTitle}" aria-selected="true">${hostsTitle}</button>
          <button type="button" role="tab" data-tab="automation" data-title="${automationTitle}" aria-selected="false">${automationTitle}</button>
          <button type="button" role="tab" data-tab="passkeys" data-title="${passkeysTitle}" aria-selected="false">${passkeysTitle}</button>
        </div>
        <div class="dm-control-body" tabindex="-1"></div>
        <div class="dm-control-toast hidden" role="status" aria-live="polite"></div>
      </div>
    </div>
  `;
  document.body.appendChild(shell);
  // Shared sheet header; the title follows the open tab (see render()).
  const head = createSheetHeader(document, { title: t("remote.tabs.hosts"), subtitle: location.host, titleId: "dmControlTitle" });
  shell.querySelector<HTMLElement>(".dm-control-card")!.prepend(head.element);

  const trigger = shell.querySelector<HTMLButtonElement>(".dm-control-trigger")!;
  const modal = shell.querySelector<HTMLElement>(".dm-control-modal")!;
  const close = head.closeButton;
  const body = shell.querySelector<HTMLElement>(".dm-control-body")!;
  const toast = shell.querySelector<HTMLElement>(".dm-control-toast")!;
  const tabs = Array.from(shell.querySelectorAll<HTMLButtonElement>("[data-tab]"));
  let activeTab = "hosts";
  let renderGeneration = 0;
  let lastFocus: HTMLElement | null = null;

  function showToast(message: string) {
    toast.textContent = message;
    toast.classList.remove("hidden");
    window.setTimeout(() => toast.classList.add("hidden"), 3500);
  }

  async function open() {
    lastFocus = document.activeElement as HTMLElement | null;
    trigger.setAttribute("aria-expanded", "true");
    modal.classList.remove("hidden");
    await render();
    body.focus();
  }

  function closeModal(restoreFocus = true) {
    trigger.setAttribute("aria-expanded", "false");
    modal.classList.add("hidden");
    if (restoreFocus) lastFocus?.focus?.();
  }

  trigger.addEventListener("click", () => void open());
  close.addEventListener("click", () => closeModal());
  window.addEventListener("devmoter:surface-changed", () => closeModal(false));
  modal.addEventListener("click", event => {
    if (event.target === modal) closeModal();
  });
  modal.addEventListener("keydown", event => {
    if (event.key === "Escape") {
      closeModal();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = Array.from(
      modal.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'
      )
    ).filter(item => !item.closest(".hidden"));
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });

  for (const tab of tabs) {
    tab.addEventListener("click", () => {
      activeTab = tab.dataset.tab || "hosts";
      for (const item of tabs) item.setAttribute("aria-selected", String(item === tab));
      void render();
    });
  }

  // The sheet title is the label of the section that is showing, so it matches
  // the Settings row (ホスト一覧 / 自動化 / パスキー) that opened it.
  async function render() {
    const generation = ++renderGeneration;
    const tab = tabs.find(item => item.dataset.tab === activeTab);
    head.setTitle(tab?.dataset.title || t("remote.tabs.hosts"));
    // Build off-DOM and swap in only if no newer render started meanwhile:
    // Settings opens the sheet and selects a tab back to back, and two renders
    // appending into the same body duplicated every row ("This host" twice).
    const view = document.createDocumentFragment();
    try {
      if (activeTab === "hosts") await renderHosts(view);
      else if (activeTab === "automation") await renderAutomation(view);
      else await renderPasskeys(view);
    } catch (error) {
      if (isDeviceAuthError(error)) {
        // One button into 信頼済み端末 instead of "Trusted device token required".
        view.appendChild(createDeviceGate(document, { compact: true, error, onRegister: () => closeModal(false) }));
      } else {
        const p = document.createElement("p");
        p.className = "dm-error";
        p.textContent = translateServerMessage(error instanceof Error ? error.message : String(error));
        view.appendChild(p);
      }
    }
    if (generation === renderGeneration) body.replaceChildren(view);
  }

  async function renderHosts(body: DocumentFragment) {
    const status = await api<{ hosts: Array<{host: Json; status: Json}> }>("/api/control/hosts/status");
    const list = document.createElement("div");
    list.className = "dm-list";
    for (const item of status.hosts || []) {
      const row = document.createElement("div");
      row.className = "dm-row";
      const copy = document.createElement("div");
      copy.className = "dm-row-copy";
      const strong = document.createElement("strong");
      strong.textContent = item.host.label || item.host.id;
      const small = document.createElement("small");
      // The state badge already shows online/offline; the line under the name is where and how trusted.
      small.textContent = item.host.address || location.origin;
      if (item.host.trustState && item.host.trustState !== "local") {
        const trust = document.createElement("span");
        trust.textContent = item.host.trustState === "trusted" ? t("remote.hosts.trusted") : t("remote.hosts.unverified");
        small.append(" · ", trust);
      }
      const state = document.createElement("span");
      state.className = `dm-state ${item.status.state || "offline"}`;
      state.textContent = fmtState(item.status.state);
      copy.append(strong, small);
      row.append(copy, state);

      if (item.host.id !== "local") {
        const open = button(t("common.open"), "dm-mini primary");
        open.addEventListener("click", () => location.assign(item.host.address));
        const remove = button(t("common.remove"), "dm-mini");
        remove.addEventListener("click", async () => {
          await api(`/api/control/hosts/${encodeURIComponent(item.host.id)}`, { method: "DELETE" });
          await render();
        });
        row.append(open, remove);
      }
      list.appendChild(row);
    }
    body.appendChild(list);

    const form = document.createElement("form");
    form.className = "dm-form";
    const label = textInput(t("remote.hosts.labelPlaceholder"));
    const address = textInput(t("remote.hosts.addressPlaceholder"));
    const trust = selectInput([["unverified", t("remote.hosts.unverified")], ["trusted", t("remote.hosts.trusted")]]);
    const submit = button(t("remote.hosts.addButton"), "primary");
    submit.type = "submit";
    form.append(field(t("remote.hosts.labelField"), label), field(t("remote.hosts.addressField"), address), field(t("remote.hosts.trustField"), trust), submit);
    const addHost = collapsible(t("remote.hosts.addButton"), form);
    form.addEventListener("submit", async event => {
      event.preventDefault();
      await api("/api/control/hosts", {
        method: "POST",
        body: JSON.stringify({ label: label.value, address: address.value, trustState: trust.value })
      });
      await render();
    });
    body.appendChild(addHost);
  }

  async function renderAutomation(body: DocumentFragment) {
    const [schedules, triggers, runs, projects] = await Promise.all([
      api<{ schedules: Json[] }>("/api/control/schedules"),
      api<{ triggers: Json[] }>("/api/control/triggers"),
      api<{ runs: Json[] }>("/api/control/runs"),
      api<{ projects: Json[] }>("/api/projects")
    ]);

    const projectOptions: Array<[string, string]> = [["", t("remote.automation.noProject")]];
    for (const project of projects.projects || []) projectOptions.push([project.id, `${project.name} · ${project.hostId && project.hostId !== "local" ? project.hostId : location.host}`]);

    const detailsSchedule = document.createElement("details");
    detailsSchedule.open = true;
    detailsSchedule.innerHTML = `<summary>${esc(t("remote.automation.schedules"))}</summary>`;
    const scheduleList = document.createElement("div");
    scheduleList.className = "dm-list";
    for (const schedule of schedules.schedules || []) {
      const row = document.createElement("div");
      row.className = "dm-row";
      const copy = document.createElement("div");
      copy.className = "dm-row-copy";
      copy.innerHTML = `<strong></strong><small></small>`;
      copy.querySelector("strong")!.textContent = schedule.name;
      copy.querySelector("small")!.textContent = `${schedule.cron} · ${schedule.timeZone} · ${schedule.backend} · ${schedule.enabled ? t("remote.automation.active") : t("remote.automation.paused")}`;
      const toggle = button(schedule.enabled ? t("remote.automation.pause") : t("remote.automation.resume"), "dm-mini");
      toggle.addEventListener("click", async () => {
        await api(`/api/control/schedules/${schedule.id}`, { method: "PATCH", body: JSON.stringify({ enabled: !schedule.enabled }) });
        await render();
      });
      const del = button(t("common.delete"), "dm-mini");
      del.addEventListener("click", async () => {
        await api(`/api/control/schedules/${schedule.id}`, { method: "DELETE" });
        await render();
      });
      row.append(copy, toggle, del);
      scheduleList.appendChild(row);
    }
    detailsSchedule.appendChild(scheduleList);

    const scheduleForm = document.createElement("form");
    scheduleForm.className = "dm-form compact";
    const scheduleName = textInput(t("remote.automation.namePlaceholder"));
    const cron = textInput("0 21 * * *");
    const timezone = textInput(Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC");
    const backend = selectInput([["codex", "Codex"], ["opencode", "OpenCode"]]);
    const project = selectInput(projectOptions);
    const task = document.createElement("textarea");
    task.placeholder = t("remote.automation.taskPlaceholder");
    const create = button(t("remote.automation.createSchedule"), "primary");
    create.type = "submit";
    scheduleForm.append(
      field(t("remote.automation.nameField"), scheduleName),
      field(t("remote.automation.cronField"), cron),
      field(t("remote.automation.timezoneField"), timezone),
      field(t("remote.automation.backendField"), backend),
      field(t("remote.automation.projectField"), project),
      field(t("remote.automation.taskField"), task),
      create
    );
    scheduleForm.addEventListener("submit", async event => {
      event.preventDefault();
      await api("/api/control/schedules", {
        method: "POST",
        body: JSON.stringify({ name: scheduleName.value, cron: cron.value, timeZone: timezone.value, backend: backend.value, projectId: project.value, task: task.value })
      });
      await render();
    });
    if (!(schedules.schedules || []).length) scheduleList.appendChild(emptyRow(t("remote.automation.noSchedules")));
    detailsSchedule.appendChild(collapsible(t("remote.automation.newSchedule"), scheduleForm));
    body.appendChild(detailsSchedule);

    const detailsTrigger = document.createElement("details");
    detailsTrigger.innerHTML = `<summary>${esc(t("remote.automation.triggers"))}</summary>`;
    const triggerList = document.createElement("div");
    triggerList.className = "dm-list";
    for (const item of triggers.triggers || []) {
      const row = document.createElement("div");
      row.className = "dm-row";
      const copy = document.createElement("div");
      copy.className = "dm-row-copy";
      const strong = document.createElement("strong");
      strong.textContent = item.name;
      const small = document.createElement("small");
      small.textContent = t("remote.automation.triggerMeta", {
        source: String(item.source || ""),
        event: String(item.event || ""),
        max: formatNumber(Number(item.maxConcurrency || 0))
      });
      copy.append(strong, small);
      const del = button(t("common.delete"), "dm-mini");
      del.addEventListener("click", async () => {
        await api(`/api/control/triggers/${item.id}`, { method: "DELETE" });
        await render();
      });
      row.append(copy, del);
      triggerList.appendChild(row);
    }
    detailsTrigger.appendChild(triggerList);

    const triggerForm = document.createElement("form");
    triggerForm.className = "dm-form compact";
    const source = selectInput([["devmoter.lifecycle", t("remote.automation.lifecycle")], ["github.webhook", t("remote.automation.githubWebhook")]]);
    const eventName = textInput("server.started");
    const triggerBackend = selectInput([["codex", "Codex"], ["opencode", "OpenCode"]]);
    const triggerProject = selectInput(projectOptions);
    const triggerTask = document.createElement("textarea");
    triggerTask.placeholder = t("remote.automation.triggerTaskPlaceholder");
    const createTrigger = button(t("remote.automation.createTrigger"), "primary");
    createTrigger.type = "submit";
    triggerForm.append(
      field(t("remote.automation.sourceField"), source),
      field(t("remote.automation.eventField"), eventName),
      field(t("remote.automation.backendField"), triggerBackend),
      field(t("remote.automation.projectField"), triggerProject),
      field(t("remote.automation.taskField"), triggerTask),
      createTrigger
    );
    triggerForm.addEventListener("submit", async event => {
      event.preventDefault();
      const result = await api<Json>("/api/control/triggers", {
        method: "POST",
        body: JSON.stringify({ source: source.value, event: eventName.value, backend: triggerBackend.value, projectId: triggerProject.value, task: triggerTask.value })
      });
      if (result.secret) showToast(t("remote.automation.webhookSecret", { secret: String(result.secret) }));
      await render();
    });
    if (!(triggers.triggers || []).length) triggerList.appendChild(emptyRow(t("remote.automation.noTriggers")));
    detailsTrigger.appendChild(collapsible(t("remote.automation.newTrigger"), triggerForm));
    body.appendChild(detailsTrigger);

    const detailsAutopilot = document.createElement("details");
    detailsAutopilot.innerHTML = `<summary>${esc(t("remote.automation.autopilot"))}</summary>`;
    const autopilotForm = document.createElement("form");
    autopilotForm.className = "dm-form compact";
    const autoBackend = selectInput([["codex", "Codex"], ["opencode", "OpenCode"]]);
    const autoProject = selectInput(projectOptions);
    const maxTurns = document.createElement("input");
    maxTurns.type = "number"; maxTurns.min = "1"; maxTurns.max = "50"; maxTurns.value = "8";
    const maxMinutes = document.createElement("input");
    maxMinutes.type = "number"; maxMinutes.min = "1"; maxMinutes.max = "1440"; maxMinutes.value = "30";
    const maxBudget = document.createElement("input");
    maxBudget.type = "number"; maxBudget.min = "0"; maxBudget.step = "0.01"; maxBudget.value = "0";
    const autoTask = document.createElement("textarea");
    autoTask.placeholder = t("remote.automation.autoTaskPlaceholder");
    const start = button(t("remote.automation.startAutopilot"), "primary");
    start.type = "submit";
    autopilotForm.append(
      field(t("remote.automation.backendField"), autoBackend),
      field(t("remote.automation.projectField"), autoProject),
      field(t("remote.automation.maxTurns"), maxTurns),
      field(t("remote.automation.maxMinutes"), maxMinutes),
      field(t("remote.automation.maxBudget"), maxBudget),
      field(t("remote.automation.taskField"), autoTask),
      start
    );
    autopilotForm.addEventListener("submit", async event => {
      event.preventDefault();
      await api("/api/control/autopilot", {
        method: "POST",
        body: JSON.stringify({
          backend: autoBackend.value,
          projectId: autoProject.value,
          task: autoTask.value,
          maxTurns: Number(maxTurns.value),
          maxMinutes: Number(maxMinutes.value),
          maxBudget: Number(maxBudget.value)
        })
      });
      await render();
    });
    detailsAutopilot.appendChild(collapsible(t("remote.automation.newAutopilot"), autopilotForm));

    const runList = document.createElement("div");
    runList.className = "dm-list";
    for (const run of (runs.runs || []).slice(0, 20)) {
      const row = document.createElement("div");
      row.className = "dm-row";
      const copy = document.createElement("div");
      copy.className = "dm-row-copy";
      const strong = document.createElement("strong");
      strong.textContent = `${run.kind} · ${run.status}`;
      const small = document.createElement("small");
      small.textContent = run.kind === "autopilot"
        ? t("remote.automation.autopilotMeta", {
            backend: String(run.backend || ""),
            completed: formatNumber(Number(run.turnsCompleted || 0)),
            max: run.bounds?.maxTurns ? formatNumber(Number(run.bounds.maxTurns)) : "?",
            summary: String(run.summary || "")
          })
        : `${run.backend} · ${run.summary || ""}`;
      copy.append(strong, small);
      row.appendChild(copy);
      if (run.kind === "autopilot" && ["queued", "running", "paused"].includes(run.status)) {
        const primaryAction = button(run.status === "paused" ? t("remote.automation.resume") : t("remote.automation.pause"), "dm-mini");
        primaryAction.addEventListener("click", async () => {
          const action = run.status === "paused" ? "resume" : "pause";
          await api(`/api/control/autopilot/${run.id}/${action}`, { method: "POST" });
          await render();
        });
        const cancel = button(t("common.cancel"), "dm-mini");
        cancel.addEventListener("click", async () => {
          await api(`/api/control/autopilot/${run.id}/cancel`, { method: "POST" });
          await render();
        });
        row.append(primaryAction, cancel);
      }
      runList.appendChild(row);
    }
    detailsAutopilot.appendChild(runList);
    body.appendChild(detailsAutopilot);
  }

  async function renderPasskeys(body: DocumentFragment) {
    const status = await api<Json>("/api/auth/passkey/status");
    const webauthnAvailable = "credentials" in navigator && typeof PublicKeyCredential !== "undefined";
    const card = document.createElement("div");
    card.className = "dm-passkey-card";
    // Static words sit in their own text nodes so the i18n dictionary can translate them.
    const state = document.createElement("p");
    if (status.enabled) {
      const count = document.createElement("strong");
      count.textContent = formatNumber(Number(status.credentialCount ?? 0));
      const signedIn = document.createElement("span");
      signedIn.textContent = status.authenticated ? t("remote.passkeys.signedIn") : t("remote.passkeys.signInRequired");
      state.append(document.createTextNode(t("remote.passkeys.registeredLabel")), " ", count, " · ", signedIn);
    } else {
      state.textContent = t("remote.passkeys.none");
    }
    card.appendChild(state);

    if (!webauthnAvailable) {
      const unsupported = document.createElement("p");
      unsupported.className = "dm-error";
      unsupported.textContent = t("remote.passkeys.unsupported");
      card.appendChild(unsupported);
    }

    if (webauthnAvailable && status.enabled && !status.authenticated) {
      const login = button(t("remote.passkeys.signIn"), "primary");
      login.addEventListener("click", async () => {
        const options = await api<Json>("/api/auth/passkey/login/options", { method: "POST" });
        const publicKey = options.publicKey;
        publicKey.challenge = b64urlToBytes(publicKey.challenge);
        publicKey.allowCredentials = (publicKey.allowCredentials || []).map((item: Json) => ({ ...item, id: b64urlToBytes(item.id) }));
        const credential = await navigator.credentials.get({ publicKey }) as PublicKeyCredential | null;
        if (!credential) throw new Error(t("remote.passkeys.loginCancelled"));
        const response = credential.response as AuthenticatorAssertionResponse;
        await api("/api/auth/passkey/login/verify", {
          method: "POST",
          body: JSON.stringify({
            challengeId: options.challengeId,
            response: authenticationResponseJSON(credential)
          })
        });
        showToast(t("remote.passkeys.signedInToast"));
        await render();
      });
      card.appendChild(login);
    }

    if (webauthnAvailable && status.canRegister) {
      const register = button(t("remote.passkeys.register"), "primary");
      register.addEventListener("click", async () => {
        const options = await api<Json>("/api/auth/passkey/register/options", { method: "POST" });
        const publicKey = options.publicKey;
        publicKey.challenge = b64urlToBytes(publicKey.challenge);
        publicKey.user.id = b64urlToBytes(publicKey.user.id);
        publicKey.excludeCredentials = (publicKey.excludeCredentials || []).map((item: Json) => ({
          ...item,
          id: b64urlToBytes(item.id)
        }));
        const credential = await navigator.credentials.create({ publicKey }) as PublicKeyCredential | null;
        if (!credential) throw new Error(t("remote.passkeys.registerCancelled"));
        await api("/api/auth/passkey/register/verify", {
          method: "POST",
          body: JSON.stringify({
            challengeId: options.challengeId,
            response: registrationResponseJSON(credential)
          })
        });
        showToast(t("remote.passkeys.registeredToast"));
        await render();
      });
      card.appendChild(register);
    }

    if (status.authenticated) {
      const logout = button(t("remote.passkeys.signOut"), "dm-mini");
      logout.addEventListener("click", async () => {
        await api("/api/auth/passkey/logout", { method: "POST" });
        location.replace("/login.html");
      });
      card.appendChild(logout);
    }
    body.appendChild(card);
  }

  return { open, close: closeModal };
}
