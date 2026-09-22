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

async function api<T = Json>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  if (init.method && !["GET", "HEAD"].includes(init.method.toUpperCase())) {
    headers.set("x-pocket-operation-id", uid());
  }
  const response = await fetch(path, { ...init, headers, cache: "no-store" });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.error || `HTTP ${response.status}`);
  return payload as T;
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
    case "online": return "Online";
    case "auth-required": return "Auth required";
    case "timeout": return "Timeout";
    default: return "Offline";
  }
}

export function hostScopedStorageKey(key: string) {
  return `devmoter:${location.host}:${key}`;
}

export function mountControlCenter() {
  const shell = document.createElement("div");
  shell.className = "dm-control-shell";
  shell.innerHTML = `
    <button class="dm-control-trigger" type="button" aria-label="DevMoter control center" aria-haspopup="dialog">⚙</button>
    <div class="dm-control-modal hidden" role="dialog" aria-modal="true" aria-labelledby="dmControlTitle">
      <div class="dm-control-card">
        <header class="dm-control-head">
          <div><strong id="dmControlTitle">DevMoter Control</strong><small>${location.host}</small></div>
          <button class="dm-control-close" type="button" aria-label="Close control center">×</button>
        </header>
        <div class="dm-control-tabs" role="tablist" aria-label="Control center sections">
          <button type="button" role="tab" data-tab="hosts" aria-selected="true">Hosts</button>
          <button type="button" role="tab" data-tab="automation" aria-selected="false">Automation</button>
          <button type="button" role="tab" data-tab="passkeys" aria-selected="false">Passkeys</button>
        </div>
        <div class="dm-control-body" tabindex="-1"></div>
        <div class="dm-control-toast hidden" role="status" aria-live="polite"></div>
      </div>
    </div>
  `;
  document.body.appendChild(shell);

  const trigger = shell.querySelector<HTMLButtonElement>(".dm-control-trigger")!;
  const modal = shell.querySelector<HTMLElement>(".dm-control-modal")!;
  const close = shell.querySelector<HTMLButtonElement>(".dm-control-close")!;
  const body = shell.querySelector<HTMLElement>(".dm-control-body")!;
  const toast = shell.querySelector<HTMLElement>(".dm-control-toast")!;
  const tabs = Array.from(shell.querySelectorAll<HTMLButtonElement>("[data-tab]"));
  let activeTab = "hosts";
  let lastFocus: HTMLElement | null = null;

  function showToast(message: string) {
    toast.textContent = message;
    toast.classList.remove("hidden");
    window.setTimeout(() => toast.classList.add("hidden"), 3500);
  }

  async function open() {
    lastFocus = document.activeElement as HTMLElement | null;
    modal.classList.remove("hidden");
    await render();
    body.focus();
  }

  function closeModal() {
    modal.classList.add("hidden");
    lastFocus?.focus?.();
  }

  trigger.addEventListener("click", () => void open());
  close.addEventListener("click", closeModal);
  modal.addEventListener("click", event => {
    if (event.target === modal) closeModal();
  });
  modal.addEventListener("keydown", event => {
    if (event.key === "Escape") closeModal();
  });

  for (const tab of tabs) {
    tab.addEventListener("click", () => {
      activeTab = tab.dataset.tab || "hosts";
      for (const item of tabs) item.setAttribute("aria-selected", String(item === tab));
      void render();
    });
  }

  async function render() {
    body.replaceChildren();
    try {
      if (activeTab === "hosts") await renderHosts();
      else if (activeTab === "automation") await renderAutomation();
      else await renderPasskeys();
    } catch (error) {
      const p = document.createElement("p");
      p.className = "dm-error";
      p.textContent = error instanceof Error ? error.message : String(error);
      body.appendChild(p);
    }
  }

  async function renderHosts() {
    const title = document.createElement("div");
    title.className = "dm-section-title";
    title.innerHTML = "<strong>Host registry</strong><span>Host → project → agent/session. Credentials stay on each host.</span>";
    body.appendChild(title);

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
      small.textContent = `${item.host.address || location.origin} · ${item.host.trustState} · ${fmtState(item.status.state)}`;
      const state = document.createElement("span");
      state.className = `dm-state ${item.status.state || "offline"}`;
      state.textContent = fmtState(item.status.state);
      copy.append(strong, small);
      row.append(copy, state);

      if (item.host.id !== "local") {
        const open = button("Open", "dm-mini primary");
        open.addEventListener("click", () => location.assign(item.host.address));
        const remove = button("Remove", "dm-mini");
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
    const label = textInput("Laptop / home server");
    const address = textInput("https://host.example");
    const trust = selectInput([["unverified", "Unverified"], ["trusted", "Trusted"]]);
    const submit = button("Add host", "primary");
    submit.type = "submit";
    form.append(field("Label", label), field("Address", address), field("Trust", trust), submit);
    form.addEventListener("submit", async event => {
      event.preventDefault();
      await api("/api/control/hosts", {
        method: "POST",
        body: JSON.stringify({ label: label.value, address: address.value, trustState: trust.value })
      });
      await render();
    });
    body.appendChild(form);
  }

  async function renderAutomation() {
    const [schedules, triggers, runs, projects] = await Promise.all([
      api<{ schedules: Json[] }>("/api/control/schedules"),
      api<{ triggers: Json[] }>("/api/control/triggers"),
      api<{ runs: Json[] }>("/api/control/runs"),
      api<{ projects: Json[] }>("/api/projects")
    ]);

    const intro = document.createElement("div");
    intro.className = "dm-section-title";
    intro.innerHTML = "<strong>Bounded automation</strong><span>Every schedule, trigger, and autopilot run is visible here. Approval policy remains normal.</span>";
    body.appendChild(intro);

    const projectOptions: Array<[string, string]> = [["", "No project"]];
    for (const project of projects.projects || []) projectOptions.push([project.id, `${project.name} · ${project.hostId || location.host}`]);

    const detailsSchedule = document.createElement("details");
    detailsSchedule.open = true;
    detailsSchedule.innerHTML = "<summary>Schedules</summary>";
    const scheduleList = document.createElement("div");
    scheduleList.className = "dm-list";
    for (const schedule of schedules.schedules || []) {
      const row = document.createElement("div");
      row.className = "dm-row";
      const copy = document.createElement("div");
      copy.className = "dm-row-copy";
      copy.innerHTML = `<strong></strong><small></small>`;
      copy.querySelector("strong")!.textContent = schedule.name;
      copy.querySelector("small")!.textContent = `${schedule.cron} · ${schedule.timeZone} · ${schedule.backend} · ${schedule.enabled ? "active" : "paused"}`;
      const toggle = button(schedule.enabled ? "Pause" : "Resume", "dm-mini");
      toggle.addEventListener("click", async () => {
        await api(`/api/control/schedules/${schedule.id}`, { method: "PATCH", body: JSON.stringify({ enabled: !schedule.enabled }) });
        await render();
      });
      const del = button("Delete", "dm-mini");
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
    const scheduleName = textInput("Nightly review");
    const cron = textInput("0 21 * * *");
    const timezone = textInput(Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC");
    const backend = selectInput([["codex", "Codex"], ["opencode", "OpenCode"]]);
    const project = selectInput(projectOptions);
    const task = document.createElement("textarea");
    task.placeholder = "Task to run";
    const create = button("Create schedule", "primary");
    create.type = "submit";
    scheduleForm.append(field("Name", scheduleName), field("Cron", cron), field("Timezone", timezone), field("Backend", backend), field("Project", project), field("Task", task), create);
    scheduleForm.addEventListener("submit", async event => {
      event.preventDefault();
      await api("/api/control/schedules", {
        method: "POST",
        body: JSON.stringify({ name: scheduleName.value, cron: cron.value, timeZone: timezone.value, backend: backend.value, projectId: project.value, task: task.value })
      });
      await render();
    });
    detailsSchedule.appendChild(scheduleForm);
    body.appendChild(detailsSchedule);

    const detailsTrigger = document.createElement("details");
    detailsTrigger.innerHTML = "<summary>Event triggers</summary>";
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
      small.textContent = `${item.source} · ${item.event} · max ${item.maxConcurrency} concurrent`;
      copy.append(strong, small);
      const del = button("Delete", "dm-mini");
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
    const source = selectInput([["devmoter.lifecycle", "DevMoter lifecycle"], ["github.webhook", "GitHub webhook"]]);
    const eventName = textInput("server.started");
    const triggerBackend = selectInput([["codex", "Codex"], ["opencode", "OpenCode"]]);
    const triggerProject = selectInput(projectOptions);
    const triggerTask = document.createElement("textarea");
    triggerTask.placeholder = "Task for this event";
    const createTrigger = button("Create trigger", "primary");
    createTrigger.type = "submit";
    triggerForm.append(field("Source", source), field("Event", eventName), field("Backend", triggerBackend), field("Project", triggerProject), field("Task", triggerTask), createTrigger);
    triggerForm.addEventListener("submit", async event => {
      event.preventDefault();
      const result = await api<Json>("/api/control/triggers", {
        method: "POST",
        body: JSON.stringify({ source: source.value, event: eventName.value, backend: triggerBackend.value, projectId: triggerProject.value, task: triggerTask.value })
      });
      if (result.secret) showToast(`Webhook secret (shown once): ${result.secret}`);
      await render();
    });
    detailsTrigger.appendChild(triggerForm);
    body.appendChild(detailsTrigger);

    const detailsAutopilot = document.createElement("details");
    detailsAutopilot.innerHTML = "<summary>Autopilot</summary>";
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
    autoTask.placeholder = "Long-running task";
    const start = button("Start bounded autopilot", "primary");
    start.type = "submit";
    autopilotForm.append(field("Backend", autoBackend), field("Project", autoProject), field("Max turns", maxTurns), field("Max minutes", maxMinutes), field("Max budget (0 = unset)", maxBudget), field("Task", autoTask), start);
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
    detailsAutopilot.appendChild(autopilotForm);

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
        ? `${run.backend} · ${run.turnsCompleted || 0}/${run.bounds?.maxTurns || "?"} turns · ${run.summary || ""}`
        : `${run.backend} · ${run.summary || ""}`;
      copy.append(strong, small);
      row.appendChild(copy);
      if (run.kind === "autopilot" && ["queued", "running"].includes(run.status)) {
        const pause = button("Pause", "dm-mini");
        pause.addEventListener("click", async () => {
          await api(`/api/control/autopilot/${run.id}/pause`, { method: "POST" });
          await render();
        });
        const cancel = button("Cancel", "dm-mini");
        cancel.addEventListener("click", async () => {
          await api(`/api/control/autopilot/${run.id}/cancel`, { method: "POST" });
          await render();
        });
        row.append(pause, cancel);
      }
      runList.appendChild(row);
    }
    detailsAutopilot.appendChild(runList);
    body.appendChild(detailsAutopilot);
  }

  async function renderPasskeys() {
    const status = await api<Json>("/api/auth/passkey/status");
    const intro = document.createElement("div");
    intro.className = "dm-section-title";
    intro.innerHTML = "<strong>Passkeys</strong><span>Credentials are scoped to this DevMoter host origin. First registration is loopback-only; recovery uses another passkey or local bootstrap.</span>";
    body.appendChild(intro);

    const card = document.createElement("div");
    card.className = "dm-passkey-card";
    const state = document.createElement("p");
    state.textContent = status.enabled
      ? `${status.credentialCount} passkey(s) registered for ${status.rpId}. ${status.authenticated ? "Authenticated." : "Login required."}`
      : `No passkey registered for ${status.rpId}.`;
    card.appendChild(state);

    if (status.enabled && !status.authenticated) {
      const login = button("Login with passkey", "primary");
      login.addEventListener("click", async () => {
        const options = await api<Json>("/api/auth/passkey/login/options", { method: "POST" });
        const publicKey = options.publicKey;
        publicKey.challenge = b64urlToBytes(publicKey.challenge);
        publicKey.allowCredentials = (publicKey.allowCredentials || []).map((item: Json) => ({ ...item, id: b64urlToBytes(item.id) }));
        const credential = await navigator.credentials.get({ publicKey }) as PublicKeyCredential | null;
        if (!credential) throw new Error("Passkey login cancelled");
        const response = credential.response as AuthenticatorAssertionResponse;
        await api("/api/auth/passkey/login/verify", {
          method: "POST",
          body: JSON.stringify({
            challengeId: options.challengeId,
            credentialId: bytesToB64url(credential.rawId),
            clientDataJSON: bytesToB64url(response.clientDataJSON),
            authenticatorData: bytesToB64url(response.authenticatorData),
            signature: bytesToB64url(response.signature)
          })
        });
        showToast("Passkey login complete");
        await render();
      });
      card.appendChild(login);
    }

    if (status.canRegister) {
      const register = button("Register passkey", "primary");
      register.addEventListener("click", async () => {
        const options = await api<Json>("/api/auth/passkey/register/options", { method: "POST" });
        const publicKey = options.publicKey;
        publicKey.challenge = b64urlToBytes(publicKey.challenge);
        publicKey.user.id = b64urlToBytes(publicKey.user.id);
        const credential = await navigator.credentials.create({ publicKey }) as PublicKeyCredential | null;
        if (!credential) throw new Error("Passkey registration cancelled");
        const response = credential.response as AuthenticatorAttestationResponse & {
          getPublicKey?: () => ArrayBuffer | null;
          getPublicKeyAlgorithm?: () => number;
          getTransports?: () => string[];
        };
        const publicKeyBytes = response.getPublicKey?.();
        const algorithm = response.getPublicKeyAlgorithm?.();
        if (!publicKeyBytes || !algorithm) throw new Error("This browser cannot export the passkey public key");
        await api("/api/auth/passkey/register/verify", {
          method: "POST",
          body: JSON.stringify({
            challengeId: options.challengeId,
            credentialId: bytesToB64url(credential.rawId),
            clientDataJSON: bytesToB64url(response.clientDataJSON),
            publicKey: bytesToB64url(publicKeyBytes),
            algorithm,
            transports: response.getTransports?.() || []
          })
        });
        showToast("Passkey registered");
        await render();
      });
      card.appendChild(register);
    }

    if (status.authenticated) {
      const logout = button("Logout", "dm-mini");
      logout.addEventListener("click", async () => {
        await api("/api/auth/passkey/logout", { method: "POST" });
        await render();
      });
      card.appendChild(logout);
    }
    body.appendChild(card);
  }

  return { open, close: closeModal };
}
