import { renderChatMarkdown } from "./chat-markdown.mjs";

type Provider = { id: string; name: string; ready: boolean; models: string[]; projectId?: string; secretRef?: string };
type Project = { id: string; name: string; path: string };
type Data = Record<string, unknown>;
type Result = { type: string; source: string; builtAt: number | string | null; unavailable: boolean; data: Data; sharing: { excluded: boolean; truncated: boolean } };
type Step = { stepOperationId: string; operationId: string; status: string; validatedInput: Data; result: Result | null; failure: string | null };
type Run = { runId: string; rawGoal: string; status: string; updatedAt: number; context: { project: Project | null; hostId: string; backend: string }; planner: { providerId: string; providerName: string; model: string }; steps: Step[]; failure: string | null; cancellation: { requested: boolean; providerMayContinue: boolean }; explanation: { rawText: string } | null };
const RUN_KEY = "devmoter-tools-ai-run";
const terminal = (run: Run) => ["completed", "failed", "stopped", "unknown"].includes(run.status);
const statuses: Record<string, string> = { planning: "AIが操作を選択中", running: "読み取り・説明を処理中", completed: "完了", failed: "失敗", stop_requested: "停止要求済み・終了待ち", stopped: "作業の継続を停止", unknown: "結果不明・自動再開なし" };
const string = (value: unknown) => typeof value === "string" ? value : JSON.stringify(value) ?? "";
const objects = (value: unknown): Data[] => Array.isArray(value) ? value as Data[] : [];

