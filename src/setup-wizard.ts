import "./setup-wizard.css";

type PlanAction = "install" | "keep" | "manual_review";

type Tool = {
  id: string;
  displayName: string;
  state: string;
  installed: boolean;
  version: string | null;
  authenticated: boolean | null;
  authState: string;
  providerAuth?: string;
  diagnostics: Array<{ code: string; message: string }>;
  install: {
    installSupport: "supported" | "blocked";
    installSourceClass: "A" | "B" | "C" | "D" | null;
    requiresPrivilege: "user" | "administrator" | "unknown";
    installStatus: "candidate" | "confirmation-required" | "manual-review" | "blocked";
    source: { type: string; publisher: string; label: string };
    changes: string[];
    verification: string[];
    notes: string[];
  };
};

type SetupStatus = {
  phase: string;
  platform: {
    os: string;
    supported: boolean;
    node: { available: boolean; version: string };
    git: { installed: boolean; version: string | null };
  };
  tools: Tool[];
};

type PlanItem = {
  toolId: string;
  displayName: string;
  currentState: string;
  detectedVersion: string | null;
  requestedAction: PlanAction;
  action: PlanAction | "unavailable";
  status: "reviewable" | "confirmation-required" | "manual-review" | "blocked" | "kept" | "unsupported";
  installSupport: "supported" | "blocked";
  installSourceClass: "A" | "B" | "C" | "D" | null;
  requiresPrivilege: "user" | "administrator" | "unknown";
  source: { type: string; publisher: string; label: string } | null;
  changes: string[];
  verification: string[];
  notes: string[];
  automaticInstall: boolean;
};

type InstallPlan = {
  phase: string;
  mode: "preview-only";
  executable: false;
  planId: string;
  expiresAt: string;
  items: PlanItem[];
  summary: { selected: number; keep: number; install: number; manualReview: number; unavailable: number };
};

type InstallExecution = {
  planId: string;
  status: "succeeded" | "failed" | "needs_user_action";
  items: Array<{
    toolId: string;
    status: "succeeded" | "failed" | "needs_user_action";
    errorCode: string | null;
    summary: string;
    nextAction: string | null;
  }>;
};

const groups = [
  { title: "Coding agents", ids: ["codex", "opencode", "claude", "antigravity"] },
  { title: "Developer tools", ids: ["github"] },
  { title: "Remote access", ids: ["tailscale"] }
];

const knownNames: Record<string, string> = {
  codex: "OpenAI Codex CLI",
  opencode: "OpenCode CLI",
  claude: "Claude Code",
  antigravity: "Antigravity CLI",
  github: "GitHub CLI",
  tailscale: "Tailscale"
};

function statusLabel(tool: Tool) {
  if (tool.state === "ready") return "Installed · Connected";
  if (tool.state === "auth_required") return "Installed · Sign-in required";
  if (tool.state === "broken") return "Installed · Check failed";
  if (tool.state === "unsupported") return "Unsupported on this platform";
  if (tool.installed && tool.id === "opencode") {
    if (tool.install && tool.install.installStatus === "manual-review") return "Installed · Keep existing";
    if (tool.providerAuth === "configured") return "Installed · Provider credentials found";
    if (tool.providerAuth === "none") return "Installed · No provider credentials found";
    return "Installed · Provider status unknown";
  }
  if (tool.installed) return "Installed · Keep existing";
  if (tool.state === "missing") return "Not installed";
  return "Status unknown";
}

function actionFor(tool: Tool): { action: PlanAction | null; label: string; disabled: boolean; checked: boolean } {
  if (tool.state === "unsupported") return { action: null, label: "Unavailable", disabled: true, checked: false };
  if (tool.state === "broken" || tool.state === "unknown") {
    return { action: "manual_review", label: "Needs manual review", disabled: true, checked: true };
  }
  if (tool.installed || ["installed", "ready", "auth_required"].includes(tool.state)) {
    return { action: "keep", label: "Keep existing", disabled: true, checked: true };
  }
  if (tool.install.installSupport === "blocked" || tool.install.installStatus === "manual-review" || tool.install.installStatus === "blocked") {
    return { action: "manual_review", label: "Needs manual review", disabled: true, checked: true };
  }
  if (tool.install.installStatus === "candidate" && ["A", "B"].includes(tool.install.installSourceClass || "")) {
    return { action: "install", label: "Install candidate", disabled: false, checked: true };
  }
  if (tool.install.installStatus === "confirmation-required" && tool.install.installSourceClass === "C") {
    return { action: "install", label: "Preview only · Class C", disabled: false, checked: false };
  }
  return { action: "manual_review", label: "Needs manual review", disabled: true, checked: true };
}

