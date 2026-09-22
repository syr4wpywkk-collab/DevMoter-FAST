import "./agent-console.css";
import { compileModePrompt, getBuiltinMode, listBuiltinModes, renderModePolicy } from "./agent-mode-core.mjs";

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

export function mountAgentConsole() {
  if (document.querySelector("#devmoterAgentLauncher")) return;

  const modes = listBuiltinModes();
  let activeModeId = modes[0]?.id || "debug";

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
    <div class="devmoter-agent-field">
      <label for="devmoterAgentTask">Task</label>
      <textarea id="devmoterAgentTask" placeholder="Describe the failure or behavior to debug"></textarea>
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

  for (const mode of modes) {
    const option = document.createElement("option");
    option.value = mode.id;
    option.textContent = mode.name;
    select.appendChild(option);
  }

  function renderMode() {
    const mode = getBuiltinMode(activeModeId);
    policy.textContent = renderModePolicy(mode);
    task.placeholder = mode.id === "debug"
      ? "Describe the failure, regression, or test you want reproduced"
      : "Describe the task";
  }

  function setStatus(message: string, error = false) {
    status.textContent = message;
    status.classList.toggle("error", error);
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
  run.addEventListener("click", () => {
    try {
      const prompt = compileModePrompt(activeModeId, task.value);
      const backend = dispatchToActiveComposer(prompt);
      setStatus(`Sent to ${backend}. Approvals and diffs stay in the normal flow.`);
      panel.classList.add("hidden");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error), true);
    }
  });

  renderMode();
  document.body.append(launcher, panel);
}
