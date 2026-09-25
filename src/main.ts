import "./style.css";
import { mountOpenCodeRemote } from "./opencode";
import { mountCodexRemote } from "./codex";
import { mountApiChat } from "./api-chat";
import { startI18n } from "./i18n";
import { mountIntegrations } from "./integrations";
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
import { mountHomeSurface } from "./home";
import { createSurfaceNavigation, type MainSurface } from "./surface-navigation.mjs";

const app = document.querySelector<HTMLDivElement>("#app")!;
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

if (startupParams.get("demo") === "1") {
  mountDemo(app);
} else if (startupParams.get("setup") === "1") {
  mountSetupWizard(app);
} else {
app.innerHTML = `
  <main id="devmoterHomeView" class="dm-home-view hidden" aria-labelledby="devmoterHomeTitle"></main>
  <div id="openCodeView" class="pocket-view"><div id="openCodeMount"></div></div>
  <div id="codexView" class="pocket-view hidden"><div id="codexMount"></div></div>
  <div id="apiView" class="pocket-view hidden"><div id="apiMount"></div></div>
  <div id="integrationsView" class="pocket-view hidden"><div id="integrationsMount"></div></div>
  <div id="workflowMount"></div>
`;

const openCodeView = document.querySelector<HTMLDivElement>("#openCodeView")!;
const homeView = document.querySelector<HTMLElement>("#devmoterHomeView")!;
const codexView = document.querySelector<HTMLDivElement>("#codexView")!;
const apiView = document.querySelector<HTMLDivElement>("#apiView")!;
const integrationsView = document.querySelector<HTMLDivElement>("#integrationsView")!;
const openCodeMount = document.querySelector<HTMLDivElement>("#openCodeMount")!;
const codexMount = document.querySelector<HTMLDivElement>("#codexMount")!;
const apiMount = document.querySelector<HTMLDivElement>("#apiMount")!;
const integrationsMount = document.querySelector<HTMLDivElement>("#integrationsMount")!;
const workflowMount = document.querySelector<HTMLDivElement>("#workflowMount")!;

type Backend = "opencode" | "codex" | "api" | "integrations";

const deepLinkBackend = startupParams.get("backend");
const deepLinkSession = startupParams.get("session");
if (deepLinkBackend === "codex" || deepLinkBackend === "opencode" || deepLinkBackend === "api") {
  localStorage.setItem("opencode-pocket-backend", deepLinkBackend);
  if (deepLinkSession && deepLinkBackend !== "api") {
    localStorage.setItem(
      deepLinkBackend === "codex" ? "opencode-pocket-codex-thread" : "opencode-pocket-opencode-session",
      deepLinkSession
    );
  }
}

const savedBackend = localStorage.getItem("opencode-pocket-backend");
let activeBackend: Backend =
  savedBackend === "codex" || savedBackend === "api" || savedBackend === "integrations"
    ? savedBackend
    : "opencode";

let surfaceNavigation: ReturnType<typeof createSurfaceNavigation> | null = null;
let initialSurfaceApplied = false;

function applyBackend(next: Backend) {
  activeBackend = next;
  localStorage.setItem("opencode-pocket-backend", next);
  homeView.classList.add("hidden");
  document.body.classList.remove("devmoter-home-mode");
  openCodeView.classList.toggle("hidden", next !== "opencode");
  codexView.classList.toggle("hidden", next !== "codex");
  apiView.classList.toggle("hidden", next !== "api");
  integrationsView.classList.toggle("hidden", next !== "integrations");
  document.body.classList.toggle("codex-mode", next === "codex");
  document.body.classList.toggle("opencode-mode", next === "opencode");
  document.body.classList.toggle("api-mode", next === "api");
  document.body.classList.toggle("integrations-mode", next === "integrations");
  if (next === "api") void apiRemote.refresh();
  if (next === "integrations") void integrationsRemote.refresh();
  window.dispatchEvent(new CustomEvent("devmoter:backend-changed", { detail: { backend: next } }));
}

function setBackend(next: Backend) {
  if (surfaceNavigation && surfaceNavigation.current() !== next) {
    surfaceNavigation.navigate(next);
    return;
  }
  applyBackend(next);
}

function applySurface(surface: MainSurface) {
  const restoreHomeFocus = initialSurfaceApplied && surface === "home";
  initialSurfaceApplied = true;
  window.dispatchEvent(new CustomEvent("devmoter:surface-changed", { detail: { surface } }));
  if (surface === "home") {
    homeView.classList.remove("hidden");
    openCodeView.classList.add("hidden");
    codexView.classList.add("hidden");
    apiView.classList.add("hidden");
    integrationsView.classList.add("hidden");
    workflowMount.classList.add("hidden");
    document.body.classList.remove("codex-mode", "opencode-mode", "api-mode", "integrations-mode");
    document.body.classList.add("devmoter-home-mode");
    if (restoreHomeFocus) window.requestAnimationFrame(() => homeView.querySelector<HTMLElement>("#devmoterHomeTitle")?.focus({ preventScroll: true }));
    return;
  }
  workflowMount.classList.remove("hidden");
  applyBackend(surface);
}

mountHomeSurface(homeView, {
  onOpenChat: () => {
    const lastBackend = localStorage.getItem("opencode-pocket-backend");
    setBackend(lastBackend === "codex" || lastBackend === "api" ? lastBackend : "opencode");
  },
  onOpenProjects: () => {
    setBackend("codex");
    window.setTimeout(() => document.querySelector<HTMLElement>("#cxProjectsNav")?.click(), 0);
  }
});

surfaceNavigation = createSurfaceNavigation({
  window,
  hasProjectDeepLink,
  savedBackend: activeBackend,
  onSurface: applySurface
});

const openCodeRemote = mountOpenCodeRemote(openCodeMount, {
  onCodex: () => setBackend("codex"),
  onApi: () => setBackend("api"),
  onIntegrations: () => setBackend("integrations")
});
const codexRemote = mountCodexRemote(codexMount, {
  onOpenCode: () => setBackend("opencode"),
  onApi: () => setBackend("api"),
  onIntegrations: () => setBackend("integrations")
});
const apiRemote = mountApiChat(apiMount, {
  onCodex: () => setBackend("codex"),
  onOpenCode: () => setBackend("opencode")
});

const integrationsRemote = mountIntegrations(integrationsMount, {
  onOpenCode: () => setBackend("opencode"),
  onCodex: () => setBackend("codex")
});

startI18n();
mountAgentConsole();
mountSessionControl({ switchBackend: backend => setBackend(backend) });
mountWorkspaceTools();
mountAdvancedTools();
const controlCenterReady = import("./control-center").then(({ mountControlCenter }) => mountControlCenter());
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
    codexRemote.setOnline(Boolean(payload?.backends?.codex?.online));
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
