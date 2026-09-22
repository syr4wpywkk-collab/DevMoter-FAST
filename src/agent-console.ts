import "./agent-console.css";
import {
  compileModePrompt,
  listModes,
  renderModePolicy,
  resolveMode,
  validateCustomMode,
  type ModeConfig
} from "./agent-mode-core.mjs";

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
    <button id="devmoterAgentRun" class="devmoter-agent-run" type="button">Run in active chat</button>
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
        : "Describe the task";
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
      const prompt = compileModePrompt(activeModeId, task.value, {}, customModes);
      const backend = dispatchToActiveComposer(prompt);
      setStatus(`Sent to ${backend}. Approvals and diffs stay in the normal flow.`);
      panel.classList.add("hidden");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error), true);
    }
  });

  rebuildModeSelect();
  renderMode();
  document.body.append(launcher, panel);
}
