import "./agent-console.css";
import { createDeviceGate, isDeviceAuthError } from "./device-gate.mjs";
import { createSheetHeader } from "./sheet-header.mjs";
import {
  compileModePrompt,
  listModes,
  renderModePolicy,
  resolveMode,
  validateCustomMode,
  type ModeConfig
} from "./agent-mode-core.mjs";
import {
  approveOrchestrationPlan,
  createOrchestrationPlan,
  renderOrchestrationPrompt,
  type OrchestrationPlan
} from "./orchestrator-core.mjs";
import { type SubagentRun } from "./subagent-runtime.mjs";
import { HostAgentRuntime } from "./host-agent-runtime";
import {
  AGENT_ROLES,
  normalizeModelRoutes,
  resolveRoleModel,
  type AgentRole,
  type ModelRoute
} from "./model-routing.mjs";
import { formatNumber, t, translateServerMessage } from "./i18n";

const CUSTOM_MODES_KEY = "devmoter-agent-custom-modes";
const MODEL_ROUTES_KEY = "devmoter-agent-model-routes";

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const ROLE_KEYS: Record<string, string> = {
  planner: "agentConsole.role.planner",
  executor: "agentConsole.role.executor",
  reviewer: "agentConsole.role.reviewer",
  vision: "agentConsole.role.vision",
  summarizer: "agentConsole.role.summarizer"
};

function roleLabel(role: string) {
  return ROLE_KEYS[role] ? t(ROLE_KEYS[role]) : role;
}

function localizedModeName(mode: ModeConfig) {
  if (!mode.custom && ["debug", "review", "orchestrator"].includes(mode.id)) {
    return t(`agentConsole.modeName.${mode.id}`);
  }
  return mode.name;
}

function localizedPolicyText(mode: ModeConfig) {
  const builtinInstCount: Record<string, { prefix: string; count: number }> = {
    debug: { prefix: "agentConsole.builtinDebugInst", count: 6 },
    review: { prefix: "agentConsole.builtinReviewInst", count: 6 },
    orchestrator: { prefix: "agentConsole.builtinOrchInst", count: 5 }
  };
  const meta = !mode.custom ? builtinInstCount[mode.id] : undefined;
  const instructions = meta
    ? Array.from({ length: meta.count }, (_, index) => t(`${meta.prefix}${index + 1}`))
    : mode.instructions;
  const allowLabel = mode.tools.allow.join(", ") || t("agentConsole.none");
  const denyLabel = mode.tools.deny.join(", ") || t("agentConsole.none");
  const mutationLabel = mode.mutationPolicy === "read-only-until-explicit-transition"
    ? t("agentConsole.mutationReadOnlyUntilTransition")
    : t("agentConsole.mutationApprovalRequired");
  return [
    t("agentConsole.policyTitle", { name: localizedModeName(mode) }),
    ...instructions.map((line, index) => `${index + 1}. ${line}`),
    mode.provider ? t("agentConsole.policyPreferredProvider", { provider: mode.provider }) : "",
    mode.model ? t("agentConsole.policyPreferredModel", { model: mode.model }) : "",
    t("agentConsole.policyAllowedTools", { tools: allowLabel }),
    t("agentConsole.policyDeniedTools", { tools: denyLabel }),
    t("agentConsole.policyMutation", { policy: mutationLabel })
  ].filter(Boolean).join("\n");
}

function visible<T extends HTMLElement>(element: T | null): element is T {
  if (!element) return false;
  return !element.closest(".hidden") && getComputedStyle(element).display !== "none";
}

function dispatchToActiveComposer(prompt: string) {
  const candidates = [
    {
      input: document.querySelector<HTMLTextAreaElement>("#codexView #cxPromptInput"),
      form: document.querySelector<HTMLFormElement>("#codexView #cxPromptForm"),
      send: document.querySelector<HTMLButtonElement>("#codexView #cxSend"),
      backend: "Codex"
    },
    {
      input: document.querySelector<HTMLTextAreaElement>("#openCodeView #ocxPromptInput"),
      form: document.querySelector<HTMLFormElement>("#openCodeView #ocxPromptForm"),
      send: document.querySelector<HTMLButtonElement>("#openCodeView #ocxSend"),
      backend: "OpenCode"
    }
  ];

  const target = candidates.find(candidate => visible(candidate.input) && visible(candidate.form));
  if (!target?.input || !target.form || !target.send) throw new Error(t("agentConsole.composerNotFound"));
  if (target.input.disabled || target.send.disabled) {
    throw new Error(t("agentConsole.backendOffline", { backend: target.backend }));
  }

  target.input.value = prompt;
  target.input.dispatchEvent(new Event("input", { bubbles: true }));
  target.form.requestSubmit();
  return target.backend;
}

