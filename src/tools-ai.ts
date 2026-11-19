import { apiModelLabel } from "./api-model-label.mjs";
import { renderChatMarkdown } from "./chat-markdown.mjs";
import { formatDateTime, t, translateServerMessage } from "./i18n";

type Provider = { id: string; name: string; ready: boolean; models: string[]; projectId?: string; secretRef?: string };
type Project = { id: string; name: string; path: string };
type Data = Record<string, unknown>;
type Result = { type: string; source: string; builtAt: number | string | null; unavailable: boolean; data: Data; sharing: { excluded: boolean; truncated: boolean } };
type Step = { stepOperationId: string; operationId: string; status: string; validatedInput: Data; result: Result | null; failure: string | null };
type Run = { runId: string; rawGoal: string; status: string; updatedAt: number; context: { project: Project | null; hostId: string; backend: string }; planner: { providerId: string; providerName: string; model: string }; steps: Step[]; failure: string | null; cancellation: { requested: boolean; providerMayContinue: boolean }; explanation: { rawText: string } | null };
const RUN_KEY = "devmoter-tools-ai-run";
const PENDING_KEY = "devmoter-tools-ai-pending-request";
const terminal = (run: Run) => ["completed", "failed", "stopped", "unknown"].includes(run.status);
const STATUS_KEYS = new Set(["planning", "running", "completed", "failed", "stop_requested", "stopped", "unknown"]);
const statusLabel = (status: string) => (STATUS_KEYS.has(status) ? t(`toolsAi.status.${status}`) : status);
const esc = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const string = (value: unknown) => typeof value === "string" ? value : JSON.stringify(value) ?? "";
const objects = (value: unknown): Data[] => Array.isArray(value) ? value as Data[] : [];

