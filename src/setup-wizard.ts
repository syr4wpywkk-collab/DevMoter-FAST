import "./setup-wizard.css";
import { t, translateServerMessage } from "./i18n";

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

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

const groups = () => [
  { title: t("setup.groupCodingAgents"), ids: ["codex", "opencode", "claude", "antigravity"] },
  { title: t("setup.groupDevTools"), ids: ["github"] },
  { title: t("setup.groupRemoteAccess"), ids: ["tailscale"] }
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
  if (tool.state === "ready") return t("setup.statusReady");
  if (tool.state === "auth_required") return t("setup.statusAuthRequired");
  if (tool.state === "broken") return t("setup.statusBroken");
  if (tool.state === "unsupported") return t("setup.statusUnsupported");
  if (tool.installed && tool.id === "opencode") {
    if (tool.install && tool.install.installStatus === "manual-review") return t("setup.statusKeep");
    if (tool.providerAuth === "configured") return t("setup.statusProviderConfigured");
    if (tool.providerAuth === "none") return t("setup.statusProviderNone");
    return t("setup.statusProviderUnknown");
  }
  if (tool.installed) return t("setup.statusKeep");
  if (tool.state === "missing") return t("setup.statusMissing");
  return t("setup.statusUnknown");
}

function actionFor(tool: Tool): { action: PlanAction | null; label: string; disabled: boolean; checked: boolean } {
  if (tool.state === "unsupported") return { action: null, label: t("setup.actionUnavailable"), disabled: true, checked: false };
  if (tool.state === "broken" || tool.state === "unknown") {
    return { action: "manual_review", label: t("setup.actionManualReview"), disabled: true, checked: true };
  }
  if (tool.installed || ["installed", "ready", "auth_required"].includes(tool.state)) {
    return { action: "keep", label: t("setup.actionKeep"), disabled: true, checked: true };
  }
  if (tool.install.installSupport === "blocked" || tool.install.installStatus === "manual-review" || tool.install.installStatus === "blocked") {
    return { action: "manual_review", label: t("setup.actionManualReview"), disabled: true, checked: true };
  }
  if (tool.install.installStatus === "candidate" && ["A", "B"].includes(tool.install.installSourceClass || "")) {
    return { action: "install", label: t("setup.actionInstallCandidate"), disabled: false, checked: true };
  }
  if (tool.install.installStatus === "confirmation-required" && tool.install.installSourceClass === "C") {
    return { action: "install", label: t("setup.actionPreviewClassC"), disabled: false, checked: false };
  }
  return { action: "manual_review", label: t("setup.actionManualReview"), disabled: true, checked: true };
}

function planStatusLabel(item: PlanItem) {
  if (item.status === "reviewable" && item.automaticInstall) return t("setup.planReadyAuto");
  if (item.status === "reviewable") return t("setup.planReadyManual");
  if (item.status === "confirmation-required") return t("setup.planConfirmClassC");
  if (item.status === "manual-review") return t("setup.planManualReview");
  if (item.status === "blocked") return t("setup.planBlocked");
  if (item.status === "unsupported") return t("setup.planUnsupported");
  if (item.action === "keep" && item.currentState === "missing") return t("setup.planSkippedMissing");
  return t("setup.actionKeep");
}

function privilegeLabel(privilege: PlanItem["requiresPrivilege"]) {
  if (privilege === "administrator") return t("setup.privAdmin");
  if (privilege === "user") return t("setup.privUser");
  return t("setup.privUnknown");
}