function loadCustomModes(): ModeConfig[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(CUSTOM_MODES_KEY) || "[]");
    if (!Array.isArray(parsed)) return [];
    const valid: ModeConfig[] = [];
    for (const candidate of parsed) {
      try {
        valid.push(validateCustomMode(candidate));
      } catch {
        // Invalid persisted configs fail closed and are not exposed to execution.
      }
    }
    return valid;
  } catch {
    return [];
  }
}

function persistCustomModes(modes: ModeConfig[]) {
  localStorage.setItem(CUSTOM_MODES_KEY, JSON.stringify(modes));
}

function loadModelRoutes(): ModelRoute[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(MODEL_ROUTES_KEY) || "[]");
    return normalizeModelRoutes(Array.isArray(parsed) ? parsed : []);
  } catch {
    return [];
  }
}

function persistModelRoutes(routes: ModelRoute[]) {
  localStorage.setItem(MODEL_ROUTES_KEY, JSON.stringify(routes));
}

// One line per built-in mode; the full policy stays under Details.
const MODE_SUMMARY_KEYS: Record<string, string> = {
  debug: "agentConsole.modeSummary.debug",
  review: "agentConsole.modeSummary.review",
  orchestrator: "agentConsole.modeSummary.orchestrator"
};

function parseToolGroups(value: string) {
  return value.split(",").map(item => item.trim()).filter(Boolean);
}