export function mountToolsAi(root: HTMLElement, options: { openSettings: () => void }) {
  root.className = "tools-ai";
  root.innerHTML = `
    <div class="tools-ai-toolbar"><button type="button" data-ai-stop disabled>${esc(t("common.stop"))}</button></div>
    <form data-ai-form aria-label="${esc(t("toolsAi.formAria"))}">
      <div class="tools-ai-composer"><textarea id="toolsAiGoal" data-ai-goal rows="1" maxlength="8000" placeholder="${esc(t("toolsAi.goalPlaceholder"))}" aria-label="${esc(t("toolsAi.goalAria"))}"></textarea><button type="submit" data-ai-submit disabled>${esc(t("toolsAi.submit"))}</button></div>
      <div class="tools-ai-models"><select data-ai-provider aria-label="${esc(t("toolsAi.providerAria"))}"></select><select data-ai-model aria-label="${esc(t("toolsAi.modelAria"))}"></select></div>
      <div data-ai-setup-notice role="status"><p data-ai-setup-message>${esc(t("toolsAi.problemLoading"))}</p><button type="button" data-ai-configure hidden>${esc(t("toolsAi.configureButton"))}</button><button type="button" data-ai-retry hidden>${esc(t("toolsAi.retryButton"))}</button></div>
    </form>
    <p data-ai-error role="alert" hidden></p>
    <div data-ai-progress data-i18n-skip role="status" aria-live="polite"></div>
    <div data-ai-results data-i18n-skip></div>`;
  const get = <T extends HTMLElement>(selector: string) => root.querySelector<T>(selector)!;
  const form = get<HTMLFormElement>("[data-ai-form]");
  const providerSelect = get<HTMLSelectElement>("[data-ai-provider]");
  const modelSelect = get<HTMLSelectElement>("[data-ai-model]");
  const goal = get<HTMLTextAreaElement>("[data-ai-goal]");
  const submit = get<HTMLButtonElement>("[data-ai-submit]");
  const stop = get<HTMLButtonElement>("[data-ai-stop]");
  const progress = get("[data-ai-progress]");
  const results = get("[data-ai-results]");
  const error = get("[data-ai-error]");
  let providers: Provider[] = [];
  // No target picker on this screen: the next run uses the saved/first Project,
  // or the Project a Vault-bound provider belongs to.
  let projects: Project[] = [];
  let preferredProjectId = "";
  const projectId = () => {
    const bound = providers.find(p => p.id === providerSelect.value)?.projectId;
    if (bound && projects.some(p => p.id === bound)) return bound;
    return preferredProjectId;
  };
  let run: Run | null = null;
  let pendingSubmit = false;
  let polling = false;
  let generation = 0;
  let signature = "";
  let contextState: "loading" | "ready" | "error" = "loading";
  let contextController: AbortController | null = null;
  const request = async <T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> => {
    const headers = new Headers();
    const device = localStorage.getItem("devmoter-device-token");
    if (device) headers.set("x-devmoter-device-token", device);
    if (body !== undefined) headers.set("content-type", "application/json");
    const response = await fetch(path, { method: body === undefined ? "GET" : "POST", headers, cache: "no-store", signal, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const data = await response.json();
    if (!response.ok) throw Object.assign(new Error(translateServerMessage(data.error) || t("common.httpError", { status: response.status })), { status: response.status, runId: data.runId });
    return data as T;
  };
  const showError = (message: string) => { error.textContent = message; error.hidden = !message; };
  const element = (tag: string, text = "", className = "") => { const node = root.ownerDocument.createElement(tag); node.textContent = text; if (className) node.className = className; return node; };
  const option = (label: string, value: string) => { const node = root.ownerDocument.createElement("option"); node.textContent = label; node.value = value; return node; };
  const paragraph = (parent: HTMLElement, text: string) => parent.append(element("p", text));
  const pre = (parent: HTMLElement, text: string) => parent.append(element("pre", text));
  const copy = (text: string) => { void navigator.clipboard?.writeText(text).catch(() => showError(t("toolsAi.copyFailed"))); };

  function plannerProblem() {
    if (contextState === "loading") return t("toolsAi.problemLoading");
    if (contextState === "error") return t("toolsAi.problemError");
    const provider = providers.find(p => p.id === providerSelect.value);
    if (!provider) return t("toolsAi.problemNoProvider");
    if (!provider.ready) return t("toolsAi.problemNotReady");
    if (provider.projectId && provider.projectId !== projectId()) return t("toolsAi.problemProjectMismatch");
    if (!modelSelect.value || !provider.models.includes(modelSelect.value)) return t("toolsAi.problemNoModel");
    return "";
  }
  function updateAvailability() {
    const problem = plannerProblem();
    const provider = providers.find(p => p.id === providerSelect.value);
    // Missing settings are actionable preflight feedback, not an inert Send control.
    submit.disabled = contextState === "loading" || pendingSubmit || Boolean(run && !terminal(run));
    get("[data-ai-setup-notice]").hidden = !problem;
    get("[data-ai-setup-message]").textContent = problem;
    const needsProviderConfiguration = contextState === "ready" && Boolean(problem) && (
      !provider ||
      !provider.ready ||
      !modelSelect.value ||
      !provider.models.includes(modelSelect.value)
    );
    get("[data-ai-configure]").hidden = !needsProviderConfiguration;
    get("[data-ai-retry]").hidden = contextState !== "error";
  }
  function fillModels() {
    const provider = providers.find(p => p.id === providerSelect.value);
    modelSelect.replaceChildren();
    for (const model of provider?.models || []) modelSelect.append(option(apiModelLabel(model), model));
    const saved = localStorage.getItem(`devmoter-tools-ai-model:${provider?.id}`) || localStorage.getItem(`devmoter-api-model:${provider?.id}`);
    if (saved && provider?.models.includes(saved)) modelSelect.value = saved;
    updateAvailability();
  }
  function renderCard(result: Result) {
    const card = element("section", "", "tools-ai-card");
    const cardTypes = new Set(["git", "search", "map", "document", "diagnostics"]);
    const heading = result.unavailable
      ? t("toolsAi.card.unavailable")
      : (cardTypes.has(result.type) ? t(`toolsAi.card.${result.type}`) : t("toolsAi.card.result"));
    card.append(element("h3", heading));
    const details = element("details", "", "tools-ai-result-details"); details.append(element("summary", t("toolsAi.card.viewDetails")));
    paragraph(details, t("toolsAi.card.source", { source: result.source }));
    if (result.builtAt !== null) {
      paragraph(card, t("toolsAi.card.indexNotice"));
      paragraph(details, t("toolsAi.card.indexDetails", { builtAt: String(result.builtAt), formatted: formatDateTime(result.builtAt) }));
    }
    if (result.sharing.excluded) paragraph(card, t("toolsAi.card.excluded"));
    if (result.sharing.truncated) paragraph(card, t("toolsAi.card.truncated"));
    const data = result.data;
    if (result.unavailable) paragraph(card, translateServerMessage(string(data.message)));
    else if (result.type === "git") {
      const status = data.status as Data; const files = data.files as Data;
      paragraph(card, t("toolsAi.card.gitSummary", { branch: string(status.branch), total: string(files.total) }));
      pre(details, JSON.stringify(status, null, 2));
      const list = element("ul");
      for (const file of objects(files.files)) list.append(element("li", `${string(file.path)} · ${string(file.status)}`));
      card.append(list);
      for (const diff of objects(data.diffs)) {
        const diffDetails = element("details"); diffDetails.append(element("summary", string(diff.path))); pre(diffDetails, string(diff.diff));
        if (diff.truncated) paragraph(diffDetails, t("toolsAi.card.diffTruncated"));
        details.append(diffDetails);
      }
    } else if (result.type === "search") {
      paragraph(card, t("toolsAi.card.query", { query: string(data.query) }));
      if (!objects(data.results).length) paragraph(card, t("toolsAi.card.searchEmpty"));
      for (const hit of objects(data.results)) { paragraph(card, `${string(hit.path)}:${string(hit.line)}`); pre(card, string(hit.snippet)); }
    } else if (result.type === "map") {
      paragraph(card, t("toolsAi.card.totalFiles", { count: string(data.totalFiles) }));
      pre(details, JSON.stringify({ directories: data.directories, files: data.files, symbols: data.symbols }, null, 2));
    } else if (result.type === "document") {
      paragraph(card, t("toolsAi.card.docMeta", { path: string(data.path), size: string(data.size) }));
      const document = element("div"); renderChatMarkdown(document, string(data.content), copy); details.append(document);
    } else if (result.type === "diagnostics") { paragraph(card, t("toolsAi.card.diagnosticsDone")); pre(details, JSON.stringify(data, null, 2)); }
    card.append(details); results.append(card);
  }
  function renderRun() {
    stop.disabled = !run || terminal(run) || run.status === "stop_requested";
    updateAvailability();
    if (!run) return;
    const nextSignature = `${run.runId}:${run.updatedAt}:${run.status}`;
    if (signature === nextSignature) return;
    signature = nextSignature;
    progress.replaceChildren(); results.replaceChildren();
    progress.append(element("h3", statusLabel(run.status)));
    const runDetails = element("details", "", "tools-ai-run-details"); runDetails.append(element("summary", t("toolsAi.run.details")));
    paragraph(runDetails, t("toolsAi.run.target", { project: run.context.project?.name || t("toolsAi.run.noProject"), hostId: run.context.hostId, backend: run.context.backend }));
    paragraph(runDetails, t("toolsAi.run.planner", { provider: run.planner.providerName, model: run.planner.model }));
    paragraph(progress, t("toolsAi.run.goal", { goal: run.rawGoal }));
    if (run.cancellation.requested) paragraph(progress, t("toolsAi.run.cancelNotice"));
    for (const step of run.steps) {
      paragraph(runDetails, `${step.operationId}: ${step.status}`);
      if (step.result) renderCard(step.result);
      if (step.failure) paragraph(results, translateServerMessage(step.failure));
    }
    progress.append(runDetails);
    if (run.failure) { const card = element("section", "", "tools-ai-card"); card.append(element("h3", t("toolsAi.run.errorHeading"))); paragraph(card, translateServerMessage(run.failure)); results.append(card); }
    if (run.explanation) { const explanation = element("section", "", "tools-ai-card tools-ai-explanation"); explanation.append(element("h3", t("toolsAi.run.explanationHeading"))); const body = element("div"); renderChatMarkdown(body, run.explanation.rawText, copy); explanation.append(body); results.prepend(explanation); }
  }
  async function refreshRun() {
    const id = run?.runId || localStorage.getItem(RUN_KEY);
    if (!id || polling) return;
    polling = true;
    try {
      const observed = await request<Run>(`/api/tools-ai/runs/${encodeURIComponent(id)}`);
      if (run && run.runId !== id) return;
      if (!run || observed.updatedAt >= run.updatedAt) { run = observed; renderRun(); }
    }
    catch (failure) { showError(t("toolsAi.reconnectError", { message: translateServerMessage(failure instanceof Error ? failure.message : String(failure)) })); }
    finally { polling = false; }
  }
  async function refresh() {
    const currentGeneration = ++generation;
    contextController?.abort();
    const controller = new AbortController();
    contextController = controller;
    const timeout = window.setTimeout(() => controller.abort(), 10000);
    contextState = "loading"; updateAvailability();
    try {
      const context = await request<{ projects: Project[]; providers: Provider[] }>("/api/tools-ai/context", undefined, controller.signal);
      window.clearTimeout(timeout);
      if (currentGeneration !== generation) return;
      contextState = "ready";
      const selectedProject = preferredProjectId || localStorage.getItem("devmoter-tools-ai-project") || localStorage.getItem("opencode-pocket-project") || "";
      projects = context.projects;
      preferredProjectId = projects.some(p => p.id === selectedProject) ? selectedProject : projects[0]?.id || "";
      providers = context.providers;
      const selectedProvider = providerSelect.value || localStorage.getItem("devmoter-tools-ai-provider") || localStorage.getItem("devmoter-api-provider") || "";
      providerSelect.replaceChildren(option(t("toolsAi.selectPlanner"), ""));
      for (const provider of providers) providerSelect.append(option(provider.name + (provider.ready ? "" : t("toolsAi.notConfiguredSuffix")), provider.id));
      providerSelect.value = providers.some(p => p.id === selectedProvider) ? selectedProvider : providers.find(p => p.ready && p.models.length)?.id || providers.find(p => p.ready)?.id || providers[0]?.id || "";
      fillModels(); showError("");
      const pending = localStorage.getItem(PENDING_KEY);
      if (pending) {
        try {
          const original = JSON.parse(pending) as { requestId: string; goal: string };
          if (!goal.value) goal.value = original.goal;
          const observed = await request<Run>(`/api/tools-ai/requests/${encodeURIComponent(original.requestId)}`);
          if (currentGeneration !== generation) return;
          run = observed; localStorage.setItem(RUN_KEY, observed.runId); localStorage.removeItem(PENDING_KEY); renderRun();
        } catch { showError(t("toolsAi.pendingUnverified")); }
      }
      await refreshRun();
    } catch (failure) {
      if (currentGeneration !== generation) return;
      contextState = "error";
      showError(controller.signal.aborted ? t("toolsAi.loadTimeout") : translateServerMessage(failure instanceof Error ? failure.message : String(failure)));
      updateAvailability();
    } finally {
      window.clearTimeout(timeout);
      if (contextController === controller) contextController = null;
    }
  }
  providerSelect.addEventListener("change", () => { localStorage.setItem("devmoter-tools-ai-provider", providerSelect.value); fillModels(); });
  modelSelect.addEventListener("change", () => { localStorage.setItem(`devmoter-tools-ai-model:${providerSelect.value}`, modelSelect.value); updateAvailability(); });
  get("[data-ai-configure]").addEventListener("click", options.openSettings);
  get("[data-ai-retry]").addEventListener("click", () => { void refresh(); });
  // One line by default; grow with content up to the CSS max-height, then scroll.
  const resizeGoal = () => { goal.style.height = "auto"; goal.style.height = `${goal.scrollHeight}px`; };
  goal.addEventListener("input", resizeGoal);
  stop.addEventListener("click", async () => {
    if (!run) return;
    stop.disabled = true;
    const stoppedId = run.runId;
    try {
      const observed = await request<Run>(`/api/tools-ai/runs/${stoppedId}/stop`, {});
      if (run?.runId !== stoppedId) return;
      if (observed.updatedAt >= run.updatedAt) run = observed;
      showError(""); renderRun();
    }
    catch (failure) { showError(t("toolsAi.stopError", { message: translateServerMessage(failure instanceof Error ? failure.message : String(failure)) })); stop.disabled = false; }
  });
  form.addEventListener("submit", async event => {
    event.preventDefault(); if (submit.disabled) return;
    const problem = plannerProblem();
    if (problem) {
      showError(problem);
      const provider = providers.find(p => p.id === providerSelect.value);
      const recoveryTarget =
        contextState === "error" ? get("[data-ai-retry]") :
        !provider ? providerSelect :
        !provider.ready ? get("[data-ai-configure]") :
        provider.projectId && provider.projectId !== projectId() ? providerSelect :
        !modelSelect.value || !provider.models.includes(modelSelect.value) ? modelSelect :
        get("[data-ai-configure]");
      recoveryTarget.focus();
      return;
    }
    if (!goal.value.trim()) { showError(t("toolsAi.emptyGoal")); goal.focus(); return; }
    pendingSubmit = true; updateAvailability(); showError("");
    // Capture the chosen target/model before any network await; later UI switches affect only the next goal.
    const selection = { goal: goal.value, projectId: projectId(), providerId: providerSelect.value, model: modelSelect.value };
    let requestId = crypto.randomUUID?.() || `request-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    try {
      const prior = JSON.parse(localStorage.getItem(PENDING_KEY) || "null");
      if (prior && Object.entries(selection).every(([key, value]) => prior[key] === value)) requestId = prior.requestId;
    } catch { /* A malformed local draft is never operation authority. */ }
    const payload = { ...selection, requestId };
    localStorage.setItem(PENDING_KEY, JSON.stringify(payload));
    try {
      run = await request<Run>("/api/tools-ai/runs", payload); localStorage.setItem(RUN_KEY, run.runId); localStorage.removeItem(PENDING_KEY); signature = ""; renderRun(); await refreshRun();
    } catch (failure) {
      const duplicate = failure as { status?: number; runId?: string };
      if (duplicate.status === 409 && duplicate.runId) {
        try { run = await request<Run>(`/api/tools-ai/runs/${encodeURIComponent(duplicate.runId)}`); localStorage.setItem(RUN_KEY, run.runId); localStorage.removeItem(PENDING_KEY); renderRun(); showError(t("toolsAi.duplicateRecovered")); }
        catch { showError(t("toolsAi.duplicateUnknown")); }
      } else {
        if (duplicate.status && duplicate.status < 500) localStorage.removeItem(PENDING_KEY);
        showError(translateServerMessage(failure instanceof Error ? failure.message : String(failure)));
      }
    }
    finally { pendingSubmit = false; updateAvailability(); }
  });
  window.setInterval(() => { if (run && !terminal(run)) void refreshRun(); }, 800);
  return { refresh, stopButton: stop };
}
