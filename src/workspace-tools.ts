type ProjectSummary = {
  id: string;
  name: string;
  path: string;
  available?: boolean;
};

type GitStatus = {
  isGit: boolean;
  branch: string | null;
  upstream: string | null;
  ahead: number | null;
  behind: number | null;
  staged: number;
  modified: number;
  untracked: number;
  conflicts: number;
};

type GitFile = {
  path: string;
  status: string[];
  additions: number | null;
  deletions: number | null;
  binary?: boolean;
};

type GitFiles = {
  isGit: boolean;
  files: GitFile[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
};

type GitDiff = {
  isGit: boolean;
  path: string | null;
  diff: string;
  truncated: boolean;
  scope: string;
  status?: string[];
};

type ParsedLine = {
  kind: "add" | "del" | "context" | "meta";
  text: string;
  oldLine: number | null;
  newLine: number | null;
};

type ParsedHunk = {
  header: string;
  lines: ParsedLine[];
};

const PAGE_SIZE = 80;

async function requestJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store" });
  const text = await res.text();
  let payload: any = {};
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    throw new Error("DevMoter returned invalid JSON");
  }
  if (!res.ok) throw new Error(payload?.error || "HTTP " + res.status);
  return payload as T;
}

function badge(text: string) {
  const span = document.createElement("span");
  span.className = "pocket-git-badge " + text;
  span.textContent = text;
  return span;
}

function parseUnifiedDiff(diff: string): ParsedHunk[] {
  const hunks: ParsedHunk[] = [];
  let current: ParsedHunk | null = null;
  let oldLine = 0;
  let newLine = 0;

  for (const raw of String(diff || "").replace(/\r\n/g, "\n").split("\n")) {
    if (raw.startsWith("@@")) {
      const match = raw.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      oldLine = match ? Number(match[1]) : 0;
      newLine = match ? Number(match[2]) : 0;
      current = { header: raw, lines: [] };
      hunks.push(current);
      continue;
    }

    if (!current) {
      if (!raw) continue;
      current = { header: "File header", lines: [] };
      hunks.push(current);
    }

    if (raw.startsWith("+") && !raw.startsWith("+++")) {
      current.lines.push({ kind: "add", text: raw.slice(1), oldLine: null, newLine });
      newLine += 1;
    } else if (raw.startsWith("-") && !raw.startsWith("---")) {
      current.lines.push({ kind: "del", text: raw.slice(1), oldLine, newLine: null });
      oldLine += 1;
    } else if (raw.startsWith(" ")) {
      current.lines.push({ kind: "context", text: raw.slice(1), oldLine, newLine });
      oldLine += 1;
      newLine += 1;
    } else {
      current.lines.push({ kind: "meta", text: raw, oldLine: null, newLine: null });
    }
  }
  return hunks;
}

function appendCell(row: HTMLElement, className: string, value: string) {
  const cell = document.createElement("span");
  cell.className = className;
  cell.textContent = value;
  row.appendChild(cell);
  return cell;
}

function unifiedHunk(hunk: ParsedHunk) {
  const details = document.createElement("details");
  details.className = "pocket-diff-hunk";
  details.open = true;

  const summary = document.createElement("summary");
  summary.textContent = hunk.header;
  details.appendChild(summary);

  const body = document.createElement("div");
  body.className = "pocket-diff-lines";
  for (const line of hunk.lines) {
    const row = document.createElement("div");
    row.className = "pocket-diff-line " + line.kind;
    appendCell(row, "old", line.oldLine === null ? "" : String(line.oldLine));
    appendCell(row, "new", line.newLine === null ? "" : String(line.newLine));
    appendCell(row, "code", line.text);
    body.appendChild(row);
  }
  details.appendChild(body);
  return details;
}

