import "./control-center.css";
import type { Terminal as XTerm } from "@xterm/xterm";
import type { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { createDeviceGate, isDeviceAuthError, responseError } from "./device-gate.mjs";
import { createSheetHeader } from "./sheet-header.mjs";
import { formatNumber, t, translateServerMessage } from "./i18n";

type ProjectSummary = {
  id: string;
  name: string;
  path: string;
  available?: boolean;
};

type TerminalSession = {
  id: string;
  name?: string;
  persistent?: boolean;
  expiresAt?: number | null;
  status?: "attached" | "detached" | "exited";
  projectId: string;
  projectName: string;
  cwd: string;
  createdAt: number;
  lastAttachedAt: number | null;
  lastActivityAt: number;
  closed: boolean;
  exitCode: number | null;
  signal: string | null;
  seq: number;
};

type TerminalRecord = {
  session: TerminalSession;
  token: string;
};

type TerminalChunk = {
  seq?: number;
  data?: string;
  stream?: string;
  type?: string;
};

type PermissionRule = {
  id: string;
  scope: {
    backend?: string;
    tool?: string;
    action?: string;
    projectId?: string;
    sessionId?: string;
  };
  createdAt: number;
  expiresAt?: number;
  note?: string;
};

const TERMINAL_RECORD_KEY = "devmoter-terminal-record";
const TERMINAL_AUTH_KEY = "devmoter-terminal-auth";
function uid() {
  return typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function button(label: string, ariaLabel = label) {
  const el = document.createElement("button");
  el.type = "button";
  el.textContent = label;
  el.setAttribute("aria-label", ariaLabel);
  return el;
}

function loadTerminalRecord(): TerminalRecord | null {
  try {
    const parsed = JSON.parse(sessionStorage.getItem(TERMINAL_RECORD_KEY) || "null") as TerminalRecord | null;
    if (!parsed?.session?.id || (!parsed?.token && !parsed?.session?.persistent)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function saveTerminalRecord(record: TerminalRecord | null) {
  if (!record) sessionStorage.removeItem(TERMINAL_RECORD_KEY);
  else sessionStorage.setItem(TERMINAL_RECORD_KEY, JSON.stringify(record));
}

function terminalAuthorization(ask = false) {
  const existing = sessionStorage.getItem(TERMINAL_AUTH_KEY);
  if (existing) return existing;
  if (!ask) return "";
  const password = window.prompt(t("terminal.passwordPrompt"));
  if (!password) return "";
  const value = `Basic ${btoa(`devmoter:${password}`)}`;
  sessionStorage.setItem(TERMINAL_AUTH_KEY, value);
  return value;
}

async function terminalFetch(
  path: string,
  init: RequestInit = {},
  retryAuth = true
): Promise<Response> {
  const headers = new Headers(init.headers || {});
  const auth = terminalAuthorization(false);
  if (auth) headers.set("authorization", auth);

  let response = await fetch(path, {
    ...init,
    headers,
    cache: "no-store",
    credentials: "same-origin"
  });

  if (response.status === 401 && retryAuth) {
    sessionStorage.removeItem(TERMINAL_AUTH_KEY);
    const next = terminalAuthorization(true);
    if (next) {
      headers.set("authorization", next);
      response = await fetch(path, {
        ...init,
        headers,
        cache: "no-store",
        credentials: "same-origin"
      });
    }
  }

  return response;
}

async function jsonOrError<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => ({})) as { error?: string } & T;
  if (!response.ok) throw responseError(response.status, payload?.error);
  return payload;
}

function errorMessage(error: unknown) {
  const raw = typeof (error as Error | null)?.message === "string" ? (error as Error).message : String(error);
  return translateServerMessage(raw);
}

// xterm draws on a canvas, so it reads the theme tokens instead of CSS.
function terminalTheme() {
  const css = window.getComputedStyle?.(document.documentElement);
  const token = (name: string, fallback: string) => css?.getPropertyValue(name).trim() || fallback;
  const foreground = token("--text-primary", "#ececec");
  return { background: token("--canvas-base", "#212121"), foreground, cursor: foreground, selectionBackground: token("--border-subtle", "#4a4a4a") };
}

function scopeSummary(rule: PermissionRule) {
  const rows = [
    rule.scope.backend ? t("safety.scopeBackend", { value: rule.scope.backend }) : "",
    rule.scope.tool ? t("safety.scopeTool", { value: rule.scope.tool }) : "",
    rule.scope.projectId ? t("safety.scopeProject", { value: rule.scope.projectId }) : "",
    rule.scope.sessionId ? t("safety.scopeSession", { value: rule.scope.sessionId }) : "",
    rule.scope.action ? t("safety.scopeAction", { value: rule.scope.action }) : ""
  ].filter(Boolean);
  return rows.join("\n");
}

function terminalSessionStateLabel(state: string) {
  if (state === "attached") return t("terminal.stateAttached");
  if (state === "exited") return t("terminal.stateExited");
  if (state === "detached") return t("terminal.stateDetached");
  return translateServerMessage(state);
}

export function mountControlCenter() {
  const launcher = button("⌘", t("controlCenter.openToolsAria"));
  launcher.className = "dm-tools-launcher";
  launcher.setAttribute("aria-haspopup", "dialog");
  launcher.setAttribute("aria-expanded", "false");

  const scrim = document.createElement("button");
  scrim.type = "button";
  scrim.className = "dm-tools-scrim hidden";
  scrim.setAttribute("aria-label", t("controlCenter.closeToolsAria"));
  scrim.tabIndex = -1;

  const panel = document.createElement("aside");
  // The shared sheet frame (zcode-theme.css) starts below the unified header.
  panel.className = "dm-tools-panel dm-sheet-frame hidden";
  panel.setAttribute("aria-label", t("controlCenter.toolsAria"));
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-modal", "true");
  panel.setAttribute("aria-labelledby", "dm-tools-title");

  // Shared sheet header; the title names the open tab, matching the Settings
  // row that opened it.
  const head = createSheetHeader(document, { title: t("controlCenter.tab.terminal"), titleId: "dm-tools-title" });
  const close = head.closeButton;

  const tabs = document.createElement("div");
  tabs.className = "dm-tools-tabs";
  const terminalTab = button(t("controlCenter.tab.terminal"));
  const safetyTab = button(t("controlCenter.tab.safety"));
  const indexTab = button(t("controlCenter.tab.index"));
  terminalTab.classList.add("active");
  tabs.setAttribute("role", "tablist");
  tabs.setAttribute("aria-label", t("controlCenter.tabsAria"));
  const tabEntries = [
    [terminalTab, "terminal", "dm-tools-terminal-panel"],
    [safetyTab, "safety", "dm-tools-safety-panel"],
    [indexTab, "index", "dm-tools-index-panel"]
  ] as const;
  const tabTitles = {
    terminal: t("controlCenter.tab.terminal"),
    safety: t("controlCenter.tab.safetyTitle"),
    index: t("controlCenter.tab.indexTitle")
  } as const;
  for (const [tab, name, panelId] of tabEntries) {
    tab.id = `dm-tools-${name}-tab`;
    tab.setAttribute("role", "tab");
    tab.setAttribute("aria-controls", panelId);
    tab.setAttribute("aria-selected", name === "terminal" ? "true" : "false");
    tab.tabIndex = name === "terminal" ? 0 : -1;
  }
  tabs.append(terminalTab, safetyTab, indexTab);

  const body = document.createElement("div");
  body.className = "dm-tools-body";

  const terminalSection = document.createElement("section");
  terminalSection.className = "dm-tools-section";
  terminalSection.id = "dm-tools-terminal-panel";
  terminalSection.setAttribute("role", "tabpanel");
  terminalSection.setAttribute("aria-labelledby", "dm-tools-terminal-tab");
  terminalSection.tabIndex = 0;
  const safetySection = document.createElement("section");
  safetySection.className = "dm-tools-section hidden";
  safetySection.id = "dm-tools-safety-panel";
  safetySection.setAttribute("role", "tabpanel");
  safetySection.setAttribute("aria-labelledby", "dm-tools-safety-tab");
  safetySection.tabIndex = 0;
  const indexSection = document.createElement("section");
  indexSection.className = "dm-tools-section hidden";
  indexSection.id = "dm-tools-index-panel";
  indexSection.setAttribute("role", "tabpanel");
  indexSection.setAttribute("aria-labelledby", "dm-tools-index-tab");
  indexSection.tabIndex = 0;
  body.append(terminalSection, safetySection, indexSection);

  panel.append(head.element, tabs, body);
  document.body.append(scrim, launcher, panel);

  let projects: ProjectSummary[] = [];
  let savedTerminalSessions: TerminalSession[] = [];
  let activeProjectId = localStorage.getItem("opencode-pocket-project") || "";
  let terminalRecord = loadTerminalRecord();
  let terminalShell: HTMLDivElement;
  let terminalPlaceholder: HTMLDivElement;
  let terminalStatus: HTMLDivElement;
  let projectSelect: HTMLSelectElement;
  let indexProjectSelect: HTMLSelectElement | null = null;
  let savedSessionSelect: HTMLSelectElement;
  let sessionNameInput: HTMLInputElement;
  let persistentSessionToggle: HTMLInputElement;
  let terminalView: XTerm | null = null;
  let terminalFit: FitAddon | null = null;
  let rendererPromise: Promise<void> | null = null;
  let terminalSocket: WebSocket | null = null;
  let socketRetryTimer: number | null = null;
  let socketConnecting = false;
  let socketGeneration = 0;
  let terminalResizeObserver: ResizeObserver | null = null;
  let lastSeq = 0;
  let setTerminalControlsBusy: (busy: boolean) => void = () => {};
  let modalOpen = false;
  let returnFocusTarget: HTMLElement | null = null;
  const inertSnapshots = new Map<HTMLElement, { inert: boolean; ariaHidden: string | null }>();
  let safetyInitialized = false;
  let indexInitialized = false;
  let safetyRevision = 0;
  let terminalRevision = 0;
  let refreshSafetyView: (() => Promise<void>) | null = null;
  let refreshIndexView: (() => Promise<void>) | null = null;

  function setTab(next: "terminal" | "safety" | "index") {
    body.scrollTop = 0;
    head.setTitle(tabTitles[next]);
    for (const [tab, name] of tabEntries) {
      const selected = name === next;
      tab.classList.toggle("active", selected);
      tab.setAttribute("aria-selected", String(selected));
      tab.tabIndex = selected ? 0 : -1;
    }
    terminalSection.classList.toggle("hidden", next !== "terminal");
    safetySection.classList.toggle("hidden", next !== "safety");
    indexSection.classList.toggle("hidden", next !== "index");

    if (next === "safety") {
      if (!safetyInitialized) {
        safetyInitialized = true;
        void renderSafety();
      } else void refreshSafetyView?.();
    } else if (next === "index" && !indexInitialized) {
      indexInitialized = true;
      void renderIndex();
    } else if (next === "index") {
      void refreshIndexView?.().catch(error => {
        if (showSectionGate(indexSection, error)) return;
        const status = indexSection.querySelector<HTMLElement>("[role='status']");
        if (status && !indexSection.classList.contains("hidden")) {
          status.textContent = errorMessage(error);
        }
      });
    }
    if (next === "terminal" && terminalView) fitTerminal();
  }

  function focusableInPanel() {
    return [...panel.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )].filter(element => !element.closest(".hidden") && element.getClientRects().length > 0);
  }

  function releaseBackgroundInert() {
    for (const [element, state] of inertSnapshots) {
      element.inert = state.inert;
      if (state.ariaHidden === null) element.removeAttribute("aria-hidden");
      else element.setAttribute("aria-hidden", state.ariaHidden);
    }
    inertSnapshots.clear();
  }

  function releaseInertFor(target: HTMLElement | null) {
    if (!target) return;
    const state = inertSnapshots.get(target);
    if (!state) return;
    target.inert = state.inert;
    if (state.ariaHidden === null) target.removeAttribute("aria-hidden");
    else target.setAttribute("aria-hidden", state.ariaHidden);
    inertSnapshots.delete(target);
  }

  function unlockSettingsOverlay() {
    if (!modalOpen) return;
    releaseInertFor(document.querySelector<HTMLElement>(".devmoter-settings-root"));
  }

  function lockBackground() {
    releaseBackgroundInert();
    for (const child of [...document.body.children]) {
      if (!(child instanceof HTMLElement) || child === launcher || child === panel || child === scrim) continue;
      // The unified workspace header stays usable: ☰ is how users leave this panel.
      if (child.id === "dmTaskFirstWorkspace") continue;
      if (child.classList.contains("devmoter-settings-root") && child.querySelector(".devmoter-settings-modal:not(.hidden)")) continue;
      inertSnapshots.set(child, { inert: child.inert, ariaHidden: child.getAttribute("aria-hidden") });
      child.inert = true;
      child.setAttribute("aria-hidden", "true");
    }
  }

  function hasAnySectionGate() {
    return [terminalSection, safetySection, indexSection].some(section => section.dataset.deviceGated === "true");
  }

  let trustDirty = false;
  function refreshPanelState(options: { includeBackgroundTabs?: boolean } = {}) {
    const revision = ++terminalRevision;
    return loadProjects().then(() => {
      if (revision !== terminalRevision) return false;
      renderProjectOptions();
      if (safetyInitialized && (options.includeBackgroundTabs || !safetySection.classList.contains("hidden"))) {
        void refreshSafetyView?.();
      }
      if (indexInitialized && (options.includeBackgroundTabs || !indexSection.classList.contains("hidden"))) {
        void refreshIndexView?.();
      }
      return loadTerminalSessions(revision);
    }).then(refreshed => {
      if (!refreshed || revision !== terminalRevision) return;
      if (modalOpen && terminalRecord) {
        void reattachTerminal(revision).catch(error => {
          if (revision === terminalRevision && modalOpen) showTerminalLoadError(error);
        });
      }
      if (modalOpen && !terminalSection.classList.contains("hidden") && terminalView && terminalSection.dataset.deviceGated !== "true") {
        fitTerminal();
      }
    }).catch(error => {
      if (revision === terminalRevision && modalOpen) showTerminalLoadError(error);
    });
  }

  function openPanel() {
    if (modalOpen) return;
    const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    returnFocusTarget = active && active !== document.body && active !== launcher ? active : null;
    panel.classList.remove("hidden");
    scrim.classList.remove("hidden");
    launcher.setAttribute("aria-expanded", "true");
    modalOpen = true;
    lockBackground();
    close.focus({ preventScroll: true });
    window.dispatchEvent(new window.CustomEvent("devmoter:workspace-panel-changed", { detail: { tab: "terminal", open: true } }));
    const includeBackgroundTabs = trustDirty;
    trustDirty = false;
    void refreshPanelState({ includeBackgroundTabs });
  }

  function closePanel(options: { restoreFocus?: boolean } = {}) {
    if (!modalOpen && panel.classList.contains("hidden")) return;
    const wasOpen = modalOpen;
    modalOpen = false;
    releaseBackgroundInert();
    panel.classList.add("hidden");
    scrim.classList.add("hidden");
    launcher.setAttribute("aria-expanded", "false");
    disconnectTerminalSocket();
    if (wasOpen) window.dispatchEvent(new window.CustomEvent("devmoter:workspace-panel-changed", { detail: { tab: "terminal", open: false } }));
    if (wasOpen && options.restoreFocus !== false) {
      const isVisible = (element: HTMLElement | null): element is HTMLElement => Boolean(
        element?.isConnected && !element.closest("[inert], [aria-hidden='true']") && element.getClientRects().length
      );
      const fallback = document.body.classList.contains("codex-mode")
        ? document.querySelector<HTMLElement>("#cxMenu")
        : document.querySelector<HTMLElement>(".dm-shell-menu-trigger") || launcher;
      const target = isVisible(returnFocusTarget) ? returnFocusTarget : fallback;
      if (isVisible(target)) target.focus({ preventScroll: true });
    }
    returnFocusTarget = null;
  }
  launcher.addEventListener("click", openPanel);
  close.addEventListener("click", () => closePanel());
  scrim.addEventListener("click", () => closePanel());
  window.addEventListener("devmoter:global-nav-opened", () => closePanel({ restoreFocus: false }));
  window.addEventListener("devmoter:surface-changed", () => closePanel({ restoreFocus: false }));
  window.addEventListener("devmoter:workspace-tab-changing", () => closePanel({ restoreFocus: false }));
  window.addEventListener("devmoter:open-settings", unlockSettingsOverlay);
  window.addEventListener("devmoter:settings-opened", unlockSettingsOverlay);
  window.addEventListener("devmoter:settings-closed", () => {
    if (!modalOpen) return;
    lockBackground();
    if (!panel.contains(document.activeElement)) close.focus({ preventScroll: true });
    if (hasAnySectionGate()) void refreshPanelState({ includeBackgroundTabs: true });
  });
  window.addEventListener("devmoter:device-trust-changed", () => {
    if (modalOpen) void refreshPanelState({ includeBackgroundTabs: true });
    else trustDirty = true;
  });
  window.addEventListener("focus", () => {
    if (modalOpen && hasAnySectionGate()) void refreshPanelState({ includeBackgroundTabs: true });
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && modalOpen && hasAnySectionGate()) {
      void refreshPanelState({ includeBackgroundTabs: true });
    }
  });
  window.addEventListener("keydown", event => {
    if (!modalOpen) return;
    if (document.body.classList.contains("devmoter-settings-open") || document.querySelector(".devmoter-settings-modal:not(.hidden), .devmoter-system-modal:not(.hidden)")) return;
    if (event.key === "Escape") {
      event.preventDefault();
      closePanel();
      return;
    }
    if (event.key === "Tab") {
      const items = focusableInPanel();
      if (!items.length) {
        event.preventDefault();
        close.focus({ preventScroll: true });
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && (document.activeElement === first || !panel.contains(document.activeElement))) {
        event.preventDefault();
        last.focus({ preventScroll: true });
      } else if (!event.shiftKey && (document.activeElement === last || !panel.contains(document.activeElement))) {
        event.preventDefault();
        first.focus({ preventScroll: true });
      }
    }
  });
  tabs.addEventListener("keydown", event => {
    const currentIndex = tabEntries.findIndex(([tab]) => tab === document.activeElement);
    if (currentIndex < 0) return;
    let nextIndex = currentIndex;
    if (event.key === "ArrowRight") nextIndex = (currentIndex + 1) % tabEntries.length;
    else if (event.key === "ArrowLeft") nextIndex = (currentIndex + tabEntries.length - 1) % tabEntries.length;
    else if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = tabEntries.length - 1;
    else return;
    event.preventDefault();
    const [tab, name] = tabEntries[nextIndex];
    setTab(name);
    tab.focus({ preventScroll: true });
  });
  terminalTab.addEventListener("click", () => setTab("terminal"));
  safetyTab.addEventListener("click", () => setTab("safety"));
  indexTab.addEventListener("click", () => setTab("index"));

  async function loadProjects() {
    const response = await fetch("/api/projects", { cache: "no-store" });
    const payload = await jsonOrError<{ projects?: ProjectSummary[] }>(response);
    projects = (payload.projects || []).filter(project => project.available !== false);
    if (!activeProjectId || !projects.some(project => project.id === activeProjectId)) {
      activeProjectId = projects[0]?.id || "";
    }
  }

  async function checkTrustedDeviceStatus(): Promise<Error | null> {
    try {
      const response = await fetch("/api/devices", { cache: "no-store" });
      await jsonOrError(response);
      return null;
    } catch (error) {
      return isDeviceAuthError(error) ? error as Error : null;
    }
  }

  function sectionFeatureName(section: HTMLElement) {
    if (section === terminalSection) return tabTitles.terminal;
    if (section === safetySection) return tabTitles.safety;
    return tabTitles.index;
  }

  // An unregistered or revoked device sees a status explanation and direct link
  // to Settings → Trusted devices in place of the whole tab (Terminal, Safety
  // or Index), never a dead form or raw 401/403 text. CSS hides the tab's other children.
  function showSectionGate(section: HTMLElement, error: unknown) {
    if (!isDeviceAuthError(error)) return false;
    if (!section.querySelector(":scope > [data-device-gate]")) {
      const feature = sectionFeatureName(section);
      const gate = createDeviceGate(document, {
        className: "dm-tools-card dm-tools-device-gate",
        error,
        copy: t("deviceGate.toolsLockedCopy", { feature }),
        buttonLabel: t("deviceGate.openToRegisterButton"),
        onRegister: unlockSettingsOverlay
      });
      if (section === terminalSection) gate.dataset.terminalDeviceGate = "true";
      section.prepend(gate);
    }
    section.dataset.deviceGated = "true";
    return true;
  }

  function clearSectionGate(section: HTMLElement) {
    section.querySelector(":scope > [data-device-gate]")?.remove();
    delete section.dataset.deviceGated;
  }

  function clearTrustedDeviceGate() {
    clearSectionGate(terminalSection);
  }

  function showTerminalError(prefix: string, error: unknown) {
    clearTrustedDeviceGate();
    if (showSectionGate(terminalSection, error)) {
      terminalStatus.textContent = "";
      return;
    }
    terminalStatus.textContent = t("terminal.errorWithReason", { prefix, error: errorMessage(error) });
  }

  function showTerminalLoadError(error: unknown) {
    showTerminalError(t("terminal.loadSessionsFailed"), error);
  }

  async function refreshTerminalSessions() {
    return loadTerminalSessions(++terminalRevision);
  }

  async function loadTerminalSessions(revision: number): Promise<boolean> {
    try {
      const response = await terminalFetch("/api/terminal/sessions");
      if (revision !== terminalRevision) return false;
      const payload = await jsonOrError<{ sessions?: TerminalSession[] }>(response);
      if (revision !== terminalRevision) return false;
      clearTrustedDeviceGate();
      savedTerminalSessions = payload.sessions || [];
      if (!savedSessionSelect) return true;
      const selectedId = terminalRecord?.session.id || savedSessionSelect.value;
      savedSessionSelect.replaceChildren();
      const placeholder = document.createElement("option");
      placeholder.value = "";
      placeholder.textContent = t("terminal.selectSavedSession");
      savedSessionSelect.append(placeholder);
      for (const session of savedTerminalSessions.filter(item => item.persistent && !item.closed)) {
        const option = document.createElement("option");
        option.value = session.id;
        option.textContent = `${session.name || t("terminal.defaultName")} · ${session.projectName} · ${terminalSessionStateLabel(session.status || "detached")}`;
        option.selected = session.id === selectedId;
        savedSessionSelect.append(option);
      }
      return true;
    } catch (error) {
      if (revision !== terminalRevision) return false;
      throw error;
    }
  }

  function renderProjectOptions() {
    for (const select of [projectSelect, indexProjectSelect]) {
      if (!select) continue;
      const previous = select.value;
      const selected = projects.some(project => project.id === previous) ? previous : activeProjectId;
      select.replaceChildren();
      for (const project of projects) {
        const option = document.createElement("option");
        option.value = project.id;
        // Name only; the path made every option ellipsize at 400px.
        option.textContent = project.name;
        option.title = project.path;
        option.selected = project.id === selected;
        select.append(option);
      }
      if (select === indexProjectSelect) select.dataset.previousProject = select.value;
    }
  }

  function renderTerminalShell() {
    terminalSection.replaceChildren();

    const projectRow = document.createElement("div");
    projectRow.className = "dm-tools-row";
    const projectLabel = document.createElement("label");
    projectLabel.textContent = t("terminal.projectLabel");
    projectSelect = document.createElement("select");
    projectLabel.append(projectSelect);
    projectRow.append(projectLabel);

    const sessionLabel = document.createElement("label");
    sessionLabel.textContent = t("terminal.savedSessionsLabel");
    savedSessionSelect = document.createElement("select");
    sessionLabel.append(savedSessionSelect);
    const refreshSessions = button(t("common.refresh"));
    projectRow.append(sessionLabel, refreshSessions);

    const persistenceRow = document.createElement("div");
    persistenceRow.className = "dm-tools-row";
    const persistLabel = document.createElement("label");
    persistLabel.className = "dm-terminal-persist-label";
    persistentSessionToggle = document.createElement("input");
    persistentSessionToggle.type = "checkbox";
    persistLabel.append(persistentSessionToggle, document.createTextNode(t("terminal.persistLabel")));
    const nameLabel = document.createElement("label");
    nameLabel.textContent = t("terminal.sessionNameLabel");
    sessionNameInput = document.createElement("input");
    sessionNameInput.maxLength = 48;
    sessionNameInput.placeholder = "api-dev";
    nameLabel.append(sessionNameInput);
    persistenceRow.append(nameLabel, persistLabel);

    const actions = document.createElement("div");
    actions.className = "dm-terminal-actions";
    const start = button(t("terminal.startReattachBtn"));
    start.classList.add("primary");
    const kill = button(t("terminal.killBtn"));
    kill.classList.add("danger");
    const clearAuth = button(t("terminal.forgetPasswordBtn"));
    actions.append(start, kill, clearAuth);

    terminalStatus = document.createElement("div");
    terminalStatus.className = "dm-terminal-status";
    terminalStatus.textContent = t("terminal.notStarted");
    terminalStatus.setAttribute("role", "status");
    terminalStatus.setAttribute("aria-live", "polite");

    terminalShell = document.createElement("div");
    terminalShell.className = "dm-terminal-shell";
    terminalShell.setAttribute("aria-label", t("terminal.outputAria"));
    terminalPlaceholder = document.createElement("div");
    terminalPlaceholder.className = "dm-terminal-placeholder";
    const placeholderTitle = document.createElement("strong");
    placeholderTitle.textContent = t("terminal.placeholderTitle");
    const placeholderCopy = document.createElement("span");
    placeholderCopy.textContent = t("terminal.placeholderCopy");
    terminalPlaceholder.append(placeholderTitle, placeholderCopy);
    terminalShell.append(terminalPlaceholder);

    const keyRow = document.createElement("div");
    keyRow.className = "dm-key-row";
    const keys: Array<[string, string, string]> = [
      ["Esc", "\u001b", t("terminal.key.escape")],
      ["Tab", "\t", t("terminal.key.tab")],
      ["Ctrl+C", "\u0003", t("terminal.key.ctrlC")],
      ["Ctrl+D", "\u0004", t("terminal.key.ctrlD")],
      ["Ctrl+Z", "\u001a", t("terminal.key.ctrlZ")],
      ["←", "\u001b[D", t("terminal.key.left")],
      ["↑", "\u001b[A", t("terminal.key.up")],
      ["↓", "\u001b[B", t("terminal.key.down")],
      ["→", "\u001b[C", t("terminal.key.right")],
      ["Home", "\u001b[H", t("terminal.key.home")],
      ["End", "\u001b[F", t("terminal.key.end")],
      ["PgUp", "\u001b[5~", t("terminal.key.pageUp")],
      ["PgDn", "\u001b[6~", t("terminal.key.pageDown")]
    ];
    for (const [label, sequence, aria] of keys) {
      const key = button(label, aria);
      key.addEventListener("click", () => terminalView?.input(sequence, true));
      keyRow.append(key);
    }

    const note = document.createElement("div");
    note.className = "dm-tools-note";
    note.textContent = t("terminal.persistenceNote");

    terminalSection.append(projectRow, persistenceRow, actions, terminalStatus, terminalShell, keyRow, note);

    projectSelect.addEventListener("change", () => {
      activeProjectId = projectSelect.value;
      localStorage.setItem("opencode-pocket-project", activeProjectId);
      if (indexProjectSelect && indexProjectSelect.value !== activeProjectId) {
        indexProjectSelect.value = activeProjectId;
        indexProjectSelect.dispatchEvent(new Event("change"));
      }
    });
    refreshSessions.addEventListener("click", () => {
      void refreshTerminalSessions().catch(showTerminalLoadError);
    });
    savedSessionSelect.addEventListener("change", () => {
      if (savedSessionSelect.value) void claimAndAttachSession(savedSessionSelect.value);
    });
    persistentSessionToggle.addEventListener("change", () => {
      sessionNameInput.disabled = !persistentSessionToggle.checked;
    });
    sessionNameInput.disabled = true;
    start.addEventListener("click", () => {
      setTerminalControlsBusy(true);
      terminalStatus.textContent = t("terminal.preparing");
      void startOrReattachTerminal().catch(error => {
        showTerminalError(t("terminal.startFailed"), error);
      }).finally(() => { setTerminalControlsBusy(false); });
    });
    kill.addEventListener("click", () => {
      setTerminalControlsBusy(true);
      void killTerminal().catch(error => {
        terminalStatus.textContent = t("terminal.killFailed", { error: errorMessage(error) });
      }).finally(() => { setTerminalControlsBusy(false); });
    });
    clearAuth.addEventListener("click", () => {
      sessionStorage.removeItem(TERMINAL_AUTH_KEY);
      terminalStatus.textContent = t("terminal.passwordCleared");
    });
    setTerminalControlsBusy = busy => {
      start.disabled = busy;
      kill.disabled = busy;
      savedSessionSelect.disabled = busy;
      refreshSessions.disabled = busy;
      projectSelect.disabled = busy;
      persistentSessionToggle.disabled = busy;
      sessionNameInput.disabled = busy || !persistentSessionToggle.checked;
    };
    renderProjectOptions();
  }

  async function ensureTerminalRenderer() {
    if (terminalView) return;
    if (!rendererPromise) {
      rendererPromise = (async () => {
        const [{ Terminal }, { FitAddon }] = await Promise.all([
          import("@xterm/xterm"),
          import("@xterm/addon-fit")
        ]);
        if (terminalView) return;
        const view = new Terminal({
          cursorBlink: true,
          scrollback: 5000,
          fontSize: 13,
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
          theme: terminalTheme(),
          disableStdin: true
        });
        const fit = new FitAddon();
        view.loadAddon(fit);
        view.open(terminalShell);
        view.onData(data => {
          if (terminalSocket?.readyState === WebSocket.OPEN) {
            terminalSocket.send(JSON.stringify({ type: "input", data }));
          }
        });
        view.onResize(({ cols, rows }) => {
          if (terminalSocket?.readyState === WebSocket.OPEN) {
            terminalSocket.send(JSON.stringify({ type: "resize", cols, rows }));
          }
        });
        terminalView = view;
        terminalFit = fit;
        terminalPlaceholder.remove();
        terminalResizeObserver = new ResizeObserver(() => fitTerminal());
        terminalResizeObserver.observe(terminalShell);
      })().catch(error => {
        rendererPromise = null;
        throw error;
      });
    }
    await rendererPromise;
    fitTerminal();
  }

  function fitTerminal() {
    if (!terminalView || !terminalFit || panel.classList.contains("hidden")) return;
    window.requestAnimationFrame(() => {
      if (!terminalView || !terminalFit || panel.classList.contains("hidden")) return;
      try { terminalFit.fit(); } catch { return; }
      if (terminalSocket?.readyState === WebSocket.OPEN) {
        terminalSocket.send(JSON.stringify({ type: "resize", cols: terminalView.cols, rows: terminalView.rows }));
      }
    });
  }

  function disconnectTerminalSocket() {
    socketGeneration += 1;
    if (socketRetryTimer !== null) window.clearTimeout(socketRetryTimer);
    socketRetryTimer = null;
    socketConnecting = false;
    const socket = terminalSocket;
    terminalSocket = null;
    if (terminalView) terminalView.options.disableStdin = true;
    if (socket && socket.readyState < WebSocket.CLOSING) socket.close(1000, "Client detached.");
  }

  function scheduleTerminalReconnect(generation: number) {
    if (socketRetryTimer !== null) window.clearTimeout(socketRetryTimer);
    if (!terminalRecord || terminalRecord.session.closed || panel.classList.contains("hidden")) return;
    socketRetryTimer = window.setTimeout(() => {
      socketRetryTimer = null;
      if (generation === socketGeneration) void connectTerminalSocket();
    }, 700);
  }

  async function connectTerminalSocket() {
    if (!terminalRecord || panel.classList.contains("hidden") || terminalSocket || socketConnecting) return;
    socketConnecting = true;
    const generation = socketGeneration;
    const record = terminalRecord;
    try {
      const ticketResponse = await terminalFetch(
        `/api/terminal/sessions/${encodeURIComponent(record.session.id)}/socket-ticket`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-devmoter-terminal-token": record.token,
            "x-pocket-operation-id": `terminal-ticket-${uid()}`
          },
          body: "{}"
        }
      );
      const ticketPayload = await jsonOrError<{ ticket: string }>(ticketResponse);
      if (generation !== socketGeneration || panel.classList.contains("hidden") || terminalRecord !== record) return;

      const protocol = location.protocol === "https:" ? "wss:" : "ws:";
      const socketUrl = `${protocol}//${location.host}/api/terminal/sessions/${encodeURIComponent(record.session.id)}/socket?after=${lastSeq}`;
      const socket = new WebSocket(socketUrl, ["devmoter-terminal.v1", `devmoter-ticket.${ticketPayload.ticket}`]);
      terminalSocket = socket;
      socket.onopen = () => {
        if (generation !== socketGeneration || socket !== terminalSocket) {
          socket.close(1000, "Stale connection.");
          return;
        }
        socketConnecting = false;
        if (terminalView) terminalView.options.disableStdin = false;
        terminalStatus.textContent = t("terminal.connectedStatus", {
          project: record.session.projectName,
          cwd: record.session.cwd
        });
        fitTerminal();
      };
      socket.onmessage = event => {
        if (socket !== terminalSocket || typeof event.data !== "string") return;
        try {
          const chunk = JSON.parse(event.data) as TerminalChunk;
          if (typeof chunk.seq === "number") lastSeq = Math.max(lastSeq, chunk.seq);
          if (chunk.data) terminalView?.write(chunk.data);
        } catch {
          socket.close(1008, "Invalid terminal output.");
        }
      };
      socket.onerror = () => socket.close();
      socket.onclose = event => {
        if (socket === terminalSocket) terminalSocket = null;
        socketConnecting = false;
        if (event.reason === "Terminal process exited.") {
          record.session.closed = true;
          terminalStatus.textContent = t("terminal.exitedStatus");
          saveTerminalRecord(record);
        }
        if (terminalView) terminalView.options.disableStdin = true;
        if (generation !== socketGeneration || panel.classList.contains("hidden")) return;
        if (record.session.closed) return;
        terminalStatus.textContent = t("terminal.disconnectedReconnecting");
        scheduleTerminalReconnect(generation);
      };
    } catch (error) {
      socketConnecting = false;
      if (generation !== socketGeneration || panel.classList.contains("hidden")) return;
      terminalStatus.textContent = t("terminal.reconnectingWithError", { error: errorMessage(error) });
      scheduleTerminalReconnect(generation);
    } finally {
      if (!terminalSocket) socketConnecting = false;
    }
  }

  async function startOrReattachTerminal() {
    if (!activeProjectId) {
      terminalStatus.textContent = t("terminal.selectProjectFirst");
      return;
    }

    if (terminalRecord) {
      try {
        await reattachTerminal();
        return;
      } catch {
        saveTerminalRecord(null);
        terminalRecord = null;
      }
    }

    const response = await terminalFetch("/api/terminal/sessions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-devmoter-terminal-entry": "explicit",
        "x-pocket-operation-id": `terminal-create-${uid()}`
      },
      body: JSON.stringify({
        projectId: activeProjectId,
        persistent: persistentSessionToggle.checked,
        name: persistentSessionToggle.checked ? sessionNameInput.value : undefined
      })
    });
    const payload = await jsonOrError<{ session: TerminalSession; token?: string }>(response);
    terminalRecord = { session: payload.session, token: payload.token || "" };
    saveTerminalRecord(terminalRecord);
    lastSeq = 0;
    terminalStatus.textContent = t("terminal.startingStatus", {
      project: payload.session.projectName,
      cwd: payload.session.cwd
    });
    await ensureTerminalRenderer();
    terminalView?.reset();
    void connectTerminalSocket();
  }

  async function claimAndAttachSession(sessionId: string) {
    const session = savedTerminalSessions.find(item => item.id === sessionId);
    if (!session) return;
    setTerminalControlsBusy(true);
    terminalStatus.textContent = t("terminal.claimingStatus", {
      name: session.name || t("terminal.sessionFallbackName")
    });
    try {
      const response = await terminalFetch(
        `/api/terminal/sessions/${encodeURIComponent(session.id)}/claim`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-devmoter-terminal-entry": "explicit",
            "x-pocket-operation-id": `terminal-claim-${uid()}`
          },
          body: "{}"
        }
      );
      const payload = await jsonOrError<{ session: TerminalSession }>(response);
      terminalRecord = { session: payload.session, token: "" };
      saveTerminalRecord(terminalRecord);
      lastSeq = 0;
      await ensureTerminalRenderer();
      terminalView?.reset();
      void connectTerminalSocket();
      await refreshTerminalSessions();
    } catch (error) {
      showTerminalError(t("terminal.attachFailed"), error);
    } finally {
      setTerminalControlsBusy(false);
    }
  }

  async function reattachTerminal(expectedRevision?: number) {
    if (!terminalRecord) return;
    if (expectedRevision !== undefined && expectedRevision !== terminalRevision) return;
    const response = await terminalFetch(
      `/api/terminal/sessions/${encodeURIComponent(terminalRecord.session.id)}`,
      {
        headers: {
          "x-devmoter-terminal-token": terminalRecord.token
        }
      }
    );
    if (expectedRevision !== undefined && expectedRevision !== terminalRevision) return;
    const payload = await jsonOrError<{ session: TerminalSession }>(response);
    if (expectedRevision !== undefined && expectedRevision !== terminalRevision) return;
    if (!terminalRecord) return;
    terminalRecord.session = payload.session;
    saveTerminalRecord(terminalRecord);
    lastSeq = Math.min(lastSeq, payload.session.seq);
    terminalStatus.textContent = payload.session.closed
      ? t("terminal.closedWithExit", { code: String(payload.session.exitCode ?? "") })
      : t("terminal.reattachedStatus", {
        project: payload.session.projectName,
        cwd: payload.session.cwd
      });
    await ensureTerminalRenderer();
    if (expectedRevision !== undefined && expectedRevision !== terminalRevision) return;
    void connectTerminalSocket();
  }

  async function killTerminal() {
    if (!terminalRecord) {
      terminalStatus.textContent = t("terminal.noSessionToKill");
      return;
    }
    if (terminalRecord.session.persistent && !window.confirm(t("terminal.killConfirm", {
      name: terminalRecord.session.name || t("terminal.defaultName")
    }))) {
      return;
    }
    const response = await terminalFetch(
      `/api/terminal/sessions/${encodeURIComponent(terminalRecord.session.id)}`,
      {
        method: "DELETE",
        headers: {
          "x-devmoter-terminal-token": terminalRecord.token,
          "x-pocket-operation-id": `terminal-kill-${uid()}`
        }
      }
    );
    await jsonOrError(response);
    disconnectTerminalSocket();
    terminalStatus.textContent = t("terminal.killedStatus");
    saveTerminalRecord(null);
    terminalRecord = null;
  }

  async function renderSafety() {
    const revision = ++safetyRevision;
    let approvalList = safetySection.querySelector<HTMLElement>("[data-safety-approval-list]");
    if (!approvalList) {
      const scanner = document.createElement("div");
      scanner.className = "dm-tools-card";
      const scannerTitle = document.createElement("strong");
      scannerTitle.textContent = t("safety.commandCheckHeading");
      const command = document.createElement("textarea");
      command.setAttribute("aria-label", t("safety.commandAria"));
      command.placeholder = t("safety.commandPlaceholder");
      const scanButton = button(t("safety.scanBtn"));
      scanButton.classList.add("primary");
      const scanResult = document.createElement("pre");
      scanResult.setAttribute("role", "status");
      scanResult.setAttribute("aria-live", "polite");
      scanButton.addEventListener("click", () => {
        scanButton.disabled = true;
        scanResult.textContent = t("safety.scanning");
        void (async () => {
          try {
            const response = await fetch("/api/safety/command-scan", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ command: command.value })
            });
            const payload = await jsonOrError<{
              command: string;
              dangerous: boolean;
              risk: string;
              reasons: string[];
              note: string;
            }>(response);
            scanner.classList.toggle("dm-risk-high", payload.dangerous === true);
            scanner.classList.toggle("dm-risk-low", payload.dangerous === false);
            const risk = typeof payload.risk === "string" && payload.risk
              ? translateServerMessage(payload.risk)
              : t("safety.riskUnknown");
            const returnedCommand = typeof payload.command === "string" ? payload.command : t("safety.notReturned");
            const reasons = Array.isArray(payload.reasons)
              ? payload.reasons.filter(reason => typeof reason === "string").map(reason => translateServerMessage(reason))
              : [];
            scanResult.textContent = [
              t("safety.riskLabel", { risk }),
              t("safety.commandLabel", { command: returnedCommand }),
              ...reasons.map(reason => `• ${reason}`),
              ...(typeof payload.note === "string" && payload.note ? [translateServerMessage(payload.note)] : [])
            ].join("\n");
          } catch (error) {
            scanner.classList.remove("dm-risk-high", "dm-risk-low");
            if (showSectionGate(safetySection, error)) {
              scanResult.textContent = "";
              return;
            }
            scanResult.textContent = errorMessage(error);
          } finally {
            scanButton.disabled = false;
          }
        })();
      });
      scanner.append(scannerTitle, command, scanButton, scanResult);

      const approvals = document.createElement("div");
      approvals.className = "dm-tools-card";
      const approvalsTitle = document.createElement("strong");
      approvalsTitle.textContent = t("safety.rememberedApprovalsHeading");
      approvalList = document.createElement("div");
      approvalList.className = "dm-tools-list";
      approvalList.dataset.safetyApprovalList = "true";
      approvals.append(approvalsTitle, approvalList);
      safetySection.append(scanner, approvals);
    }
    approvalList.replaceChildren();

    try {
      const [authError, response] = await Promise.all([
        checkTrustedDeviceStatus(),
        fetch("/api/safety/permissions", { cache: "no-store" })
      ]);
      if (revision !== safetyRevision) return;
      if (authError && showSectionGate(safetySection, authError)) return;
      const payload = await jsonOrError<{ rules?: PermissionRule[] }>(response);
      if (revision !== safetyRevision) return;
      clearSectionGate(safetySection);
      const rules = payload.rules || [];
      if (!rules.length) {
        const empty = document.createElement("small");
        empty.textContent = t("safety.noRememberedApprovals");
        approvalList.append(empty);
      }
      for (const rule of rules) {
        const row = document.createElement("div");
        row.className = "dm-tools-card";
        const name = document.createElement("strong");
        name.textContent = `${rule.scope.backend || t("safety.backendFallback")} · ${rule.scope.tool || t("safety.toolFallback")}`;
        const detail = document.createElement("pre");
        detail.textContent = scopeSummary(rule);
        const revoke = button(t("safety.revokeBtn"));
        revoke.addEventListener("click", () => {
          revoke.disabled = true;
          void (async () => {
            try {
              const response = await fetch(`/api/safety/permissions/${encodeURIComponent(rule.id)}`, {
                method: "DELETE",
                headers: { "x-pocket-operation-id": `permission-revoke-${uid()}` }
              });
              await jsonOrError(response);
              await renderSafety();
            } catch (error) {
              if (showSectionGate(safetySection, error)) return;
              const fail = document.createElement("small");
              fail.textContent = errorMessage(error);
              row.append(fail);
              revoke.disabled = false;
            }
          })();
        });
        row.append(name, detail, revoke);
        approvalList.append(row);
      }
    } catch (error) {
      if (revision !== safetyRevision) return;
      if (showSectionGate(safetySection, error)) return;
      const fail = document.createElement("small");
      fail.textContent = errorMessage(error);
      approvalList.append(fail);
    }
  }
  refreshSafetyView = renderSafety;

  async function renderIndex() {
    indexSection.replaceChildren();

    const row = document.createElement("div");
    row.className = "dm-tools-row";
    const label = document.createElement("label");
    label.textContent = t("index.projectLabel");
    const select = document.createElement("select");
    indexProjectSelect = select;
    renderProjectOptions();
    select.dataset.previousProject = select.value;
    label.append(select);
    row.append(label);

    const excludeLabel = document.createElement("label");
    excludeLabel.textContent = t("index.excludeLabel");
    const excludes = document.createElement("input");
    excludes.placeholder = "private, fixtures/secrets";
    let excludesTouched = false;
    const excludesDrafts = new Map<string, string>();
    excludes.addEventListener("input", () => {
      excludesTouched = true;
      excludesDrafts.set(select.value, excludes.value);
    });
    excludeLabel.append(excludes);

    const actions = document.createElement("div");
    actions.className = "dm-tools-row";
    const rebuild = button(t("index.rebuildBtn"));
    const remove = button(t("index.deleteBtn"));
    const showMap = button(t("index.repoMapBtn"));
    actions.append(rebuild, remove, showMap);

    const searchLabel = document.createElement("label");
    searchLabel.textContent = t("index.searchLabel");
    const query = document.createElement("input");
    query.placeholder = t("index.searchPlaceholder");
    searchLabel.append(query);
    const searchButton = button(t("index.searchBtn"));

    const status = document.createElement("div");
    status.className = "dm-terminal-status";
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    const results = document.createElement("div");
    results.className = "dm-tools-list";

    // Everyday actions first; excludes and Delete index wait under Details.
    actions.replaceChildren(rebuild, showMap);
    const advanced = document.createElement("details");
    advanced.className = "dm-tools-details";
    const advancedSummary = document.createElement("summary");
    advancedSummary.textContent = t("index.detailsSummary");
    const advancedActions = document.createElement("div");
    advancedActions.className = "dm-tools-row";
    advancedActions.append(remove);
    advanced.append(advancedSummary, excludeLabel, advancedActions);
    const searchRow = document.createElement("div");
    searchRow.className = "dm-tools-row";
    searchRow.append(searchLabel, searchButton);

    indexSection.append(row, actions, advanced, searchRow, status, results);

    const currentProject = () => select.value || activeProjectId;
    let projectRevision = 0;
    let indexStatusRevision = 0;
    const showIndexError = (error: unknown) => {
      status.textContent = showSectionGate(indexSection, error) ? "" : errorMessage(error);
    };

    async function refreshStatus() {
      const trustCheck = checkTrustedDeviceStatus();
      const projectId = currentProject();
      const revision = projectRevision;
      const statusRevision = ++indexStatusRevision;
      if (!projectId) {
        const authError = await trustCheck;
        if (revision !== projectRevision || statusRevision !== indexStatusRevision) return;
        if (authError && showSectionGate(indexSection, authError)) {
          status.textContent = "";
          return;
        }
        clearSectionGate(indexSection);
        return;
      }
      status.textContent = t("index.loadingStatus");
      try {
        const [authError, response] = await Promise.all([
          trustCheck,
          fetch(`/api/projects/${encodeURIComponent(projectId)}/index/status`, { cache: "no-store" })
        ]);
        if (revision !== projectRevision || statusRevision !== indexStatusRevision || projectId !== currentProject()) return;
        if (authError && showSectionGate(indexSection, authError)) {
          status.textContent = "";
          return;
        }
        const payload = await jsonOrError<{
          ready: boolean;
          builtAt?: number;
          files?: number;
          indexedBytes?: number;
          reusedFiles?: number;
          exclude?: string[];
        }>(response);
        if (revision !== projectRevision || statusRevision !== indexStatusRevision || projectId !== currentProject()) return;
        clearSectionGate(indexSection);
        status.textContent = payload.ready
          ? t("index.readyStatus", {
            files: formatNumber(payload.files || 0),
            kib: formatNumber(Math.round((payload.indexedBytes || 0) / 1024)),
            reused: formatNumber(payload.reusedFiles || 0)
          })
          : t("index.notBuiltStatus");
        if (payload.exclude?.length && !excludesTouched) excludes.value = payload.exclude.join(", ");
      } catch (error) {
        if (revision === projectRevision && statusRevision === indexStatusRevision && projectId === currentProject()) {
          showIndexError(error);
        }
      }
    }
    refreshIndexView = refreshStatus;

    select.addEventListener("change", () => {
      excludesDrafts.set(select.dataset.previousProject || "", excludes.value);
      const nextProject = select.value;
      select.dataset.previousProject = nextProject;
      activeProjectId = select.value;
      projectRevision += 1;
      results.replaceChildren();
      excludesTouched = excludesDrafts.has(nextProject);
      excludes.value = excludesDrafts.get(nextProject) || "";
      localStorage.setItem("opencode-pocket-project", activeProjectId);
      if (projectSelect && projects.some(project => project.id === activeProjectId)) projectSelect.value = activeProjectId;
      void refreshStatus().catch(() => {});
    });

    rebuild.addEventListener("click", async () => {
      const projectId = currentProject();
      const revision = projectRevision;
      results.replaceChildren();
      status.textContent = t("index.buildingStatus");
      rebuild.disabled = true;
      remove.disabled = true;
      select.disabled = true;
      try {
        const exclude = excludes.value.split(",").map(value => value.trim()).filter(Boolean);
        const response = await fetch(
          `/api/projects/${encodeURIComponent(projectId)}/index/rebuild`,
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "x-pocket-operation-id": `index-rebuild-${uid()}`
            },
            body: JSON.stringify({ exclude })
          }
        );
        const payload = await jsonOrError<{ files: number; indexedBytes: number; reusedFiles: number }>(response);
        if (revision === projectRevision && projectId === currentProject()) {
          status.textContent = t("index.builtStatus", {
            files: formatNumber(payload.files),
            kib: formatNumber(Math.round(payload.indexedBytes / 1024)),
            reused: formatNumber(payload.reusedFiles)
          });
        }
      } catch (error) {
        if (revision === projectRevision) showIndexError(error);
      } finally {
        rebuild.disabled = false;
        remove.disabled = false;
        select.disabled = false;
      }
    });

    remove.addEventListener("click", async () => {
      const projectId = currentProject();
      const revision = projectRevision;
      remove.disabled = true;
      rebuild.disabled = true;
      select.disabled = true;
      status.textContent = t("index.deletingStatus");
      try {
        const response = await fetch(
          `/api/projects/${encodeURIComponent(projectId)}/index`,
          {
            method: "DELETE",
            headers: { "x-pocket-operation-id": `index-delete-${uid()}` }
          }
        );
        await jsonOrError(response);
        if (revision === projectRevision && projectId === currentProject()) {
          results.replaceChildren();
          status.textContent = t("index.deletedStatus");
        }
      } catch (error) {
        if (revision === projectRevision) showIndexError(error);
      } finally {
        remove.disabled = false;
        rebuild.disabled = false;
        select.disabled = false;
      }
    });

    searchButton.addEventListener("click", async () => {
      const projectId = currentProject();
      const revision = projectRevision;
      results.replaceChildren();
      status.textContent = t("index.searchingStatus");
      searchButton.disabled = true;
      try {
        const response = await fetch(
          `/api/projects/${encodeURIComponent(projectId)}/index/search?q=${encodeURIComponent(query.value)}`,
          { cache: "no-store" }
        );
        const payload = await jsonOrError<{
          results?: Array<{ path: string; line: number; snippet: string; score: number }>;
        }>(response);
        if (revision !== projectRevision || projectId !== currentProject()) return;
        const count = (payload.results || []).length;
        status.textContent = count === 1
          ? t("index.searchResultsOne")
          : t("index.searchResultsMany", { count: formatNumber(count) });
        for (const item of payload.results || []) {
          const card = document.createElement("div");
          card.className = "dm-tools-card";
          const name = document.createElement("strong");
          name.textContent = `${item.path}:${item.line}`;
          const snippet = document.createElement("pre");
          snippet.textContent = item.snippet;
          card.append(name, snippet);
          results.append(card);
        }
        if (!(payload.results || []).length) {
          const empty = document.createElement("small");
          empty.textContent = t("index.noMatches");
          results.append(empty);
        }
      } catch (error) {
        if (revision === projectRevision) showIndexError(error);
      } finally {
        searchButton.disabled = false;
      }
    });

    showMap.addEventListener("click", async () => {
      const projectId = currentProject();
      const revision = projectRevision;
      results.replaceChildren();
      status.dataset.state = "loading";
      status.textContent = t("index.loadingMapStatus");
      showMap.disabled = true;
      try {
        const response = await fetch(
          `/api/projects/${encodeURIComponent(projectId)}/map`,
          { cache: "no-store" }
        );
        const payload = await jsonOrError<{
          directories?: Array<{ path: string; fileCount: number }>;
          symbols?: Array<{ name: string; kind: string; path: string; line: number }>;
        }>(response);
        if (revision !== projectRevision || projectId !== currentProject()) return;
        status.dataset.state = "ok";
        status.textContent = t("index.mapLoadedStatus");
        const directoryCard = document.createElement("div");
        directoryCard.className = "dm-tools-card";
        const directoryTitle = document.createElement("strong");
        directoryTitle.textContent = t("index.structureTitle");
        const directoryText = document.createElement("pre");
        directoryText.textContent = (payload.directories || [])
          .slice(0, 120)
          .map(item => `${item.path}  (${item.fileCount})`)
          .join("\n");
        directoryCard.append(directoryTitle, directoryText);
        results.append(directoryCard);

        const symbolCard = document.createElement("div");
        symbolCard.className = "dm-tools-card";
        const symbolTitle = document.createElement("strong");
        symbolTitle.textContent = t("index.symbolsTitle");
        const symbolText = document.createElement("pre");
        symbolText.textContent = (payload.symbols || [])
          .slice(0, 220)
          .map(item => `${item.kind} ${item.name} — ${item.path}:${item.line}`)
          .join("\n");
        symbolCard.append(symbolTitle, symbolText);
        results.append(symbolCard);
      } catch (error) {
        if (revision === projectRevision) {
          status.dataset.state = "error";
          status.textContent = t("index.mapFailedStatus", { error: errorMessage(error) });
          if (showSectionGate(indexSection, error)) status.textContent = "";
        }
      } finally {
        showMap.disabled = false;
      }
    });

    await refreshStatus().catch(showIndexError);
  }

  renderTerminalShell();
  const initialRevision = terminalRevision;
  void loadProjects().then(() => {
    if (initialRevision !== terminalRevision) return false;
    renderProjectOptions();
    if (indexInitialized && !indexSection.classList.contains("hidden")) void refreshIndexView?.();
    return refreshTerminalSessions();
  }, error => {
    if (initialRevision === terminalRevision) showTerminalLoadError(error);
    return false;
  }).catch(showTerminalLoadError);
}
