import { mountNoaWorkspace } from "./noa-workspace";
import "./style.css";
import { mountOpenCodeRemote } from "./opencode";
import { mountCodexRemote } from "./codex";
import { mountApiChat } from "./api-chat";
import { startI18n } from "./i18n";
import { mountIntegrations } from "./integrations";
import { mountQwenChat } from "./qwen-chat";
import { mountAgentConsole } from "./agent-console";
import { mountSessionControl } from "./session-control";
import { mountWorkspaceTools } from "./workspace-tools";
import { mountAdvancedTools } from "./advanced";
import { mountTaskWorkflow } from "./workflow";
import { mountDemo } from "./demo";
import { mountSystemPanel } from "./system-panel";
import { mountRemoteControlCenter } from "./remote-control";
import { startWorkspaceControl } from "./workspace-control";
import { mountSettingsPanel } from "./settings";
import { mountSetupWizard } from "./setup-wizard";
import { mountUnifiedFeatureShell } from "./app-shell";
import { startViewportSync } from "./visual-viewport.mjs";
import { startPasteSecretGuard } from "./paste-secret-guard.mjs";
import { mountHomeSurface } from "./home";
import { mountMissionControl } from "./mission-control";
import { mountKnowledge } from "./knowledge";
import { createSurfaceNavigation, type MainSurface } from "./surface-navigation.mjs";
import {
  DEFAULT_VISIBLE_BACKEND,
  QWEN_UI_ENABLED,
  isHiddenQwenTarget,
  isVisibleChatBackend,
  normalizeVisibleBackend,
  normalizeVisibleSurface
} from "./feature-flags.mjs";
import "./zcode-theme.css";

const app = document.querySelector<HTMLDivElement>("#app")!;
// One visualViewport listener publishes --dm-viewport-height / --dm-keyboard-inset
// and keeps focused fields above the iOS keyboard for every surface.
startViewportSync(window);
startPasteSecretGuard(document);
startI18n();
const startupParams = new URLSearchParams(window.location.search);

const requestedProject = startupParams.get("project");
const hasProjectDeepLink = Boolean(requestedProject);
if (requestedProject) {
  localStorage.setItem("opencode-pocket-project", requestedProject);
  startupParams.delete("project");
  const nextQuery = startupParams.toString();
  window.history.replaceState(
    window.history.state,
    "",
    window.location.pathname + (nextQuery ? "?" + nextQuery : "") + window.location.hash
  );
}

