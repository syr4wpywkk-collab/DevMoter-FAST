import type { MainSurface } from "./surface-navigation.mjs";
import "./unified-workspace-nav.css";

type ChatBackend = "codex" | "opencode" | "api";

type WorkspaceActions = {
  initialSurface: MainSurface;
  switchBackend: (backend: ChatBackend) => void;
  openHome: () => void;
  openTasks: () => void;
  openReview: () => void;
  openTools: () => void;
};

/**
 * Opt-in presentation-only workspace navigator.
 * Sessions, messages, tools and approvals remain owned by their existing providers.
 * This view never invents task records, connectivity, models or permissions.
 */
export function mountTaskFirstWorkspace(actions: WorkspaceActions) {
  if (document.getElementById("dmTaskFirstWorkspace")) return;

  const root = document.createElement("div");
  root.id = "dmTaskFirstWorkspace";
  root.className = "dm-task-first-nav";
  root.innerHTML = `
    <header class="dm-task-first-header">
      <button type="button" data-workspace-home class="dm-task-first-brand" aria-label="DevMoter FAST Home">
        <span class="dm-task-first-mark" aria-hidden="true">▦</span>
        <span><strong>DevMoter <em>FAST</em></strong><small>UNIFIED WORKSPACE</small></span>
      </button>
      <p class="dm-task-first-project" data-workspace-project aria-label="Current project"></p>
      <label class="dm-task-first-backend">
        <span>AI backend</span>
        <select data-workspace-backend aria-label="AIバックエンド切り替え">
          <option value="" disabled>AIを選択</option>
          <option value="codex">Codex</option>
          <option value="opencode">OpenCode</option>
          <option value="api">API Chat</option>
        </select>
      </label>
    </header>
    <nav class="dm-task-first-tabs" aria-label="DevMoter workspace">
      <button type="button" data-workspace-action="tasks" aria-label="Tasks and sessions"><span aria-hidden="true">▤</span><strong>Tasks</strong></button>
      <button type="button" data-workspace-action="chat" aria-label="Current chat and conversation history"><span aria-hidden="true">◇</span><strong>Chat</strong></button>
      <button type="button" data-workspace-action="review" aria-label="Review changes"><span aria-hidden="true">⑂</span><strong>Review</strong></button>
      <button type="button" data-workspace-action="tools" aria-label="Open tools"><span aria-hidden="true">⌘</span><strong>Tools</strong></button>
    </nav>
    <p class="dm-task-first-caption">タスク・会話・レビューを一か所から</p>
    <p class="dm-task-first-feedback" role="status" aria-live="polite" data-workspace-feedback></p>
  `;
  document.body.append(root);
  document.body.classList.add("dm-task-first-enabled");

  const backendSelect = root.querySelector<HTMLSelectElement>("[data-workspace-backend]")!;
  const projectLabel = root.querySelector<HTMLElement>("[data-workspace-project]")!;
  const feedback = root.querySelector<HTMLElement>("[data-workspace-feedback]")!;

  let surface: MainSurface = actions.initialSurface;
  let currentBackend: ChatBackend = surface === "codex" || surface === "api" || surface === "opencode"
    ? surface
    : "opencode";

  const updateProject = () => {
    // Project selection is owned by the existing backend; this is a label only.
    const value = localStorage.getItem("opencode-pocket-project") || "";
    const normalized = value.replace(/\\/g, "/").replace(/\/+$/, "");
    projectLabel.textContent = normalized.split("/").filter(Boolean).pop()?.slice(0, 80) || "Workspace";
  };

  const updateSurface = (next: MainSurface) => {
    surface = next;
    if (next === "codex" || next === "opencode" || next === "api") currentBackend = next;
    backendSelect.value = next === "codex" || next === "opencode" || next === "api" ? next : "";
    for (const button of root.querySelectorAll<HTMLButtonElement>("[data-workspace-action]")) {
      const isCurrent = button.dataset.workspaceAction === "chat" &&
        (next === "codex" || next === "opencode" || next === "api");
      if (isCurrent) button.setAttribute("aria-current", "page");
      else button.removeAttribute("aria-current");
    }
    updateProject();
  };

  const onSurfaceChanged = (event: Event) => {
    const next = (event as CustomEvent<{ surface?: MainSurface }>).detail?.surface;
    if (next) updateSurface(next);
  };
  window.addEventListener("devmoter:surface-changed", onSurfaceChanged);

  const onBackendChanged = (event: Event) => {
    const next = (event as CustomEvent<{ backend?: ChatBackend }>).detail?.backend;
    if (next === "codex" || next === "opencode" || next === "api") currentBackend = next;
  };
  window.addEventListener("devmoter:backend-changed", onBackendChanged);

  backendSelect.addEventListener("change", () => {
    const next = backendSelect.value;
    if (next !== "codex" && next !== "opencode" && next !== "api") return;
    feedback.textContent = "";
    actions.switchBackend(next);
  });

  function openNativeHistory() {
    // The provider's own history control is authoritative and knows its session IDs.
    const trigger = document.querySelector<HTMLButtonElement>(
      currentBackend === "codex" ? "#cxMenu" : currentBackend === "opencode" ? "#ocxMenu" : "#apiMenu"
    );
    if (!trigger) {
      feedback.textContent = "この画面では会話履歴を開けません。";
      return;
    }
    trigger.click();
  }

  for (const button of root.querySelectorAll<HTMLButtonElement>("[data-workspace-action]")) {
    button.addEventListener("click", () => {
      feedback.textContent = "";
      switch (button.dataset.workspaceAction) {
        case "tasks":
          actions.openTasks();
          break;
        case "chat":
          if (surface === "home" || surface === "integrations") actions.switchBackend(currentBackend);
          else openNativeHistory();
          break;
        case "review":
          actions.openReview();
          break;
        case "tools":
          actions.openTools();
          break;
      }
    });
  }

  root.querySelector<HTMLButtonElement>("[data-workspace-home]")!.addEventListener("click", actions.openHome);
  updateSurface(surface);
  return { destroy() {
    window.removeEventListener("devmoter:surface-changed", onSurfaceChanged);
    window.removeEventListener("devmoter:backend-changed", onBackendChanged);
    root.remove();
    document.body.classList.remove("dm-task-first-enabled");
  } };
}