export function mountToolsAi(root: HTMLElement, options: { openSettings: () => void; openManual: () => void }) {
  root.className = "tools-ai";
  root.innerHTML = `
    <div class="tools-ai-toolbar"><strong>Tools AI · 読み取り v1</strong><button type="button" data-ai-stop disabled>Stop</button></div>
    <h2 id="toolsAiTitle">何をしたいですか？</h2>
    <form data-ai-form>
      <label>対象Project（次の依頼）<select data-ai-project aria-label="対象Project"></select></label>
      <div class="tools-ai-models"><label>Planner provider<select data-ai-provider aria-label="Planner provider"></select></label><label>Planner model<select data-ai-model aria-label="Planner model"></select></label></div>
      <p class="tools-ai-sharing">実行先: このDevMoterサーバーの読み取り操作。入力した目的と、必要なProject内容の一部を選択したAIへ共有します。件数・byte制限と秘密情報の除外を適用します。</p>
      <label for="toolsAiGoal">依頼内容</label><textarea id="toolsAiGoal" data-ai-goal rows="3" maxlength="8000" placeholder="今の変更を調べて"></textarea>
      <button type="submit" data-ai-submit disabled>AIに依頼する</button>
    </form>
    <p data-ai-availability role="status"></p>
    <div class="tools-ai-links"><button type="button" data-ai-settings>Provider / modelを設定</button><button type="button" data-ai-manual>ツールを直接開く</button></div>
    <p data-ai-error role="alert" hidden></p>
    <div data-ai-progress role="status" aria-live="polite"></div>
    <div data-ai-results></div>`;
  const get = <T extends HTMLElement>(selector: string) => root.querySelector<T>(selector)!;
  const form = get<HTMLFormElement>("[data-ai-form]");
  const projectSelect = get<HTMLSelectElement>("[data-ai-project]");
  const providerSelect = get<HTMLSelectElement>("[data-ai-provider]");
  const modelSelect = get<HTMLSelectElement>("[data-ai-model]");
  const goal = get<HTMLTextAreaElement>("[data-ai-goal]");
  const submit = get<HTMLButtonElement>("[data-ai-submit]");
  const stop = get<HTMLButtonElement>("[data-ai-stop]");
  const availability = get("[data-ai-availability]");
  const progress = get("[data-ai-progress]");
  const results = get("[data-ai-results]");
  const error = get("[data-ai-error]");
  let providers: Provider[] = [];
  let run: Run | null = null;
  let pendingSubmit = false;
  let polling = false;
  let generation = 0;
  let signature = "";
  const request = async <T>(path: string, body?: unknown): Promise<T> => {
    const headers = new Headers();
    const device = localStorage.getItem("devmoter-device-token");
    if (device) headers.set("x-devmoter-device-token", device);
    if (body !== undefined) headers.set("content-type", "application/json");
    const response = await fetch(path, { method: body === undefined ? "GET" : "POST", headers, cache: "no-store", ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
    return data as T;
  };
  const showError = (message: string) => { error.textContent = message; error.hidden = !message; };
  const element = (tag: string, text = "", className = "") => { const node = root.ownerDocument.createElement(tag); node.textContent = text; if (className) node.className = className; return node; };
  const option = (label: string, value: string) => { const node = root.ownerDocument.createElement("option"); node.textContent = label; node.value = value; return node; };
  const paragraph = (parent: HTMLElement, text: string) => parent.append(element("p", text));
  const pre = (parent: HTMLElement, text: string) => parent.append(element("pre", text));
  const copy = (text: string) => { void navigator.clipboard?.writeText(text).catch(() => showError("コピーできませんでした。")); };

  function updateAvailability() {
    const provider = providers.find(p => p.id === providerSelect.value);
    const bindingOk = !provider?.projectId || provider.projectId === projectSelect.value;
    const ready = Boolean(provider?.ready && modelSelect.value && bindingOk);
    submit.disabled = !ready || pendingSubmit || Boolean(run && !terminal(run));
    availability.textContent = !provider ? "Planner provider / modelが未設定のためAI操作は使えません。下の設定または手動Toolsを開いてください。" : !provider.ready ? "このproviderのcredentialが未設定です。既存のAPI Chat設定を確認してください。" : !bindingOk ? "このVault providerに紐付いたProjectを選んでください。" : `Planner: ${provider.name} / ${modelSelect.value || "model未設定"}`;
  }
  function fillModels() {
    const provider = providers.find(p => p.id === providerSelect.value);
    modelSelect.replaceChildren();
    for (const model of provider?.models || []) modelSelect.append(option(model, model));
    const saved = localStorage.getItem(`devmoter-tools-ai-model:${provider?.id}`) || localStorage.getItem(`devmoter-api-model:${provider?.id}`);
    if (saved && provider?.models.includes(saved)) modelSelect.value = saved;
    updateAvailability();
  }
  function renderCard(result: Result) {
    const card = element("section", "", "tools-ai-card");
    const titles: Record<string, string> = { git: "Git状態・変更・差分", search: "検索結果", map: "Project構造", document: "Markdown文書", diagnostics: "Diagnostics · 固定host観測" };
    card.append(element("h3", result.unavailable ? "取得不可" : titles[result.type] || "結果"));
    paragraph(card, `Source: ${result.source}`);
    if (result.builtAt !== null) paragraph(card, `保存済みindex · builtAt: ${result.builtAt} (${new Date(result.builtAt).toLocaleString()})。現在のファイル状態は未確認です。`);
    if (result.sharing.excluded) paragraph(card, "安全上、一部内容をAIへの共有対象から除外した");
    if (result.sharing.truncated) paragraph(card, "件数・byte上限により内容の一部を省略しました。");
    const data = result.data;
    if (result.unavailable) paragraph(card, string(data.message));
    else if (result.type === "git") {
      const status = data.status as Data; const files = data.files as Data;
      paragraph(card, `Branch: ${string(status.branch)} · changed files: ${string(files.total)}`);
      pre(card, JSON.stringify(status, null, 2));
      const list = element("ul");
      for (const file of objects(files.files)) list.append(element("li", `${string(file.path)} · ${string(file.status)}`));
      card.append(list);
      for (const diff of objects(data.diffs)) {
        const details = element("details"); details.append(element("summary", string(diff.path))); pre(details, string(diff.diff));
        if (diff.truncated) paragraph(details, "元のGit helperで差分が切り詰められています。");
        card.append(details);
      }
    } else if (result.type === "search") {
      paragraph(card, `Query: ${string(data.query)}`);
      if (!objects(data.results).length) paragraph(card, "保存済みindexの返却結果は0件です。");
      for (const hit of objects(data.results)) { paragraph(card, `${string(hit.path)}:${string(hit.line)}`); pre(card, string(hit.snippet)); }
    } else if (result.type === "map") {
      paragraph(card, `Index内のファイル総数: ${string(data.totalFiles)}`);
      pre(card, JSON.stringify({ directories: data.directories, files: data.files, symbols: data.symbols }, null, 2));
    } else if (result.type === "document") {
      paragraph(card, `${string(data.path)} · 元のbyte数: ${string(data.size)}`);
      const document = element("div"); renderChatMarkdown(document, string(data.content), copy); card.append(document);
    } else if (result.type === "diagnostics") pre(card, JSON.stringify(data, null, 2));
    results.append(card);
  }
  function renderRun() {
    stop.disabled = !run || terminal(run) || run.status === "stop_requested";
    updateAvailability();
    if (!run) return;
    const nextSignature = `${run.runId}:${run.updatedAt}:${run.status}`;
    if (signature === nextSignature) return;
    signature = nextSignature;
    progress.replaceChildren(); results.replaceChildren();
    progress.append(element("h3", statuses[run.status] || run.status));
    paragraph(progress, `今回の対象: ${run.context.project?.name || "Projectなし"} / ${run.context.hostId} / ${run.context.backend}`);
    paragraph(progress, `今回のPlanner: ${run.planner.providerName} / ${run.planner.model}`);
    paragraph(progress, `依頼: ${run.rawGoal}`);
    if (run.cancellation.requested) paragraph(progress, "新しい操作は開始しません。開始済みの読み取りやprovider内部処理が即時停止したことは保証しません。");
    for (const step of run.steps) {
      paragraph(progress, `${step.operationId}: ${step.status}`);
      if (step.result) renderCard(step.result);
      if (step.failure) paragraph(results, step.failure);
    }
    if (run.failure) { const card = element("section", "", "tools-ai-card"); card.append(element("h3", "Error / unavailable")); paragraph(card, run.failure); results.append(card); }
    if (run.explanation) { const explanation = element("section", "", "tools-ai-card tools-ai-explanation"); explanation.append(element("h3", "実結果に基づくAI説明")); const body = element("div"); renderChatMarkdown(body, run.explanation.rawText, copy); explanation.append(body); results.append(explanation); }
  }
  async function refreshRun() {
    const id = run?.runId || localStorage.getItem(RUN_KEY);
    if (!id || polling) return;
    polling = true;
    try { run = await request<Run>(`/api/tools-ai/runs/${encodeURIComponent(id)}`); renderRun(); }
    catch (failure) { showError(`再接続できません: ${failure instanceof Error ? failure.message : failure}。手動Toolsは引き続き利用できます。`); }
    finally { polling = false; }
  }
  async function refresh() {
    const currentGeneration = ++generation;
    try {
      const context = await request<{ projects: Project[]; providers: Provider[] }>("/api/tools-ai/context");
      if (currentGeneration !== generation) return;
      const selectedProject = projectSelect.value || localStorage.getItem("devmoter-tools-ai-project") || localStorage.getItem("opencode-pocket-project") || "";
      projectSelect.replaceChildren(option("Projectなし（診断のみ）", ""));
      for (const project of context.projects) projectSelect.append(option(project.name, project.id));
      projectSelect.value = context.projects.some(p => p.id === selectedProject) ? selectedProject : context.projects[0]?.id || "";
      providers = context.providers;
      const selectedProvider = providerSelect.value || localStorage.getItem("devmoter-tools-ai-provider") || localStorage.getItem("devmoter-api-provider") || "";
      providerSelect.replaceChildren(option("Plannerを選択", ""));
      for (const provider of providers) providerSelect.append(option(provider.name + (provider.ready ? "" : "（未設定）"), provider.id));
      providerSelect.value = providers.some(p => p.id === selectedProvider) ? selectedProvider : providers.find(p => p.ready)?.id || "";
      fillModels(); showError(""); await refreshRun();
    } catch (failure) { showError(failure instanceof Error ? failure.message : String(failure)); updateAvailability(); }
  }
  projectSelect.addEventListener("change", () => { localStorage.setItem("devmoter-tools-ai-project", projectSelect.value); updateAvailability(); });
  providerSelect.addEventListener("change", () => { localStorage.setItem("devmoter-tools-ai-provider", providerSelect.value); fillModels(); });
  modelSelect.addEventListener("change", () => { localStorage.setItem(`devmoter-tools-ai-model:${providerSelect.value}`, modelSelect.value); updateAvailability(); });
  get("[data-ai-settings]").addEventListener("click", options.openSettings);
  get("[data-ai-manual]").addEventListener("click", options.openManual);
  stop.addEventListener("click", async () => {
    if (!run) return;
    stop.disabled = true;
    try { run = await request<Run>(`/api/tools-ai/runs/${run.runId}/stop`, {}); showError(""); renderRun(); }
    catch (failure) { showError(`停止要求を確認できません: ${failure instanceof Error ? failure.message : failure}`); stop.disabled = false; }
  });
  form.addEventListener("submit", async event => {
    event.preventDefault(); if (submit.disabled || !goal.value.trim()) return;
    pendingSubmit = true; updateAvailability(); showError("");
    // Capture the chosen target/model before any network await; later UI switches affect only the next goal.
    const payload = { goal: goal.value, projectId: projectSelect.value, providerId: providerSelect.value, model: modelSelect.value, requestId: crypto.randomUUID?.() || `request-${Date.now()}-${Math.random().toString(36).slice(2)}` };
    try {
      run = await request<Run>("/api/tools-ai/runs", payload); localStorage.setItem(RUN_KEY, run.runId); signature = ""; renderRun(); await refreshRun();
    } catch (failure) { showError(failure instanceof Error ? failure.message : String(failure)); }
    finally { pendingSubmit = false; updateAvailability(); }
  });
  window.setInterval(() => { if (run && !terminal(run)) void refreshRun(); }, 800);
  return { refresh, stopButton: stop };
}
