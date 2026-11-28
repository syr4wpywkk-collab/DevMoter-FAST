import { formatNumber, t, translateServerMessage } from "./i18n";
import { fetchReadWithTimeout } from "./fetch-with-timeout.mjs";

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
const esc = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

async function requestJson<T>(url: string): Promise<T> {
  const res = await fetchReadWithTimeout((input, request) => fetch(input, request), url, { cache: "no-store" }, () => new Error(t("common.requestTimeout")));
  const text = await res.text();
  let payload: any = {};
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(t("workspaceTools.invalidJson"));
  }
  if (!res.ok) throw new Error(translateServerMessage(payload?.error) || t("common.httpError", { status: res.status }));
  return payload as T;
}

function badge(key: string, label = key) {
  const span = document.createElement("span");
  span.className = "pocket-git-badge " + key;
  span.textContent = label;
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
      current = { header: t("workspaceTools.fileHeader"), lines: [] };
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

function appendDiffCode(row: HTMLElement, line: ParsedLine) {
  const code = appendCell(row, "code", line.text);
  if (line.kind === "add" || line.kind === "del") {
    const marker = document.createElement("span");
    marker.className = "pocket-diff-marker";
    marker.textContent = line.kind === "add" ? "+ " : "− ";
    marker.setAttribute("aria-hidden", "true");
    code.prepend(marker);
    row.setAttribute("aria-label", t(line.kind === "add" ? "workspaceTools.addedLineAria" : "workspaceTools.deletedLineAria", { text: line.text }));
  }
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
    appendDiffCode(row, line);
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
      if (line) appendDiffCode(cell, line);
      else appendCell(cell, "code", "");
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
  trigger.textContent = t("workspaceTools.triggerLabel");
  trigger.setAttribute("aria-label", t("workspaceTools.triggerAria"));

  const overlay = document.createElement("div");
  overlay.className = "pocket-git-overlay hidden";
  overlay.innerHTML = [
    `<section class="pocket-git-panel" role="dialog" aria-modal="true" aria-label="${esc(t("workspaceTools.dialogTitle"))}">`,
    '  <header class="pocket-git-head">',
    `    <div><strong>${esc(t("workspaceTools.dialogTitle"))}</strong><small id="pocketGitProject">${esc(t("workspaceTools.noProject"))}</small></div>`,
    `    <button id="pocketGitClose" type="button" aria-label="${esc(t("common.close"))}">×</button>`,
    '  </header>',
    '  <div id="pocketGitBody" class="pocket-git-body"></div>',
    '</section>'
  ].join("");

  document.body.append(trigger, overlay);

  const close = overlay.querySelector<HTMLButtonElement>("#pocketGitClose")!;
  const projectLabel = overlay.querySelector<HTMLElement>("#pocketGitProject")!;
  const body = overlay.querySelector<HTMLDivElement>("#pocketGitBody")!;

  let returnFocus: HTMLElement | null = null;
  let previousOverflow = "";
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
    card.textContent = translateServerMessage(error instanceof Error ? error.message : String(error));
    const retry = document.createElement("button");
    retry.type = "button";
    retry.textContent = t("workspaceTools.retryStatus");
    retry.addEventListener("click", () => void openPanel());
    card.appendChild(retry);
    body.appendChild(card);
  }

  async function resolveProject() {
    const payload = await requestJson<{ projects?: ProjectSummary[] }>("/api/projects");
    const projects = (payload.projects || []).filter(item => item.available !== false);
    const saved = localStorage.getItem("opencode-pocket-project");
    project = projects.find(item => item.id === saved) || projects[0] || null;
    if (project && saved !== project.id) localStorage.setItem("opencode-pocket-project", project.id);
    projectLabel.textContent = project ? project.name + " · " + project.path : t("workspaceTools.noProject");
  }

  function renderStatus(container: HTMLElement) {
    if (!status) return;
    const card = document.createElement("section");
    card.className = "pocket-git-status";
    if (!status.isGit) {
      card.textContent = t("workspaceTools.notGitRepo");
      container.appendChild(card);
      return;
    }

    const branch = document.createElement("strong");
    branch.textContent = status.branch || t("workspaceTools.unknownBranch");
    const counts = document.createElement("div");
    counts.className = "pocket-git-counts";
    for (const [name, value] of [
      ["staged", status.staged],
      ["modified", status.modified],
      ["untracked", status.untracked],
      ["conflict", status.conflicts]
    ] as const) {
      const item = badge(name, t(`workspaceTools.badge.${name}`));
      item.append(" " + formatNumber(value));
      counts.appendChild(item);
    }
    const sync = document.createElement("small");
    sync.textContent =
      status.ahead === null || status.behind === null
        ? t("workspaceTools.noUpstream")
        : "↑ " + formatNumber(status.ahead) + "  ↓ " + formatNumber(status.behind) + (status.upstream ? " · " + status.upstream : "");
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
    label.textContent = total ? formatNumber(offset + 1) + "–" + formatNumber(Math.min(total, offset + files.length)) + " / " + formatNumber(total) : t("workspaceTools.pagerZero");
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
    title.textContent = t("workspaceTools.changedFiles");
    list.appendChild(title);

    if (!files.length) {
      const empty = document.createElement("div");
      empty.className = "pocket-git-empty";
      empty.textContent = t("workspaceTools.cleanTree");
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
      const fallbackMeta = file.binary
        ? "workspaceTools.fileMeta.binary"
        : file.status.includes("untracked") ? "workspaceTools.fileMeta.untracked" : "workspaceTools.fileMeta.changed";
      meta.textContent = counts || t(fallbackMeta);
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
    loading.textContent = t("workspaceTools.loadingDiff");
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
    back.textContent = t("workspaceTools.backToFiles");
    back.addEventListener("click", renderList);

    const title = document.createElement("strong");
    title.textContent = selected.path;

    const mode = document.createElement("div");
    mode.className = "pocket-diff-mode";
    const unified = document.createElement("button");
    unified.type = "button";
    unified.textContent = t("workspaceTools.view.unified");
    unified.classList.toggle("active", view === "unified");
    unified.addEventListener("click", () => {
      view = "unified";
      renderDiff();
    });
    const split = document.createElement("button");
    split.type = "button";
    split.textContent = t("workspaceTools.view.split");
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
    wrapLabel.append(wrapInput, document.createTextNode(t("workspaceTools.wrap")));

    const copy = document.createElement("button");
    copy.type = "button";
    copy.textContent = t("common.copy");
    copy.addEventListener("click", () => void navigator.clipboard?.writeText(currentDiff?.diff || ""));

    toolbar.append(back, title, mode, wrapLabel, copy);
    body.appendChild(toolbar);

    if (currentDiff.truncated) {
      const note = document.createElement("div");
      note.className = "pocket-git-note";
      note.textContent = t("workspaceTools.diffTruncated");
      body.appendChild(note);
    }

    const fileDetails = document.createElement("details");
    fileDetails.className = "pocket-diff-file";
    fileDetails.open = true;
    const fileSummary = document.createElement("summary");
    fileSummary.textContent = t("workspaceTools.collapseExpandFile", { path: selected.path });
    fileDetails.appendChild(fileSummary);

    const viewer = document.createElement("div");
    viewer.className = "pocket-diff-viewer " + (wrap ? "wrap" : "nowrap");
    const hunks = parseUnifiedDiff(currentDiff.diff);
    if (!hunks.length) {
      const empty = document.createElement("div");
      empty.className = "pocket-git-empty";
      empty.textContent = selected.binary ? t("workspaceTools.binaryChanged") : t("workspaceTools.noTextDiff");
      viewer.appendChild(empty);
    } else {
      const useSplit = view === "split" && !window.matchMedia("(max-width: 899px)").matches;
      for (const hunk of hunks) viewer.appendChild(useSplit ? splitHunk(hunk) : unifiedHunk(hunk));
    }
    fileDetails.appendChild(viewer);
    body.appendChild(fileDetails);
  }

  async function openPanel() {
    if (overlay.classList.contains("hidden")) {
      returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      previousOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
    }
    overlay.classList.remove("hidden");
    close.focus({ preventScroll: true });
    body.replaceChildren();
    const loading = document.createElement("div");
    loading.className = "pocket-git-empty";
    loading.textContent = t("workspaceTools.loadingStatus");
    body.appendChild(loading);
    try {
      await resolveProject();
      if (!project) {
        showError(t("workspaceTools.addProjectFirst"));
        return;
      }
      await loadPage(0);
    } catch (error) {
      showError(error);
    }
  }

  function closePanel() {
    if (overlay.classList.contains("hidden")) return;
    overlay.classList.add("hidden");
    document.body.style.overflow = previousOverflow;
    if (returnFocus?.isConnected && !returnFocus.closest(".hidden, [hidden]")) returnFocus.focus({ preventScroll: true });
  }

  trigger.addEventListener("click", () => void openPanel());
  close.addEventListener("click", closePanel);
  overlay.addEventListener("click", event => {
    if (event.target === overlay) closePanel();
  });
  window.addEventListener("keydown", event => {
    if (event.key === "Escape" && !overlay.classList.contains("hidden")) closePanel();
  });
  window.addEventListener("devmoter:surface-changed", closePanel);

  return { open: openPanel, close: closePanel };
}
