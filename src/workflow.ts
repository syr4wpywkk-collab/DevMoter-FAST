import { projectOptionLabels } from "./project-labels.mjs";
import { createSheetHeader } from "./sheet-header.mjs";
import { formatNumber, t, translateServerMessage } from "./i18n";
import { apiErrorMessage } from "./api-error.mjs";

function wfError(error: unknown) {
  return translateServerMessage(error instanceof Error ? error.message : String(error));
}

const WF_DECISION_KEYS: Record<string, string> = {
  pending: "workflow.decision.pending",
  accept: "workflow.decision.accept",
  reject: "workflow.decision.reject",
  partial: "workflow.decision.partial",
  applied: "workflow.decision.applied",
  committed: "workflow.decision.committed"
};

function wfDecisionLabel(value: string) {
  return WF_DECISION_KEYS[value] ? t(WF_DECISION_KEYS[value]) : translateServerMessage(value);
}

const WF_FILTERS = ["all", "pending", "accept", "reject", "partial"] as const;
type WfFilter = typeof WF_FILTERS[number];
const WF_FILTER_KEYS: Record<WfFilter, string> = {
  all: "workflow.filterAll",
  pending: "workflow.filterPending",
  accept: "workflow.filterAccept",
  reject: "workflow.filterReject",
  partial: "workflow.filterPartial"
};

const REFRESH_ICON = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/></svg>';

type Json = Record<string, any>;

type Project = {
  id: string;
  name: string;
  path: string;
  available?: boolean;
  github?: string;
};

type Hunk = {
  id: string;
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  oldText: string;
  newText: string;
  decision: "pending" | "accept" | "reject";
};

type ChangeFile = {
  path: string;
  decision: "pending" | "accept" | "reject" | "partial";
  hunks: Hunk[];
  preview: {
    content: string;
    truncated: boolean;
    lines: number;
    totalLines: number;
    bytes: number;
    totalBytes: number;
  };
  acceptedPreview: {
    content: string;
    truncated: boolean;
    lines: number;
    totalLines: number;
    bytes: number;
    totalBytes: number;
  };
};

type ChangeSet = {
  id: string;
  status: "pending" | "applied" | "committed";
  source: string;
  autoCommit: boolean;
  appliedFiles: string[];
  commit?: { sha: string; message: string } | null;
  files: ChangeFile[];
};

type Worktree = {
  id: string;
  path: string;
  branch: string;
  baseBranch: string;
  sessionId?: string | null;
  agent?: string | null;
  dirty?: boolean | null;
};

type Task = {
  id: string;
  repo: string;
  branch: string;
  agent: string;
  sessionId?: string | null;
  status: string;
  issue: { number: number; title: string; url?: string };
};

function escapeHtml(value: unknown) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[char] || char));
}

async function api<T>(url: string, init: RequestInit = {}): Promise<T> {
  const method = String(init.method || "GET").toUpperCase();
  const mutation = method !== "GET" && method !== "HEAD";
  const headers = new Headers(init.headers || {});
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  if (mutation && !headers.has("x-pocket-operation-id")) headers.set("x-pocket-operation-id", crypto.randomUUID());
  const response = await fetch(url, {
    cache: "no-store",
    ...init,
    headers
  });
  const payload = await response.json().catch(() => ({})) as Json;
  if (!response.ok) throw new Error(apiErrorMessage(payload, response.status));
  return payload as T;
}

function jsonBody(value: unknown): BodyInit {
  return JSON.stringify(value);
}

function inputValue(root: ParentNode, selector: string) {
  return root.querySelector<HTMLInputElement>(selector)?.value.trim() || "";
}

function textareaValue(root: ParentNode, selector: string) {
  return root.querySelector<HTMLTextAreaElement>(selector)?.value || "";
}

