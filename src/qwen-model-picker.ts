// Model picker for the Qwen Code chat. Lists only what the qwen CLI can run
// (GET /api/qwen/models: its own settings' modelProviders + the /auth
// providers), and adds a provider the way /auth does (POST /api/qwen/providers).
// API keys are typed here once and go straight to the server; nothing about a
// key is kept in the browser.
import { SYSTEM_ICONS } from "./app-registry";
import { formatNumber, getLanguage, t, translateServerMessage } from "./i18n";
import { createSheetHeader } from "./sheet-header.mjs";
import {
  loadQwenModel,
  loadRecentQwenModels,
  qwenModelKey,
  qwenModelSections,
  saveQwenModel,
  type QwenListedModel,
  type QwenModelChoice,
  type QwenModelGroup
} from "./qwen-model-store.mjs";

type Preset = {
  id: string;
  label: string;
  group: string;
  title: string;
  baseUrls: { id: string; label: string }[];
  custom: boolean;
  protocols: string[];
  modelsEditable: boolean;
  keyPlaceholder: string;
  models: { id: string; disabled?: boolean; reason?: string }[];
};
type Listing = {
  version: string;
  scope: "user" | "workspace" | "none";
  defaultModel: string | null;
  groups: QwenModelGroup[];
  models: QwenListedModel[];
  presets: Preset[];
};

export type QwenModelPickerOptions = {
  host: HTMLElement;
  headers: () => Headers;
  projectId: () => string | null;
  onChange: (choice: QwenModelChoice | null) => void;
  onOpenChange?: (open: boolean) => void;
};

export type QwenModelPicker = {
  open(returnFocus?: HTMLElement | null): void;
  close(): void;
  isOpen(): boolean;
  current(): QwenModelChoice | null;
  element: HTMLElement;
};

function protocolLabel(value: string) {
  if (value === "openai") return t("qwen.picker.protocolOpenAiCompatible");
  if (value === "anthropic") return "Anthropic";
  if (value === "gemini") return "Gemini";
  return value;
}

function option(label: string, value: string) {
  const node = document.createElement("option");
  node.value = value;
  node.textContent = label;
  return node;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = "", text = ""): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

