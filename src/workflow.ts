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
  const response = await fetch(url, {
    cache: "no-store",
    ...init,
    headers: init.body ? { "content-type": "application/json" } : init.headers
  });
  const payload = await response.json().catch(() => ({})) as Json;
  if (!response.ok) throw new Error(String(payload.error || `HTTP ${response.status}`));
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
    <button id="wfLaunch" class="wf-launch" type="button" aria-label="Review changes and tasks">
      <span>⌁</span><b>Review</b>
    </button>
    <div id="wfModal" class="wf-modal hidden" aria-hidden="true">
      <div class="wf-sheet">
        <header class="wf-header">
          <div>
            <span class="wf-kicker">DEVMOTER WORKFLOW</span>
            <strong>Review & Tasks</strong>
          </div>
          <button id="wfClose" class="wf-close" type="button" aria-label="Close">×</button>
        </header>
        <div class="wf-toolbar">
          <label>
            <span>Project</span>
            <select id="wfProject"></select>
          </label>
          <button id="wfRefresh" type="button">Refresh</button>
        </div>
        <nav class="wf-tabs" aria-label="Workflow sections">
          <button type="button" class="active" data-wf-tab="changes">Changes</button>
          <button type="button" data-wf-tab="worktrees">Worktrees</button>
          <button type="button" data-wf-tab="github">GitHub</button>
        </nav>
        <div id="wfStatus" class="wf-status" role="status" aria-live="polite"></div>
        <main class="wf-body">
          <section id="wfChangesPanel" data-wf-panel="changes">
            <div class="wf-section-head">
              <div><strong>Reviewed changes</strong><small>Pending review never mutates files.</small></div>
              <button id="wfLoadDiff" type="button">Working diff</button>
            </div>
            <div id="wfDiffBox" class="wf-inspector hidden">
              <div class="wf-inspector-head">
                <strong>Bounded diff window</strong>
                <button id="wfNextDiff" class="hidden" type="button">Load next</button>
              </div>
              <div id="wfDiffNotice" class="wf-notice"></div>
              <pre id="wfDiff"></pre>
            </div>
            <div id="wfFileBox" class="wf-inspector hidden">
              <div class="wf-inspector-head">
                <strong id="wfFileTitle">File window</strong>
                <button id="wfNextFile" class="hidden" type="button">Load next</button>
              </div>
              <div id="wfFileNotice" class="wf-notice"></div>
              <pre id="wfFile"></pre>
            </div>
            <div id="wfChanges" class="wf-stack"></div>
          </section>

          <section id="wfWorktreesPanel" class="hidden" data-wf-panel="worktrees">
            <div class="wf-section-head">
              <div><strong>Isolated worktrees</strong><small>Task branches stay inside DevMoter's managed worktree root.</small></div>
            </div>
            <form id="wfWorktreeForm" class="wf-form">
              <label><span>Base branch</span><input id="wfBaseBranch" value="main" required /></label>
              <label><span>Task branch</span><input id="wfTaskBranch" placeholder="issue-57" required /></label>
              <label><span>Agent</span><input id="wfWorktreeAgent" placeholder="codex" /></label>
              <label><span>Session ID</span><input id="wfSessionId" placeholder="optional" /></label>
              <button class="primary" type="submit">Create isolated worktree</button>
            </form>
            <div id="wfWorktrees" class="wf-stack"></div>
          </section>

          <section id="wfGithubPanel" class="hidden" data-wf-panel="github">
            <div class="wf-grid">
              <form id="wfIssueForm" class="wf-form wf-card">
                <div class="wf-section-head">
                  <div><strong>GitHub Issue → task</strong><small>Issue text is always treated as untrusted input.</small></div>
                </div>
                <label><span>Repository</span><input id="wfIssueRepo" placeholder="owner/repo" required /></label>
                <label><span>Issue #</span><input id="wfIssueNumber" type="number" min="1" required /></label>
                <label><span>Task branch</span><input id="wfIssueBranch" placeholder="devmoter/issue-59" required /></label>
                <label><span>Agent</span><input id="wfIssueAgent" placeholder="codex" required /></label>
                <label><span>Session ID</span><input id="wfIssueSession" placeholder="optional" /></label>
                <label><span>Selected context / attachments (one per line)</span><textarea id="wfIssueAttachments" rows="3" placeholder="README.md&#10;src/main.ts"></textarea></label>
                <button class="primary" type="submit">Create bounded task</button>
              </form>

              <form id="wfPrForm" class="wf-form wf-card">
                <div class="wf-section-head">
                  <div><strong>Task → pull request</strong><small>Preview first. No force-push and no auto-merge.</small></div>
                </div>
                <label><span>Repository</span><input id="wfPrRepo" placeholder="owner/repo" required /></label>
                <label><span>Task</span><select id="wfPrTask"><option value="">No task link</option></select></label>
                <label><span>Worktree</span><select id="wfPrWorktree" required></select></label>
                <label><span>Base</span><input id="wfPrBase" value="main" required /></label>
                <label><span>Head</span><input id="wfPrHead" placeholder="devmoter/issue-60" required /></label>
                <label><span>Title</span><input id="wfPrTitle" required /></label>
                <label><span>Body</span><textarea id="wfPrBody" rows="4"></textarea></label>
                <div class="wf-actions">
                  <button id="wfPreviewPr" type="button">Preview PR</button>
                  <button class="primary" type="submit">Create PR</button>
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
  const modal = root.querySelector<HTMLDivElement>("#wfModal")!;
  const projectSelect = root.querySelector<HTMLSelectElement>("#wfProject")!;
  const status = root.querySelector<HTMLDivElement>("#wfStatus")!;
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
  let diffOffset = 0;
  let fileWindow: { path: string; offset: number; returned: number } | null = null;

  const setStatus = (message: string, error = false) => {
    status.textContent = message;
    status.classList.toggle("error", error);
  };

  const project = () => projects.find(item => item.id === activeProjectId) || null;

  async function refreshProjects() {
    const payload = await api<{ projects: Project[] }>("/api/projects");
    projects = payload.projects.filter(item => item.available !== false);
    if (!projects.some(item => item.id === activeProjectId)) {
      activeProjectId = localStorage.getItem("devmoter-workflow-project") || projects[0]?.id || "";
    }
    if (!projects.some(item => item.id === activeProjectId)) activeProjectId = projects[0]?.id || "";
    projectSelect.innerHTML = projects.map(item =>
      `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)} — ${escapeHtml(item.path)}</option>`
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
    if (!activeProjectId) {
      changes = []; worktrees = []; tasks = [];
      render();
      return;
    }
    const prefix = `/api/workflow/projects/${encodeURIComponent(activeProjectId)}`;
    const [changePayload, worktreePayload, taskPayload] = await Promise.all([
      api<{ changes: ChangeSet[] }>(prefix + "/changes"),
      api<{ worktrees: Worktree[] }>(prefix + "/worktrees"),
      api<{ tasks: Task[] }>(prefix + "/github/tasks").catch(() => ({ tasks: [] }))
    ]);
    changes = changePayload.changes;
    worktrees = worktreePayload.worktrees;
    tasks = taskPayload.tasks;
    render();
  }

  async function refreshAll() {
    setStatus("Refreshing…");
    try {
      await refreshProjects();
      await refreshData();
      setStatus("Ready");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error), true);
    }
  }

  function hunkDiff(hunk: Hunk) {
    const oldText = hunk.oldText.split("\n").filter((_, index, all) => index < all.length - 1 || all[index]).map(line => "- " + line).join("\n");
    const newText = hunk.newText.split("\n").filter((_, index, all) => index < all.length - 1 || all[index]).map(line => "+ " + line).join("\n");
    return `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@\n${oldText}\n${newText}`.trim();
  }

  function renderChanges() {
    if (!changes.length) {
      changesBox.innerHTML = '<div class="wf-empty">No staged change sets yet. Agent integrations can POST proposals to the workflow API.</div>';
      return;
    }
    changesBox.innerHTML = changes.map(change => {
      const files = change.files.map(file => {
        const controls = change.status === "pending" ? `
          <div class="wf-inline-actions">
            <button type="button" data-wf-action="file-accept" data-change="${escapeHtml(change.id)}" data-path="${escapeHtml(file.path)}">Accept file</button>
            <button type="button" data-wf-action="file-reject" data-change="${escapeHtml(change.id)}" data-path="${escapeHtml(file.path)}">Reject file</button>
          </div>` : "";
        const hunks = file.hunks.map(hunk => `
          <details class="wf-hunk" ${file.hunks.length === 1 ? "open" : ""}>
            <summary>
              <span>${escapeHtml(hunk.id)} · -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines}</span>
              <span class="wf-badge ${escapeHtml(hunk.decision)}">${escapeHtml(hunk.decision)}</span>
            </summary>
            <pre>${escapeHtml(hunkDiff(hunk))}</pre>
            ${change.status === "pending" ? `
              <div class="wf-inline-actions">
                <button type="button" data-wf-action="hunk-accept" data-change="${escapeHtml(change.id)}" data-path="${escapeHtml(file.path)}" data-hunk="${escapeHtml(hunk.id)}">Accept hunk</button>
                <button type="button" data-wf-action="hunk-reject" data-change="${escapeHtml(change.id)}" data-path="${escapeHtml(file.path)}" data-hunk="${escapeHtml(hunk.id)}">Reject hunk</button>
              </div>` : ""}
          </details>
        `).join("");
        return `
          <article class="wf-file">
            <div class="wf-file-head">
              <strong>${escapeHtml(file.path)}</strong>
              <span class="wf-badge ${escapeHtml(file.decision)}">${escapeHtml(file.decision)}</span>
            </div>
            ${controls}
            <div class="wf-hunks">${hunks || '<div class="wf-notice">No textual hunks.</div>'}</div>
            ${file.hunks.some(hunk => hunk.decision === "accept") ? `
              <details class="wf-raw-preview wf-accepted-preview" open>
                <summary>Accepted result preview · only selected hunks</summary>
                <pre>${escapeHtml(file.acceptedPreview.content)}</pre>
              </details>` : ""}
            <details class="wf-raw-preview">
              <summary>Full proposal preview · ${file.preview.totalLines} lines · ${file.preview.totalBytes} bytes</summary>
              <pre>${escapeHtml(file.preview.content)}</pre>
            </details>
            ${file.preview.truncated ? `
              <div class="wf-truncated">
                Preview truncated by safety limits.
                <button type="button" data-wf-action="file-window" data-path="${escapeHtml(file.path)}">Fetch bounded file window</button>
              </div>` : ""}
          </article>
        `;
      }).join("");

      const action = change.status === "pending"
        ? `<button class="primary" type="button" data-wf-action="apply" data-change="${escapeHtml(change.id)}">Apply accepted changes</button>`
        : change.status === "applied"
          ? `
            <div class="wf-commit">
              <label><span>Commit message</span><input data-commit-message="${escapeHtml(change.id)}" placeholder="Generate or edit a commit message" /></label>
              <div class="wf-inline-actions">
                <button type="button" data-wf-action="generate-message" data-change="${escapeHtml(change.id)}">Generate message</button>
                <button class="primary" type="button" data-wf-action="commit" data-change="${escapeHtml(change.id)}">Commit…</button>
              </div>
            </div>`
          : `<span class="wf-commit-sha">${escapeHtml(change.commit?.sha?.slice(0, 12) || "committed")}</span>`;

      return `
        <section class="wf-change">
          <div class="wf-change-head">
            <div>
              <strong>${escapeHtml(change.source || "agent change")}</strong>
              <small>${change.files.length} file(s) · auto-commit ${change.autoCommit ? "enabled" : "off"}</small>
            </div>
            <span class="wf-badge ${escapeHtml(change.status)}">${escapeHtml(change.status)}</span>
          </div>
          <div class="wf-files">${files}</div>
          <div class="wf-change-actions">
            <span>${change.appliedFiles.length ? "Applied: " + escapeHtml(change.appliedFiles.join(", ")) : ""}</span>
            ${action}
          </div>
        </section>
      `;
    }).join("");
  }

  function renderWorktrees() {
    worktreesBox.innerHTML = worktrees.length ? worktrees.map(item => `
      <article class="wf-worktree">
        <div>
          <strong>${escapeHtml(item.branch)}</strong>
          <small>${escapeHtml(item.baseBranch)} → ${escapeHtml(item.branch)}</small>
          <code>${escapeHtml(item.path)}</code>
          <small>${escapeHtml(item.agent || "agent not set")} · ${escapeHtml(item.sessionId || "no session")}</small>
        </div>
        <div class="wf-worktree-actions">
          <span class="wf-badge ${item.dirty ? "reject" : "accept"}">${item.dirty ? "dirty" : "clean"}</span>
          <button type="button" data-wf-action="cleanup" data-worktree="${escapeHtml(item.id)}">Cleanup…</button>
        </div>
      </article>
    `).join("") : '<div class="wf-empty">No active task worktrees.</div>';

    prWorktree.innerHTML = worktrees.length
      ? '<option value="">Select a worktree</option>' + worktrees.map(item =>
        `<option value="${escapeHtml(item.id)}" data-branch="${escapeHtml(item.branch)}">${escapeHtml(item.branch)}${item.dirty ? " · dirty" : ""}</option>`
      ).join("")
      : '<option value="">No active worktrees</option>';
  }

  function renderTasks() {
    prTask.innerHTML = '<option value="">No task link</option>' + tasks.map(task =>
      `<option value="${escapeHtml(task.id)}">${escapeHtml(task.repo)}#${task.issue.number} — ${escapeHtml(task.issue.title)}</option>`
    ).join("");
    tasksBox.innerHTML = tasks.length ? `
      <div class="wf-section-head"><div><strong>Prepared tasks</strong><small>Stored locally; GitHub issues remain open.</small></div></div>
      ${tasks.map(task => `
        <article class="wf-task">
          <div>
            <strong>${escapeHtml(task.repo)}#${task.issue.number} · ${escapeHtml(task.issue.title)}</strong>
            <small>${escapeHtml(task.agent)} · ${escapeHtml(task.branch)} · ${escapeHtml(task.status)}</small>
          </div>
          <code>${escapeHtml(task.id)}</code>
        </article>
      `).join("")}
    ` : "";
  }

  function render() {
    renderChanges();
    renderWorktrees();
    renderTasks();
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
    if (!activeProjectId) return;
    if (reset) diffOffset = 0;
    const params = new URLSearchParams({ offset: String(diffOffset), lines: "600", bytes: String(128 * 1024) });
    const payload = await api<{ content: string; returnedLines: number; truncated: boolean; notice?: string }>(
      `/api/workflow/projects/${encodeURIComponent(activeProjectId)}/diff?${params}`
    );
    diffBox.classList.remove("hidden");
    diffPre.textContent = payload.content || "(empty diff)";
    diffNotice.textContent = payload.notice || `Bounded response: ${payload.returnedLines} lines.`;
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
    fileTitle.textContent = `File window · ${path}`;
    filePre.textContent = payload.content || "(empty)";
    fileNotice.textContent = payload.notice || `Bounded response: ${payload.returnedLines} lines.`;
    nextFile.classList.toggle("hidden", !payload.truncated);
  }

  launch.addEventListener("click", () => {
    modal.classList.remove("hidden");
    modal.setAttribute("aria-hidden", "false");
    void refreshAll();
  });
  root.querySelector<HTMLButtonElement>("#wfClose")!.addEventListener("click", () => {
    modal.classList.add("hidden");
    modal.setAttribute("aria-hidden", "true");
  });
  root.querySelector<HTMLButtonElement>("#wfRefresh")!.addEventListener("click", () => void refreshAll());

  root.querySelectorAll<HTMLButtonElement>("[data-wf-tab]").forEach(button => {
    button.addEventListener("click", () => {
      const tab = button.dataset.wfTab;
      root.querySelectorAll<HTMLButtonElement>("[data-wf-tab]").forEach(item => item.classList.toggle("active", item === button));
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
    void refreshData();
  });

  root.querySelector<HTMLButtonElement>("#wfLoadDiff")!.addEventListener("click", () => {
    void loadDiff(true).catch(error => setStatus(error instanceof Error ? error.message : String(error), true));
  });
  nextDiff.addEventListener("click", () => {
    diffOffset = Number(nextDiff.dataset.nextOffset || 0);
    void loadDiff(false).catch(error => setStatus(error instanceof Error ? error.message : String(error), true));
  });
  nextFile.addEventListener("click", () => {
    if (!fileWindow) return;
    void loadFile(fileWindow.path, fileWindow.offset + fileWindow.returned)
      .catch(error => setStatus(error instanceof Error ? error.message : String(error), true));
  });

  changesBox.addEventListener("click", event => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-wf-action]");
    if (!button) return;
    const action = button.dataset.wfAction || "";
    const changeId = button.dataset.change || "";
    const path = button.dataset.path || "";
    const hunk = button.dataset.hunk || "";

    const run = async () => {
      setStatus("Working…");
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
        setStatus(`Applied exactly: ${result.change.appliedFiles.join(", ")}`);

        if (selectedChange?.autoCommit) {
          const preview = await api<{ preview: { files: string[]; message: string } }>(
            endpoint + "/commit",
            { method: "POST", body: jsonBody({}) }
          );
          const edited = window.prompt(
            `Auto-commit is enabled for this change set.\n\nFiles:\n${preview.preview.files.join("\n")}\n\nEdit the commit message before continuing:`,
            preview.preview.message
          );
          if (edited !== null) {
            const message = edited.trim() || preview.preview.message;
            const approved = window.confirm(
              `Create the opt-in commit now?\n\nMessage: ${message}\nFiles:\n${preview.preview.files.join("\n")}`
            );
            if (approved) {
              await api(endpoint + "/commit", {
                method: "POST",
                body: jsonBody({ message, confirm: true })
              });
              setStatus("Accepted changes were applied and committed.");
            } else {
              setStatus("Changes applied; automatic commit was cancelled.");
            }
          } else {
            setStatus("Changes applied; automatic commit was cancelled.");
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
        setStatus(`Commit preview: ${result.preview.files.join(", ")}`);
        return;
      } else if (action === "commit") {
        const input = changesBox.querySelector<HTMLInputElement>(`[data-commit-message="${CSS.escape(changeId)}"]`);
        const message = input?.value.trim() || "";
        const preview = await api<{ preview: { files: string[]; message: string }; committed: boolean }>(
          `/api/workflow/projects/${encodeURIComponent(activeProjectId)}/changes/${encodeURIComponent(changeId)}/commit`,
          { method: "POST", body: jsonBody({ message }) }
        );
        if (input && !input.value.trim()) input.value = preview.preview.message;
        const approved = window.confirm(`Create this commit?\n\nMessage: ${preview.preview.message}\nFiles:\n${preview.preview.files.join("\n")}`);
        if (!approved) { setStatus("Commit cancelled; files remain applied but uncommitted."); return; }
        await api(
          `/api/workflow/projects/${encodeURIComponent(activeProjectId)}/changes/${encodeURIComponent(changeId)}/commit`,
          { method: "POST", body: jsonBody({ message: input?.value.trim() || preview.preview.message, confirm: true }) }
        );
        await refreshData();
      }
      setStatus("Ready");
    };
    void run().catch(error => setStatus(error instanceof Error ? error.message : String(error), true));
  });

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
      setStatus(`Created ${result.worktree.branch}`);
      await refreshData();
    };
    void run().catch(error => setStatus(error instanceof Error ? error.message : String(error), true));
  });

  worktreesBox.addEventListener("click", event => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-wf-action="cleanup"]');
    if (!button) return;
    const id = button.dataset.worktree || "";
    const run = async () => {
      const endpoint = `/api/workflow/projects/${encodeURIComponent(activeProjectId)}/worktrees/${encodeURIComponent(id)}/cleanup`;
      const preview = await api<Json>(endpoint, { method: "POST", body: jsonBody({}) });
      if (preview.blocked) {
        setStatus(`Cleanup blocked: dirty worktree ${preview.branch} at ${preview.path}`, true);
        return;
      }
      if (!window.confirm(`Remove clean worktree?\n\nPath: ${preview.preview.path}\nBranch: ${preview.preview.branch}\nBase: ${preview.preview.baseBranch}`)) return;
      await api(endpoint, { method: "POST", body: jsonBody({ confirm: true }) });
      setStatus("Worktree removed. Branch was not force-deleted.");
      await refreshData();
    };
    void run().catch(error => setStatus(error instanceof Error ? error.message : String(error), true));
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
      setStatus(`Task created: ${result.task.repo}#${result.task.issue.number}. Issue content remains untrusted.`);
      await refreshData();
      prTask.value = result.task.id;
      const title = root.querySelector<HTMLInputElement>("#wfPrTitle")!;
      if (!title.value) title.value = result.task.issue.title;
    };
    void run().catch(error => setStatus(error instanceof Error ? error.message : String(error), true));
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
    void previewPr().then(() => setStatus("PR preview ready. Nothing was pushed or created."))
      .catch(error => setStatus(error instanceof Error ? error.message : String(error), true));
  });

  root.querySelector<HTMLFormElement>("#wfPrForm")!.addEventListener("submit", event => {
    event.preventDefault();
    const run = async () => {
      const { payload, preview } = await previewPr();
      const approved = window.confirm(
        `Create pull request?\n\n${preview.repo}\n${preview.base} ← ${preview.head}\n\n${preview.title}\n\nThis may push the selected branch normally. It never force-pushes or auto-merges.`
      );
      if (!approved) return;
      const result = await api<{ created: boolean; url: string }>(
        `/api/workflow/projects/${encodeURIComponent(activeProjectId)}/github/pr`,
        { method: "POST", body: jsonBody({ ...payload, confirm: true }) }
      );
      setStatus(result.created ? `Pull request created: ${result.url}` : "Pull request was not created.");
      await refreshData();
    };
    void run().catch(error => setStatus(error instanceof Error ? error.message : String(error), true));
  });
}
