import { renderChatMarkdown } from "./chat-markdown.mjs";

type Provider = { id: string; name: string; ready: boolean; models: string[]; projectId?: string; secretRef?: string };
type Project = { id: string; name: string; path: string };
type Data = Record<string, unknown>;
type Result = { type: string; source: string; builtAt: number | string | null; unavailable: boolean; data: Data; sharing: { excluded: boolean; truncated: boolean } };
type Step = { stepOperationId: string; operationId: string; status: string; validatedInput: Data; result: Result | null; failure: string | null };
type Run = { runId: string; rawGoal: string; status: string; updatedAt: number; context: { project: Project | null; hostId: string; backend: string }; planner: { providerId: string; providerName: string; model: string }; steps: Step[]; failure: string | null; cancellation: { requested: boolean; providerMayContinue: boolean }; explanation: { rawText: string } | null };
const RUN_KEY = "devmoter-tools-ai-run";
const PENDING_KEY = "devmoter-tools-ai-pending-request";
const terminal = (run: Run) => ["completed", "failed", "stopped", "unknown"].includes(run.status);
const statuses: Record<string, string> = { planning: "AIが操作を選択中です…", running: "内容を確認して、結果をまとめています…", completed: "完了", failed: "失敗", stop_requested: "停止要求済み・終了待ち", stopped: "作業の継続を停止", unknown: "結果不明・自動再開なし" };
const string = (value: unknown) => typeof value === "string" ? value : JSON.stringify(value) ?? "";
const objects = (value: unknown): Data[] => Array.isArray(value) ? value as Data[] : [];

