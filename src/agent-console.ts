import "./agent-console.css";
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
import {
  SubagentRuntime,
  createCodexSubagentAdapter,
  type SubagentRun
} from "./subagent-runtime.mjs";

const CUSTOM_MODES_KEY = "devmoter-agent-custom-modes";

function visible<T extends HTMLElement>(element: T | null): element is T {
  if (!element) return false;
  return !element.closest(".hidden") && getComputedStyle(element).display !== "none";
}

function dispatchToActiveComposer(prompt: string) {
  const candidates = [
    {
      input: document.querySelector<HTMLTextAreaElement>("#codexView #cxPromptInput"),
      form: document.querySelector<HTMLFormElement>("#codexView #cxPromptForm"),
      backend: "Codex"
    },
    {
      input: document.querySelector<HTMLTextAreaElement>("#openCodeView #ocxPromptInput"),
      form: document.querySelector<HTMLFormElement>("#openCodeView #ocxPromptForm"),
      backend: "OpenCode"
    }
  ];

  const target = candidates.find(candidate => visible(candidate.input) && visible(candidate.form));
  if (!target?.input || !target.form) throw new Error("Active DevMoter composer was not found");
  if (target.input.disabled) throw new Error(`${target.backend} is offline or busy`);

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

function parseToolGroups(value: string) {
  return value.split(",").map(item => item.trim()).filter(Boolean);
}

export function mountAgentConsole() {
  if (document.querySelector("#devmoterAgentLauncher")) return;

  let customModes = loadCustomModes();
  let activeModeId = "debug";
  let orchestrationPlan: OrchestrationPlan | null = null;
  const subagents = new SubagentRuntime({
    adapters: { codex: createCodexSubagentAdapter() },
    policy: { maxDepth: 3, tokenBudget: 12000, turnBudget: 8 }
  });

  const launcher = document.createElement("button");
  launcher.id = "devmoterAgentLauncher";
  launcher.className = "devmoter-agent-launcher";
  launcher.type = "button";
  launcher.textContent = "Agent mode";

  const panel = document.createElement("section");
  panel.className = "devmoter-agent-panel hidden";
  panel.setAttribute("aria-label", "Agent mode control");
  panel.innerHTML = `
    <div class="devmoter-agent-head">
      <div><h2>Agent mode</h2><p>Runs through the normal DevMoter approval flow.</p></div>
      <button class="devmoter-agent-close" type="button" aria-label="Close">×</button>
    </div>
    <div class="devmoter-agent-field">
      <label for="devmoterAgentMode">Mode</label>
      <select id="devmoterAgentMode"></select>
    </div>
    <div class="devmoter-agent-field">
      <label>Visible policy</label>
      <pre id="devmoterAgentPolicy" class="devmoter-agent-policy"></pre>
    </div>
    <div class="devmoter-agent-mode-tools">
      <button id="devmoterAgentNewMode" type="button">＋ Custom mode</button>
      <button id="devmoterAgentEditMode" type="button">Edit selected</button>
    </div>
    <section id="devmoterAgentEditor" class="devmoter-agent-editor hidden">
      <div class="devmoter-agent-field"><label>Mode id</label><input id="devmoterModeId" type="text" placeholder="security-review" /></div>
      <div class="devmoter-agent-field"><label>Name</label><input id="devmoterModeName" type="text" placeholder="Security review" /></div>
      <div class="devmoter-agent-field"><label>Instructions (one per line)</label><textarea id="devmoterModeInstructions"></textarea></div>
      <div class="devmoter-agent-grid">
        <div class="devmoter-agent-field"><label>Preferred provider</label><input id="devmoterModeProvider" type="text" placeholder="optional" /></div>
        <div class="devmoter-agent-field"><label>Preferred model</label><input id="devmoterModeModel" type="text" placeholder="optional" /></div>
      </div>
      <div class="devmoter-agent-field"><label>Allowed tool groups</label><input id="devmoterModeAllow" type="text" value="read" placeholder="read, diagnostics, git" /></div>
      <div class="devmoter-agent-field"><label>Denied tool groups</label><input id="devmoterModeDeny" type="text" placeholder="files, network" /></div>
      <div class="devmoter-agent-field"><label>Mutation policy</label><select id="devmoterModeMutation"><option value="approval-required">Approval required</option><option value="read-only-until-explicit-transition">Read-only until explicit transition</option></select></div>
      <div class="devmoter-agent-mode-tools">
        <button id="devmoterModeSave" type="button">Save mode</button>
        <button id="devmoterModeDelete" type="button">Delete</button>
      </div>
    </section>
    <div class="devmoter-agent-field">
      <label for="devmoterAgentTask">Task</label>
      <textarea id="devmoterAgentTask" placeholder="Describe the task"></textarea>
    </div>
    <section id="devmoterOrchestrationPreview" class="devmoter-orchestration-preview hidden">
      <strong>Decomposition preview</strong>
      <div id="devmoterOrchestrationChildren"></div>
      <button id="devmoterOrchestrationApprove" class="devmoter-agent-run" type="button">Approve & send plan</button>
    </section>
    <button id="devmoterAgentRun" class="devmoter-agent-run" type="button">Run in active chat</button>
    <button id="devmoterSubagentRun" class="devmoter-agent-secondary-run" type="button">Run as bounded Codex subagent</button>
    <section id="devmoterSubagentRuns" class="devmoter-subagent-runs hidden">
      <strong>Subagent runs</strong>
      <div id="devmoterSubagentList"></div>
    </section>
    <p id="devmoterAgentStatus" class="devmoter-agent-status" role="status" aria-live="polite"></p>
  `;

  const close = panel.querySelector<HTMLButtonElement>(".devmoter-agent-close")!;
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
  const subagentRun = panel.querySelector<HTMLButtonElement>("#devmoterSubagentRun")!;
  const subagentRuns = panel.querySelector<HTMLElement>("#devmoterSubagentRuns")!;
  const subagentList = panel.querySelector<HTMLDivElement>("#devmoterSubagentList")!;

  function setStatus(message: string, error = false) {
    status.textContent = message;
    status.classList.toggle("error", error);
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
      option.textContent = mode.custom ? `${mode.name} · custom` : mode.name;
      option.selected = mode.id === activeModeId;
      select.appendChild(option);
    }
  }

  function renderMode() {
    const mode = resolveMode(activeModeId, customModes);
    policy.textContent = renderModePolicy(mode);
    task.placeholder = mode.id === "debug"
      ? "Describe the failure, regression, or test you want reproduced"
      : mode.id === "review"
        ? "Describe the working tree, diff, or range to review"
        : mode.id === "orchestrator"
          ? "Describe the large task to decompose"
          : "Describe the task";
    run.textContent = mode.id === "orchestrator" ? "Preview decomposition" : "Run in active chat";
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

  function renderSubagentRun(run: SubagentRun) {
    let card = subagentList.querySelector<HTMLElement>(`[data-run-id="${run.id}"]`);
    if (!card) {
      card = document.createElement("article");
      card.className = "devmoter-subagent-card";
      card.dataset.runId = run.id;
      subagentList.prepend(card);
    }
    const lineage = [run.parentSessionId, ...run.lineage, run.id].join(" > ");
    card.replaceChildren();
    const head = document.createElement("div");
    head.className = "devmoter-subagent-card-head";
    const name = document.createElement("strong");
    name.textContent = `${run.role} · ${run.state}`;
    const model = document.createElement("span");
    model.textContent = run.effectiveModel || run.model || "default model";
    head.append(name, model);
    const taskText = document.createElement("p");
    taskText.textContent = run.task;
    const lineageText = document.createElement("small");
    lineageText.textContent = `Lineage: ${lineage}`;
    const budget = document.createElement("small");
    budget.textContent = `Depth ${run.depth} · budget ${run.budget.tokensRemaining}/${run.budget.tokenLimit} tok · ${run.budget.turnsRemaining}/${run.budget.turnLimit} turns`;
    card.append(head, taskText, lineageText, budget);

    if (!["completed", "failed", "cancelled"].includes(run.state)) {
      const actions = document.createElement("div");
      actions.className = "devmoter-agent-mode-tools";
      const cancel = document.createElement("button");
      cancel.type = "button";
      cancel.textContent = "Cancel";
      cancel.addEventListener("click", () => void subagents.cancel(run.id).catch(error =>
        setStatus(error instanceof Error ? error.message : String(error), true)
      ));
      actions.appendChild(cancel);

      if (run.pendingApproval) {
        for (const [decision, label] of [["decline", "Deny"], ["accept", "Allow once"]] as const) {
          const button = document.createElement("button");
          button.type = "button";
          button.textContent = label;
          button.addEventListener("click", () => void subagents.respondApproval(run.id, decision).catch(error =>
            setStatus(error instanceof Error ? error.message : String(error), true)
          ));
          actions.appendChild(button);
        }
      }
      card.appendChild(actions);
    }
    subagentRuns.classList.remove("hidden");
  }

  subagents.subscribe(renderSubagentRun);

  launcher.addEventListener("click", () => {
    panel.classList.toggle("hidden");
    if (!panel.classList.contains("hidden")) task.focus();
  });
  close.addEventListener("click", () => panel.classList.add("hidden"));
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
      setStatus("Built-in modes are inspectable but not editable. Create a custom mode to customize them.", true);
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
        description: "User-defined DevMoter mode",
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
      setStatus(`Saved custom mode: ${mode.name}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error), true);
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
    setStatus(`Deleted custom mode: ${id}`);
  });
  run.addEventListener("click", () => {
    try {
      if (activeModeId === "orchestrator") {
        orchestrationPlan = createOrchestrationPlan(task.value);
        orchestrationChildren.replaceChildren();
        for (const child of orchestrationPlan.children) {
          const row = document.createElement("div");
          row.className = "devmoter-orchestration-child";
          row.innerHTML = `<span>${child.state}</span><strong>${child.owner}</strong><p></p>`;
          row.querySelector("p")!.textContent = child.title;
          orchestrationChildren.appendChild(row);
        }
        orchestrationPreview.classList.remove("hidden");
        setStatus("Review the decomposition, then explicitly approve it.");
        return;
      }
      const prompt = compileModePrompt(activeModeId, task.value, {}, customModes);
      const backend = dispatchToActiveComposer(prompt);
      setStatus(`Sent to ${backend}. Approvals and diffs stay in the normal flow.`);
      panel.classList.add("hidden");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error), true);
    }
  });

  subagentRun.addEventListener("click", () => {
    void (async () => {
      try {
        const parent = parentSessionId();
        if (!parent) throw new Error("Open a parent chat/session before spawning a subagent");
        const mode = resolveMode(activeModeId, customModes);
        const run = await subagents.spawn({
          backend: "codex",
          parentSessionId: parent,
          role: activeModeId === "review" ? "reviewer" : activeModeId === "orchestrator" ? "planner" : "executor",
          model: mode.model || undefined,
          task: task.value,
          context: {
            mode: mode.name,
            modePolicy: renderModePolicy(mode)
          }
        });
        if (run) setStatus(`Spawned bounded subagent ${run.id}`);
      } catch (error) {
        setStatus(error instanceof Error ? error.message : String(error), true);
      }
    })();
  });

  orchestrationApprove.addEventListener("click", () => {
    try {
      if (!orchestrationPlan) throw new Error("Preview a decomposition first");
      approveOrchestrationPlan(orchestrationPlan);
      const backend = dispatchToActiveComposer(renderOrchestrationPrompt(orchestrationPlan));
      setStatus(`Approved plan sent to ${backend}. Extra delegation still requires approval.`);
      panel.classList.add("hidden");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error), true);
    }
  });

  rebuildModeSelect();
  renderMode();
  document.body.append(launcher, panel);
}
