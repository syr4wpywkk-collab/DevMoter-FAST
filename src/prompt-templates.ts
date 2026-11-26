import "./prompt-templates.css";
import { createSheetHeader } from "./sheet-header.mjs";
import { t, translateServerMessage } from "./i18n";
import { apiErrorMessage } from "./api-error.mjs";
import { createDeviceGate, isDeviceAuthError, responseError } from "./device-gate.mjs";
import {
  draftNeedsConfirmation,
  expandTemplate,
  extractVariables,
  mergeIntoDraft,
  searchTemplates,
  templatesForScope,
  type PromptTemplate
} from "./prompt-template-core.mjs";

type Project = { id: string; name?: string; path?: string };
type ImportResult = { imported: number; overwritten: number; skipped: Array<{ id: string; name: string; reason: string }> };

const DEVICE_TOKEN_KEY = "devmoter-device-token";
const PROJECT_KEY = "opencode-pocket-project";
// Conversation composers, in the order the chat surfaces declare them.
const COMPOSER_SELECTORS = ["#cxPromptInput", "#ocxPromptInput", "#apiPrompt", "[data-qwen-input]"];

function operationId() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const method = String(init.method || "GET").toUpperCase();
  const headers = new Headers(init.headers || {});
  if (init.body) headers.set("content-type", "application/json");
  if (method !== "GET") headers.set("x-pocket-operation-id", operationId());
  const deviceToken = localStorage.getItem(DEVICE_TOKEN_KEY);
  if (deviceToken) headers.set("x-devmoter-device-token", deviceToken);
  const res = await fetch(path, { ...init, headers, cache: method === "GET" ? "no-store" : undefined });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) throw responseError(res.status, apiErrorMessage(payload, res.status));
  return payload as T;
}

/** The composer of the chat surface the user is looking at, if any. */
export function findActiveComposer(doc: Document = document): HTMLTextAreaElement | null {
  for (const selector of COMPOSER_SELECTORS) {
    const input = doc.querySelector<HTMLTextAreaElement>(selector);
    if (input && !input.disabled && !input.readOnly && input.getClientRects().length > 0) return input;
  }
  return null;
}

/** Puts text in the composer and tells it the value changed. Never submits. */
export function writeComposerDraft(input: HTMLTextAreaElement, text: string) {
  input.value = text;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.focus({ preventScroll: true });
  input.setSelectionRange(text.length, text.length);
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = "", text = ""): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function button(label: string, onClick: () => void, className = "") {
  const node = el("button", className, label);
  node.type = "button";
  node.addEventListener("click", onClick);
  return node;
}

function field(label: string, control: HTMLElement) {
  const wrap = el("label", "pt-field");
  wrap.append(el("span", "", label), control);
  return wrap;
}

let panel: HTMLElement | null = null;