if (startupParams.get("workspace") === "1") {
  mountNoaWorkspace(app);
} else if (startupParams.get("demo") === "1") {
  mountDemo(app);
} else if (startupParams.get("setup") === "1") {
  mountSetupWizard(app);
} else {
app.innerHTML = `
  <main id="devmoterHomeView" class="dm-home-view hidden" aria-labelledby="devmoterHomeTitle"></main>
  <div id="openCodeView" class="pocket-view"><div id="openCodeMount"></div></div>
  <div id="codexView" class="pocket-view hidden"><div id="codexMount"></div></div>
  <div id="apiView" class="pocket-view hidden"><div id="apiMount"></div></div>
  <div id="qwenView" class="pocket-view hidden"><div id="qwenMount"></div></div>
  <div id="integrationsView" class="pocket-view hidden"><div id="integrationsMount"></div></div>
  <div id="workflowMount"></div>
`;

const openCodeView = document.querySelector<HTMLDivElement>("#openCodeView")!;
const homeView = document.querySelector<HTMLElement>("#devmoterHomeView")!;
const codexView = document.querySelector<HTMLDivElement>("#codexView")!;
const apiView = document.querySelector<HTMLDivElement>("#apiView")!;
const qwenView = document.querySelector<HTMLDivElement>("#qwenView")!;
const integrationsView = document.querySelector<HTMLDivElement>("#integrationsView")!;
const openCodeMount = document.querySelector<HTMLDivElement>("#openCodeMount")!;
const codexMount = document.querySelector<HTMLDivElement>("#codexMount")!;
const apiMount = document.querySelector<HTMLDivElement>("#apiMount")!;
const integrationsMount = document.querySelector<HTMLDivElement>("#integrationsMount")!;
const workflowMount = document.querySelector<HTMLDivElement>("#workflowMount")!;

type Backend = "opencode" | "codex" | "api" | "qwen" | "integrations";

const deepLinkBackend = startupParams.get("backend");
const deepLinkSession = startupParams.get("session");
if (isVisibleChatBackend(deepLinkBackend)) {
  localStorage.setItem("opencode-pocket-backend", deepLinkBackend);
  if (deepLinkSession && deepLinkBackend !== "api" && deepLinkBackend !== "qwen") {
    localStorage.setItem(
      deepLinkBackend === "codex" ? "opencode-pocket-codex-thread" : "opencode-pocket-opencode-session",
      deepLinkSession
    );
  }
}

const savedBackend = localStorage.getItem("opencode-pocket-backend");
let activeBackend: Backend =
  savedBackend === "integrations" || isVisibleChatBackend(savedBackend)
    ? savedBackend
    : DEFAULT_VISIBLE_BACKEND;

let surfaceNavigation: ReturnType<typeof createSurfaceNavigation> | null = null;
let initialSurfaceApplied = false;

function applyBackend(next: Backend) {
  const requestedHiddenQwen = isHiddenQwenTarget(next);
  const preserveHiddenQwen = !QWEN_UI_ENABLED && localStorage.getItem("opencode-pocket-backend") === "qwen";
  const resolved: Backend = requestedHiddenQwen ? DEFAULT_VISIBLE_BACKEND : next;
  activeBackend = resolved;
  if (!requestedHiddenQwen && !(preserveHiddenQwen && resolved === DEFAULT_VISIBLE_BACKEND)) {
    localStorage.setItem("opencode-pocket-backend", resolved);
  }
  homeView.classList.add("hidden");
  document.body.classList.remove("devmoter-home-mode");
  openCodeView.classList.toggle("hidden", resolved !== "opencode");
  codexView.classList.toggle("hidden", resolved !== "codex");
  apiView.classList.toggle("hidden", resolved !== "api");
  qwenView.classList.toggle("hidden", !QWEN_UI_ENABLED || resolved !== "qwen");
  integrationsView.classList.toggle("hidden", resolved !== "integrations");
  document.body.classList.toggle("codex-mode", resolved === "codex");
  document.body.classList.toggle("opencode-mode", resolved === "opencode");
  document.body.classList.toggle("api-mode", resolved === "api");
  document.body.classList.toggle("qwen-mode", QWEN_UI_ENABLED && resolved === "qwen");
  document.body.classList.toggle("integrations-mode", resolved === "integrations");
  if (resolved === "api") void apiRemote.refresh();
  if (QWEN_UI_ENABLED && resolved === "qwen") void qwenRemote?.refresh();
  if (resolved === "integrations") void integrationsRemote.refresh();
  window.dispatchEvent(new CustomEvent("devmoter:backend-changed", { detail: { backend: resolved } }));
}

function setBackend(next: Backend) {
  next = next === "integrations" ? "integrations" : normalizeVisibleBackend(next);
  if (surfaceNavigation && surfaceNavigation.current() !== next) {
    surfaceNavigation.navigate(next);
    return;
  }
  applyBackend(next);
}

function applySurface(surface: MainSurface) {
  const resolvedSurface = normalizeVisibleSurface(surface);
  const restoreHomeFocus = initialSurfaceApplied && resolvedSurface === "home";
  initialSurfaceApplied = true;
  window.dispatchEvent(new CustomEvent("devmoter:surface-changed", { detail: { surface: resolvedSurface } }));
  if (resolvedSurface === "home") {
    homeView.classList.remove("hidden");
    openCodeView.classList.add("hidden");
    codexView.classList.add("hidden");
    apiView.classList.add("hidden");
    qwenView.classList.add("hidden");
    integrationsView.classList.add("hidden");
    document.body.classList.remove("codex-mode", "opencode-mode", "api-mode", "qwen-mode", "integrations-mode");
    document.body.classList.add("devmoter-home-mode");
    if (restoreHomeFocus) window.requestAnimationFrame(() => homeView.querySelector<HTMLElement>("#devmoterHomeTitle")?.focus({ preventScroll: true }));
    return;
  }
  applyBackend(resolvedSurface);
}

mountHomeSurface(homeView, {
  // Home React shortcuts navigate through the existing surface controller.
  onSwitchBackend: backend => setBackend(backend),
  onPreviewApp: (id, message) => {
    window.dispatchEvent(new CustomEvent("devmoter:app-preview", { detail: { id, message } }));
  },
  onLaunchApp: id => {
    void controlCenterReady.then(() => {
      window.dispatchEvent(new CustomEvent("devmoter:launch-app", { detail: { id } }));
    });
  }
});

surfaceNavigation = createSurfaceNavigation({
  window,
  hasProjectDeepLink,
  savedBackend: activeBackend,
  onSurface: applySurface
});

const openCodeRemote = mountOpenCodeRemote(openCodeMount);
const codexRemote = mountCodexRemote(codexMount, {
  onOpenCode: () => setBackend("opencode"),
  onApi: () => setBackend("api"),
  onIntegrations: () => setBackend("integrations")
});
const apiRemote = mountApiChat(apiMount, {
  onCodex: () => setBackend("codex"),
  onOpenCode: () => setBackend("opencode")
});

const qwenRemote = QWEN_UI_ENABLED
  ? mountQwenChat(document.querySelector<HTMLDivElement>("#qwenMount")!, {
      onIntegrations: () => setBackend("integrations")
    })
  : null;

const integrationsRemote = mountIntegrations(integrationsMount, {
  onOpenCode: () => setBackend("opencode"),
  onCodex: () => setBackend("codex")
});

startI18n();
mountMissionControl();
mountKnowledge();
mountAgentConsole();
mountSessionControl({ switchBackend: backend => setBackend(backend) });
mountWorkspaceTools();
mountAdvancedTools();
const controlCenterReady = import("./control-center").then(({ mountControlCenter }) => mountControlCenter());
// Review is a temporary overlay shared by Home and all chat surfaces.
// Its mount stays available; the workflow owns modal visibility.
mountTaskWorkflow(workflowMount);
mountSystemPanel();
mountRemoteControlCenter();
mountSettingsPanel();
startWorkspaceControl();
void controlCenterReady.then(() => {
  mountUnifiedFeatureShell({
    switchBackend: backend => setBackend(backend),
    initialBackend: activeBackend,
    initialSurface: surfaceNavigation?.current() || "home",
    openHome: () => surfaceNavigation?.navigate("home")
  });
});

let healthCheckInFlight = false;
async function checkHealth() {
  if (healthCheckInFlight) return;
  healthCheckInFlight = true;
  try {
    const res = await fetch("/api/health", { cache: "no-store" });
    const payload = await res.json();
    openCodeRemote.setOnline(Boolean(payload?.backends?.opencode?.online));
    const codexHealth = payload?.backends?.codex;
    const codexCode = codexHealth?.code;
    const codexLaunchFailed = codexCode === "not_installed" || codexCode === "not_executable" || codexCode === "failed";
    codexRemote.setOnline(
      Boolean(codexHealth?.online),
      codexLaunchFailed ? String(codexHealth?.error || "") : "",
      codexLaunchFailed ? codexCode : ""
    );
  } catch {
    openCodeRemote.setOnline(false);
    codexRemote.setOnline(false);
  } finally {
    healthCheckInFlight = false;
  }
}

applySurface(surfaceNavigation.current());
void checkHealth();
window.setInterval(() => void checkHealth(), 15000);
window.addEventListener("offline", () => {
  openCodeRemote.setOnline(false);
  codexRemote.setOnline(false);
});
window.addEventListener("online", () => void checkHealth());
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") void checkHealth();
});
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(console.error));
}
}