function splitRows(hunk: ParsedHunk) {
  const rows: Array<{ left: ParsedLine | null; right: ParsedLine | null }> = [];
  let index = 0;
  while (index < hunk.lines.length) {
    const line = hunk.lines[index];
    if (line.kind === "del") {
      const dels: ParsedLine[] = [];
      const adds: ParsedLine[] = [];
      while (index < hunk.lines.length && hunk.lines[index].kind === "del") {
        dels.push(hunk.lines[index]);
        index += 1;
      }
      while (index < hunk.lines.length && hunk.lines[index].kind === "add") {
        adds.push(hunk.lines[index]);
        index += 1;
      }
      const count = Math.max(dels.length, adds.length);
      for (let i = 0; i < count; i += 1) rows.push({ left: dels[i] || null, right: adds[i] || null });
      continue;
    }
    if (line.kind === "add") {
      rows.push({ left: null, right: line });
    } else {
      rows.push({ left: line, right: line });
    }
    index += 1;
  }
  return rows;
}

function splitHunk(hunk: ParsedHunk) {
  const details = document.createElement("details");
  details.className = "pocket-diff-hunk split";
  details.open = true;

  const summary = document.createElement("summary");
  summary.textContent = hunk.header;
  details.appendChild(summary);

  const body = document.createElement("div");
  body.className = "pocket-split-lines";
  for (const pair of splitRows(hunk)) {
    const row = document.createElement("div");
    row.className = "pocket-split-row";

    for (const [side, line] of [["left", pair.left], ["right", pair.right]] as const) {
      const cell = document.createElement("div");
      cell.className = "pocket-split-cell " + side + " " + (line?.kind || "empty");
      appendCell(cell, "num", line ? String(side === "left" ? line.oldLine ?? "" : line.newLine ?? "") : "");
      appendCell(cell, "code", line?.text || "");
      row.appendChild(cell);
    }
    body.appendChild(row);
  }
  details.appendChild(body);
  return details;
}