export function openPromptTemplates() {
  if (panel) { panel.classList.remove("hidden"); return; }

  let templates: PromptTemplate[] = [];
  let projects: Project[] = [];
  let scope = "";
  let query = "";
  let returnFocus: HTMLElement | null = document.activeElement instanceof HTMLElement ? document.activeElement : null;

  const sheet = el("section", "pt-panel dm-sheet-frame");
  panel = sheet;
  sheet.setAttribute("role", "dialog");
  sheet.setAttribute("aria-labelledby", "ptTitle");
  const head = createSheetHeader(document, { title: t("promptTemplates.title"), titleId: "ptTitle", onClose: close });
  const status = el("p", "pt-status");
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  const body = el("div", "pt-body");
  sheet.append(head.element, status, body);
  document.body.append(sheet);

  function close() {
    sheet.remove();
    panel = null;
    document.removeEventListener("keydown", onKeydown, true);
    if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
    returnFocus = null;
  }
  function onKeydown(event: KeyboardEvent) {
    // Settings opened over the sheet (to register this device) handles its own Esc;
    // capture runs before Settings closes, so that Esc never also closes this sheet.
    if (document.body.classList.contains("devmoter-settings-open")) return;
    if (event.key === "Escape" && panel) close();
  }
  document.addEventListener("keydown", onKeydown, true);

  function say(message: string, kind: "info" | "error" = "info") {
    status.parentElement?.querySelector(".pt-inline-gate")?.remove();
    status.textContent = message;
    status.dataset.kind = kind;
  }
  // An unregistered browser gets the shared Trusted device gate, as in Knowledge.
  // `keepForm` leaves an open editor in place so an unsaved draft is not lost; its gate
  // opens Trusted devices over the sheet without closing it.
  function report(error: unknown, keepForm = false) {
    if (isDeviceAuthError(error) && !keepForm) {
      say("");
      body.replaceChildren(createDeviceGate(document, { error, onRegister: close }));
      return;
    }
    say(error instanceof Error ? error.message : String(error), "error");
    if (isDeviceAuthError(error)) status.after(createDeviceGate(document, { error, compact: true, className: "pt-inline-gate" }));
  }
  function projectLabel(id: string | null) {
    if (!id) return t("promptTemplates.scopeGlobal");
    const project = projects.find(item => item.id === id);
    return project ? project.name || project.path || id : t("promptTemplates.scopeUnregistered", { id });
  }
  // `unregistered` are project ids to offer although the project is gone: every such id in
  // the list filter, only the template's own in the editor, since nothing new can be saved there.
  function scopeSelect(selected: string, id: string, unregistered: Array<string | null>) {
    const select = el("select");
    select.id = id;
    const ids = projects.map(item => item.id);
    for (const projectId of unregistered) if (projectId && !ids.includes(projectId)) ids.push(projectId);
    const options: Array<[string, string]> = [["", t("promptTemplates.scopeGlobal")], ...ids.map(id => [id, projectLabel(id)] as [string, string])];
    for (const [value, label] of options) {
      const option = el("option", "", label);
      option.value = value;
      select.append(option);
    }
    select.value = options.some(([value]) => value === selected) ? selected : "";
    return select;
  }

  async function reload() {
    templates = (await api<{ templates: PromptTemplate[] }>("/api/prompt-templates?scope=all")).templates;
  }

  function showList() {
    head.setTitle(t("promptTemplates.title"));
    body.replaceChildren();

    const toolbar = el("div", "pt-toolbar");
    const scopeControl = scopeSelect(scope, "ptScope", templates.map(item => item.projectId));
    scopeControl.addEventListener("change", () => { scope = scopeControl.value; renderItems(); });
    const search = el("input");
    search.type = "search";
    search.id = "ptSearch";
    search.value = query;
    search.placeholder = t("promptTemplates.searchPlaceholder");
    search.addEventListener("input", () => { query = search.value; renderItems(); });
    toolbar.append(field(t("promptTemplates.scopeLabel"), scopeControl), field(t("common.search"), search));

    const list = el("ul", "pt-list");
    const empty = el("p", "pt-empty");

    function renderItems() {
      const inScope = templatesForScope(templates, scope || null);
      const visible = searchTemplates(inScope, query);
      list.replaceChildren();
      empty.textContent = visible.length ? "" : inScope.length ? t("promptTemplates.noResults") : t("promptTemplates.empty");
      empty.hidden = visible.length > 0;
      for (const template of visible) {
        const item = el("li", "pt-item");
        const text = el("div", "pt-item-text");
        text.append(el("strong", "", template.name));
        if (template.description) text.append(el("span", "pt-item-description", template.description));
        text.append(el("span", "pt-item-scope", projectLabel(template.projectId)));
        const actions = el("div", "pt-item-actions");
        actions.append(
          button(t("promptTemplates.use"), () => showUse(template), "pt-primary"),
          button(t("common.edit"), () => showEditor(template)),
          button(t("common.delete"), () => void remove(template), "pt-danger")
        );
        item.append(text, actions);
        list.append(item);
      }
    }

    const fileInput = el("input");
    fileInput.type = "file";
    fileInput.accept = "application/json,.json";
    fileInput.hidden = true;
    fileInput.addEventListener("change", () => {
      const file = fileInput.files?.[0];
      fileInput.value = "";
      if (file) void restore(file);
    });
    const footer = el("div", "pt-footer");
    footer.append(
      button(t("promptTemplates.new"), () => showEditor(null), "pt-primary"),
      button(t("promptTemplates.backup"), () => void backup()),
      button(t("promptTemplates.restore"), () => fileInput.click()),
      fileInput
    );

    body.append(toolbar, list, empty, footer);
    renderItems();
  }

  async function remove(template: PromptTemplate) {
    if (!window.confirm(t("promptTemplates.deleteConfirm", { name: template.name }))) return;
    try {
      await api(`/api/prompt-templates/${encodeURIComponent(template.id)}`, { method: "DELETE" });
      await reload();
      say(t("promptTemplates.deleted", { name: template.name }));
      showList();
    } catch (error) { report(error); }
  }

  function showEditor(template: PromptTemplate | null) {
    head.setTitle(template ? t("promptTemplates.editTitle") : t("promptTemplates.newTitle"));
    body.replaceChildren();
    const form = el("form", "pt-form");
    const name = el("input");
    name.id = "ptName";
    name.maxLength = 120;
    name.required = true;
    name.value = template?.name ?? "";
    const description = el("input");
    description.id = "ptDescription";
    description.maxLength = 500;
    description.value = template?.description ?? "";
    const text = el("textarea");
    text.id = "ptBody";
    text.rows = 8;
    text.required = true;
    text.value = template?.body ?? "";
    const scopeControl = scopeSelect(template ? template.projectId ?? "" : scope, "ptEditScope", [template?.projectId ?? null]);
    const save = el("button", "pt-primary", t("common.save"));
    save.type = "submit";
    const actions = el("div", "pt-footer");
    actions.append(save, button(t("common.cancel"), showList));
    form.append(
      field(t("promptTemplates.nameLabel"), name),
      field(t("promptTemplates.descriptionLabel"), description),
      field(t("promptTemplates.bodyLabel"), text),
      el("p", "pt-hint", t("promptTemplates.variableHint", { example: "{{name}}" })),
      field(t("promptTemplates.scopeLabel"), scopeControl),
      actions
    );
    form.addEventListener("submit", event => {
      event.preventDefault();
      save.disabled = true;
      const projectId = scopeControl.value || null;
      const fields: Record<string, string | null> = { name: name.value, description: description.value, body: text.value };
      // An unchanged scope is not re-sent, so a template of an unregistered project can still be edited.
      if (!template || projectId !== (template.projectId || null)) fields.projectId = projectId;
      const payload = JSON.stringify(fields);
      const request = template
        ? api(`/api/prompt-templates/${encodeURIComponent(template.id)}`, { method: "PATCH", body: payload })
        : api("/api/prompt-templates", { method: "POST", body: payload });
      void request.then(reload).then(() => {
        scope = scopeControl.value;
        say(t("common.saved"));
        showList();
      }).catch(error => { save.disabled = false; report(error, true); });
    });
    body.append(form);
    name.focus();
  }

  // Expanding only builds text in this sheet: the stored template is not
  // changed and nothing reaches a conversation until Copy or Insert is pressed.
  function showUse(template: PromptTemplate) {
    head.setTitle(template.name);
    body.replaceChildren();
    const values: Record<string, string> = Object.create(null);
    const variables = extractVariables(template.body);
    const inputs = el("div", "pt-variables");
    const missing = el("p", "pt-missing");
    missing.setAttribute("role", "status");
    const preview = el("pre", "pt-preview");
    preview.id = "ptPreview";
    preview.tabIndex = 0;
    preview.setAttribute("aria-label", t("promptTemplates.previewLabel"));
    const choice = el("div", "pt-choice");
    choice.hidden = true;
    const copy = button(t("common.copy"), () => {
      navigator.clipboard.writeText(current().text).then(() => say(t("common.copied")), () => say(t("common.copyFailed"), "error"));
    });
    const insert = button(t("promptTemplates.insert"), startInsert, "pt-primary");

    function current() { return expandTemplate(template.body, values); }
    function refresh() {
      const result = current();
      preview.textContent = result.text;
      missing.textContent = result.missing.length ? t("promptTemplates.missingVariables", { names: result.missing.join(", ") }) : "";
      missing.hidden = result.missing.length === 0;
      copy.disabled = insert.disabled = result.missing.length > 0;
      choice.hidden = true;
      for (const input of inputs.querySelectorAll<HTMLInputElement>("textarea")) {
        input.setAttribute("aria-invalid", String(result.missing.includes(input.dataset.variable || "")));
      }
    }
    function finishInsert(composer: HTMLTextAreaElement, mode: "replace" | "append") {
      writeComposerDraft(composer, mergeIntoDraft(composer.value, current().text, mode));
      returnFocus = composer;
      close();
    }
    function startInsert() {
      const result = current();
      if (result.missing.length) return;
      const composer = findActiveComposer();
      if (!composer) { say(t("promptTemplates.noComposer"), "error"); return; }
      say("");
      if (!draftNeedsConfirmation(composer.value)) { finishInsert(composer, "replace"); return; }
      choice.replaceChildren(
        el("p", "", t("promptTemplates.draftExists")),
        button(t("promptTemplates.appendToDraft"), () => finishInsert(composer, "append"), "pt-primary"),
        button(t("promptTemplates.replaceDraft"), () => finishInsert(composer, "replace"), "pt-danger"),
        button(t("common.cancel"), () => { choice.hidden = true; })
      );
      choice.hidden = false;
      choice.querySelector("button")?.focus();
    }

    for (const variable of variables) {
      const input = el("textarea");
      input.rows = 1;
      input.dataset.variable = variable;
      input.addEventListener("input", () => { values[variable] = input.value; refresh(); });
      inputs.append(field(variable, input));
    }
    const actions = el("div", "pt-footer");
    actions.append(insert, copy, button(t("common.back"), showList));
    body.append(inputs, missing, el("h3", "pt-preview-title", t("promptTemplates.previewLabel")), preview, el("p", "pt-hint", t("promptTemplates.notSentHint")), choice, actions);
    refresh();
    (inputs.querySelector("textarea") ?? insert).focus();
  }

  async function backup() {
    try {
      const document_ = await api<{ templates: PromptTemplate[] }>("/api/prompt-templates/export");
      const url = URL.createObjectURL(new Blob([JSON.stringify(document_, null, 2)], { type: "application/json" }));
      const link = el("a");
      link.href = url;
      link.download = `devmoter-prompt-templates-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      say(t("promptTemplates.backupDone", { count: document_.templates.length }));
    } catch (error) { report(error); }
  }

  async function restore(file: File) {
    try {
      let parsed: unknown;
      try { parsed = JSON.parse(await file.text()); } catch { throw new Error(t("promptTemplates.restoreInvalid")); }
      const send = (conflict: "skip" | "overwrite") =>
        api<ImportResult>("/api/prompt-templates/import", { method: "POST", body: JSON.stringify({ backup: parsed, conflict }) });
      let result = await send("skip");
      const existing = result.skipped.filter(item => item.reason === "exists").length;
      if (existing && window.confirm(t("promptTemplates.restoreOverwriteConfirm", { count: existing }))) {
        const imported = result.imported;
        result = await send("overwrite");
        // The second pass also rewrites what the first pass just imported.
        result.overwritten -= imported;
        result.imported += imported;
      }
      await reload();
      showList();
      say(t("promptTemplates.restoreDone", { imported: result.imported, overwritten: result.overwritten, skipped: result.skipped.length }));
    } catch (error) { report(error); }
  }

  body.append(el("p", "pt-empty", t("common.loading")));
  void Promise.all([
    reload(),
    api<{ projects: Project[] }>("/api/projects").then(payload => { projects = payload.projects || []; }).catch(() => { projects = []; })
  ]).then(() => {
    const saved = localStorage.getItem(PROJECT_KEY) || "";
    scope = projects.some(item => item.id === saved) ? saved : "";
    showList();
  }).catch(error => { body.replaceChildren(); report(error); });
}