export function mountAgentConsole() {
  if (document.querySelector("#devmoterAgentLauncher")) return;

  let customModes = loadCustomModes();
  let modelRoutes = loadModelRoutes();
  let activeModeId = "debug";
  let orchestrationPlan: OrchestrationPlan | null = null;
  let secondOpinionTargetId: string | null = null;
  const subagents = new HostAgentRuntime();

  const launcher = document.createElement("button");
  launcher.id = "devmoterAgentLauncher";
  launcher.className = "devmoter-agent-launcher";
  launcher.type = "button";
  launcher.textContent = t("agentConsole.launcherLabel");

  const panel = document.createElement("section");
  // Shared sheet frame + header (zcode-theme.css / sheet-header.mjs).
  panel.className = "devmoter-agent-panel dm-sheet-frame hidden";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", t("agentConsole.panelAria"));
  panel.innerHTML = `
    <div class="devmoter-agent-body">
    <div class="devmoter-agent-field">
      <label for="devmoterAgentMode">${escapeHtml(t("agentConsole.modeLabel"))}</label>
      <select id="devmoterAgentMode"></select>
      <small id="devmoterAgentModeSummary" class="devmoter-agent-summary"></small>
    </div>
    <details class="devmoter-agent-details">
      <summary>${escapeHtml(t("agentConsole.detailsSummary"))}</summary>
      <pre id="devmoterAgentPolicy" class="devmoter-agent-policy"></pre>
    </details>
    <div class="devmoter-agent-mode-tools">
      <button id="devmoterAgentNewMode" type="button">${escapeHtml(t("agentConsole.newModeBtn"))}</button>
      <button id="devmoterAgentEditMode" type="button">${escapeHtml(t("agentConsole.editModeBtn"))}</button>
    </div>
    <section id="devmoterAgentEditor" class="devmoter-agent-editor hidden">
      <div class="devmoter-agent-field"><label>${escapeHtml(t("agentConsole.modeIdLabel"))}</label><input id="devmoterModeId" type="text" placeholder="security-review" /></div>
      <div class="devmoter-agent-field"><label>${escapeHtml(t("agentConsole.modeNameLabel"))}</label><input id="devmoterModeName" type="text" placeholder="${escapeHtml(t("agentConsole.modeNamePlaceholder"))}" /></div>
      <div class="devmoter-agent-field"><label>${escapeHtml(t("agentConsole.instructionsLabel"))}</label><textarea id="devmoterModeInstructions"></textarea></div>
      <div class="devmoter-agent-grid">
        <div class="devmoter-agent-field"><label>${escapeHtml(t("agentConsole.preferredProviderLabel"))}</label><input id="devmoterModeProvider" type="text" placeholder="${escapeHtml(t("agentConsole.optionalPlaceholder"))}" /></div>
        <div class="devmoter-agent-field"><label>${escapeHtml(t("agentConsole.preferredModelLabel"))}</label><input id="devmoterModeModel" type="text" placeholder="${escapeHtml(t("agentConsole.optionalPlaceholder"))}" /></div>
      </div>
      <div class="devmoter-agent-field"><label>${escapeHtml(t("agentConsole.allowedToolsLabel"))}</label><input id="devmoterModeAllow" type="text" value="read" placeholder="read, diagnostics, git" /></div>
      <div class="devmoter-agent-field"><label>${escapeHtml(t("agentConsole.deniedToolsLabel"))}</label><input id="devmoterModeDeny" type="text" placeholder="files, network" /></div>
      <div class="devmoter-agent-field"><label>${escapeHtml(t("agentConsole.mutationPolicyLabel"))}</label><select id="devmoterModeMutation"><option value="approval-required">${escapeHtml(t("agentConsole.mutationApprovalRequired"))}</option><option value="read-only-until-explicit-transition">${escapeHtml(t("agentConsole.mutationReadOnlyUntilTransition"))}</option></select></div>
      <div class="devmoter-agent-mode-tools">
        <button id="devmoterModeSave" type="button">${escapeHtml(t("agentConsole.saveModeBtn"))}</button>
        <button id="devmoterModeDelete" type="button">${escapeHtml(t("agentConsole.deleteBtn"))}</button>
      </div>
    </section>
    <details class="devmoter-model-routing">
      <summary>${escapeHtml(t("agentConsole.roleRoutingSummary"))}</summary>
      <pre id="devmoterModelRoutePreview" class="devmoter-agent-policy"></pre>
      <div id="devmoterModelRouteRows"></div>
      <button id="devmoterModelRoutesSave" class="devmoter-agent-secondary-run" type="button">${escapeHtml(t("agentConsole.saveRoleModelsBtn"))}</button>
    </details>
    <div class="devmoter-agent-field">
      <label for="devmoterAgentTask">${escapeHtml(t("agentConsole.taskLabel"))}</label>
      <textarea id="devmoterAgentTask" placeholder="${escapeHtml(t("agentConsole.taskPlaceholder"))}"></textarea>
    </div>
    <section id="devmoterOrchestrationPreview" class="devmoter-orchestration-preview hidden">
      <strong>${escapeHtml(t("agentConsole.decompositionPreviewHeading"))}</strong>
      <div id="devmoterOrchestrationChildren"></div>
      <div class="devmoter-fleet-launch">
        <label>${escapeHtml(t("agentConsole.concurrencyLabel"))} <select id="devmoterFleetConcurrency"><option>1</option><option selected>2</option><option>3</option><option>4</option></select></label>
        <button id="devmoterFleetLaunch" type="button">${escapeHtml(t("agentConsole.approveLaunchFleetBtn"))}</button>
      </div>
      <button id="devmoterOrchestrationApprove" class="devmoter-agent-run" type="button">${escapeHtml(t("agentConsole.approveSendPlanBtn"))}</button>
    </section>
    <button id="devmoterAgentRun" class="devmoter-agent-run" type="button">${escapeHtml(t("agentConsole.runActiveChatBtn"))}</button>
    <button id="devmoterSubagentRun" class="devmoter-agent-secondary-run" type="button">${escapeHtml(t("agentConsole.runSubagentBtn"))}</button>
    <section id="devmoterSubagentRuns" class="devmoter-subagent-runs hidden">
      <div class="devmoter-fleet-dashboard-head">
        <strong>${escapeHtml(t("agentConsole.fleetDashboardHeading"))}</strong>
        <span id="devmoterSubagentSummary">${escapeHtml(t("agentConsole.zeroAgents"))}</span>
      </div>
      <div id="devmoterSubagentList"></div>
    </section>
    <section id="devmoterSecondOpinionComposer" class="devmoter-second-opinion-composer hidden">
      <strong>${escapeHtml(t("agentConsole.secondOpinionHeading"))}</strong>
      <small id="devmoterSecondOpinionTarget"></small>
      <div class="devmoter-second-opinion-share">
        <label><input id="devmoterOpinionShareTask" type="checkbox" checked /> ${escapeHtml(t("agentConsole.shareTask"))}</label>
        <label><input id="devmoterOpinionShareOutput" type="checkbox" checked /> ${escapeHtml(t("agentConsole.shareOutput"))}</label>
        <label><input id="devmoterOpinionShareError" type="checkbox" /> ${escapeHtml(t("agentConsole.shareError"))}</label>
      </div>
      <textarea id="devmoterOpinionQuestion">${escapeHtml(t("agentConsole.opinionQuestionDefault"))}</textarea>
      <div class="devmoter-agent-mode-tools">
        <button id="devmoterOpinionLaunch" type="button">${escapeHtml(t("agentConsole.askReviewerBtn"))}</button>
        <button id="devmoterOpinionClose" type="button">${escapeHtml(t("agentConsole.cancelBtn"))}</button>
      </div>
    </section>
    <section id="devmoterSecondOpinionRuns" class="devmoter-subagent-runs hidden">
      <div class="devmoter-fleet-dashboard-head"><strong>${escapeHtml(t("agentConsole.secondOpinionsHeading"))}</strong><span>${escapeHtml(t("agentConsole.separateResults"))}</span></div>
      <div id="devmoterSecondOpinionList"></div>
    </section>
    <p id="devmoterAgentStatus" class="devmoter-agent-status" role="status" aria-live="polite"></p>
    </div>
  `;
  const head = createSheetHeader(document, {
    title: t("agentConsole.sheetTitle"),
    subtitle: t("agentConsole.sheetSubtitle"),
    titleId: "devmoterAgentTitle"
  });
  panel.setAttribute("aria-labelledby", "devmoterAgentTitle");
  panel.prepend(head.element);

  const close = head.closeButton;
  const modeSummary = panel.querySelector<HTMLElement>("#devmoterAgentModeSummary")!;
  const select = panel.querySelector<HTMLSelectElement>("#devmoterAgentMode")!;
  const policy = panel.querySelector<HTMLPreElement>("#devmoterAgentPolicy")!;
  const task = panel.querySelector<HTMLTextAreaElement>("#devmoterAgentTask")!;
  const run = panel.querySelector<HTMLButtonElement>("#devmoterAgentRun")!;
  const status = panel.querySelector<HTMLParagraphElement>("#devmoterAgentStatus")!;
  const newMode = panel.querySelector<HTMLButtonElement>("#devmoterAgentNewMode")!;
  const editMode = panel.querySelector<HTMLButtonElement>("#devmoterAgentEditMode")!;
  const editor = panel.querySelector<HTMLElement>("#devmoterAgentEditor")!;
  const editorId = panel.querySelector<HTMLInputElement>("#devmoterModeId")!;
  const editorName = panel.querySelector<HTMLInputElement>("#devmoterModeName")!;
  const editorInstructions = panel.querySelector<HTMLTextAreaElement>("#devmoterModeInstructions")!;
  const editorProvider = panel.querySelector<HTMLInputElement>("#devmoterModeProvider")!;
  const editorModel = panel.querySelector<HTMLInputElement>("#devmoterModeModel")!;
  const editorAllow = panel.querySelector<HTMLInputElement>("#devmoterModeAllow")!;
  const editorDeny = panel.querySelector<HTMLInputElement>("#devmoterModeDeny")!;
  const editorMutation = panel.querySelector<HTMLSelectElement>("#devmoterModeMutation")!;
  const editorSave = panel.querySelector<HTMLButtonElement>("#devmoterModeSave")!;
  const editorDelete = panel.querySelector<HTMLButtonElement>("#devmoterModeDelete")!;
  const orchestrationPreview = panel.querySelector<HTMLElement>("#devmoterOrchestrationPreview")!;
  const orchestrationChildren = panel.querySelector<HTMLDivElement>("#devmoterOrchestrationChildren")!;
  const orchestrationApprove = panel.querySelector<HTMLButtonElement>("#devmoterOrchestrationApprove")!;
  const fleetConcurrency = panel.querySelector<HTMLSelectElement>("#devmoterFleetConcurrency")!;
  const fleetLaunch = panel.querySelector<HTMLButtonElement>("#devmoterFleetLaunch")!;
  const subagentRun = panel.querySelector<HTMLButtonElement>("#devmoterSubagentRun")!;
  const subagentRuns = panel.querySelector<HTMLElement>("#devmoterSubagentRuns")!;
  const subagentList = panel.querySelector<HTMLDivElement>("#devmoterSubagentList")!;
  const subagentSummary = panel.querySelector<HTMLElement>("#devmoterSubagentSummary")!;
  const modelRoutePreview = panel.querySelector<HTMLPreElement>("#devmoterModelRoutePreview")!;
  const modelRouteRows = panel.querySelector<HTMLDivElement>("#devmoterModelRouteRows")!;
  const modelRoutesSave = panel.querySelector<HTMLButtonElement>("#devmoterModelRoutesSave")!;
  const opinionComposer = panel.querySelector<HTMLElement>("#devmoterSecondOpinionComposer")!;
  const opinionTarget = panel.querySelector<HTMLElement>("#devmoterSecondOpinionTarget")!;
  const opinionShareTask = panel.querySelector<HTMLInputElement>("#devmoterOpinionShareTask")!;
  const opinionShareOutput = panel.querySelector<HTMLInputElement>("#devmoterOpinionShareOutput")!;
  const opinionShareError = panel.querySelector<HTMLInputElement>("#devmoterOpinionShareError")!;
  const opinionQuestion = panel.querySelector<HTMLTextAreaElement>("#devmoterOpinionQuestion")!;
  const opinionLaunch = panel.querySelector<HTMLButtonElement>("#devmoterOpinionLaunch")!;
  const opinionClose = panel.querySelector<HTMLButtonElement>("#devmoterOpinionClose")!;
  const opinionRuns = panel.querySelector<HTMLElement>("#devmoterSecondOpinionRuns")!;
  const opinionList = panel.querySelector<HTMLDivElement>("#devmoterSecondOpinionList")!;

  function renderModelRouting() {
    const normalized = normalizeModelRoutes(modelRoutes);
    modelRoutePreview.textContent = normalized.length
      ? [
        t("agentConsole.roleRoutesHeader"),
        ...normalized.map(route =>
          `- ${roleLabel(route.role)} -> ${route.provider ? `${route.provider}/` : ""}${route.model} [${route.capabilities.join(", ")}]`
        )
      ].join("\n")
      : t("agentConsole.roleDefaultsLine");
    modelRouteRows.replaceChildren();
    for (const role of AGENT_ROLES) {
      const route = modelRoutes.find(item => item.role === role);
      const row = document.createElement("div");
      row.className = "devmoter-model-route-row";
      row.dataset.role = role;
      row.innerHTML = `
        <strong>${escapeHtml(roleLabel(role))}</strong>
        <input data-route-model type="text" placeholder="${escapeHtml(t("agentConsole.routeModelPlaceholder"))}" />
        <input data-route-provider type="text" placeholder="${escapeHtml(t("agentConsole.routeProviderPlaceholder"))}" />
        <input data-route-capabilities type="text" placeholder="${escapeHtml(t("agentConsole.routeCapabilitiesPlaceholder"))}" />
      `;
      row.querySelector<HTMLInputElement>("[data-route-model]")!.value = route?.model || "";
      row.querySelector<HTMLInputElement>("[data-route-provider]")!.value = route?.provider || "";
      row.querySelector<HTMLInputElement>("[data-route-capabilities]")!.value =
        route?.capabilities.join(", ") || (role === "vision" ? "text, vision" : "text");
      modelRouteRows.appendChild(row);
    }
  }

  function selectedRole(activeMode: string): AgentRole {
    if (activeMode === "review") return "reviewer";
    if (activeMode === "orchestrator") return "planner";
    return "executor";
  }

  function routedModel(role: AgentRole, fallback?: string | null) {
    const route = resolveRoleModel(role, modelRoutes);
    return route.model || fallback || undefined;
  }

  function setStatus(message: string, error = false) {
    panel.querySelector(".devmoter-agent-body > [data-device-gate]")?.remove();
    status.textContent = message;
    status.classList.toggle("error", error);
  }

  // Device-token refusals become one button into 信頼済み端末, not raw text.
  function reportError(error: unknown) {
    if (!isDeviceAuthError(error)) {
      setStatus(translateServerMessage(error instanceof Error ? error.message : String(error)), true);
      return;
    }
    setStatus("");
    status.before(createDeviceGate(document, { compact: true, onRegister: () => panel.classList.add("hidden") }));
  }

  function currentModes() {
    return listModes(customModes);
  }

  function rebuildModeSelect() {
    const modes = currentModes();
    if (!modes.some(mode => mode.id === activeModeId)) activeModeId = "debug";
    select.replaceChildren();
    for (const mode of modes) {
      const option = document.createElement("option");
      option.value = mode.id;
      option.textContent = mode.custom
        ? t("agentConsole.customModeOption", { name: mode.name })
        : localizedModeName(mode);
      option.selected = mode.id === activeModeId;
      select.appendChild(option);
    }
  }

  function renderMode() {
    const mode = resolveMode(activeModeId, customModes);
    policy.textContent = localizedPolicyText(mode);
    modeSummary.textContent = !mode.custom && MODE_SUMMARY_KEYS[mode.id]
      ? t(MODE_SUMMARY_KEYS[mode.id])
      : mode.description || "";
    task.placeholder = mode.id === "debug"
      ? t("agentConsole.taskPlaceholderDebug")
      : mode.id === "review"
        ? t("agentConsole.taskPlaceholderReview")
        : mode.id === "orchestrator"
          ? t("agentConsole.taskPlaceholderOrchestrator")
          : t("agentConsole.taskPlaceholder");
    run.textContent = mode.id === "orchestrator"
      ? t("agentConsole.previewDecompositionBtn")
      : t("agentConsole.runActiveChatBtn");
    orchestrationPlan = null;
    orchestrationPreview.classList.add("hidden");
  }

  function clearEditor() {
    editorId.value = "";
    editorId.disabled = false;
    editorName.value = "";
    editorInstructions.value = "";
    editorProvider.value = "";
    editorModel.value = "";
    editorAllow.value = "read";
    editorDeny.value = "";
    editorMutation.value = "approval-required";
    editorDelete.disabled = true;
  }

  function fillEditor(mode: ModeConfig) {
    editorId.value = mode.id;
    editorId.disabled = true;
    editorName.value = mode.name;
    editorInstructions.value = mode.instructions.join("\n");
    editorProvider.value = mode.provider || "";
    editorModel.value = mode.model || "";
    editorAllow.value = mode.tools.allow.join(", ");
    editorDeny.value = mode.tools.deny.join(", ");
    editorMutation.value = mode.mutationPolicy;
    editorDelete.disabled = false;
  }

  function parentSessionId() {
    const backend = document.body.classList.contains("codex-mode") ? "codex" : "opencode";
    return backend === "codex"
      ? localStorage.getItem("opencode-pocket-codex-thread")
      : localStorage.getItem("opencode-pocket-opencode-session");
  }

  function activeProjectId() {
    return localStorage.getItem("opencode-pocket-project") || "";
  }

  function dashboardState(state: SubagentRun["state"]) {
    if (state === "waiting_for_approval") return t("agentConsole.stateWaiting");
    if (state === "completed") return t("agentConsole.stateDone");
    if (state === "running") return t("agentConsole.stateRunning");
    if (state === "starting") return t("agentConsole.stateStarting");
    if (state === "failed") return t("agentConsole.stateFailed");
    if (state === "cancelled") return t("agentConsole.stateCancelled");
    return state;
  }

  function updateDashboardSummary() {
    const runs = subagents.listRuns();
    const active = runs.filter(run => ["starting", "running", "waiting_for_approval"].includes(run.state)).length;
    const failed = runs.filter(run => run.state === "failed").length;
    const failedPart = failed ? t("agentConsole.dashboardFailedPart", { failed: formatNumber(failed) }) : "";
    subagentSummary.textContent = t("agentConsole.dashboardSummary", {
      total: formatNumber(runs.length),
      active: formatNumber(active),
      failedPart
    });
  }

  function renderSubagentRun(run: SubagentRun) {
    const targetList = run.kind === "second-opinion" ? opinionList : subagentList;
    let card = targetList.querySelector<HTMLElement>(`[data-run-id="${run.id}"]`);
    if (!card) {
      card = document.createElement("article");
      card.className = `devmoter-subagent-card ${run.kind === "second-opinion" ? "second-opinion" : ""}`;
      card.dataset.runId = run.id;
      targetList.prepend(card);
    }
    card.dataset.state = run.state;
    const lineage = [run.parentSessionId, ...run.lineage, run.id].join(" > ");
    card.replaceChildren();

    const head = document.createElement("div");
    head.className = "devmoter-subagent-card-head";
    const identity = document.createElement("div");
    const name = document.createElement("strong");
    name.textContent = t("agentConsole.cardHead", {
      role: roleLabel(run.role),
      state: dashboardState(run.state)
    });
    const agentName = document.createElement("small");
    agentName.textContent = t("agentConsole.agentIdLabel", { id: run.id });
    identity.append(name, agentName);
    const model = document.createElement("span");
    model.textContent = run.effectiveModel || run.model || t("agentConsole.defaultModel");
    head.append(identity, model);

    const taskText = document.createElement("p");
    taskText.textContent = run.task;
    const lineageText = document.createElement("small");
    lineageText.textContent = t("agentConsole.lineageLabel", { lineage });
    const budget = document.createElement("small");
    budget.textContent = t("agentConsole.budgetLabel", {
      depth: formatNumber(run.depth),
      tokensRemaining: formatNumber(run.budget.tokensRemaining),
      tokenLimit: formatNumber(run.budget.tokenLimit),
      turnsRemaining: formatNumber(run.budget.turnsRemaining),
      turnLimit: formatNumber(run.budget.turnLimit)
    });
    card.append(head, taskText, lineageText, budget);
    if (run.kind === "second-opinion" && run.output) {
      const result = document.createElement("pre");
      result.className = "devmoter-second-opinion-result";
      result.textContent = run.output;
      card.appendChild(result);
    }

    const actions = document.createElement("div");
    actions.className = "devmoter-agent-mode-tools";

    if (run.sessionId) {
      const open = document.createElement("button");
      open.type = "button";
      open.textContent = t("agentConsole.openSessionBtn");
      open.addEventListener("click", () => {
        localStorage.setItem("opencode-pocket-backend", "codex");
        localStorage.setItem("opencode-pocket-codex-thread", run.sessionId!);
        window.location.reload();
      });
      actions.appendChild(open);
    }

    if (run.kind !== "second-opinion") {
      const opinion = document.createElement("button");
      opinion.type = "button";
      opinion.textContent = t("agentConsole.secondOpinionBtn");
      opinion.addEventListener("click", () => {
        secondOpinionTargetId = run.id;
        opinionTarget.textContent = `${roleLabel(run.role)} · ${run.id}`;
        opinionShareTask.checked = true;
        opinionShareOutput.checked = Boolean(run.output);
        opinionShareError.checked = Boolean(run.error);
        opinionComposer.classList.remove("hidden");
      });
      actions.appendChild(opinion);
    }

    if (!["completed", "failed", "cancelled"].includes(run.state)) {
      const cancel = document.createElement("button");
      cancel.type = "button";
      cancel.textContent = t("agentConsole.cancelBtn");
      cancel.addEventListener("click", () => void subagents.cancel(run.id).catch(error =>
        reportError(error)
      ));
      actions.appendChild(cancel);

      if (run.pendingApproval) {
        for (const [decision, label] of [["decline", t("agentConsole.denyBtn")], ["accept", t("agentConsole.allowOnceBtn")]] as const) {
          const button = document.createElement("button");
          button.type = "button";
          button.textContent = label;
          button.addEventListener("click", () => void subagents.respondApproval(run.id, decision).catch(error =>
            reportError(error)
          ));
          actions.appendChild(button);
        }
      }
    }

    if (actions.childElementCount) card.appendChild(actions);
    if (run.kind === "second-opinion") opinionRuns.classList.remove("hidden");
    else subagentRuns.classList.remove("hidden");
    updateDashboardSummary();
  }

  subagents.subscribe(renderSubagentRun);
  void subagents.refresh().catch(error =>
    reportError(error)
  );

  opinionClose.addEventListener("click", () => {
    secondOpinionTargetId = null;
    opinionComposer.classList.add("hidden");
  });

  opinionLaunch.addEventListener("click", () => {
    void (async () => {
      try {
        if (!secondOpinionTargetId) throw new Error(t("agentConsole.chooseAgentFirst"));
        const reviewer = resolveRoleModel("reviewer", modelRoutes);
        const opinion = await subagents.spawnSecondOpinion(secondOpinionTargetId, {
          role: "reviewer",
          model: reviewer.model || undefined,
          task: opinionQuestion.value,
          share: {
            task: opinionShareTask.checked,
            output: opinionShareOutput.checked,
            error: opinionShareError.checked
          }
        });
        opinionComposer.classList.add("hidden");
        secondOpinionTargetId = null;
        if (opinion) setStatus(t("agentConsole.secondOpinionStarted", { id: opinion.id }));
      } catch (error) {
        reportError(error);
      }
    })();
  });

  modelRoutesSave.addEventListener("click", () => {
    try {
      const next = [...modelRouteRows.querySelectorAll<HTMLElement>(".devmoter-model-route-row")]
        .map(row => {
          const role = row.dataset.role as AgentRole;
          const model = row.querySelector<HTMLInputElement>("[data-route-model]")!.value.trim();
          if (!model) return null;
          return {
            role,
            model,
            provider: row.querySelector<HTMLInputElement>("[data-route-provider]")!.value.trim(),
            capabilities: row.querySelector<HTMLInputElement>("[data-route-capabilities]")!.value
              .split(",").map(value => value.trim()).filter(Boolean)
          };
        })
        .filter((route): route is NonNullable<typeof route> => Boolean(route));
      const normalized = normalizeModelRoutes(next);
      for (const route of normalized) {
        resolveRoleModel(route.role, normalized, { allowDefault: false });
      }
      modelRoutes = normalized;
      persistModelRoutes(modelRoutes);
      renderModelRouting();
      setStatus(t("agentConsole.savedModelRouting"));
    } catch (error) {
      reportError(error);
    }
  });

  launcher.addEventListener("click", () => {
    panel.classList.toggle("hidden");
    if (!panel.classList.contains("hidden")) task.focus();
  });
  close.addEventListener("click", () => panel.classList.add("hidden"));
  window.addEventListener("devmoter:surface-changed", () => panel.classList.add("hidden"));
  select.addEventListener("change", () => {
    activeModeId = select.value;
    renderMode();
  });
  newMode.addEventListener("click", () => {
    clearEditor();
    editor.classList.remove("hidden");
    editorId.focus();
  });
  editMode.addEventListener("click", () => {
    const mode = resolveMode(activeModeId, customModes);
    if (!mode.custom) {
      setStatus(t("agentConsole.builtinNotEditable"), true);
      return;
    }
    fillEditor(mode);
    editor.classList.remove("hidden");
  });
  editorSave.addEventListener("click", () => {
    try {
      const mode = validateCustomMode({
        id: editorId.value,
        name: editorName.value,
        description: t("agentConsole.customModeDescription"),
        instructions: editorInstructions.value.split(/\r?\n/),
        provider: editorProvider.value,
        model: editorModel.value,
        tools: { allow: parseToolGroups(editorAllow.value), deny: parseToolGroups(editorDeny.value) },
        mutationPolicy: editorMutation.value
      });
      customModes = [...customModes.filter(item => item.id !== mode.id), mode];
      persistCustomModes(customModes);
      activeModeId = mode.id;
      rebuildModeSelect();
      renderMode();
      fillEditor(mode);
      setStatus(t("agentConsole.savedCustomMode", { name: mode.name }));
    } catch (error) {
      reportError(error);
    }
  });
  editorDelete.addEventListener("click", () => {
    const id = editorId.value;
    customModes = customModes.filter(mode => mode.id !== id);
    persistCustomModes(customModes);
    activeModeId = "debug";
    editor.classList.add("hidden");
    rebuildModeSelect();
    renderMode();
    setStatus(t("agentConsole.deletedCustomMode", { id }));
  });
  run.addEventListener("click", () => {
    try {
      if (activeModeId === "orchestrator") {
        orchestrationPlan = createOrchestrationPlan(task.value);
        orchestrationChildren.replaceChildren();
        for (const child of orchestrationPlan.children) {
          const row = document.createElement("div");
          row.className = "devmoter-orchestration-child";
          const childStateKeys: Record<string, string> = {
            planned: "agentConsole.statePlanned",
            approved: "agentConsole.stateApproved",
            running: "agentConsole.stateRunning",
            done: "agentConsole.stateDone",
            failed: "agentConsole.stateFailed",
            cancelled: "agentConsole.stateCancelled"
          };
          const childStateLabel = childStateKeys[child.state]
            ? t(childStateKeys[child.state])
            : child.state;
          const stateEl = document.createElement("span");
          stateEl.textContent = childStateLabel;
          const ownerEl = document.createElement("strong");
          ownerEl.textContent = roleLabel(child.owner);
          const titleEl = document.createElement("p");
          titleEl.textContent = child.title;
          row.append(stateEl, ownerEl, titleEl);
          orchestrationChildren.appendChild(row);
        }
        orchestrationPreview.classList.remove("hidden");
        setStatus(t("agentConsole.reviewDecompositionStatus"));
        return;
      }
      const prompt = compileModePrompt(activeModeId, task.value, {}, customModes);
      const backend = dispatchToActiveComposer(prompt);
      setStatus(t("agentConsole.sentToBackendStatus", { backend }));
      panel.classList.add("hidden");
    } catch (error) {
      reportError(error);
    }
  });

  subagentRun.addEventListener("click", () => {
    void (async () => {
      try {
        const parent = parentSessionId();
        if (!parent) throw new Error(t("agentConsole.openParentFirstSubagent"));
        const mode = resolveMode(activeModeId, customModes);
        const run = await subagents.spawn({
          backend: "codex",
          parentSessionId: parent,
          role: activeModeId === "review" ? "reviewer" : activeModeId === "orchestrator" ? "planner" : "executor",
          model: routedModel(selectedRole(activeModeId), mode.model),
          task: task.value,
          capabilityPolicy: {
            allow: mode.tools.allow,
            deny: mode.tools.deny,
            mutationPolicy: mode.mutationPolicy
          },
          context: {
            projectId: activeProjectId(),
            mode: mode.name,
            modePolicy: renderModePolicy(mode)
          }
        });
        if (run) setStatus(t("agentConsole.spawnedSubagent", { id: run.id }));
      } catch (error) {
        reportError(error);
      }
    })();
  });

  fleetLaunch.addEventListener("click", () => {
    void (async () => {
      try {
        if (!orchestrationPlan) throw new Error(t("agentConsole.previewDecompositionFirst"));
        const parent = parentSessionId();
        if (!parent) throw new Error(t("agentConsole.openParentFirstFleet"));
        if (orchestrationPlan.state === "awaiting_approval") approveOrchestrationPlan(orchestrationPlan);
        const mode = resolveMode(activeModeId, customModes);
        const fleet = await subagents.runFleet(
          orchestrationPlan.children.map(child => ({
            backend: "codex",
            parentSessionId: parent,
            role: child.owner,
            model: routedModel(child.owner as AgentRole, mode.model),
            task: child.title,
            capabilityPolicy: {
              allow: mode.tools.allow,
              deny: mode.tools.deny,
              mutationPolicy: mode.mutationPolicy
            },
            context: {
              projectId: activeProjectId(),
              parentTask: orchestrationPlan?.task || "",
              approvedPlanId: orchestrationPlan?.id || ""
            }
          })),
          { concurrency: Number(fleetConcurrency.value) || 2 }
        );
        setStatus(t("agentConsole.fleetLaunchedStatus", {
          id: fleet.id,
          started: formatNumber(fleet.runIds.length),
          queued: formatNumber(fleet.queued)
        }));
        subagentRuns.classList.remove("hidden");
      } catch (error) {
        reportError(error);
      }
    })();
  });

  orchestrationApprove.addEventListener("click", () => {
    try {
      if (!orchestrationPlan) throw new Error(t("agentConsole.previewDecompositionFirst"));
      approveOrchestrationPlan(orchestrationPlan);
      const backend = dispatchToActiveComposer(renderOrchestrationPrompt(orchestrationPlan));
      setStatus(t("agentConsole.approvedPlanSentStatus", { backend }));
      panel.classList.add("hidden");
    } catch (error) {
      reportError(error);
    }
  });

  rebuildModeSelect();
  renderMode();
  renderModelRouting();
  document.body.append(launcher, panel);
}