function planStatusLabel(item: PlanItem) {
  if (item.status === "reviewable" && item.automaticInstall) return "Ready · reviewed automatic install";
  if (item.status === "reviewable") return "Ready for review · manual execution";
  if (item.status === "confirmation-required") return "Class C · manual install remains required";
  if (item.status === "manual-review") return "Needs manual review";
  if (item.status === "blocked") return "Blocked · not an install candidate";
  if (item.status === "unsupported") return "Unavailable on this platform";
  if (item.action === "keep" && item.currentState === "missing") return "Skipped · not installed";
  return "Keep existing";
}

function privilegeLabel(privilege: PlanItem["requiresPrivilege"]) {
  if (privilege === "administrator") return "Administrator permission required";
  if (privilege === "user") return "User-level install · no sudo expected";
  return "Privilege requirement not verified";
}

export function mountSetupWizard(root: HTMLDivElement) {
  root.innerHTML = `
    <main class="dm-setup" aria-labelledby="dm-setup-title">
      <header class="dm-setup-header">
        <a href="/" class="dm-setup-back">← DevMoter FAST</a>
        <span class="dm-setup-badge">EXPERIMENTAL · INSTALL</span>
      </header>
      <section class="dm-setup-intro">
        <p class="dm-setup-eyebrow">DEV MOTER FAST SETUP</p>
        <h1 id="dm-setup-title">Your tools, one clear plan.</h1>
        <p class="dm-setup-lede">Installation should cost time, not expertise.</p>
        <p class="dm-setup-note">Review first. Only approved Codex/OpenCode npm candidates can be installed automatically, and only into a writable user-owned npm prefix. Other tools remain manual.</p>
        <div class="dm-setup-actions" data-selection-actions>
          <button class="dm-setup-rescan" type="button" data-rescan>Rescan</button>
          <button class="dm-setup-review" type="button" data-review disabled>Review install plan</button>
          <span class="dm-setup-scan-state" aria-live="polite" data-scan-state></span>
        </div>
      </section>
      <section class="dm-setup-environment" aria-labelledby="dm-setup-environment-title">
        <h2 id="dm-setup-environment-title">Environment</h2>
        <div class="dm-setup-environment-grid" data-environment><div class="dm-setup-skeleton">Checking this machine…</div></div>
      </section>
      <section class="dm-setup-selection" aria-labelledby="dm-setup-selection-title" data-selection-view>
        <h2 id="dm-setup-selection-title">Choose what to plan</h2>
        <p class="dm-setup-section-note">Existing installs are kept. Reviewed Codex/OpenCode candidates can run without sudo; Class C and administrator installs remain manual.</p>
        <div class="dm-setup-groups" data-tool-groups></div>
      </section>
      <section class="dm-setup-plan-view" aria-labelledby="dm-setup-plan-title" data-plan-view hidden>
        <div class="dm-setup-plan-heading">
          <div><p class="dm-setup-eyebrow">REVIEW & EXECUTE</p><h2 id="dm-setup-plan-title">Review install plan</h2></div>
          <span class="dm-setup-plan-lock">Explicit confirmation</span>
        </div>
        <div class="dm-setup-plan-items" data-plan-items></div>
        <div class="dm-setup-plan-actions">
          <button class="dm-setup-back-button" type="button" data-back>Back</button>
          <button class="dm-setup-execute-button" type="button" data-execute disabled>Install reviewed tools</button>
        </div>
        <div class="dm-setup-execution-result" data-execution-result aria-live="polite"></div>
      </section>
      <footer class="dm-setup-footer">Automatic execution is intentionally narrow: reviewed Codex/OpenCode user-level npm installs only. No sudo, arbitrary shell, browser-supplied package, or automatic Tailscale/service mutation.</footer>
    </main>
  `;

  const rescan = root.querySelector<HTMLButtonElement>("[data-rescan]")!;
  const review = root.querySelector<HTMLButtonElement>("[data-review]")!;
  const scanState = root.querySelector<HTMLElement>("[data-scan-state]")!;
  const environment = root.querySelector<HTMLElement>("[data-environment]")!;
  const toolGroups = root.querySelector<HTMLElement>("[data-tool-groups]")!;
  const selectionView = root.querySelector<HTMLElement>("[data-selection-view]")!;
  const planView = root.querySelector<HTMLElement>("[data-plan-view]")!;
  const planItems = root.querySelector<HTMLElement>("[data-plan-items]")!;
  const back = root.querySelector<HTMLButtonElement>("[data-back]")!;
  const execute = root.querySelector<HTMLButtonElement>("[data-execute]")!;
  const executionResult = root.querySelector<HTMLElement>("[data-execution-result]")!;
  let currentStatus: SetupStatus | null = null;
  let currentPlan: InstallPlan | null = null;

  function renderEnvironment(status: SetupStatus) {
    const items = [
      { label: status.platform.os === "linux" ? "Linux" : status.platform.os, value: status.platform.supported ? "Supported" : "Unsupported" },
      { label: "Node.js", value: status.platform.node.available ? status.platform.node.version : "Missing" },
      { label: "Git", value: status.platform.git.version || (status.platform.git.installed ? "Available" : "Not found") }
    ];
    environment.replaceChildren(...items.map(item => {
      const card = document.createElement("div");
      card.className = "dm-setup-env-card";
      const name = document.createElement("span");
      name.textContent = item.label;
      const value = document.createElement("strong");
      value.textContent = item.value;
      card.append(name, value);
      return card;
    }));
  }

  function renderTools(tools: Tool[]) {
    const byId = new Map(tools.map(tool => [tool.id, tool]));
    toolGroups.replaceChildren(...groups.map(group => {
      const section = document.createElement("section");
      section.className = "dm-setup-group";
      const heading = document.createElement("h3");
      heading.textContent = group.title;
      const list = document.createElement("div");
      list.className = "dm-setup-tool-list";
      for (const id of group.ids) {
        const tool = byId.get(id);
        const row = document.createElement("article");
        row.className = `dm-setup-tool dm-setup-state-${tool?.state || "unknown"}`;
        const choice = tool ? actionFor(tool) : { action: null, label: "Status unknown", disabled: true, checked: false };
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.className = "dm-setup-choice";
        checkbox.dataset.toolId = id;
        checkbox.checked = choice.checked;
        checkbox.disabled = choice.disabled;
        checkbox.setAttribute("aria-label", `${tool?.displayName || knownNames[id]}: ${choice.label}`);
        const copy = document.createElement("div");
        copy.className = "dm-setup-tool-copy";
        const name = document.createElement("strong");
        name.textContent = tool?.displayName || knownNames[id];
        const status = document.createElement("span");
        status.textContent = tool ? statusLabel(tool) : "Status unknown";
        const action = document.createElement("small");
        action.textContent = choice.label;
        copy.append(name, status, action);
        if (tool?.version) {
          const version = document.createElement("small");
          version.textContent = `Version ${tool.version}`;
          copy.append(version);
        }
        if (tool?.install.installSourceClass) {
          const source = document.createElement("small");
          source.textContent = `Source class ${tool.install.installSourceClass} · ${tool.install.source.label}`;
          copy.append(source);
        }
        row.append(checkbox, copy);
        list.append(row);
      }
      section.append(heading, list);
      return section;
    }));
  }

  function renderPlan(plan: InstallPlan) {
    currentPlan = plan;
    executionResult.replaceChildren();
    planItems.replaceChildren(...plan.items.map(item => {
      const card = document.createElement("article");
      card.className = `dm-setup-plan-card dm-setup-plan-${item.status}`;
      const heading = document.createElement("div");
      heading.className = "dm-setup-plan-card-heading";
      const name = document.createElement("h3");
      name.textContent = item.displayName;
      const state = document.createElement("span");
      state.textContent = planStatusLabel(item);
      heading.append(name, state);
      card.append(heading);

      if (item.action === "install" || item.status === "manual-review" || item.status === "blocked") {
        const source = document.createElement("p");
        source.className = "dm-setup-plan-source";
        source.textContent = item.source ? `${item.source.label} · ${item.source.publisher} · Class ${item.installSourceClass || "?"}` : "No verified source";
        const privilege = document.createElement("p");
        privilege.className = "dm-setup-plan-privilege";
        privilege.textContent = privilegeLabel(item.requiresPrivilege);
        card.append(source, privilege);
      } else if (item.action === "keep") {
        const kept = document.createElement("p");
        kept.className = "dm-setup-plan-privilege";
        kept.textContent = item.detectedVersion ? `Version ${item.detectedVersion} · no changes planned` : "No changes planned";
        card.append(kept);
      }

      const appendList = (title: string, values: string[]) => {
        if (!values.length) return;
        const block = document.createElement("div");
        block.className = "dm-setup-plan-detail";
        const label = document.createElement("strong");
        label.textContent = title;
        const list = document.createElement("ul");
        for (const value of values) {
          const entry = document.createElement("li");
          entry.textContent = value;
          list.append(entry);
        }
        block.append(label, list);
        card.append(block);
      };
      appendList("Planned changes", item.changes);
      appendList("Verification", item.verification);
      appendList("Notes", item.notes);
      return card;
    }));
    selectionView.hidden = true;
    planView.hidden = false;
    rescan.hidden = true;
    review.hidden = true;
    execute.disabled = !plan.items.some(item => item.action === "install" && item.automaticInstall);
  }

  function renderExecution(result: InstallExecution) {
    const section = document.createElement("section");
    section.className = `dm-setup-execution dm-setup-execution-${result.status}`;
    const heading = document.createElement("strong");
    heading.textContent = result.status === "succeeded"
      ? "Installation complete"
      : result.status === "failed"
        ? "Installation needs attention"
        : "Some tools still need local action";
    section.append(heading);

    const list = document.createElement("div");
    list.className = "dm-setup-execution-list";
    for (const item of result.items) {
      const row = document.createElement("div");
      row.className = "dm-setup-execution-row";
      const name = document.createElement("span");
      name.textContent = knownNames[item.toolId] || item.toolId;
      const detail = document.createElement("small");
      detail.textContent = item.nextAction ? `${item.summary} ${item.nextAction}` : item.summary;
      row.append(name, detail);
      list.append(row);
    }
    section.append(list);
    executionResult.replaceChildren(section);
  }

  async function scan() {
    rescan.disabled = true;
    review.disabled = true;
    scanState.textContent = "Scanning…";
    try {
      const response = await fetch("/api/setup/status", { cache: "no-store", credentials: "same-origin" });
      if (!response.ok) throw new Error(response.status === 401 ? "Sign in to scan this machine." : `Scan failed (${response.status}).`);
      const status = await response.json() as SetupStatus;
      currentStatus = status;
      renderEnvironment(status);
      renderTools(status.tools);
      scanState.textContent = "Scan complete";
    } catch (error) {
      scanState.textContent = error instanceof Error ? error.message : "Scan failed.";
    } finally {
      rescan.disabled = false;
      review.disabled = !currentStatus?.platform.supported;
    }
  }

  async function reviewPlan() {
    if (!currentStatus) return;
    review.disabled = true;
    scanState.textContent = "Building preview…";
    const selections: Array<{ toolId: string; action: PlanAction }> = [];
    for (const tool of currentStatus.tools) {
      const choice = actionFor(tool);
      if (!choice.action || !choice.checked) continue;
      const checkbox = [...root.querySelectorAll<HTMLInputElement>("input[data-tool-id]")]
        .find(input => input.dataset.toolId === tool.id);
      if (!checkbox?.checked) continue;
      selections.push({ toolId: tool.id, action: choice.action });
    }
    if (!selections.length) {
      scanState.textContent = "Select at least one tool to review.";
      review.disabled = false;
      return;
    }
    try {
      const response = await fetch("/api/setup/plan", {
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ selections })
      });
      if (!response.ok) {
        if (response.status === 401) throw new Error("Sign in to review this plan.");
        const error = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(error.error || `Plan preview failed (${response.status}).`);
      }
      renderPlan(await response.json() as InstallPlan);
      scanState.textContent = "Preview ready · nothing was installed";
    } catch (error) {
      scanState.textContent = error instanceof Error ? error.message : "Plan preview failed.";
      review.disabled = false;
    }
  }

  async function executePlan() {
    if (!currentPlan) return;
    const installItems = currentPlan.items.filter(item => item.action === "install");
    if (!installItems.some(item => item.automaticInstall)) return;

    execute.disabled = true;
    back.disabled = true;
    scanState.textContent = "Installing reviewed tools…";
    try {
      const response = await fetch("/api/setup/execute", {
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
        headers: {
          "content-type": "application/json",
          "x-pocket-operation-id": crypto.randomUUID()
        },
        body: JSON.stringify({
          planId: currentPlan.planId,
          confirmedActions: installItems.map(item => ({
            toolId: item.toolId,
            actionId: "install",
            confirmed: true
          }))
        })
      });
      const payload = await response.json().catch(() => ({})) as InstallExecution & { error?: string };
      if (!response.ok) throw new Error(payload.error || `Installation failed (${response.status}).`);
      renderExecution(payload);
      scanState.textContent = payload.status === "succeeded"
        ? "Installation complete · rescan to refresh status"
        : "Installation finished with follow-up actions";
    } catch (error) {
      scanState.textContent = error instanceof Error ? error.message : "Installation failed.";
      execute.disabled = false;
    } finally {
      back.disabled = false;
    }
  }

  back.addEventListener("click", () => {
    planView.hidden = true;
    selectionView.hidden = false;
    rescan.hidden = false;
    review.hidden = false;
    currentPlan = null;
    executionResult.replaceChildren();
    execute.disabled = true;
    scanState.textContent = "Choose tools to update the preview.";
  });
  review.addEventListener("click", () => void reviewPlan());
  execute.addEventListener("click", () => void executePlan());
  rescan.addEventListener("click", () => void scan());
  void scan();
}