export function mountTaskWorkflow(root: HTMLElement) {
  root.innerHTML = `
    <button id="wfLaunch" class="wf-launch" type="button" aria-label="${escapeHtml(t("workflow.launchAria"))}">
      <span>⌁</span><b>${escapeHtml(t("workflow.launchLabel"))}</b>
    </button>
    <div id="wfModal" class="wf-modal hidden" aria-hidden="true" role="dialog" aria-modal="true" aria-labelledby="wfTitle" tabindex="-1">
      <div class="wf-sheet dm-sheet-frame">
        <div class="wf-toolbar">
          <label>
            <span>${escapeHtml(t("workflow.projectLabel"))}</span>
            <select id="wfProject"></select>
          </label>
        </div>
        <nav class="wf-tabs" role="tablist" aria-label="${escapeHtml(t("workflow.tabsAria"))}">
          <button type="button" class="active" role="tab" aria-selected="true" data-wf-tab="changes">${escapeHtml(t("workflow.tabChanges"))}</button>
          <button type="button" role="tab" aria-selected="false" data-wf-tab="worktrees">${escapeHtml(t("workflow.tabWorktrees"))}</button>
          <button type="button" role="tab" aria-selected="false" data-wf-tab="github">${escapeHtml(t("workflow.tabGithub"))}</button>
        </nav>
        <div id="wfStatus" class="wf-status" role="status" aria-live="polite"></div>
        <main class="wf-body">
          <div id="wfRepositoryNotice" class="wf-notice hidden" role="note">
            <strong>${escapeHtml(t("workspaceTools.notGitRepo"))}</strong>
            <div>${escapeHtml(t("workflow.gitRequiredHint"))}</div>
          </div>
          <section id="wfChangesPanel" data-wf-panel="changes">
            <div class="wf-section-head">
              <div><strong>${escapeHtml(t("workflow.reviewedChangesHeading"))}</strong><small>${escapeHtml(t("workflow.reviewedChangesSubheading"))}</small></div>
              <button id="wfLoadDiff" type="button">${escapeHtml(t("workflow.workingDiffBtn"))}</button>
            </div>
            <div id="wfDiffBox" class="wf-inspector hidden">
              <div class="wf-inspector-head">
                <strong>${escapeHtml(t("workflow.boundedDiffHeading"))}</strong>
                <button id="wfNextDiff" class="hidden" type="button">${escapeHtml(t("workflow.loadNextBtn"))}</button>
              </div>
              <div id="wfDiffNotice" class="wf-notice"></div>
              <pre id="wfDiff"></pre>
            </div>
            <div id="wfFileBox" class="wf-inspector hidden">
              <div class="wf-inspector-head">
                <strong id="wfFileTitle">${escapeHtml(t("workflow.fileWindowHeading"))}</strong>
                <button id="wfNextFile" class="hidden" type="button">${escapeHtml(t("workflow.loadNextBtn"))}</button>
              </div>
              <div id="wfFileNotice" class="wf-notice"></div>
              <pre id="wfFile"></pre>
            </div>
            <div id="wfReviewTools" class="wf-review-tools hidden">
              <div class="wf-filter" role="group" aria-label="${escapeHtml(t("workflow.filterAria"))}">
                ${WF_FILTERS.map(filter => `<button type="button" data-wf-filter="${filter}" aria-pressed="${filter === "all"}">${escapeHtml(t(WF_FILTER_KEYS[filter]))} <span data-wf-count="${filter}">0</span></button>`).join("")}
              </div>
              <div class="wf-review-search">
                <label><span>${escapeHtml(t("workflow.pathSearchLabel"))}</span><input id="wfPathSearch" type="search" autocomplete="off" spellcheck="false" placeholder="${escapeHtml(t("workflow.pathSearchPlaceholder"))}" /></label>
                <label><span>${escapeHtml(t("workflow.diffSearchLabel"))}</span><input id="wfDiffSearch" type="search" autocomplete="off" spellcheck="false" placeholder="${escapeHtml(t("workflow.diffSearchPlaceholder"))}" /></label>
              </div>
              <div class="wf-review-row">
                <span id="wfMatchInfo" class="wf-match-info" role="status" aria-live="polite"></span>
                <div class="wf-review-toggle">
                  <button id="wfExpandAll" type="button">${escapeHtml(t("workflow.expandAllBtn"))}</button>
                  <button id="wfCollapseAll" type="button">${escapeHtml(t("workflow.collapseAllBtn"))}</button>
                </div>
              </div>
            </div>
            <div id="wfNoMatch" class="wf-no-match hidden">${escapeHtml(t("workflow.noMatchingFiles"))}</div>
            <div id="wfChanges" class="wf-stack"></div>
          </section>

          <section id="wfWorktreesPanel" class="hidden" data-wf-panel="worktrees">
            <div class="wf-section-head">
              <div><strong>${escapeHtml(t("workflow.worktreesHeading"))}</strong><small>${escapeHtml(t("workflow.worktreesSubheading"))}</small></div>
            </div>
            <form id="wfWorktreeForm" class="wf-form">
              <label><span>${escapeHtml(t("workflow.baseBranchLabel"))}</span><input id="wfBaseBranch" value="main" required /></label>
              <label><span>${escapeHtml(t("workflow.taskBranchLabel"))}</span><input id="wfTaskBranch" placeholder="issue-57" required /></label>
              <label><span>${escapeHtml(t("workflow.agentLabel"))}</span><input id="wfWorktreeAgent" placeholder="codex" /></label>
              <label><span>${escapeHtml(t("workflow.sessionIdLabel"))}</span><input id="wfSessionId" placeholder="${escapeHtml(t("workflow.optionalPlaceholder"))}" /></label>
              <button class="primary" type="submit">${escapeHtml(t("workflow.createWorktreeBtn"))}</button>
            </form>
            <div id="wfWorktrees" class="wf-stack"></div>
          </section>

          <section id="wfGithubPanel" class="hidden" data-wf-panel="github">
            <div class="wf-grid">
              <form id="wfIssueForm" class="wf-form wf-card">
                <div class="wf-section-head">
                  <div><strong>${escapeHtml(t("workflow.issueToTaskHeading"))}</strong><small>${escapeHtml(t("workflow.issueUntrustedNote"))}</small></div>
                </div>
                <label><span>${escapeHtml(t("workflow.repositoryLabel"))}</span><input id="wfIssueRepo" placeholder="owner/repo" required /></label>
                <label><span>${escapeHtml(t("workflow.issueNumberLabel"))}</span><input id="wfIssueNumber" type="number" min="1" required /></label>
                <label><span>${escapeHtml(t("workflow.taskBranchLabel"))}</span><input id="wfIssueBranch" placeholder="devmoter/issue-59" required /></label>
                <label><span>${escapeHtml(t("workflow.agentLabel"))}</span><input id="wfIssueAgent" placeholder="codex" required /></label>
                <label><span>${escapeHtml(t("workflow.sessionIdLabel"))}</span><input id="wfIssueSession" placeholder="${escapeHtml(t("workflow.optionalPlaceholder"))}" /></label>
                <label><span>${escapeHtml(t("workflow.issueAttachmentsLabel"))}</span><textarea id="wfIssueAttachments" rows="3" placeholder="README.md&#10;src/main.ts"></textarea></label>
                <button class="primary" type="submit">${escapeHtml(t("workflow.createBoundedTaskBtn"))}</button>
              </form>

              <form id="wfPrForm" class="wf-form wf-card">
                <div class="wf-section-head">
                  <div><strong>${escapeHtml(t("workflow.taskToPrHeading"))}</strong><small>${escapeHtml(t("workflow.taskToPrNote"))}</small></div>
                </div>
                <label><span>${escapeHtml(t("workflow.repositoryLabel"))}</span><input id="wfPrRepo" placeholder="owner/repo" required /></label>
                <label><span>${escapeHtml(t("workflow.taskLabel"))}</span><select id="wfPrTask"><option value="">${escapeHtml(t("workflow.noTaskLink"))}</option></select></label>
                <label><span>${escapeHtml(t("workflow.worktreeLabel"))}</span><select id="wfPrWorktree" required></select></label>
                <label><span>${escapeHtml(t("workflow.baseLabel"))}</span><input id="wfPrBase" value="main" required /></label>
                <label><span>${escapeHtml(t("workflow.headLabel"))}</span><input id="wfPrHead" placeholder="devmoter/issue-60" required /></label>
                <label><span>${escapeHtml(t("workflow.titleLabel"))}</span><input id="wfPrTitle" required /></label>
                <label><span>${escapeHtml(t("workflow.bodyLabel"))}</span><textarea id="wfPrBody" rows="4"></textarea></label>
                <div class="wf-actions">
                  <button id="wfPreviewPr" type="button">${escapeHtml(t("workflow.previewPrBtn"))}</button>
                  <button class="primary" type="submit">${escapeHtml(t("workflow.createPrBtn"))}</button>
                </div>
                <pre id="wfPrPreview" class="wf-preview hidden"></pre>
              </form>
            </div>
            <div id="wfTasks" class="wf-stack"></div>
          </section>
        </main>
      </div>
    </div>
  `;

  const launch = root.querySelector<HTMLButtonElement>("#wfLaunch")!;
  // Shared sheet header: title, refresh (icon action) and close.
  const head = createSheetHeader(document, { title: t("workflow.sheetTitle"), titleId: "wfTitle" });
  head.closeButton.id = "wfClose";
  const refreshButton = document.createElement("button");
  refreshButton.type = "button";
  refreshButton.id = "wfRefresh";
  refreshButton.setAttribute("aria-label", t("common.refresh"));
  refreshButton.innerHTML = REFRESH_ICON;
  head.actions.append(refreshButton);
  root.querySelector<HTMLElement>(".wf-sheet")!.prepend(head.element);
  const modal = root.querySelector<HTMLDivElement>("#wfModal")!;
  const projectSelect = root.querySelector<HTMLSelectElement>("#wfProject")!;
  const status = root.querySelector<HTMLDivElement>("#wfStatus")!;
  const repositoryNotice = root.querySelector<HTMLDivElement>("#wfRepositoryNotice")!;
  const changesBox = root.querySelector<HTMLDivElement>("#wfChanges")!;
  const worktreesBox = root.querySelector<HTMLDivElement>("#wfWorktrees")!;
  const tasksBox = root.querySelector<HTMLDivElement>("#wfTasks")!;
  const diffBox = root.querySelector<HTMLDivElement>("#wfDiffBox")!;
  const diffPre = root.querySelector<HTMLPreElement>("#wfDiff")!;
  const diffNotice = root.querySelector<HTMLDivElement>("#wfDiffNotice")!;
  const nextDiff = root.querySelector<HTMLButtonElement>("#wfNextDiff")!;
  const fileBox = root.querySelector<HTMLDivElement>("#wfFileBox")!;
  const filePre = root.querySelector<HTMLPreElement>("#wfFile")!;
  const fileTitle = root.querySelector<HTMLElement>("#wfFileTitle")!;
  const fileNotice = root.querySelector<HTMLDivElement>("#wfFileNotice")!;
  const nextFile = root.querySelector<HTMLButtonElement>("#wfNextFile")!;
  const prPreview = root.querySelector<HTMLPreElement>("#wfPrPreview")!;
  const prTask = root.querySelector<HTMLSelectElement>("#wfPrTask")!;
  const prWorktree = root.querySelector<HTMLSelectElement>("#wfPrWorktree")!;

  let projects: Project[] = [];
  let changes: ChangeSet[] = [];
  let worktrees: Worktree[] = [];
  let tasks: Task[] = [];
  let activeProjectId = "";
  let isGit: boolean | null = null;
  let diffOffset = 0;
  let fileWindow: { path: string; offset: number; returned: number } | null = null;
  // View-only review state: none of it is sent to the server or changes a decision.
  let activeFilter: WfFilter = "all";
  let dataRequest = 0;
  const hunkOpenState = new Map<string, boolean>();
  const reviewTools = root.querySelector<HTMLDivElement>("#wfReviewTools")!;
  const noMatch = root.querySelector<HTMLDivElement>("#wfNoMatch")!;
  const matchInfo = root.querySelector<HTMLElement>("#wfMatchInfo")!;
  const pathSearch = root.querySelector<HTMLInputElement>("#wfPathSearch")!;
  const diffSearch = root.querySelector<HTMLInputElement>("#wfDiffSearch")!;

  const setStatus = (message: string, error = false) => {
    status.textContent = message;
    status.classList.toggle("error", error);
  };
  const setReadyStatus = () => setStatus(isGit === false ? "" : t("workflow.ready"));

  const project = () => projects.find(item => item.id === activeProjectId) || null;

  async function refreshProjects() {
    const payload = await api<{ projects: Project[] }>("/api/projects");
    projects = payload.projects.filter(item => item.available !== false);
    if (!projects.some(item => item.id === activeProjectId)) {
      activeProjectId = localStorage.getItem("devmoter-workflow-project") || projects[0]?.id || "";
    }
    if (!projects.some(item => item.id === activeProjectId)) activeProjectId = projects[0]?.id || "";
    const labels = projectOptionLabels(projects);
    projectSelect.innerHTML = projects.map((item, index) =>
      `<option value="${escapeHtml(item.id)}">${escapeHtml(labels[index])}</option>`
    ).join("");
    projectSelect.value = activeProjectId;
    const current = project();
    if (current?.github) {
      const issueRepo = root.querySelector<HTMLInputElement>("#wfIssueRepo")!;
      const prRepo = root.querySelector<HTMLInputElement>("#wfPrRepo")!;
      if (!issueRepo.value) issueRepo.value = current.github;
      if (!prRepo.value) prRepo.value = current.github;
    }
  }

  async function refreshData() {
    const request = ++dataRequest;
    const projectId = activeProjectId;
    if (!activeProjectId) {
      isGit = null;
      changes = []; worktrees = []; tasks = [];
      render();
      return;
    }
    const prefix = `/api/workflow/projects/${encodeURIComponent(activeProjectId)}`;
    const [changePayload, worktreePayload, taskPayload, gitPayload] = await Promise.all([
      api<{ changes: ChangeSet[] }>(prefix + "/changes"),
      api<{ worktrees: Worktree[] }>(prefix + "/worktrees"),
      api<{ tasks: Task[] }>(prefix + "/github/tasks").catch(() => ({ tasks: [] })),
      api<{ isGit: boolean }>(`/api/projects/${encodeURIComponent(projectId)}/git/status`)
    ]);
    // A slower, older response must not replace decisions loaded by a newer request.
    if (request !== dataRequest || projectId !== activeProjectId) return;
    isGit = gitPayload.isGit;
    changes = changePayload.changes;
    worktrees = worktreePayload.worktrees;
    tasks = taskPayload.tasks;
    render();
  }

  async function refreshAll() {
    setStatus(t("workflow.refreshing"));
    try {
      await refreshProjects();
      await refreshData();
      setReadyStatus();
    } catch (error) {
      setStatus(t("workflow.refreshFailedKept", { error: wfError(error) }), true);
    }
  }

  function hunkKey(changeId: string, path: string, hunkId: string) {
    return [changeId, path, hunkId].join("\n");
  }

  function highlightDiff(term: string) {
    let matches = 0;
    const pattern = term ? new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi") : null;
    changesBox.querySelectorAll<HTMLPreElement>(".wf-hunk > pre").forEach(pre => {
      const text = pre.textContent || "";
      const visible = !pre.closest(".wf-file.hidden");
      // Built from text nodes only, so the search term is never parsed as HTML.
      const nodes: Node[] = [];
      let last = 0;
      if (pattern) {
        pattern.lastIndex = 0;
        for (let found = pattern.exec(text); found; found = pattern.exec(text)) {
          if (found.index > last) nodes.push(document.createTextNode(text.slice(last, found.index)));
          const mark = document.createElement("mark");
          mark.className = "wf-mark";
          mark.textContent = found[0];
          nodes.push(mark);
          last = found.index + found[0].length;
          if (visible) matches += 1;
        }
      }
      if (last < text.length || !nodes.length) nodes.push(document.createTextNode(text.slice(last)));
      pre.replaceChildren(...nodes);
    });
    return matches;
  }

  function applyReviewView() {
    const allFiles = changes.flatMap(change => change.files);
    const counts: Record<WfFilter, number> = { all: allFiles.length, pending: 0, accept: 0, reject: 0, partial: 0 };
    for (const file of allFiles) if (file.decision in counts) counts[file.decision] += 1;
    if (activeFilter === "partial" && !counts.partial) activeFilter = "all";
    reviewTools.classList.toggle("hidden", !changes.length);
    reviewTools.querySelectorAll<HTMLButtonElement>("[data-wf-filter]").forEach(button => {
      const filter = button.dataset.wfFilter as WfFilter;
      button.setAttribute("aria-pressed", String(filter === activeFilter));
      button.classList.toggle("hidden", filter === "partial" && !counts.partial);
      button.querySelector("[data-wf-count]")!.textContent = formatNumber(counts[filter]);
    });

    const query = pathSearch.value.trim().toLowerCase();
    const narrowed = activeFilter !== "all" || Boolean(query);
    const shown: HTMLElement[] = [];
    changesBox.querySelectorAll<HTMLElement>(".wf-change").forEach(section => {
      const files = Array.from(section.querySelectorAll<HTMLElement>(".wf-file"));
      let visible = 0;
      for (const file of files) {
        const match = (activeFilter === "all" || file.dataset.decision === activeFilter)
          && (!query || (file.dataset.path || "").toLowerCase().includes(query));
        file.classList.toggle("hidden", !match);
        if (match) { visible += 1; shown.push(file); }
      }
      section.classList.toggle("hidden", narrowed && !visible);
    });
    shown.forEach((file, index) => {
      const previous = file.querySelector<HTMLButtonElement>('[data-wf-action="file-prev"]');
      const next = file.querySelector<HTMLButtonElement>('[data-wf-action="file-next"]');
      if (previous) previous.disabled = index === 0;
      if (next) next.disabled = index === shown.length - 1;
    });
    noMatch.classList.toggle("hidden", !changes.length || !narrowed || shown.length > 0);

    const term = diffSearch.value;
    const matches = highlightDiff(term);
    const info = [t("workflow.filesShown", { shown: formatNumber(shown.length), total: formatNumber(allFiles.length) })];
    if (term) info.push(t("workflow.diffMatches", { count: formatNumber(matches) }));
    matchInfo.textContent = changes.length ? info.join(" / ") : "";
  }

  function setAllHunksOpen(open: boolean) {
    changesBox.querySelectorAll<HTMLDetailsElement>("details.wf-hunk").forEach(details => {
      details.open = open;
      if (details.dataset.wfHunkKey) hunkOpenState.set(details.dataset.wfHunkKey, open);
    });
  }

  function moveToFile(from: HTMLElement | null, step: number) {
    const shown = Array.from(changesBox.querySelectorAll<HTMLElement>(".wf-file:not(.hidden)"));
    const target = shown[shown.indexOf(from as HTMLElement) + step];
    if (!from || !target || !shown.includes(from)) return;
    target.focus({ preventScroll: true });
    target.scrollIntoView?.({ block: "start" });
  }

  async function copyPath(path: string) {
    try {
      if (!navigator.clipboard?.writeText) throw new Error("clipboard unavailable");
      await navigator.clipboard.writeText(path);
      setStatus(t("workflow.pathCopied", { path }));
    } catch {
      setStatus(t("workflow.pathCopyFailed"), true);
    }
  }

  function hunkDiff(hunk: Hunk) {
    const oldText = hunk.oldText.split("\n").filter((_, index, all) => index < all.length - 1 || all[index]).map(line => "- " + line).join("\n");
    const newText = hunk.newText.split("\n").filter((_, index, all) => index < all.length - 1 || all[index]).map(line => "+ " + line).join("\n");
    return `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@\n${oldText}\n${newText}`.trim();
  }

  function renderChanges() {
    if (!changes.length) {
      changesBox.innerHTML = isGit === false ? "" : `<div class="wf-empty">${escapeHtml(t("workflow.noChangesToReview"))}</div>`;
      return;
    }
    changesBox.innerHTML = changes.map(change => {
      const files = change.files.map(file => {
        const controls = `
          <div class="wf-inline-actions">
            ${change.status === "pending" ? `
            <button type="button" data-wf-action="file-accept" data-change="${escapeHtml(change.id)}" data-path="${escapeHtml(file.path)}">${escapeHtml(t("workflow.acceptFileBtn"))}</button>
            <button type="button" data-wf-action="file-reject" data-change="${escapeHtml(change.id)}" data-path="${escapeHtml(file.path)}">${escapeHtml(t("workflow.rejectFileBtn"))}</button>` : ""}
            <span class="wf-file-tools">
              <button type="button" data-wf-action="copy-path" data-path="${escapeHtml(file.path)}">${escapeHtml(t("workflow.copyPathBtn"))}</button>
              <button type="button" data-wf-action="file-prev">${escapeHtml(t("workflow.prevFileBtn"))}</button>
              <button type="button" data-wf-action="file-next">${escapeHtml(t("workflow.nextFileBtn"))}</button>
            </span>
          </div>`;
        const hunks = file.hunks.map(hunk => `
          <details class="wf-hunk" data-wf-hunk-key="${escapeHtml(hunkKey(change.id, file.path, hunk.id))}" ${(hunkOpenState.get(hunkKey(change.id, file.path, hunk.id)) ?? file.hunks.length === 1) ? "open" : ""}>
            <summary>
              <span>${escapeHtml(hunk.id)} · -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines}</span>
              <span class="wf-badge ${escapeHtml(hunk.decision)}">${escapeHtml(wfDecisionLabel(hunk.decision))}</span>
            </summary>
            <pre>${escapeHtml(hunkDiff(hunk))}</pre>
            ${change.status === "pending" ? `
              <div class="wf-inline-actions">
                <button type="button" data-wf-action="hunk-accept" data-change="${escapeHtml(change.id)}" data-path="${escapeHtml(file.path)}" data-hunk="${escapeHtml(hunk.id)}">${escapeHtml(t("workflow.acceptHunkBtn"))}</button>
                <button type="button" data-wf-action="hunk-reject" data-change="${escapeHtml(change.id)}" data-path="${escapeHtml(file.path)}" data-hunk="${escapeHtml(hunk.id)}">${escapeHtml(t("workflow.rejectHunkBtn"))}</button>
              </div>` : ""}
          </details>
        `).join("");
        return `
          <article class="wf-file" tabindex="-1" data-path="${escapeHtml(file.path)}" data-decision="${escapeHtml(file.decision)}">
            <div class="wf-file-head">
              <strong>${escapeHtml(file.path)}</strong>
              <span class="wf-badge ${escapeHtml(file.decision)}">${escapeHtml(wfDecisionLabel(file.decision))}</span>
            </div>
            ${controls}
            <div class="wf-hunks">${hunks || `<div class="wf-notice">${escapeHtml(t("workflow.noTextualHunks"))}</div>`}</div>
            ${file.hunks.some(hunk => hunk.decision === "accept") ? `
              <details class="wf-raw-preview wf-accepted-preview" open>
                <summary>${escapeHtml(t("workflow.acceptedPreviewSummary"))}</summary>
                <pre>${escapeHtml(file.acceptedPreview.content)}</pre>
              </details>` : ""}
            <details class="wf-raw-preview">
              <summary>${escapeHtml(t("workflow.fullPreviewSummary", {
                lines: formatNumber(file.preview.totalLines),
                bytes: formatNumber(file.preview.totalBytes)
              }))}</summary>
              <pre>${escapeHtml(file.preview.content)}</pre>
            </details>
            ${file.preview.truncated ? `
              <div class="wf-truncated">
                ${escapeHtml(t("workflow.previewTruncatedNote"))}
                <button type="button" data-wf-action="file-window" data-path="${escapeHtml(file.path)}">${escapeHtml(t("workflow.fetchFileWindowBtn"))}</button>
              </div>` : ""}
          </article>
        `;
      }).join("");

      const action = change.status === "pending"
        ? `<button class="primary" type="button" data-wf-action="apply" data-change="${escapeHtml(change.id)}">${escapeHtml(t("workflow.applyAcceptedBtn"))}</button>`
        : change.status === "applied"
          ? `
            <div class="wf-commit">
              <label><span>${escapeHtml(t("workflow.commitMessageLabel"))}</span><input data-commit-message="${escapeHtml(change.id)}" placeholder="${escapeHtml(t("workflow.commitMessagePlaceholder"))}" /></label>
              <div class="wf-inline-actions">
                <button type="button" data-wf-action="generate-message" data-change="${escapeHtml(change.id)}">${escapeHtml(t("workflow.generateMessageBtn"))}</button>
                <button class="primary" type="button" data-wf-action="commit" data-change="${escapeHtml(change.id)}">${escapeHtml(t("workflow.commitBtn"))}</button>
              </div>
            </div>`
          : `<span class="wf-commit-sha">${escapeHtml(change.commit?.sha?.slice(0, 12) || t("workflow.committedFallback"))}</span>`;

      return `
        <section class="wf-change">
          <div class="wf-change-head">
            <div>
              <strong>${escapeHtml(change.source || t("workflow.agentChangeFallback"))}</strong>
              <small>${escapeHtml(t("workflow.changeMeta", {
                count: formatNumber(change.files.length),
                autoCommit: change.autoCommit ? t("workflow.autoCommitEnabled") : t("workflow.autoCommitOff")
              }))}</small>
            </div>
            <span class="wf-badge ${escapeHtml(change.status)}">${escapeHtml(wfDecisionLabel(change.status))}</span>
          </div>
          <div class="wf-files">${files}</div>
          <div class="wf-change-actions">
            <span>${change.appliedFiles.length ? escapeHtml(t("workflow.appliedFiles", { files: change.appliedFiles.join(", ") })) : ""}</span>
            ${action}
          </div>
        </section>
      `;
    }).join("");
  }

  function renderWorktrees() {
    worktreesBox.innerHTML = isGit === false ? "" : worktrees.length ? worktrees.map(item => `
      <article class="wf-worktree">
        <div>
          <strong>${escapeHtml(item.branch)}</strong>
          <small>${escapeHtml(item.baseBranch)} → ${escapeHtml(item.branch)}</small>
          <code>${escapeHtml(item.path)}</code>
          <small>${escapeHtml(item.agent || t("workflow.agentNotSet"))} · ${escapeHtml(item.sessionId || t("workflow.noSession"))}</small>
        </div>
        <div class="wf-worktree-actions">
          <span class="wf-badge ${item.dirty ? "reject" : "accept"}">${escapeHtml(item.dirty ? t("workflow.dirty") : t("workflow.clean"))}</span>
          <button type="button" data-wf-action="cleanup" data-worktree="${escapeHtml(item.id)}">${escapeHtml(t("workflow.cleanupBtn"))}</button>
        </div>
      </article>
    `).join("") : `<div class="wf-empty">${escapeHtml(t("workflow.noWorktrees"))}</div>`;

    prWorktree.innerHTML = worktrees.length
      ? `<option value="">${escapeHtml(t("workflow.selectWorktreeOption"))}</option>` + worktrees.map(item =>
        `<option value="${escapeHtml(item.id)}" data-branch="${escapeHtml(item.branch)}">${escapeHtml(item.branch)}${item.dirty ? ` · ${escapeHtml(t("workflow.dirty"))}` : ""}</option>`
      ).join("")
      : `<option value="">${escapeHtml(t("workflow.noActiveWorktreesOption"))}</option>`;
  }

  function renderTasks() {
    prTask.innerHTML = `<option value="">${escapeHtml(t("workflow.noTaskLink"))}</option>` + tasks.map(task =>
      `<option value="${escapeHtml(task.id)}">${escapeHtml(task.repo)}#${task.issue.number} — ${escapeHtml(task.issue.title)}</option>`
    ).join("");
    tasksBox.innerHTML = tasks.length ? `
      <div class="wf-section-head"><div><strong>${escapeHtml(t("workflow.preparedTasksHeading"))}</strong><small>${escapeHtml(t("workflow.preparedTasksNote"))}</small></div></div>
      ${tasks.map(task => `
        <article class="wf-task">
          <div>
            <strong>${escapeHtml(task.repo)}#${task.issue.number} · ${escapeHtml(task.issue.title)}</strong>
            <small>${escapeHtml(task.agent)} · ${escapeHtml(task.branch)} · ${escapeHtml(wfDecisionLabel(task.status))}</small>
          </div>
          <code>${escapeHtml(task.id)}</code>
        </article>
      `).join("")}
    ` : "";
  }

  function renderRepositoryState() {
    const unavailable = isGit === false;
    repositoryNotice.classList.toggle("hidden", !unavailable);
    root.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | HTMLButtonElement>(
      '#wfLoadDiff, #wfWorktreeForm input, #wfWorktreeForm button, #wfPrForm input, #wfPrForm select, #wfPrForm textarea, #wfPrForm button, #wfChanges [data-wf-action="generate-message"], #wfChanges [data-wf-action="commit"]'
    ).forEach(control => { control.disabled = unavailable; });
    if (unavailable) {
      diffBox.classList.add("hidden");
      prPreview.classList.add("hidden");
    }
  }

  function render() {
    renderChanges();
    applyReviewView();
    renderWorktrees();
    renderTasks();
    renderRepositoryState();
  }

  async function reviewFile(changeId: string, path: string, decision: "accept" | "reject") {
    const prefix = `/api/workflow/projects/${encodeURIComponent(activeProjectId)}`;
    await api(prefix + `/changes/${encodeURIComponent(changeId)}/review`, {
      method: "PATCH",
      body: jsonBody({ files: [{ path, decision }] })
    });
    await refreshData();
  }

  async function reviewHunk(changeId: string, path: string, hunkId: string, decision: "accept" | "reject") {
    const prefix = `/api/workflow/projects/${encodeURIComponent(activeProjectId)}`;
    await api(prefix + `/changes/${encodeURIComponent(changeId)}/review`, {
      method: "PATCH",
      body: jsonBody({ files: [{ path, hunks: [{ id: hunkId, decision }] }] })
    });
    await refreshData();
  }

  async function loadDiff(reset = false) {
    if (!activeProjectId || isGit === false) return;
    if (reset) diffOffset = 0;
    const params = new URLSearchParams({ offset: String(diffOffset), lines: "600", bytes: String(128 * 1024) });
    const payload = await api<{ content: string; returnedLines: number; truncated: boolean; notice?: string }>(
      `/api/workflow/projects/${encodeURIComponent(activeProjectId)}/diff?${params}`
    );
    diffBox.classList.remove("hidden");
    diffPre.textContent = payload.content || t("workflow.emptyDiff");
    diffNotice.textContent = payload.notice
      ? translateServerMessage(payload.notice)
      : t("workflow.boundedResponseNotice", { lines: formatNumber(payload.returnedLines) });
    nextDiff.classList.toggle("hidden", !payload.truncated);
    nextDiff.dataset.nextOffset = String(diffOffset + payload.returnedLines);
  }

  async function loadFile(path: string, offset = 0) {
    const params = new URLSearchParams({ path, offset: String(offset), lines: "400", bytes: String(128 * 1024) });
    const payload = await api<{ content: string; returnedLines: number; truncated: boolean; notice?: string }>(
      `/api/workflow/projects/${encodeURIComponent(activeProjectId)}/file?${params}`
    );
    fileWindow = { path, offset, returned: payload.returnedLines };
    fileBox.classList.remove("hidden");
    fileTitle.textContent = t("workflow.fileWindowTitle", { path });
    filePre.textContent = payload.content || t("workflow.emptyFile");
    fileNotice.textContent = payload.notice
      ? translateServerMessage(payload.notice)
      : t("workflow.boundedResponseNotice", { lines: formatNumber(payload.returnedLines) });
    nextFile.classList.toggle("hidden", !payload.truncated);
  }

  const closeButton = head.closeButton;
  let returnFocus: HTMLElement | null = null;
  let previousOverflow = "";
  function closeReview(restoreFocus = true) {
    if (modal.classList.contains("hidden")) return;
    modal.classList.add("hidden");
    modal.setAttribute("aria-hidden", "true");
    window.dispatchEvent(new CustomEvent("devmoter:workspace-panel-changed", { detail: { tab: "review", open: false } }));
    document.body.style.overflow = previousOverflow;
    if (restoreFocus && returnFocus?.isConnected && !returnFocus.closest(".hidden, [hidden]")) returnFocus.focus({ preventScroll: true });
  }
  launch.addEventListener("click", () => {
    if (!modal.classList.contains("hidden")) return;
    returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    modal.classList.remove("hidden");
    modal.setAttribute("aria-hidden", "false");
    closeButton.focus({ preventScroll: true });
    window.dispatchEvent(new CustomEvent("devmoter:workspace-panel-changed", { detail: { tab: "review", open: true } }));
    void refreshAll();
  });
  closeButton.addEventListener("click", () => closeReview());
  modal.addEventListener("click", event => { if (event.target === modal) closeReview(); });
  // Programmatic navigation must not steal focus back from the destination.
  window.addEventListener("devmoter:surface-changed", () => closeReview(false));
  window.addEventListener("devmoter:workspace-tab-changing", () => closeReview(false));
  modal.addEventListener("keydown", event => {
    if (event.key === "Escape") { event.preventDefault(); closeReview(); return; }
    if (event.key !== "Tab") return;
    const controls = Array.from(modal.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], summary, [tabindex="0"]'))
      .filter(node => !node.closest(".hidden, [hidden]") && (!node.closest("details:not([open])") || node.tagName === "SUMMARY") && node.getAttribute("aria-hidden") !== "true");
    const first = controls[0];
    const last = controls.at(-1);
    if (!first || !last) { event.preventDefault(); modal.focus(); return; }
    if (event.shiftKey && (document.activeElement === first || document.activeElement === modal)) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  });
  refreshButton.addEventListener("click", () => void refreshAll());

  root.querySelectorAll<HTMLButtonElement>("[data-wf-tab]").forEach(button => {
    button.addEventListener("click", () => {
      const tab = button.dataset.wfTab;
      root.querySelectorAll<HTMLButtonElement>("[data-wf-tab]").forEach(item => {
        item.classList.toggle("active", item === button);
        item.setAttribute("aria-selected", String(item === button));
      });
      root.querySelectorAll<HTMLElement>("[data-wf-panel]").forEach(panel => panel.classList.toggle("hidden", panel.dataset.wfPanel !== tab));
    });
  });

  projectSelect.addEventListener("change", () => {
    activeProjectId = projectSelect.value;
    localStorage.setItem("devmoter-workflow-project", activeProjectId);
    diffOffset = 0;
    diffBox.classList.add("hidden");
    fileBox.classList.add("hidden");
    const current = project();
    const issueRepo = root.querySelector<HTMLInputElement>("#wfIssueRepo")!;
    const prRepo = root.querySelector<HTMLInputElement>("#wfPrRepo")!;
    issueRepo.value = current?.github || "";
    prRepo.value = current?.github || "";
    isGit = null;
    changes = []; worktrees = []; tasks = [];
    render();
    setStatus(t("workflow.refreshing"));
    void refreshData().then(setReadyStatus)
      .catch(error => setStatus(t("workflow.refreshFailedKept", { error: wfError(error) }), true));
  });

  root.querySelector<HTMLButtonElement>("#wfLoadDiff")!.addEventListener("click", () => {
    void loadDiff(true).catch(error => setStatus(wfError(error), true));
  });
  nextDiff.addEventListener("click", () => {
    diffOffset = Number(nextDiff.dataset.nextOffset || 0);
    void loadDiff(false).catch(error => setStatus(wfError(error), true));
  });
  nextFile.addEventListener("click", () => {
    if (!fileWindow) return;
    void loadFile(fileWindow.path, fileWindow.offset + fileWindow.returned)
      .catch(error => setStatus(wfError(error), true));
  });

  changesBox.addEventListener("click", event => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-wf-action]");
    if (!button) return;
    const action = button.dataset.wfAction || "";
    const changeId = button.dataset.change || "";
    const path = button.dataset.path || "";
    const hunk = button.dataset.hunk || "";
    // View-only actions: no request is sent and no decision is touched.
    if (action === "copy-path") { void copyPath(path); return; }
    if (action === "file-prev" || action === "file-next") {
      moveToFile(button.closest<HTMLElement>(".wf-file"), action === "file-prev" ? -1 : 1);
      return;
    }

    const run = async () => {
      setStatus(t("workflow.working"));
      if (action === "file-accept" || action === "file-reject") {
        await reviewFile(changeId, path, action === "file-accept" ? "accept" : "reject");
      } else if (action === "hunk-accept" || action === "hunk-reject") {
        await reviewHunk(changeId, path, hunk, action === "hunk-accept" ? "accept" : "reject");
      } else if (action === "file-window") {
        await loadFile(path, 0);
      } else if (action === "apply") {
        const selectedChange = changes.find(item => item.id === changeId);
        const endpoint = `/api/workflow/projects/${encodeURIComponent(activeProjectId)}/changes/${encodeURIComponent(changeId)}`;
        const result = await api<{ change: ChangeSet }>(
          endpoint + "/apply",
          { method: "POST", body: jsonBody({}) }
        );
        setStatus(t("workflow.appliedExactly", { files: result.change.appliedFiles.join(", ") }));

        if (selectedChange?.autoCommit && isGit !== false) {
          const preview = await api<{ preview: { files: string[]; message: string } }>(
            endpoint + "/commit",
            { method: "POST", body: jsonBody({}) }
          );
          const edited = window.prompt(
            t("workflow.autoCommitPrompt", { files: preview.preview.files.join("\n") }),
            preview.preview.message
          );
          if (edited !== null) {
            const message = edited.trim() || preview.preview.message;
            const approved = window.confirm(
              t("workflow.autoCommitConfirm", { message, files: preview.preview.files.join("\n") })
            );
            if (approved) {
              await api(endpoint + "/commit", {
                method: "POST",
                body: jsonBody({ message, confirm: true })
              });
              setStatus(t("workflow.autoCommitSuccess"));
            } else {
              setStatus(t("workflow.autoCommitCancelled"));
            }
          } else {
            setStatus(t("workflow.autoCommitCancelled"));
          }
        }

        await refreshData();
        return;
      } else if (action === "generate-message") {
        const result = await api<{ preview: { files: string[]; message: string } }>(
          `/api/workflow/projects/${encodeURIComponent(activeProjectId)}/changes/${encodeURIComponent(changeId)}/commit`,
          { method: "POST", body: jsonBody({}) }
        );
        const input = changesBox.querySelector<HTMLInputElement>(`[data-commit-message="${CSS.escape(changeId)}"]`);
        if (input) input.value = result.preview.message;
        setStatus(t("workflow.commitPreviewStatus", { files: result.preview.files.join(", ") }));
        return;
      } else if (action === "commit") {
        const input = changesBox.querySelector<HTMLInputElement>(`[data-commit-message="${CSS.escape(changeId)}"]`);
        const message = input?.value.trim() || "";
        const preview = await api<{ preview: { files: string[]; message: string }; committed: boolean }>(
          `/api/workflow/projects/${encodeURIComponent(activeProjectId)}/changes/${encodeURIComponent(changeId)}/commit`,
          { method: "POST", body: jsonBody({ message }) }
        );
        if (input && !input.value.trim()) input.value = preview.preview.message;
        const approved = window.confirm(
          t("workflow.commitConfirm", { message: preview.preview.message, files: preview.preview.files.join("\n") })
        );
        if (!approved) { setStatus(t("workflow.commitCancelled")); return; }
        await api(
          `/api/workflow/projects/${encodeURIComponent(activeProjectId)}/changes/${encodeURIComponent(changeId)}/commit`,
          { method: "POST", body: jsonBody({ message: input?.value.trim() || preview.preview.message, confirm: true }) }
        );
        await refreshData();
      }
      setReadyStatus();
    };
    void run().catch(error => setStatus(wfError(error), true));
  });

  reviewTools.addEventListener("click", event => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-wf-filter]");
    if (!button) return;
    activeFilter = button.dataset.wfFilter as WfFilter;
    applyReviewView();
  });
  pathSearch.addEventListener("input", applyReviewView);
  diffSearch.addEventListener("input", applyReviewView);
  root.querySelector<HTMLButtonElement>("#wfExpandAll")!.addEventListener("click", () => setAllHunksOpen(true));
  root.querySelector<HTMLButtonElement>("#wfCollapseAll")!.addEventListener("click", () => setAllHunksOpen(false));
  // "toggle" does not bubble; capture it so a refresh keeps what the reviewer opened.
  changesBox.addEventListener("toggle", event => {
    const details = event.target as HTMLDetailsElement;
    if (details.dataset?.wfHunkKey) hunkOpenState.set(details.dataset.wfHunkKey, details.open);
  }, true);

  root.querySelector<HTMLFormElement>("#wfWorktreeForm")!.addEventListener("submit", event => {
    event.preventDefault();
    const run = async () => {
      const payload = {
        baseBranch: inputValue(root, "#wfBaseBranch"),
        branch: inputValue(root, "#wfTaskBranch"),
        agent: inputValue(root, "#wfWorktreeAgent"),
        sessionId: inputValue(root, "#wfSessionId")
      };
      const result = await api<{ worktree: Worktree }>(
        `/api/workflow/projects/${encodeURIComponent(activeProjectId)}/worktrees`,
        { method: "POST", body: jsonBody(payload) }
      );
      setStatus(t("workflow.createdWorktree", { branch: result.worktree.branch }));
      await refreshData();
    };
    void run().catch(error => setStatus(wfError(error), true));
  });

  worktreesBox.addEventListener("click", event => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-wf-action="cleanup"]');
    if (!button) return;
    const id = button.dataset.worktree || "";
    const run = async () => {
      const endpoint = `/api/workflow/projects/${encodeURIComponent(activeProjectId)}/worktrees/${encodeURIComponent(id)}/cleanup`;
      const preview = await api<Json>(endpoint, { method: "POST", body: jsonBody({}) });
      if (preview.blocked) {
        setStatus(t("workflow.cleanupBlocked", { branch: preview.branch, path: preview.path }), true);
        return;
      }
      if (!window.confirm(t("workflow.cleanupConfirm", {
        path: preview.preview.path,
        branch: preview.preview.branch,
        baseBranch: preview.preview.baseBranch
      }))) return;
      await api(endpoint, { method: "POST", body: jsonBody({ confirm: true }) });
      setStatus(t("workflow.worktreeRemoved"));
      await refreshData();
    };
    void run().catch(error => setStatus(wfError(error), true));
  });

  root.querySelector<HTMLFormElement>("#wfIssueForm")!.addEventListener("submit", event => {
    event.preventDefault();
    const run = async () => {
      const attachments = textareaValue(root, "#wfIssueAttachments").split(/\r?\n/).map(value => value.trim()).filter(Boolean);
      const result = await api<{ task: Task; note: string }>(
        `/api/workflow/projects/${encodeURIComponent(activeProjectId)}/github/issue`,
        {
          method: "POST",
          body: jsonBody({
            repo: inputValue(root, "#wfIssueRepo"),
            issue: Number(inputValue(root, "#wfIssueNumber")),
            branch: inputValue(root, "#wfIssueBranch"),
            agent: inputValue(root, "#wfIssueAgent"),
            sessionId: inputValue(root, "#wfIssueSession"),
            attachments
          })
        }
      );
      setStatus(t("workflow.taskCreated", { repo: result.task.repo, number: result.task.issue.number }));
      await refreshData();
      prTask.value = result.task.id;
      const title = root.querySelector<HTMLInputElement>("#wfPrTitle")!;
      if (!title.value) title.value = result.task.issue.title;
    };
    void run().catch(error => setStatus(wfError(error), true));
  });

  prWorktree.addEventListener("change", () => {
    const option = prWorktree.selectedOptions[0];
    const branch = option?.dataset.branch || "";
    if (branch) root.querySelector<HTMLInputElement>("#wfPrHead")!.value = branch;
  });

  prTask.addEventListener("change", () => {
    const task = tasks.find(item => item.id === prTask.value);
    if (!task) return;
    root.querySelector<HTMLInputElement>("#wfPrRepo")!.value = task.repo;
    root.querySelector<HTMLInputElement>("#wfPrTitle")!.value = task.issue.title;
  });

  async function previewPr() {
    const payload = {
      repo: inputValue(root, "#wfPrRepo"),
      taskId: prTask.value,
      worktreeId: prWorktree.value,
      base: inputValue(root, "#wfPrBase"),
      head: inputValue(root, "#wfPrHead"),
      title: inputValue(root, "#wfPrTitle"),
      body: textareaValue(root, "#wfPrBody")
    };
    const result = await api<{ preview: Json }>(
      `/api/workflow/projects/${encodeURIComponent(activeProjectId)}/github/pr`,
      { method: "POST", body: jsonBody(payload) }
    );
    prPreview.classList.remove("hidden");
    prPreview.textContent = JSON.stringify(result.preview, null, 2);
    return { payload, preview: result.preview };
  }

  root.querySelector<HTMLButtonElement>("#wfPreviewPr")!.addEventListener("click", () => {
    void previewPr().then(() => setStatus(t("workflow.prPreviewReady")))
      .catch(error => setStatus(wfError(error), true));
  });

  root.querySelector<HTMLFormElement>("#wfPrForm")!.addEventListener("submit", event => {
    event.preventDefault();
    const run = async () => {
      const { payload, preview } = await previewPr();
      const approved = window.confirm(
        t("workflow.createPrConfirm", {
          repo: preview.repo,
          base: preview.base,
          head: preview.head,
          title: preview.title
        })
      );
      if (!approved) return;
      const result = await api<{ created: boolean; url: string }>(
        `/api/workflow/projects/${encodeURIComponent(activeProjectId)}/github/pr`,
        { method: "POST", body: jsonBody({ ...payload, confirm: true }) }
      );
      setStatus(result.created ? t("workflow.prCreated", { url: result.url }) : t("workflow.prNotCreated"));
      await refreshData();
    };
    void run().catch(error => setStatus(wfError(error), true));
  });
}