export function mountWorkspaceTools() {
  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.className = "pocket-git-trigger";
  trigger.textContent = "Git";
  trigger.setAttribute("aria-label", "Project Git status");

  const overlay = document.createElement("div");
  overlay.className = "pocket-git-overlay hidden";
  overlay.innerHTML = [
    '<section class="pocket-git-panel" role="dialog" aria-modal="true" aria-label="Project Git">',
    '  <header class="pocket-git-head">',
    '    <div><strong>Project Git</strong><small id="pocketGitProject">No project</small></div>',
    '    <button id="pocketGitClose" type="button" aria-label="Close">×</button>',
    '  </header>',
    '  <div id="pocketGitBody" class="pocket-git-body"></div>',
    '</section>'
  ].join("");

  document.body.append(trigger, overlay);

  const close = overlay.querySelector<HTMLButtonElement>("#pocketGitClose")!;
  const projectLabel = overlay.querySelector<HTMLElement>("#pocketGitProject")!;
  const body = overlay.querySelector<HTMLDivElement>("#pocketGitBody")!;

  let project: ProjectSummary | null = null;
  let status: GitStatus | null = null;
  let files: GitFile[] = [];
  let total = 0;
  let offset = 0;
  let selected: GitFile | null = null;
  let currentDiff: GitDiff | null = null;
  let view: "unified" | "split" = "unified";
  let wrap = localStorage.getItem("opencode-pocket-diff-wrap") !== "0";

  function showError(error: unknown) {
    body.replaceChildren();
    const card = document.createElement("div");
    card.className = "pocket-git-empty";
    card.textContent = error instanceof Error ? error.message : String(error);
    body.appendChild(card);
  }

  async function resolveProject() {
    const payload = await requestJson<{ projects?: ProjectSummary[] }>("/api/projects");
    const projects = (payload.projects || []).filter(item => item.available !== false);
    const saved = localStorage.getItem("opencode-pocket-project");
    project = projects.find(item => item.id === saved) || projects[0] || null;
    if (project && saved !== project.id) localStorage.setItem("opencode-pocket-project", project.id);
    projectLabel.textContent = project ? project.name + " · " + project.path : "No project";
  }

  function renderStatus(container: HTMLElement) {
    if (!status) return;
    const card = document.createElement("section");
    card.className = "pocket-git-status";
    if (!status.isGit) {
      card.textContent = "This project is not a Git repository.";
      container.appendChild(card);
      return;
    }

    const branch = document.createElement("strong");
    branch.textContent = status.branch || "unknown branch";
    const counts = document.createElement("div");
    counts.className = "pocket-git-counts";
    for (const [name, value] of [
      ["staged", status.staged],
      ["modified", status.modified],
      ["untracked", status.untracked],
      ["conflict", status.conflicts]
    ] as const) {
      const item = badge(name);
      item.append(" " + value);
      counts.appendChild(item);
    }
    const sync = document.createElement("small");
    sync.textContent =
      status.ahead === null || status.behind === null
        ? "No upstream tracking information"
        : "↑ " + status.ahead + "  ↓ " + status.behind + (status.upstream ? " · " + status.upstream : "");
    card.append(branch, counts, sync);
    container.appendChild(card);
  }

  async function loadPage(nextOffset = 0) {
    if (!project) return;
    offset = Math.max(0, nextOffset);
    const [statusPayload, filesPayload] = await Promise.all([
      requestJson<GitStatus>("/api/projects/" + encodeURIComponent(project.id) + "/git/status"),
      requestJson<GitFiles>(
        "/api/projects/" + encodeURIComponent(project.id) +
        "/git/files?limit=" + PAGE_SIZE + "&offset=" + offset
      )
    ]);
    status = statusPayload;
    files = filesPayload.files || [];
    total = filesPayload.total || 0;
    selected = null;
    currentDiff = null;
    renderList();
  }

  function pager() {
    const row = document.createElement("div");
    row.className = "pocket-git-pager";
    const prev = document.createElement("button");
    prev.type = "button";
    prev.textContent = "←";
    prev.disabled = offset <= 0;
    prev.addEventListener("click", () => void loadPage(Math.max(0, offset - PAGE_SIZE)));
    const label = document.createElement("span");
    label.textContent = total ? (offset + 1) + "–" + Math.min(total, offset + files.length) + " / " + total : "0 files";
    const next = document.createElement("button");
    next.type = "button";
    next.textContent = "→";
    next.disabled = offset + files.length >= total;
    next.addEventListener("click", () => void loadPage(offset + PAGE_SIZE));
    row.append(prev, label, next);
    return row;
  }

  function renderList() {
    body.replaceChildren();
    renderStatus(body);
    if (!status?.isGit) return;

    const list = document.createElement("section");
    list.className = "pocket-git-files";
    const title = document.createElement("div");
    title.className = "pocket-git-section-title";
    title.textContent = "Changed files";
    list.appendChild(title);

    if (!files.length) {
      const empty = document.createElement("div");
      empty.className = "pocket-git-empty";
      empty.textContent = "Working tree is clean.";
      list.appendChild(empty);
    }

    for (const file of files) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "pocket-git-file";
      const copy = document.createElement("span");
      copy.className = "pocket-git-file-copy";
      const name = document.createElement("strong");
      name.textContent = file.path;
      const meta = document.createElement("small");
      const counts = file.additions === null || file.deletions === null
        ? ""
        : "+" + file.additions + " −" + file.deletions;
      meta.textContent = counts || (file.binary ? "binary" : "changed");
      copy.append(name, meta);
      const badges = document.createElement("span");
      badges.className = "pocket-git-file-badges";
      for (const value of file.status) badges.appendChild(badge(value));
      button.append(copy, badges);
      button.addEventListener("click", () => void openDiff(file));
      list.appendChild(button);
    }

    list.appendChild(pager());
    body.appendChild(list);
  }

  async function openDiff(file: GitFile) {
    if (!project) return;
    selected = file;
    body.replaceChildren();
    const loading = document.createElement("div");
    loading.className = "pocket-git-empty";
    loading.textContent = "Loading diff…";
    body.appendChild(loading);

    try {
      currentDiff = await requestJson<GitDiff>(
        "/api/projects/" + encodeURIComponent(project.id) +
        "/git/diff?path=" + encodeURIComponent(file.path)
      );
      renderDiff();
    } catch (error) {
      showError(error);
    }
  }

  function renderDiff() {
    if (!selected || !currentDiff) return;
    body.replaceChildren();

    const toolbar = document.createElement("div");
    toolbar.className = "pocket-diff-toolbar";
    const back = document.createElement("button");
    back.type = "button";
    back.textContent = "← Files";
    back.addEventListener("click", renderList);

    const title = document.createElement("strong");
    title.textContent = selected.path;

    const mode = document.createElement("div");
    mode.className = "pocket-diff-mode";
    const unified = document.createElement("button");
    unified.type = "button";
    unified.textContent = "Unified";
    unified.classList.toggle("active", view === "unified");
    unified.addEventListener("click", () => {
      view = "unified";
      renderDiff();
    });
    const split = document.createElement("button");
    split.type = "button";
    split.textContent = "Split";
    split.classList.toggle("active", view === "split");
    split.addEventListener("click", () => {
      view = window.matchMedia("(max-width: 899px)").matches ? "unified" : "split";
      renderDiff();
    });
    mode.append(unified, split);

    const wrapLabel = document.createElement("label");
    wrapLabel.className = "pocket-diff-wrap-toggle";
    const wrapInput = document.createElement("input");
    wrapInput.type = "checkbox";
    wrapInput.checked = wrap;
    wrapInput.addEventListener("change", () => {
      wrap = wrapInput.checked;
      localStorage.setItem("opencode-pocket-diff-wrap", wrap ? "1" : "0");
      renderDiff();
    });
    wrapLabel.append(wrapInput, document.createTextNode("Wrap"));

    const copy = document.createElement("button");
    copy.type = "button";
    copy.textContent = "Copy";
    copy.addEventListener("click", () => void navigator.clipboard?.writeText(currentDiff?.diff || ""));

    toolbar.append(back, title, mode, wrapLabel, copy);
    body.appendChild(toolbar);

    if (currentDiff.truncated) {
      const note = document.createElement("div");
      note.className = "pocket-git-note";
      note.textContent = "Large diff bounded for mobile rendering.";
      body.appendChild(note);
    }

    const fileDetails = document.createElement("details");
    fileDetails.className = "pocket-diff-file";
    fileDetails.open = true;
    const fileSummary = document.createElement("summary");
    fileSummary.textContent = selected.path + " · collapse/expand file";
    fileDetails.appendChild(fileSummary);

    const viewer = document.createElement("div");
    viewer.className = "pocket-diff-viewer " + (wrap ? "wrap" : "nowrap");
    const hunks = parseUnifiedDiff(currentDiff.diff);
    if (!hunks.length) {
      const empty = document.createElement("div");
      empty.className = "pocket-git-empty";
      empty.textContent = selected.binary ? "Binary file changed." : "No textual diff available.";
      viewer.appendChild(empty);
    } else {
      const useSplit = view === "split" && !window.matchMedia("(max-width: 899px)").matches;
      for (const hunk of hunks) viewer.appendChild(useSplit ? splitHunk(hunk) : unifiedHunk(hunk));
    }
    fileDetails.appendChild(viewer);
    body.appendChild(fileDetails);
  }

  async function openPanel() {
    overlay.classList.remove("hidden");
    body.replaceChildren();
    const loading = document.createElement("div");
    loading.className = "pocket-git-empty";
    loading.textContent = "Loading project Git status…";
    body.appendChild(loading);
    try {
      await resolveProject();
      if (!project) {
        showError("Add or select a project first.");
        return;
      }
      await loadPage(0);
    } catch (error) {
      showError(error);
    }
  }

  function closePanel() {
    overlay.classList.add("hidden");
  }

  trigger.addEventListener("click", () => void openPanel());
  close.addEventListener("click", closePanel);
  overlay.addEventListener("click", event => {
    if (event.target === overlay) closePanel();
  });
  window.addEventListener("keydown", event => {
    if (event.key === "Escape" && !overlay.classList.contains("hidden")) closePanel();
  });

  return { open: openPanel, close: closePanel };
}