export function mountQwenModelPicker(options: QwenModelPickerOptions): QwenModelPicker {
  const sheet = el("section", "qx-picker");
  sheet.id = "qwenModelSheet";
  sheet.dataset.qwenPicker = "";
  sheet.setAttribute("role", "dialog");
  sheet.setAttribute("aria-modal", "true");
  sheet.setAttribute("aria-labelledby", "qwenModelTitle");
  sheet.hidden = true;
  const head = createSheetHeader(document, {
    title: t("qwen.picker.title"),
    titleId: "qwenModelTitle",
    closeLabel: t("qwen.picker.closeAria"),
    onClose: () => close()
  });
  const body = el("div", "qx-picker-body");
  sheet.append(head.element, body);
  options.host.append(sheet);

  let choice = loadQwenModel(localStorage);
  let listing: Listing | null = null;
  let loadError = "";
  let loading = false;
  let query = "";
  let group = "all";
  let view: "list" | "providers" | "form" = "list";
  let preset: Preset | null = null;
  let returnFocus: HTMLElement | null = null;
  let loadedFor = "";

  const back = el("button", "dm-sheet-head-back");
  back.type = "button";
  back.dataset.qwenPickerBack = "";
  back.setAttribute("aria-label", t("qwen.picker.backAria"));
  back.innerHTML = SYSTEM_ICONS.back;
  back.addEventListener("click", () => {
    view = view === "form" ? "providers" : "list";
    render();
  });
  head.element.prepend(back);

  async function load(force = false) {
    const projectId = options.projectId();
    if (!projectId) {
      listing = null;
      loadError = t("qwen.picker.selectProjectFirst");
      render();
      return;
    }
    if (!force && listing && loadedFor === projectId) return;
    loading = true;
    loadError = "";
    render();
    try {
      const res = await fetch(`/api/qwen/models?projectId=${encodeURIComponent(projectId)}`, { cache: "no-store", headers: options.headers() });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(String(payload?.error || t("common.httpError", { status: res.status })));
      listing = {
        version: String(payload.version || ""),
        scope: payload.scope === "workspace" || payload.scope === "user" ? payload.scope : "none",
        defaultModel: typeof payload.defaultModel === "string" ? payload.defaultModel : null,
        groups: Array.isArray(payload.groups) ? payload.groups : [],
        models: Array.isArray(payload.models) ? payload.models : [],
        presets: Array.isArray(payload.presets) ? payload.presets : []
      };
      loadedFor = projectId;
      if (group !== "all" && !listing.groups.some(item => item.id === group)) group = "all";
    } catch (error) {
      loadError = translateServerMessage(error instanceof Error ? error.message : String(error));
    } finally {
      loading = false;
      render();
    }
  }

  function select(next: QwenModelChoice | null) {
    choice = saveQwenModel(localStorage, next);
    options.onChange(choice);
    close();
  }

  function row(label: string, meta: string, { selected = false, disabled = false, reason = "" } = {}) {
    const button = el("button", "qx-picker-row");
    button.type = "button";
    button.setAttribute("role", "option");
    button.setAttribute("aria-selected", String(selected));
    const text = el("span", "qx-picker-row-text");
    text.append(el("strong", "", label));
    const sub = disabled ? reason : meta;
    if (sub) text.append(el("small", "", sub));
    const check = el("span", "qx-picker-check");
    if (selected) check.innerHTML = SYSTEM_ICONS.check;
    button.append(text, check);
    if (disabled) {
      button.disabled = true;
      button.setAttribute("aria-disabled", "true");
      button.dataset.disabled = "";
    }
    return button;
  }

  function renderList() {
    head.setTitle(t("qwen.picker.title"));
    head.setSubtitle(listing?.version ? t("qwen.picker.subtitleWithVersion", { version: listing.version }) : t("qwen.picker.subtitleDefault"));
    // With nothing listed the empty state carries the one Add API button.
    const empty = Boolean(listing && !listing.models.length && !loadError);
    head.setPrimary(empty ? null : { label: t("qwen.picker.addApi"), onClick: () => { view = "providers"; render(); } });
    back.hidden = true;

    const search = el("label", "qx-picker-search");
    search.innerHTML = SYSTEM_ICONS.search;
    const input = el("input");
    input.type = "search";
    input.dataset.qwenModelSearch = "";
    input.placeholder = t("qwen.picker.searchPlaceholder");
    input.setAttribute("aria-label", t("qwen.picker.searchAria"));
    input.autocomplete = "off";
    input.spellcheck = false;
    input.value = query;
    input.addEventListener("input", () => {
      query = input.value;
      renderResults();
    });
    search.append(input);

    const chips = el("div", "qx-picker-chips");
    chips.setAttribute("role", "tablist");
    chips.setAttribute("aria-label", t("qwen.picker.providersAria"));
    const results = el("div", "qx-picker-results");
    results.setAttribute("role", "listbox");
    results.setAttribute("aria-label", t("qwen.picker.modelsAria"));

    const renderChips = () => {
      chips.replaceChildren();
      const all = [{ id: "all", label: t("qwen.picker.allGroups") }, ...(listing?.groups ?? [])];
      chips.hidden = all.length < 3;
      for (const entry of all) {
        const chip = el("button", "qx-picker-chip", entry.label);
        chip.type = "button";
        chip.dataset.group = entry.id;
        chip.setAttribute("role", "tab");
        chip.setAttribute("aria-selected", String(group === entry.id));
        chip.addEventListener("click", () => {
          group = entry.id;
          renderChips();
          renderResults();
        });
        chips.append(chip);
      }
    };

    const renderResults = () => {
      results.replaceChildren();
      if (!query.trim() && group === "all") {
        const fallback = listing?.defaultModel
          ? t("qwen.picker.defaultFallbackWithModel", { model: listing.defaultModel })
          : t("qwen.picker.defaultFallback");
        const item = row(t("qwen.picker.defaultTitle"), fallback, { selected: !choice });
        item.dataset.qwenModel = "";
        item.classList.add("qx-picker-default");
        item.addEventListener("click", () => select(null));
        results.append(item);
      }
      if (loading && !listing) {
        results.append(el("p", "qx-picker-state", t("qwen.picker.loading")));
        return;
      }
      if (loadError) {
        const state = el("div", "qx-picker-state");
        state.setAttribute("role", "alert");
        state.append(el("p", "", loadError));
        const retry = el("button", "qx-picker-secondary", t("qwen.picker.reload"));
        retry.type = "button";
        retry.dataset.qwenPickerRetry = "";
        retry.addEventListener("click", () => void load(true));
        state.append(retry);
        results.append(state);
        return;
      }
      if (!listing?.models.length) {
        const empty = el("div", "qx-picker-state");
        empty.dataset.qwenPickerEmpty = "";
        empty.append(el("p", "", t("qwen.picker.emptyState")));
        const add = el("button", "qx-picker-primary", t("qwen.picker.addApi"));
        add.type = "button";
        add.addEventListener("click", () => { view = "providers"; render(); });
        empty.append(add);
        results.append(empty);
        return;
      }
      const sections = qwenModelSections(listing, { query, group, recent: loadRecentQwenModels(localStorage), language: getLanguage() });
      if (!sections.length) {
        results.append(el("p", "qx-picker-state", t("qwen.picker.noMatches", { query: query.trim() })));
        return;
      }
      for (const section of sections) {
        const block = el("div", "qx-picker-section");
        block.setAttribute("role", "group");
        const title = el("h3", "", section.label);
        title.id = `qwen-section-${section.id.replace(/[^a-z0-9-]/gi, "-")}`;
        block.setAttribute("aria-labelledby", title.id);
        block.append(title);
        for (const model of section.items) {
          const label = model.name.replace(/^\[[^\]]+\]\s*/, "") || model.id;
          const meta = [label === model.id ? "" : model.id, model.host || ""].filter(Boolean).join(" · ");
          const item = row(label, meta, {
            selected: qwenModelKey(choice) === qwenModelKey(model),
            disabled: Boolean(model.disabled),
            reason: model.reason ? translateServerMessage(model.reason) : ""
          });
          item.dataset.qwenModel = qwenModelKey(model);
          item.addEventListener("click", () => select({ id: model.id, authType: model.authType, name: model.name }));
          block.append(item);
        }
        results.append(block);
      }
      if (listing.scope === "workspace") {
        results.append(el("p", "qx-picker-note", t("qwen.picker.workspaceScopeNote")));
      }
    };

    renderChips();
    renderResults();
    body.replaceChildren(search, chips, results);
  }

  function renderProviders() {
    head.setTitle(t("qwen.picker.addApi"));
    head.setSubtitle(t("qwen.picker.providersSubtitle"));
    head.setPrimary(null);
    back.hidden = false;
    const wrap = el("div", "qx-picker-results");
    const presets = listing?.presets ?? [];
    if (!presets.length) {
      wrap.append(el("p", "qx-picker-state", loadError || t("qwen.picker.loading")));
    }
    const titles = [...new Set(presets.map(item => item.title))];
    for (const title of titles) {
      const block = el("div", "qx-picker-section");
      block.append(el("h3", "", title));
      for (const item of presets.filter(entry => entry.title === title)) {
        const count = item.custom
          ? t("qwen.picker.customProviderHint")
          : item.baseUrls.length > 1
            ? t("qwen.picker.providerCountWithRegions", {
                models: formatNumber(item.models.length),
                regions: formatNumber(item.baseUrls.length)
              })
            : t("qwen.picker.providerCount", { models: formatNumber(item.models.length) });
        const button = row(item.label, count);
        button.removeAttribute("role");
        button.removeAttribute("aria-selected");
        button.dataset.qwenPreset = item.id;
        button.addEventListener("click", () => {
          preset = item;
          view = "form";
          render();
        });
        block.append(button);
      }
      wrap.append(block);
    }
    body.replaceChildren(wrap);
  }

  function field(label: string, control: HTMLElement, hint = "") {
    const wrap = el("label", "qx-field");
    wrap.append(el("span", "qx-field-label", label), control);
    if (hint) wrap.append(el("small", "qx-field-hint", hint));
    return wrap;
  }

  function renderForm() {
    const item = preset!;
    head.setTitle(item.label);
    head.setSubtitle(item.title === item.label ? "" : item.title);
    head.setPrimary(null);
    back.hidden = false;
    const form = el("form", "qx-picker-form");
    form.dataset.qwenProviderForm = "";
    form.noValidate = true;

    let region: HTMLSelectElement | null = null;
    if (item.baseUrls.length > 1) {
      region = el("select");
      region.name = "baseUrlId";
      for (const entry of item.baseUrls) region.append(option(entry.label, entry.id));
      form.append(field(t("qwen.picker.regionLabel"), region));
    }
    let protocol: HTMLSelectElement | null = null;
    let baseUrl: HTMLInputElement | null = null;
    if (item.custom) {
      protocol = el("select");
      protocol.name = "protocol";
      for (const value of item.protocols) protocol.append(option(protocolLabel(value), value));
      baseUrl = el("input");
      baseUrl.name = "baseUrl";
      baseUrl.type = "url";
      baseUrl.inputMode = "url";
      baseUrl.autocomplete = "off";
      baseUrl.spellcheck = false;
      baseUrl.placeholder = "https://example.com/v1";
      form.append(field(t("qwen.picker.protocolLabel"), protocol), field(t("qwen.picker.baseUrlLabel"), baseUrl, t("qwen.picker.baseUrlHint")));
    }
    const key = el("input");
    key.name = "apiKey";
    key.type = "password";
    key.autocomplete = "off";
    key.spellcheck = false;
    key.placeholder = item.keyPlaceholder || t("qwen.picker.apiKeyPlaceholder");
    form.append(field(t("qwen.picker.apiKeyLabel"), key, t("qwen.picker.apiKeyHint")));

    const boxes: HTMLInputElement[] = [];
    if (item.models.length) {
      const set = el("fieldset", "qx-picker-models");
      set.append(el("legend", "", t("qwen.picker.modelsLegend")));
      for (const model of item.models) {
        const line = el("label", "qx-check");
        const box = el("input");
        box.type = "checkbox";
        box.value = model.id;
        box.checked = !model.disabled;
        box.disabled = Boolean(model.disabled);
        boxes.push(box);
        const text = el("span", "", model.id);
        line.append(box, text);
        if (model.disabled) line.append(el("small", "", model.reason ? translateServerMessage(model.reason) : t("qwen.picker.unavailableReason")));
        set.append(line);
      }
      form.append(set);
    }
    let extra: HTMLInputElement | null = null;
    if (item.modelsEditable) {
      extra = el("input");
      extra.name = "modelIds";
      extra.autocomplete = "off";
      extra.spellcheck = false;
      extra.placeholder = item.custom ? t("qwen.picker.customModelPlaceholder") : t("qwen.picker.extraModelPlaceholder");
      form.append(field(item.custom ? t("qwen.picker.modelIdsLabel") : t("qwen.picker.extraModelIdsLabel"), extra, t("qwen.picker.modelIdsHint")));
    }
    const message = el("p", "qx-picker-message");
    message.setAttribute("role", "status");
    const submit = el("button", "qx-picker-primary", t("qwen.picker.submitAdd"));
    submit.type = "submit";
    submit.dataset.qwenProviderSubmit = "";
    const foot = el("div", "qx-picker-form-foot");
    foot.append(message, submit);
    form.append(foot);

    form.addEventListener("submit", async event => {
      event.preventDefault();
      const modelIds = [
        ...boxes.filter(box => box.checked).map(box => box.value),
        ...(extra?.value.split(",").map(value => value.trim()).filter(Boolean) ?? [])
      ];
      const apiKey = key.value.trim();
      const fail = (text: string, focus?: HTMLElement | null) => {
        message.textContent = text;
        message.dataset.state = "error";
        message.setAttribute("role", "alert");
        focus?.focus();
      };
      if (item.custom && !baseUrl!.value.trim()) return fail(t("qwen.picker.enterBaseUrl"), baseUrl);
      if (!apiKey) return fail(t("qwen.picker.enterApiKey"), key);
      if (!modelIds.length) return fail(t("qwen.picker.selectAtLeastOneModel"), extra);
      submit.disabled = true;
      message.dataset.state = "loading";
      message.setAttribute("role", "status");
      message.textContent = t("qwen.picker.saving");
      try {
        const res = await fetch("/api/qwen/providers", {
          method: "POST",
          headers: options.headers(),
          body: JSON.stringify({
            presetId: item.id,
            ...(region ? { baseUrlId: region.value } : {}),
            ...(protocol ? { protocol: protocol.value } : {}),
            ...(baseUrl ? { baseUrl: baseUrl.value.trim() } : {}),
            apiKey,
            modelIds
          })
        });
        const payload = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(String(payload?.error || t("common.httpError", { status: res.status })));
        key.value = "";
        await load(true);
        const first = (payload.added ?? [])[0];
        const added = first && listing?.models.find(model => model.id === first.id && model.authType === first.authType && !model.disabled);
        view = "list";
        query = "";
        group = "all";
        if (added) select({ id: added.id, authType: added.authType, name: added.name });
        else render();
      } catch (error) {
        submit.disabled = false;
        fail(translateServerMessage(error instanceof Error ? error.message : String(error)));
      }
    });
    body.replaceChildren(form);
    (region ?? protocol ?? key).focus({ preventScroll: true });
  }

  function render() {
    if (sheet.hidden) return;
    if (view === "form" && preset) renderForm();
    else if (view === "providers") renderProviders();
    else renderList();
  }

  function open(focusBack: HTMLElement | null = null) {
    if (!sheet.hidden) return;
    returnFocus = focusBack ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    view = "list";
    query = "";
    sheet.hidden = false;
    options.onOpenChange?.(true);
    render();
    void load(true);
    head.closeButton.focus({ preventScroll: true });
  }

  function close() {
    if (sheet.hidden) return;
    const restore = sheet.contains(document.activeElement);
    sheet.hidden = true;
    body.replaceChildren();
    options.onOpenChange?.(false);
    if (restore && returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
    returnFocus = null;
  }

  sheet.addEventListener("keydown", event => {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      return;
    }
    if (event.key !== "Tab") return;
    const controls = Array.from(sheet.querySelectorAll<HTMLElement>("button:not([disabled]):not([hidden]), input:not([disabled]), select"));
    const first = controls[0];
    const last = controls.at(-1);
    if (!first || !last) return;
    if (event.shiftKey ? document.activeElement === first : document.activeElement === last) {
      event.preventDefault();
      (event.shiftKey ? last : first).focus({ preventScroll: true });
    }
  });

  return { open, close, isOpen: () => !sheet.hidden, current: () => choice, element: sheet };
}
