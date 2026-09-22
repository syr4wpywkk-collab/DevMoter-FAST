import "./style.css";
import { mountOpenCodeRemote } from "./opencode";
import { mountCodexRemote } from "./codex";
import { mountApiChat } from "./api-chat";
import { startI18n } from "./i18n";

const app = document.querySelector<HTMLDivElement>("#app")!;

app.innerHTML = `
  <div id="openCodeView" class="pocket-view"><div id="openCodeMount"></div></div>
  <div id="codexView" class="pocket-view hidden"><div id="codexMount"></div></div>
  <div id="apiView" class="pocket-view hidden"><div id="apiMount"></div></div>
`;

const openCodeView = document.querySelector<HTMLDivElement>("#openCodeView")!;
const codexView = document.querySelector<HTMLDivElement>("#codexView")!;
const apiView = document.querySelector<HTMLDivElement>("#apiView")!;
const openCodeMount = document.querySelector<HTMLDivElement>("#openCodeMount")!;
const codexMount = document.querySelector<HTMLDivElement>("#codexMount")!;
const apiMount = document.querySelector<HTMLDivElement>("#apiMount")!;

type Backend = "opencode" | "codex" | "api";

const savedBackend = localStorage.getItem("opencode-pocket-backend");
let activeBackend: Backend = savedBackend === "codex" || savedBackend === "api" ? savedBackend : "opencode";

function setBackend(next: Backend) {
  activeBackend = next;
  localStorage.setItem("opencode-pocket-backend", next);
  openCodeView.classList.toggle("hidden", next !== "opencode");
  codexView.classList.toggle("hidden", next !== "codex");
  apiView.classList.toggle("hidden", next !== "api");
  document.body.classList.toggle("codex-mode", next === "codex");
  document.body.classList.toggle("opencode-mode", next === "opencode");
  document.body.classList.toggle("api-mode", next === "api");
}

const openCodeRemote = mountOpenCodeRemote(openCodeMount, {
  onCodex: () => setBackend("codex"),
  onApi: () => setBackend("api")
});
const codexRemote = mountCodexRemote(codexMount, {
  onOpenCode: () => setBackend("opencode"),
  onApi: () => setBackend("api")
});
const apiRemote = mountApiChat(apiMount, {
  onCodex: () => setBackend("codex"),
  onOpenCode: () => setBackend("opencode")
});

startI18n();

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

setBackend(activeBackend);
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
