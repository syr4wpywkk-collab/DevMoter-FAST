import "./knowledge.css";
import { renderChatMarkdown } from "./chat-markdown.mjs";
import { createDeviceGate, isDeviceAuthError, responseError } from "./device-gate.mjs";
import { formatDateTime, t, translateServerMessage } from "./i18n";
import {
  MAX_IMPORT_BYTES, MAX_TITLE_LENGTH, cleanTitle, decodeMarkdownFile, duplicateTitle, exportFileName,
  exportMarkdown, filterNotes, normalizeNote, sortNotes, type KnowledgeNote
} from "./knowledge-notes.mjs";
import { createSheetHeader } from "./sheet-header.mjs";

type Project = { id: string; name: string };
type View = "list" | "note" | "edit";
type ListState = "loading" | "ready" | "auth" | "error";

const NOTES_API = "/api/knowledge/notes";

function operationId() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

async function request(path: string, init: { method?: string; body?: unknown } = {}) {
  const method = init.method || "GET";
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(path, {
      method,
      cache: "no-store",
      credentials: "same-origin",
      signal: controller.signal,
      headers: method === "GET" ? undefined : { "content-type": "application/json", "x-pocket-operation-id": operationId() },
      body: init.body === undefined ? undefined : JSON.stringify(init.body)
    });
    const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
    if (!response.ok) {
      const raw = typeof payload.error === "string" ? payload.error : "";
      throw responseError(response.status, raw ? translateServerMessage(raw) : t("common.httpError", { status: response.status }));
    }
    return payload;
  } finally {
    window.clearTimeout(timeout);
  }
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = "", text = "") {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function button(label: string, className = "dm-know-button") {
  const node = el("button", className, label);
  node.type = "button";
  return node;
}

function errorText(error: unknown) {
  if (error instanceof DOMException && error.name === "AbortError") return t("knowledge.err.timeout");
  return error instanceof Error && error.message ? translateServerMessage(error.message) : t("knowledge.err.generic");
}

export function mountKnowledge() {
  if (document.querySelector("#devmoterKnowledge")) return;

  const root = el("div", "dm-know-root");
  root.id = "devmoterKnowledge";
  const modal = el("div", "dm-know-modal hidden");
  modal.setAttribute("role", "dialog");
  modal.setAttribute("aria-modal", "true");
  modal.setAttribute("aria-labelledby", "dmKnowledgeTitle");
  const sheet = el("section", "dm-know-sheet dm-sheet-frame");
  const body = el("div", "dm-know-scroll");
  const head = createSheetHeader(document, {
    title: t("knowledge.title"),
    titleId: "dmKnowledgeTitle",
    onClose: () => close(),
    primary: { label: t("knowledge.new"), onClick: () => startEdit(null) }
  });
  const status = el("p", "dm-know-status");
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  sheet.append(head.element, status, body);
  modal.append(sheet);
  root.append(modal);
  document.body.append(root);

  let opened = false;
  let lastFocus: HTMLElement | null = null;
  let view: View = "list";
  let listState: ListState = "loading";
  let listError = "";
  let notes: KnowledgeNote[] = [];
  let projects: Project[] = [];
  let query = "";
  let projectFilter = "";
  let current: KnowledgeNote | null = null;
  let draft: { id: string | null; title: string; content: string; projectId: string } | null = null;
  let confirmingDelete = false;
  let busy = false;
  let loadToken = 0;

  const projectName = (id: string | null) => projects.find(project => project.id === id)?.name || "";

  function say(message: string, isError = false) {
    status.textContent = message;
    status.dataset.state = message ? (isError ? "error" : "info") : "";
  }

  function upsertNote(note: KnowledgeNote) {
    notes = sortNotes([note, ...notes.filter(item => item.id !== note.id)]);
  }

  async function loadList() {
    const token = ++loadToken;
    listState = "loading";
    render();
    const [noteResult, projectResult] = await Promise.allSettled([request(NOTES_API), request("/api/projects")]);
    if (token !== loadToken) return;
    if (projectResult.status === "fulfilled") {
      const list = Array.isArray(projectResult.value.projects) ? projectResult.value.projects as Record<string, unknown>[] : [];
      projects = list
        .filter(project => project && typeof project.id === "string" && project.id)
        .map(project => ({ id: String(project.id), name: typeof project.name === "string" && project.name ? project.name : String(project.id) }));
    }
    if (noteResult.status === "fulfilled") {
      notes = sortNotes((Array.isArray(noteResult.value.notes) ? noteResult.value.notes : []).map(normalizeNote).filter(note => note.id));
      listState = "ready";
    } else {
      listState = isDeviceAuthError(noteResult.reason) ? "auth" : "error";
      listError = errorText(noteResult.reason);
    }
    render();
  }

  // One mutation at a time: a double tap must not create two notes.
  async function mutate<T>(task: () => Promise<T>): Promise<T | undefined> {
    if (busy) return undefined;
    busy = true;
    sheet.setAttribute("aria-busy", "true");
    say("");
    try {
      return await task();
    } catch (error) {
      say(errorText(error), true);
      return undefined;
    } finally {
      busy = false;
      sheet.removeAttribute("aria-busy");
    }
  }

  async function openNote(id: string) {
    const note = await mutate(async () => normalizeNote((await request(`${NOTES_API}/${encodeURIComponent(id)}`)).note));
    if (!note) return;
    current = note;
    confirmingDelete = false;
    view = "note";
    render();
  }

  function startEdit(note: KnowledgeNote | null, preset?: { title: string; content: string }) {
    if (listState !== "ready") return;
    draft = note
      ? { id: note.id, title: note.title, content: note.content, projectId: note.projectId || "" }
      : { id: null, title: preset?.title || "", content: preset?.content || "", projectId: projectFilter };
    say("");
    view = "edit";
    render();
  }

  async function saveDraft() {
    if (!draft) return;
    const title = cleanTitle(draft.title);
    if (!title) { say(t("knowledge.err.titleRequired"), true); return; }
    const payload = { title, content: draft.content, projectId: draft.projectId || null };
    const id = draft.id;
    // On failure the draft stays on screen untouched so nothing typed is lost.
    const saved = await mutate(async () => normalizeNote((id
      ? await request(`${NOTES_API}/${encodeURIComponent(id)}`, { method: "PATCH", body: payload })
      : await request(NOTES_API, { method: "POST", body: payload })).note));
    if (!saved) return;
    upsertNote(saved);
    current = saved;
    draft = null;
    view = "note";
    render();
    say(t("knowledge.saved"));
  }

  async function togglePin() {
    const note = current;
    if (!note) return;
    const saved = await mutate(async () => normalizeNote(
      (await request(`${NOTES_API}/${encodeURIComponent(note.id)}`, { method: "PATCH", body: { pinned: !note.pinned } })).note));
    if (!saved) return;
    upsertNote(saved);
    current = saved;
    render();
    say(t(saved.pinned ? "knowledge.pinnedDone" : "knowledge.unpinnedDone"));
  }

  async function duplicateNote() {
    const note = current;
    if (!note) return;
    const copy = await mutate(async () => normalizeNote((await request(NOTES_API, {
      method: "POST",
      body: { title: duplicateTitle(note.title, t("knowledge.copySuffix")), content: note.content, projectId: note.projectId }
    })).note));
    if (!copy) return;
    upsertNote(copy);
    current = copy;
    render();
    say(t("knowledge.duplicated"));
  }

  async function deleteNote() {
    const note = current;
    if (!note || !confirmingDelete) return;
    const removed = await mutate(async () => request(`${NOTES_API}/${encodeURIComponent(note.id)}`, { method: "DELETE" }));
    if (!removed) return;
    notes = notes.filter(item => item.id !== note.id);
    current = null;
    confirmingDelete = false;
    view = "list";
    render();
    say(t("knowledge.deleted"));
  }

  function exportNote() {
    if (!current) return;
    const blob = new Blob([exportMarkdown(current)], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = el("a");
    link.href = url;
    link.download = exportFileName(current.title, t("knowledge.exportFallbackName"));
    link.hidden = true;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    say(t("knowledge.exported", { name: link.download }));
  }

  async function importFile(file: File) {
    if (file.size > MAX_IMPORT_BYTES) { say(t("knowledge.err.importTooLarge"), true); return; }
    let result;
    try { result = decodeMarkdownFile(new Uint8Array(await file.arrayBuffer()), file.name); }
    catch { say(t("knowledge.err.importRead"), true); return; }
    if (!result.ok) {
      say(t(result.reason === "tooLarge" ? "knowledge.err.importTooLarge" : result.reason === "notUtf8" ? "knowledge.err.importNotUtf8" : "knowledge.err.importNotText"), true);
      return;
    }
    const imported = result;
    // Always POST: an import creates a new note and can never overwrite one.
    const created = await mutate(async () => normalizeNote((await request(NOTES_API, {
      method: "POST",
      body: { title: imported.title || t("knowledge.untitled"), content: imported.content, projectId: projectFilter || null }
    })).note));
    if (!created) return;
    upsertNote(created);
    current = created;
    view = "note";
    render();
    say(t("knowledge.imported"));
  }

  function projectSelect(value: string, emptyLabel: string, label: string) {
    const select = el("select", "dm-know-select");
    select.setAttribute("aria-label", label);
    const none = el("option", "", emptyLabel);
    none.value = "";
    select.append(none);
    for (const project of projects) {
      const option = el("option", "", project.name);
      option.value = project.id;
      select.append(option);
    }
    select.value = projects.some(project => project.id === value) ? value : "";
    return select;
  }

  function meta(note: KnowledgeNote) {
    const parts = [];
    if (note.pinned) parts.push(t("knowledge.pinned"));
    const name = projectName(note.projectId);
    if (name) parts.push(name);
    const updated = note.updatedAt ? formatDateTime(note.updatedAt, { dateStyle: "medium", timeStyle: "short" }) : "";
    if (updated) parts.push(t("knowledge.updatedAt", { time: updated }));
    return parts.join(" / ");
  }

  function renderResults(container: HTMLElement) {
    container.replaceChildren();
    const visible = filterNotes(notes, { query, projectId: projectFilter });
    if (!notes.length) {
      const empty = el("div", "dm-know-empty");
      const create = button(t("knowledge.new"));
      create.dataset.knowEmptyNew = "";
      create.addEventListener("click", () => startEdit(null));
      empty.append(el("strong", "", t("knowledge.empty.title")), el("p", "", t("knowledge.empty.copy")), create);
      container.append(empty);
      return;
    }
    if (!visible.length) {
      const empty = el("div", "dm-know-empty");
      empty.dataset.knowNoResults = "";
      const clear = button(t("knowledge.clearFilters"));
      clear.addEventListener("click", () => { query = ""; projectFilter = ""; render(); });
      empty.append(el("strong", "", t("knowledge.noResults.title")), el("p", "", t("knowledge.noResults.copy")), clear);
      container.append(empty);
      return;
    }
    const list = el("ul", "dm-know-list");
    for (const note of visible) {
      const item = el("li");
      const open = button("", "dm-know-row");
      open.dataset.knowNote = note.id;
      if (note.pinned) open.dataset.pinned = "true";
      open.append(el("strong", "", note.title), el("small", "", meta(note)));
      open.addEventListener("click", () => void openNote(note.id));
      item.append(open);
      list.append(item);
    }
    container.append(list);
  }

  function renderList() {
    head.setTitle(t("knowledge.title"));
    head.setPrimary(listState === "ready" ? { label: t("knowledge.new"), onClick: () => startEdit(null) } : null);
    if (listState === "loading") { body.append(el("p", "dm-know-loading", t("common.loading"))); return; }
    if (listState === "auth") {
      // An untrusted device is "not connected", which is different from "no notes yet".
      const gate = createDeviceGate(document, { onRegister: () => close(false) });
      gate.dataset.knowAuth = "";
      body.append(gate);
      return;
    }
    if (listState === "error") {
      const box = el("div", "dm-know-empty");
      box.dataset.knowError = "";
      const retry = button(t("common.retry"));
      retry.addEventListener("click", () => void loadList());
      box.append(el("strong", "", t("knowledge.err.load")), el("p", "", listError), retry);
      body.append(box);
      return;
    }
    const tools = el("div", "dm-know-tools");
    const search = el("input", "dm-know-search");
    search.type = "search";
    search.value = query;
    search.placeholder = t("knowledge.searchPlaceholder");
    search.setAttribute("aria-label", t("knowledge.searchPlaceholder"));
    const results = el("div", "dm-know-results");
    search.addEventListener("input", () => { query = search.value; renderResults(results); });
    const filter = projectSelect(projectFilter, t("knowledge.allProjects"), t("knowledge.filterProject"));
    filter.dataset.knowProjectFilter = "";
    filter.addEventListener("change", () => { projectFilter = filter.value; renderResults(results); });
    const picker = el("input");
    picker.type = "file";
    picker.accept = ".md,.markdown,.txt,text/markdown,text/plain";
    picker.hidden = true;
    picker.dataset.knowImportInput = "";
    picker.addEventListener("change", () => {
      const file = picker.files?.[0];
      picker.value = "";
      if (file) void importFile(file);
    });
    const importButton = button(t("knowledge.import"));
    importButton.dataset.knowImport = "";
    importButton.addEventListener("click", () => picker.click());
    tools.append(search, filter, importButton, picker);
    body.append(tools, results);
    renderResults(results);
  }

  function renderNote() {
    const note = current;
    if (!note) { view = "list"; renderList(); return; }
    head.setTitle(t("knowledge.title"));
    head.setPrimary({ label: t("common.edit"), onClick: () => startEdit(note) });
    const back = button(t("knowledge.backToList"), "dm-know-back");
    back.addEventListener("click", () => { current = null; view = "list"; say(""); render(); });
    const title = el("h3", "dm-know-note-title", note.title);
    const info = el("p", "dm-know-note-meta", meta(note));
    const content = el("div", "dm-know-content");
    if (note.content.trim()) renderChatMarkdown(content, note.content, value => void navigator.clipboard?.writeText(value));
    else content.append(el("p", "dm-know-muted", t("knowledge.emptyBody")));

    const actions = el("div", "dm-know-actions");
    const pin = button(t(note.pinned ? "knowledge.unpin" : "knowledge.pin"));
    pin.dataset.knowPin = "";
    pin.setAttribute("aria-pressed", String(note.pinned));
    pin.addEventListener("click", () => void togglePin());
    const copy = button(t("knowledge.duplicate"));
    copy.dataset.knowDuplicate = "";
    copy.addEventListener("click", () => void duplicateNote());
    const save = button(t("knowledge.export"));
    save.dataset.knowExport = "";
    save.addEventListener("click", exportNote);
    const remove = button(t("common.delete"), "dm-know-button dm-know-danger");
    remove.dataset.knowDelete = "";
    remove.addEventListener("click", () => { confirmingDelete = true; say(""); render(); });
    actions.append(pin, copy, save, remove);
    body.append(back, title, info, actions);

    if (confirmingDelete) {
      const confirm = el("div", "dm-know-confirm");
      confirm.setAttribute("role", "alertdialog");
      confirm.setAttribute("aria-label", t("knowledge.deleteConfirm.title"));
      const cancel = button(t("common.cancel"));
      cancel.dataset.knowDeleteCancel = "";
      cancel.addEventListener("click", () => { confirmingDelete = false; render(); });
      const ok = button(t("knowledge.deleteConfirm.ok"), "dm-know-button dm-know-danger");
      ok.dataset.knowDeleteConfirm = "";
      ok.addEventListener("click", () => void deleteNote());
      const row = el("div", "dm-know-confirm-actions");
      row.append(cancel, ok);
      confirm.append(el("strong", "", t("knowledge.deleteConfirm.title")), el("p", "", t("knowledge.deleteConfirm.copy", { title: note.title })), row);
      body.append(confirm);
      window.requestAnimationFrame(() => cancel.focus({ preventScroll: true }));
    }
    body.append(content);
  }

  function renderEdit() {
    const state = draft;
    if (!state) { view = "list"; renderList(); return; }
    head.setTitle(t(state.id ? "knowledge.editTitle" : "knowledge.newTitle"));
    head.setPrimary({ label: t("common.save"), onClick: () => void saveDraft() });
    const form = el("form", "dm-know-form");
    form.addEventListener("submit", event => { event.preventDefault(); void saveDraft(); });
    const titleLabel = el("label", "dm-know-field");
    const title = el("input");
    title.type = "text";
    title.name = "title";
    title.maxLength = MAX_TITLE_LENGTH;
    title.required = true;
    title.value = state.title;
    title.addEventListener("input", () => { state.title = title.value; });
    titleLabel.append(el("span", "", t("knowledge.field.title")), title);
    const projectLabel = el("label", "dm-know-field");
    const project = projectSelect(state.projectId, t("knowledge.noProject"), t("knowledge.field.project"));
    project.name = "projectId";
    project.addEventListener("change", () => { state.projectId = project.value; });
    projectLabel.append(el("span", "", t("knowledge.field.project")), project);
    const contentLabel = el("label", "dm-know-field dm-know-field-body");
    const content = el("textarea");
    content.name = "content";
    content.value = state.content;
    content.spellcheck = false;
    content.addEventListener("input", () => { state.content = content.value; });
    contentLabel.append(el("span", "", t("knowledge.field.content")), content);
    const actions = el("div", "dm-know-form-actions");
    const cancel = button(t("common.cancel"));
    cancel.dataset.knowEditCancel = "";
    cancel.addEventListener("click", () => { draft = null; view = current ? "note" : "list"; say(""); render(); });
    const save = button(t("common.save"), "dm-know-button dm-know-primary");
    save.type = "submit";
    save.dataset.knowSave = "";
    actions.append(cancel, save);
    form.append(titleLabel, projectLabel, contentLabel, actions);
    body.append(form);
    if (!state.id && !state.title) window.requestAnimationFrame(() => title.focus({ preventScroll: true }));
  }

  function render() {
    body.replaceChildren();
    sheet.dataset.view = view;
    if (view === "note") renderNote();
    else if (view === "edit") renderEdit();
    else renderList();
  }

  function open() {
    if (!opened) {
      opened = true;
      lastFocus = document.activeElement as HTMLElement | null;
      modal.classList.remove("hidden");
      document.body.classList.add("dm-know-open");
      window.requestAnimationFrame(() => head.closeButton.focus({ preventScroll: true }));
    }
    if (view !== "edit") {
      view = "list";
      current = null;
      say("");
      void loadList();
    }
  }

  function close(restoreFocus = true) {
    if (!opened) return;
    opened = false;
    loadToken++;
    modal.classList.add("hidden");
    document.body.classList.remove("dm-know-open");
    if (restoreFocus) lastFocus?.focus?.();
  }

  window.addEventListener("devmoter:open-knowledge", open);
  window.addEventListener("devmoter:surface-changed", () => close(false));
  document.addEventListener("keydown", event => {
    if (!opened || event.key !== "Escape") return;
    if (confirmingDelete) { confirmingDelete = false; render(); }
    else close();
  });
}