export function mountSetupWizard(root: HTMLDivElement) {
  root.innerHTML = `
    <main class="dm-setup" aria-labelledby="dm-setup-title">
      <header class="dm-setup-header">
        <a href="/" class="dm-setup-back">${escapeHtml(t("setup.backHome"))}</a>
        <span class="dm-setup-badge">${escapeHtml(t("setup.badge"))}</span>
      </header>
      <section class="dm-setup-intro">
        <p class="dm-setup-eyebrow">${escapeHtml(t("setup.eyebrow"))}</p>
        <h1 id="dm-setup-title">${escapeHtml(t("setup.title"))}</h1>
        <p class="dm-setup-lede">${escapeHtml(t("setup.lede"))}</p>
        <p class="dm-setup-note">${escapeHtml(t("setup.note"))}</p>
        <div class="dm-setup-actions" data-selection-actions>
          <button class="dm-setup-rescan" type="button" data-rescan>${escapeHtml(t("setup.rescan"))}</button>
          <button class="dm-setup-review" type="button" data-review disabled>${escapeHtml(t("setup.reviewPlan"))}</button>
          <span class="dm-setup-scan-state" aria-live="polite" data-scan-state></span>
        </div>
      </section>
      <section class="dm-setup-environment" aria-labelledby="dm-setup-environment-title">
        <h2 id="dm-setup-environment-title">${escapeHtml(t("setup.envTitle"))}</h2>
        <div class="dm-setup-environment-grid" data-environment><div class="dm-setup-skeleton">${escapeHtml(t("setup.envChecking"))}</div></div>
      </section>
      <section class="dm-setup-selection" aria-labelledby="dm-setup-selection-title" data-selection-view>
        <h2 id="dm-setup-selection-title">${escapeHtml(t("setup.selectionTitle"))}</h2>
        <p class="dm-setup-section-note">${escapeHtml(t("setup.selectionNote"))}</p>
        <div class="dm-setup-groups" data-tool-groups></div>
      </section>
      <section class="dm-setup-plan-view" aria-labelledby="dm-setup-plan-title" data-plan-view hidden>
        <div class="dm-setup-plan-heading">
          <div><p class="dm-setup-eyebrow">${escapeHtml(t("setup.planEyebrow"))}</p><h2 id="dm-setup-plan-title">${escapeHtml(t("setup.planTitle"))}</h2></div>
          <span class="dm-setup-plan-lock">${escapeHtml(t("setup.planLock"))}</span>
        </div>
        <div class="dm-setup-plan-items" data-plan-items></div>
        <div class="dm-setup-plan-actions">
          <button class="dm-setup-back-button" type="button" data-back>${escapeHtml(t("common.back"))}</button>
          <button class="dm-setup-execute-button" type="button" data-execute disabled>${escapeHtml(t("setup.installButton"))}</button>
        </div>
        <div class="dm-setup-execution-result" data-execution-result aria-live="polite"></div>
      </section>
      <footer class="dm-setup-footer">${escapeHtml(t("setup.footer"))}</footer>
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
      { label: status.platform.os === "linux" ? "Linux" : status.platform.os, value: status.platform.supported ? t("setup.supported") : t("setup.unsupported") },
      { label: "Node.js", value: status.platform.node.available ? status.platform.node.version : t("setup.missing") },
      { label: "Git", value: status.platform.git.version || (status.platform.git.installed ? t("setup.available") : t("setup.notFound")) }
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
    toolGroups.replaceChildren(...groups().map(group => {
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
        const choice = tool ? actionFor(tool) : { action: null, label: t("setup.statusUnknown"), disabled: true, checked: false };
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
        status.textContent = tool ? statusLabel(tool) : t("setup.statusUnknown");
        const action = document.createElement("small");
        action.textContent = choice.label;
        copy.append(name, status, action);
        if (tool?.version) {
          const version = document.createElement("small");
          version.textContent = t("setup.versionLabel", { version: tool.version });
          copy.append(version);
        }
        if (tool?.install.installSourceClass) {
          const source = document.createElement("small");
          source.textContent = t("setup.sourceClassLabel", {
            cls: tool.install.installSourceClass,
            label: tool.install.source.label
          });
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
        source.textContent = item.source
          ? t("setup.planSource", { label: item.source.label, publisher: item.source.publisher, cls: item.installSourceClass || "?" })
          : t("setup.noVerifiedSource");
        const privilege = document.createElement("p");
        privilege.className = "dm-setup-plan-privilege";
        privilege.textContent = privilegeLabel(item.requiresPrivilege);
        card.append(source, privilege);
      } else if (item.action === "keep") {
        const kept = document.createElement("p");
        kept.className = "dm-setup-plan-privilege";
        kept.textContent = item.detectedVersion
          ? t("setup.keptVersion", { version: item.detectedVersion })
          : t("setup.noChangesPlanned");
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
      appendList(t("setup.listPlannedChanges"), item.changes);
      appendList(t("setup.listVerification"), item.verification);
      appendList(t("setup.listNotes"), item.notes);
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
      ? t("setup.execSucceeded")
      : result.status === "failed"
        ? t("setup.execFailed")
        : t("setup.execAction");
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
    scanState.textContent = t("setup.scanning");
    try {
      const response = await fetch("/api/setup/status", { cache: "no-store", credentials: "same-origin" });
      if (!response.ok) throw new Error(response.status === 401 ? t("setup.scanAuthRequired") : t("setup.scanFailed", { status: response.status }));
      const status = await response.json() as SetupStatus;
      currentStatus = status;
      renderEnvironment(status);
      renderTools(status.tools);
      scanState.textContent = t("setup.scanComplete");
    } catch (error) {
      scanState.textContent = error instanceof Error ? translateServerMessage(error.message) : t("setup.scanFailedGeneric");
    } finally {
      rescan.disabled = false;
      review.disabled = !currentStatus?.platform.supported;
    }
  }

  async function reviewPlan() {
    if (!currentStatus) return;
    review.disabled = true;
    scanState.textContent = t("setup.buildingPreview");
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
      scanState.textContent = t("setup.selectAtLeastOne");
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
        if (response.status === 401) throw new Error(t("setup.planAuthRequired"));
        const error = await response.json().catch(() => ({})) as { error?: string };
        throw new Error((error.error && translateServerMessage(error.error)) || t("setup.planFailed", { status: response.status }));
      }
      renderPlan(await response.json() as InstallPlan);
      scanState.textContent = t("setup.previewReady");
    } catch (error) {
      scanState.textContent = error instanceof Error ? translateServerMessage(error.message) : t("setup.planFailedGeneric");
      review.disabled = false;
    }
  }

  async function executePlan() {
    if (!currentPlan) return;
    const installItems = currentPlan.items.filter(item => item.action === "install");
    if (!installItems.some(item => item.automaticInstall)) return;

    execute.disabled = true;
    back.disabled = true;
    scanState.textContent = t("setup.installing");
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
      if (!response.ok) throw new Error((payload.error && translateServerMessage(payload.error)) || t("setup.installFailed", { status: response.status }));
      renderExecution(payload);
      scanState.textContent = payload.status === "succeeded"
        ? t("setup.installCompleteRescan")
        : t("setup.installFinishedFollowup");
    } catch (error) {
      scanState.textContent = error instanceof Error ? translateServerMessage(error.message) : t("setup.installFailedGeneric");
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
    scanState.textContent = t("setup.backHint");
  });
  review.addEventListener("click", () => void reviewPlan());
  execute.addEventListener("click", () => void executePlan());
  rescan.addEventListener("click", () => void scan());
  void scan();
}