export function mountToolsAi(root: HTMLElement, options: { openSettings: () => void; openManual: () => void }) {
  root.className = "tools-ai";
  root.innerHTML = `
    <div class="tools-ai-toolbar"><button type="button" data-ai-stop disabled>Stop</button></div>
    <div class="tools-ai-welcome"><span class="tools-ai-spark" aria-hidden="true">✦</span><h2 id="toolsAiTitle">何をしたいですか？</h2><p>変更の確認、コード検索、README確認、診断などをAIに頼めます。</p></div>
    <form data-ai-form>
      <div class="tools-ai-composer"><label class="tools-ai-goal-label" for="toolsAiGoal">AIへの依頼</label><textarea id="toolsAiGoal" data-ai-goal rows="3" maxlength="8000" placeholder="今の変更を調べて"></textarea><div class="tools-ai-composer-actions"><span>読む・調べるお手伝い</span><button type="submit" data-ai-submit disabled>送信 <span aria-hidden="true">↑</span></button></div></div>
      <div data-ai-setup-notice role="status"><p data-ai-setup-message>AIの設定を読み込んでいます…</p><button type="button" data-ai-configure hidden>API ChatのAI設定を開く</button><button type="button" data-ai-retry hidden>設定を再読み込み</button></div>
      <div class="tools-ai-suggestions" aria-label="依頼の例">${["今の変更を調べて", "認証処理を探して", "プロジェクト構成を教えて", "READMEから起動方法を教えて", "接続できない理由を調べて"].map(text => `<button type="button" data-ai-suggestion>${text}</button>`).join("")}</div>
      <p class="tools-ai-sharing">依頼と必要なProject内容の一部を、選択したAIへ共有します。</p>
      <details class="tools-ai-settings"><summary>使用する対象とAIを変更</summary>
        <label>対象Project（次の依頼）<select data-ai-project aria-label="対象Project"></select></label>
        <div class="tools-ai-models"><label>Planner provider<select data-ai-provider aria-label="Planner provider"></select></label><label>Planner model<select data-ai-model aria-label="Planner model"></select></label></div>
        <p class="tools-ai-sharing">実行先はこのDevMoterサーバーです。読み取り操作のみを行い、共有内容には件数・byte制限と秘密情報の除外を適用します。</p>
        <p data-ai-availability role="status"></p><button type="button" data-ai-settings>Provider / modelを設定</button>
      </details>
    </form>
    <div class="tools-ai-links"><button type="button" data-ai-manual>ツールを直接開く</button></div>
    <p data-ai-error role="alert" hidden></p>
    <div data-ai-progress data-i18n-skip role="status" aria-live="polite"></div>
    <div data-ai-results data-i18n-skip></div>`;
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
  let contextState: "loading" | "ready" | "error" = "loading";
  const request = async <T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> => {
    const headers = new Headers();
    const device = localStorage.getItem("devmoter-device-token");
    if (device) headers.set("x-devmoter-device-token", device);
    if (body !== undefined) headers.set("content-type", "application/json");
    const response = await fetch(path, { method: body === undefined ? "GET" : "POST", headers, cache: "no-store", signal, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const data = await response.json();
    if (!response.ok) throw Object.assign(new Error(data.error || `HTTP ${response.status}`), { status: response.status, runId: data.runId });
    return data as T;
  };
  const showError = (message: string) => { error.textContent = message; error.hidden = !message; };
  const element = (tag: string, text = "", className = "") => { const node = root.ownerDocument.createElement(tag); node.textContent = text; if (className) node.className = className; return node; };
  const option = (label: string, value: string) => { const node = root.ownerDocument.createElement("option"); node.textContent = label; node.value = value; return node; };
  const paragraph = (parent: HTMLElement, text: string) => parent.append(element("p", text));
  const pre = (parent: HTMLElement, text: string) => parent.append(element("pre", text));
  const copy = (text: string) => { void navigator.clipboard?.writeText(text).catch(() => showError("コピーできませんでした。")); };

  function plannerProblem() {
    if (contextState === "loading") return "AIの設定を読み込んでいます…";
    if (contextState === "error") return "AIの設定を取得できません。設定を再読み込みしてください。";
    const provider = providers.find(p => p.id === providerSelect.value);
    if (!provider) return "Tools AIにはAPI Chatのproviderとmodelの設定が必要です。Codex / OpenCodeへのログインだけでは利用できません。";
    if (!provider.ready) return "選択したAIのcredentialが未設定です。API ChatのAI設定で確認してください。";
    if (provider.projectId && provider.projectId !== projectSelect.value) return "このVault providerに紐付いたProjectを選んでください。";
    if (!modelSelect.value || !provider.models.includes(modelSelect.value)) return "選択したAIのmodelが未設定です。API ChatのAI設定でmodelを登録してください。";
    return "";
  }
  function updateAvailability() {
    const problem = plannerProblem();
    const provider = providers.find(p => p.id === providerSelect.value);
    // Missing settings are actionable preflight feedback, not an inert Send control.
    submit.disabled = contextState === "loading" || pendingSubmit || Boolean(run && !terminal(run));
    get("[data-ai-setup-notice]").hidden = !problem;
    get("[data-ai-setup-message]").textContent = problem;
    get("[data-ai-configure]").hidden = contextState !== "ready" || !problem;
    get("[data-ai-retry]").hidden = contextState !== "error";
    availability.textContent = problem || `Planner: ${provider?.name} / ${modelSelect.value}`;
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
    const details = element("details", "", "tools-ai-result-details"); details.append(element("summary", "詳細を見る"));
    paragraph(details, `Source: ${result.source}`);
    if (result.builtAt !== null) { paragraph(card, "保存済みindexに基づく結果です。現在のファイル状態は未確認です。"); paragraph(details, `保存済みindex · builtAt: ${result.builtAt} (${new Date(result.builtAt).toLocaleString()})。現在のファイル状態は未確認です。`); }
    if (result.sharing.excluded) paragraph(card, "安全上、一部内容をAIへの共有対象から除外した");
    if (result.sharing.truncated) paragraph(card, "件数・byte上限により内容の一部を省略しました。");
    const data = result.data;
    if (result.unavailable) paragraph(card, string(data.message));
    else if (result.type === "git") {
      const status = data.status as Data; const files = data.files as Data;
      paragraph(card, `Branch: ${string(status.branch)} · changed files: ${string(files.total)}`);
      pre(details, JSON.stringify(status, null, 2));
      const list = element("ul");
      for (const file of objects(files.files)) list.append(element("li", `${string(file.path)} · ${string(file.status)}`));
      card.append(list);
      for (const diff of objects(data.diffs)) {
        const diffDetails = element("details"); diffDetails.append(element("summary", string(diff.path))); pre(diffDetails, string(diff.diff));
        if (diff.truncated) paragraph(diffDetails, "元のGit helperで差分が切り詰められています。");
        details.append(diffDetails);
      }
    } else if (result.type === "search") {
      paragraph(card, `Query: ${string(data.query)}`);
      if (!objects(data.results).length) paragraph(card, "保存済みindexの返却結果は0件です。");
      for (const hit of objects(data.results)) { paragraph(card, `${string(hit.path)}:${string(hit.line)}`); pre(card, string(hit.snippet)); }
    } else if (result.type === "map") {
      paragraph(card, `Index内のファイル総数: ${string(data.totalFiles)}`);
      pre(details, JSON.stringify({ directories: data.directories, files: data.files, symbols: data.symbols }, null, 2));
    } else if (result.type === "document") {
      paragraph(card, `${string(data.path)} · 元のbyte数: ${string(data.size)}`);
      const document = element("div"); renderChatMarkdown(document, string(data.content), copy); details.append(document);
    } else if (result.type === "diagnostics") { paragraph(card, "接続・実行環境の診断結果を取得しました。詳細から確認できます。"); pre(details, JSON.stringify(data, null, 2)); }
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
    progress.append(element("h3", statuses[run.status] || run.status));
    const runDetails = element("details", "", "tools-ai-run-details"); runDetails.append(element("summary", "実行の詳細"));
    paragraph(runDetails, `今回の対象: ${run.context.project?.name || "Projectなし"} / ${run.context.hostId} / ${run.context.backend}`);
    paragraph(runDetails, `今回のPlanner: ${run.planner.providerName} / ${run.planner.model}`);
    paragraph(progress, `依頼: ${run.rawGoal}`);
    if (run.cancellation.requested) paragraph(progress, "新しい操作は開始しません。開始済みの読み取りやprovider内部処理が即時停止したことは保証しません。");
    for (const step of run.steps) {
      paragraph(runDetails, `${step.operationId}: ${step.status}`);
      if (step.result) renderCard(step.result);
      if (step.failure) paragraph(results, step.failure);
    }
    progress.append(runDetails);
    if (run.failure) { const card = element("section", "", "tools-ai-card"); card.append(element("h3", "Error / unavailable")); paragraph(card, run.failure); results.append(card); }
    if (run.explanation) { const explanation = element("section", "", "tools-ai-card tools-ai-explanation"); explanation.append(element("h3", "わかったこと")); const body = element("div"); renderChatMarkdown(body, run.explanation.rawText, copy); explanation.append(body); results.prepend(explanation); }
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
    catch (failure) { showError(`再接続できません: ${failure instanceof Error ? failure.message : failure}。手動Toolsは引き続き利用できます。`); }
    finally { polling = false; }
  }
  async function refresh() {
    const currentGeneration = ++generation;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 10000);
    contextState = "loading"; updateAvailability();
    try {
      const context = await request<{ projects: Project[]; providers: Provider[] }>("/api/tools-ai/context", undefined, controller.signal);
      window.clearTimeout(timeout);
      if (currentGeneration !== generation) return;
      contextState = "ready";
      const selectedProject = projectSelect.value || localStorage.getItem("devmoter-tools-ai-project") || localStorage.getItem("opencode-pocket-project") || "";
      projectSelect.replaceChildren(option("Projectなし（診断のみ）", ""));
      for (const project of context.projects) projectSelect.append(option(project.name, project.id));
      projectSelect.value = context.projects.some(p => p.id === selectedProject) ? selectedProject : context.projects[0]?.id || "";
      providers = context.providers;
      const selectedProvider = providerSelect.value || localStorage.getItem("devmoter-tools-ai-provider") || localStorage.getItem("devmoter-api-provider") || "";
      providerSelect.replaceChildren(option("Plannerを選択", ""));
      for (const provider of providers) providerSelect.append(option(provider.name + (provider.ready ? "" : "（未設定）"), provider.id));
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
        } catch { showError("前回の送信結果を照合できません。同じ依頼の再送信には元のrequest IDを使います。成功とは扱いません。"); }
      }
      await refreshRun();
    } catch (failure) {
      if (currentGeneration !== generation) return;
      contextState = "error";
      showError(controller.signal.aborted ? "AIの設定の読み込みがタイムアウトしました。再読み込みしてください。" : failure instanceof Error ? failure.message : String(failure));
      updateAvailability();
    } finally { window.clearTimeout(timeout); }
  }
  projectSelect.addEventListener("change", () => { localStorage.setItem("devmoter-tools-ai-project", projectSelect.value); updateAvailability(); });
  providerSelect.addEventListener("change", () => { localStorage.setItem("devmoter-tools-ai-provider", providerSelect.value); fillModels(); });
  modelSelect.addEventListener("change", () => { localStorage.setItem(`devmoter-tools-ai-model:${providerSelect.value}`, modelSelect.value); updateAvailability(); });
  root.querySelectorAll<HTMLButtonElement>("[data-ai-suggestion]").forEach(chip => chip.addEventListener("click", () => { goal.value = chip.textContent || ""; goal.focus(); }));
  get("[data-ai-settings]").addEventListener("click", options.openSettings);
  get("[data-ai-configure]").addEventListener("click", options.openSettings);
  get("[data-ai-retry]").addEventListener("click", () => { void refresh(); });
  get("[data-ai-manual]").addEventListener("click", options.openManual);
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
    catch (failure) { showError(`停止要求を確認できません: ${failure instanceof Error ? failure.message : failure}`); stop.disabled = false; }
  });
  form.addEventListener("submit", async event => {
    event.preventDefault(); if (submit.disabled) return;
    const problem = plannerProblem();
    if (problem) {
      showError(problem);
      const settings = get<HTMLDetailsElement>(".tools-ai-settings"); settings.open = true;
      settings.scrollIntoView?.({ block: "nearest" });
      (contextState === "error" ? get("[data-ai-retry]") : !providerSelect.value ? providerSelect : !modelSelect.value ? modelSelect : get("[data-ai-settings]")).focus();
      return;
    }
    if (!goal.value.trim()) { showError("何をしたいか入力してください。"); goal.focus(); return; }
    pendingSubmit = true; updateAvailability(); showError("");
    // Capture the chosen target/model before any network await; later UI switches affect only the next goal.
    const selection = { goal: goal.value, projectId: projectSelect.value, providerId: providerSelect.value, model: modelSelect.value };
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
        try { run = await request<Run>(`/api/tools-ai/runs/${encodeURIComponent(duplicate.runId)}`); localStorage.setItem(RUN_KEY, run.runId); localStorage.removeItem(PENDING_KEY); renderRun(); showError("重複送信を検出し、元のrunの実状態を再取得しました。"); }
        catch { showError("元のrunを照合できません。結果不明です。"); }
      } else {
        if (duplicate.status && duplicate.status < 500) localStorage.removeItem(PENDING_KEY);
        showError(failure instanceof Error ? failure.message : String(failure));
      }
    }
    finally { pendingSubmit = false; updateAvailability(); }
  });
  window.setInterval(() => { if (run && !terminal(run)) void refreshRun(); }, 800);
  return { refresh, stopButton: stop };
}
