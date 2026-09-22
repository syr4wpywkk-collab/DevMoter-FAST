import "./session-control.css";

type Backend = "codex" | "opencode";
type Status = "running" | "waiting" | "done" | "idle" | "failed" | "interrupted" | "unknown";
type Json = Record<string, any>;
type Session = {
  key: string; id: string; backend: Backend; title: string; project: string; projectId?: string;
  agent: string; model: string; updatedAt: number; status: Status; turns: number; tokens: number;
  activeTurnId?: string | null; excerpt?: string;
};
type Message = { role: "user" | "assistant" | "system"; text: string };
type ControlState = { version: 1; queue: Json[]; budgets: Record<string, Json>; ownership: Record<string, Json>; checkpoints: Json[]; events: Json[] };
type MountOptions = { switchBackend?: (backend: Backend) => void };

const MAX_SCAN = 40;
const MAX_MESSAGES = 80;
const MAX_CHARS = 28000;

function uid() { return globalThis.crypto?.randomUUID?.() ?? Date.now().toString(36) + Math.random().toString(36).slice(2); }
function keyOf(backend: Backend, id: string) { return backend + ":" + id; }
function label(backend: Backend) { return backend === "codex" ? "Codex" : "OpenCode"; }
function statusLabel(value: Status) { return ({running:"Running",waiting:"Waiting",done:"Done",idle:"Idle",failed:"Failed",interrupted:"Interrupted",unknown:"Unknown"} as Record<Status,string>)[value]; }
function statusFrom(value: unknown): Status {
  const raw = typeof value === "string" ? value : String((value as Json)?.type || (value as Json)?.status || (value as Json)?.state || "");
  const text = raw.toLowerCase();
  if (/wait|approval|question|input/.test(text)) return "waiting";
  if (/run|work|progress|active|start/.test(text)) return "running";
  if (/fail|error/.test(text)) return "failed";
  if (/interrupt|cancel|abort|stop/.test(text)) return "interrupted";
  if (/complete|success|done|finish/.test(text)) return "done";
  if (/idle|ready/.test(text)) return "idle";
  return "unknown";
}
function tokenMetric(value: unknown): number {
  if (!value || typeof value !== "object") return 0;
  const obj = value as Json;
  for (const k of ["totalTokens","total_tokens","total"]) { const n = Number(obj[k]); if (Number.isFinite(n) && n >= 0) return n; }
  const direct = ["inputTokens","input_tokens","input","outputTokens","output_tokens","output","reasoningTokens","reasoning_tokens","reasoning"].map(k => Number(obj[k])).filter(Number.isFinite);
  if (direct.length) return direct.reduce((a,b) => a+b,0);
  let best = 0; for (const child of Object.values(obj)) best = Math.max(best, tokenMetric(child)); return best;
}
async function json<T=Json>(url: string, init: RequestInit = {}): Promise<T> {
  const method = String(init.method || "GET").toUpperCase();
  const res = await fetch(url, { ...init, headers: { ...(init.body ? {"content-type":"application/json"} : {}), ...((method !== "GET" && method !== "HEAD") ? {"x-pocket-operation-id":uid()} : {}), ...(init.headers || {}) }, cache: method === "GET" ? "no-store" : undefined });
  if (res.status === 204) return undefined as T;
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(payload?.error?.message || payload?.error || payload?.message || ("HTTP " + res.status));
  return payload as T;
}
async function codex<T=Json>(method: string, params: Json = {}): Promise<T> {
  const out = await json<{result?:T}>("/api/codex/rpc", {method:"POST", body:JSON.stringify({method,params})}); return out.result as T;
}
async function oc<T=Json>(path: string, init: RequestInit = {}, projectId?: string): Promise<T> {
  const out = await json<any>("/api/opencode" + path, { ...init, headers: { ...(projectId ? {"x-pocket-project-id":projectId} : {}), ...(init.headers || {}) } });
  return out && typeof out === "object" && !Array.isArray(out) && Object.prototype.hasOwnProperty.call(out,"data") ? out.data as T : out as T;
}
function compact(messages: Message[]) {
  const picked = messages.slice(-MAX_MESSAGES); const out: Message[] = []; let left = MAX_CHARS;
  for (let i=picked.length-1;i>=0 && left>0;i--) { const m=picked[i]; const text=m.text.slice(Math.max(0,m.text.length-left)); left-=text.length; out.unshift({...m,text}); }
  return out;
}
function filesFrom(messages: Message[]) {
  const found = new Set<string>(); const re = /(?:^|\s)([./~][\w@%+.,:=~/-]+\.[A-Za-z0-9]{1,12}|[A-Za-z0-9_.-]+\/[A-Za-z0-9_./-]+\.[A-Za-z0-9]{1,12})/g;
  for (const m of messages) for (const match of m.text.matchAll(re)) if (match[1]) found.add(match[1].replace(/[),.;:'"]+$/,""));
  return [...found].slice(0,80);
}
function handoffText(source: Session, messages: Message[], mode: string, note = "") {
  const files = filesFrom(messages); const lines = ["[DevMoter " + mode + "]","Source backend: "+label(source.backend),"Source session: "+source.id,"Source project: "+(source.project||"unknown")];
  if (note) lines.push("Instruction: "+note); lines.push(files.length ? "Referenced files:\n"+files.map(f=>"- "+f).join("\n") : "Referenced files: none detected", "", "Conversation context:");
  messages.forEach((m,i)=>lines.push(String(i+1)+". "+m.role.toUpperCase()+": "+m.text)); return {text:lines.join("\n"),files};
}

export function mountSessionControl(options: MountOptions = {}) {
  let sessions: Session[] = []; let control: ControlState = {version:1,queue:[],budgets:{},ownership:{},checkpoints:[],events:[]};
  let activeTab = "activity"; let searchHits = new Map<string,string>(); let toastTimer:number|null=null;
  const root = document.createElement("div"); root.className="sc-shell";
  root.innerHTML = [
    '<button class="sc-fab" type="button" aria-label="Session Control">✦</button>',
    '<div class="sc-scrim hidden"></div>',
    '<section class="sc-panel" aria-hidden="true">',
    '<header class="sc-head"><div><strong>Session Control</strong><small>#31–#40 · local-first</small></div><button class="sc-close" type="button">×</button></header>',
    '<div class="sc-toolbar"><input class="sc-search" type="search" placeholder="Search local session text…"><button class="sc-search-run" type="button">Search</button><select class="sc-backend"><option value="">All agents</option><option value="codex">Codex</option><option value="opencode">OpenCode</option></select><select class="sc-project"><option value="">All projects</option></select><select class="sc-status"><option value="">All states</option><option value="running">Running</option><option value="waiting">Waiting</option><option value="done">Done</option><option value="idle">Idle</option><option value="failed">Failed</option><option value="interrupted">Interrupted</option></select><button class="sc-refresh" type="button">Refresh</button></div>',
    '<div class="sc-tabs"><button class="active" data-tab="activity">Activity</button><button data-tab="queue">Queue <span class="sc-queue-count"></span></button><button data-tab="checkpoints">Checkpoints</button><button data-tab="history">History</button></div>',
    '<div class="sc-body"></div><div class="sc-toast hidden"></div></section>'
  ].join(""); document.body.appendChild(root);
  const panel=root.querySelector<HTMLElement>(".sc-panel")!, scrim=root.querySelector<HTMLElement>(".sc-scrim")!, body=root.querySelector<HTMLDivElement>(".sc-body")!, search=root.querySelector<HTMLInputElement>(".sc-search")!, backendFilter=root.querySelector<HTMLSelectElement>(".sc-backend")!, projectFilter=root.querySelector<HTMLSelectElement>(".sc-project")!, statusFilter=root.querySelector<HTMLSelectElement>(".sc-status")!, count=root.querySelector<HTMLElement>(".sc-queue-count")!, toast=root.querySelector<HTMLElement>(".sc-toast")!;
  const notify=(text:string)=>{ if(toastTimer!==null) clearTimeout(toastTimer); toast.textContent=text; toast.classList.remove("hidden"); toastTimer=window.setTimeout(()=>toast.classList.add("hidden"),2200); };
  const open=()=>{ panel.classList.add("open"); panel.setAttribute("aria-hidden","false"); scrim.classList.remove("hidden"); void refresh(); };
  const close=()=>{ panel.classList.remove("open"); panel.setA